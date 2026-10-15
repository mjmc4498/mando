// Mando — service worker.
// Coordina la sesión: crea el documento offscreen que mantiene la conexión WebRTC
// con el celular, decide qué pestaña se controla y le reenvía los comandos.

import { DEFAULT_SETTINGS, ID_PREFIX, getSettings } from './config.js';

const OFFSCREEN_PATH = 'offscreen.html';
const SCRIPTS = [
  { id: 'mando-main', js: ['content/main.js'], world: 'MAIN' },
  { id: 'mando-isolated', js: ['content/isolated.js'], world: 'ISOLATED' },
];
const EMPTY_STATE = { active: false, status: 'idle', error: null, devices: [], targetTabId: null };

// ---------------------------------------------------------------- ajustes

let settings = { ...DEFAULT_SETTINGS };
const settingsReady = getSettings().then((s) => { settings = s; });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  const before = settings.followActiveTab;
  settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
  if (before !== settings.followActiveTab) retarget();
});

// ---------------------------------------------------------------- estado

let state = null;

async function loadState() {
  if (!state) {
    const { state: saved } = await chrome.storage.session.get('state');
    state = { ...EMPTY_STATE, ...(saved || {}) };
  }
  return state;
}

async function patchState(patch) {
  await loadState();
  state = { ...state, ...patch };
  await chrome.storage.session.set({ state });
  updateBadge();
  return state;
}

function updateBadge() {
  const count = state?.active ? state.devices.length : 0;
  chrome.action.setBadgeText({ text: count ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#34C759' });
  chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' });
}

// ---------------------------------------------------------------- identidad

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

function randomId(length) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => ALPHABET[b & 31]).join('');
}

// Se memoriza la promesa para que llamadas simultáneas (popup y offscreen)
// nunca generen identidades distintas.
let identityPromise = null;

function getIdentity(regenerate = false) {
  if (regenerate || !identityPromise) {
    identityPromise = (async () => {
      let identity = regenerate ? null : (await chrome.storage.local.get('identity')).identity;
      if (!identity) {
        identity = { peerId: ID_PREFIX + randomId(16), token: randomId(16) };
        await chrome.storage.local.set({ identity });
      }
      return identity;
    })();
  }
  return identityPromise;
}

// ---------------------------------------------------------------- documento offscreen

let creatingOffscreen = null;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['WEB_RTC'],
      justification: 'Mantener la conexión WebRTC con el celular que controla la presentación.',
    })
    .finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

async function closeOffscreen(reason) {
  if (!(await hasOffscreen())) return;
  await chrome.runtime.sendMessage({ to: 'offscreen', type: 'stop', reason }).catch(() => {});
  await chrome.offscreen.closeDocument().catch(() => {});
}

// ---------------------------------------------------------------- scripts de contenido

async function registerScripts() {
  const ids = SCRIPTS.map((s) => s.id);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids });
  if (existing.length === ids.length) return;
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
  await chrome.scripting.registerContentScripts(SCRIPTS.map((s) => ({
    id: s.id,
    js: s.js,
    world: s.world,
    matches: ['<all_urls>'],
    allFrames: true,
    runAt: 'document_idle',
    persistAcrossSessions: false,
  })));
}

async function unregisterScripts() {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPTS.map((s) => s.id) });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
}

const injecting = new Map();
const blockedTabs = new Set();

function inject(tabId) {
  if (!injecting.has(tabId)) {
    const job = (async () => {
      try {
        for (const s of SCRIPTS) {
          await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: s.js,
            world: s.world,
            injectImmediately: true,
          });
        }
        return true;
      } catch {
        return false;
      }
    })();
    injecting.set(tabId, job);
    job.finally(() => setTimeout(() => injecting.delete(tabId), 500));
  }
  return injecting.get(tabId);
}

async function sendToTab(tabId, cmd, { injectIfMissing = true } = {}) {
  if (blockedTabs.has(tabId)) return { ok: false, error: 'restricted' };
  const message = { mando: cmd };
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch {
    if (!injectIfMissing) return { ok: false, error: 'unreachable' };
    if (!(await inject(tabId))) {
      blockedTabs.add(tabId);
      return { ok: false, error: 'restricted' };
    }
    try {
      return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    } catch {
      return { ok: false, error: 'unreachable' };
    }
  }
}

// ---------------------------------------------------------------- pestaña objetivo

let cachedTarget = null;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function targetTabId() {
  if (cachedTarget != null) return cachedTarget;
  await settingsReady;
  const s = await loadState();
  let tab = null;
  if (!settings.followActiveTab && s.targetTabId != null) {
    tab = await chrome.tabs.get(s.targetTabId).catch(() => null);
  }
  tab ??= await activeTab();
  cachedTarget = tab?.id ?? null;
  if (cachedTarget !== s.targetTabId) await patchState({ targetTabId: cachedTarget });
  return cachedTarget;
}

async function setTarget(tabId) {
  const previous = cachedTarget;
  cachedTarget = tabId;
  await patchState({ targetTabId: tabId });
  if (previous != null && previous !== tabId) sendToTab(previous, { t: 'reset' }, { injectIfMissing: false });
  broadcastTarget();
}

async function retarget() {
  const previous = cachedTarget;
  cachedTarget = null;
  const next = await targetTabId();
  if (next !== previous) {
    if (previous != null) sendToTab(previous, { t: 'reset' }, { injectIfMissing: false });
    broadcastTarget();
  }
}

function isScriptable(url = '') {
  if (!/^(https?|file):/.test(url)) return false;
  return !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url);
}

async function targetInfo() {
  const id = await targetTabId();
  const tab = id == null ? null : await chrome.tabs.get(id).catch(() => null);
  if (!tab) return { t: 'target', title: '', host: '', ok: false };
  let host = '';
  try { host = new URL(tab.url).hostname; } catch {}
  return { t: 'target', title: tab.title || host, host, ok: isScriptable(tab.url) && !blockedTabs.has(id) };
}

let broadcastTimer = 0;
function broadcastTarget() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(async () => {
    if (!(await loadState()).active) return;
    const msg = await targetInfo();
    chrome.runtime.sendMessage({ to: 'offscreen', type: 'broadcast', msg }).catch(() => {});
  }, 250);
}

chrome.tabs.onActivated.addListener(() => { if (settings.followActiveTab) retarget(); });
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (settings.followActiveTab && windowId !== chrome.windows.WINDOW_ID_NONE) retarget();
});
chrome.tabs.onRemoved.addListener((tabId) => {
  blockedTabs.delete(tabId);
  if (tabId === cachedTarget) retarget();
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' || info.url) blockedTabs.delete(tabId);
  if (tabId === cachedTarget && (info.title || info.url)) broadcastTarget();
});

// ---------------------------------------------------------------- ventana

const previousWindowState = new Map();

async function setFullscreen(tabId, on) {
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  const isFull = win.state === 'fullscreen';
  if (on === undefined) on = !isFull;
  if (on && !isFull) {
    previousWindowState.set(win.id, win.state);
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(win.id, { state: 'fullscreen', focused: true });
  } else if (!on && isFull) {
    const prev = previousWindowState.get(win.id);
    await chrome.windows.update(win.id, { state: prev && prev !== 'fullscreen' ? prev : 'normal' });
  }
  return on;
}

async function focusTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

// ---------------------------------------------------------------- comandos del celular

let lastRestrictedNotice = 0;

async function handleCommand(cmd) {
  const tabId = await targetTabId();
  if (tabId == null) return { reply: { t: 'error', error: 'no-target' } };

  if (cmd.t === 'nav') {
    if (cmd.a === 'fullscreen') {
      const fullscreen = await setFullscreen(tabId).catch(() => false);
      return { reply: { t: 'state', fullscreen } };
    }
    if (cmd.a === 'start') {
      await focusTab(tabId).catch(() => {});
      await sendToTab(tabId, cmd);
      const fullscreen = await setFullscreen(tabId, true).catch(() => false);
      return { reply: { t: 'state', fullscreen } };
    }
    if (cmd.a === 'exit') {
      await sendToTab(tabId, cmd);
      await setFullscreen(tabId, false).catch(() => {});
      return { reply: { t: 'state', fullscreen: false, black: false } };
    }
  }

  const res = await sendToTab(tabId, cmd);
  if (res?.error === 'restricted') {
    if (Date.now() - lastRestrictedNotice < 2000) return null;
    lastRestrictedNotice = Date.now();
    return { reply: await targetInfo() };
  }
  if (res?.state) return { reply: { t: 'state', ...res.state } };
  return null;
}

// ---------------------------------------------------------------- enrutamiento a iframes

// Una página puede tener la presentación dentro de un iframe de otro origen
// (p. ej. PowerPoint para la web). El script del marco superior envía una
// sonda de un solo uso al iframe; el script del iframe la reporta y así
// sabemos su frameId sin exponer ninguna clave a la página.
const probes = new Map();

function probeEntry(nonce) {
  let entry = probes.get(nonce);
  if (!entry) {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    entry = { promise, resolve, frame: null };
    probes.set(nonce, entry);
    setTimeout(() => probes.delete(nonce), 5000);
  }
  return entry;
}

async function routeToFrame(nonce, cmd, sender) {
  const entry = probeEntry(nonce);
  const frame = await Promise.race([entry.promise, new Promise((r) => setTimeout(() => r(null), 800))]);
  probes.delete(nonce);
  if (!frame || frame.tabId !== sender.tab?.id) return;
  chrome.tabs.sendMessage(frame.tabId, { mando: cmd, routed: true }, { frameId: frame.frameId }).catch(() => {});
}

// ---------------------------------------------------------------- sesión

async function startSession(tabId) {
  await settingsReady;
  const s = await loadState();
  if (!s.active) {
    // Sesión nueva: con «Código nuevo en cada sesión», el QR anterior deja de servir.
    if (settings.newCodeEachSession) await getIdentity(true);
    await patchState({ active: true, status: 'starting', error: null, devices: [] });
  }
  await registerScripts();
  if (tabId != null) {
    const current = s.targetTabId != null ? await chrome.tabs.get(s.targetTabId).catch(() => null) : null;
    if (!current || !s.active) await setTarget(tabId);
  }
  await ensureOffscreen();
  return snapshot();
}

async function stopSession() {
  await closeOffscreen('stopped');
  await unregisterScripts().catch(() => {});
  const s = await loadState();
  if (s.targetTabId != null) sendToTab(s.targetTabId, { t: 'reset' }, { injectIfMissing: false });
  cachedTarget = null;
  await patchState({ ...EMPTY_STATE });
  return snapshot();
}

async function resetCode() {
  await closeOffscreen('revoked');
  await getIdentity(true);
  const s = await loadState();
  await patchState({ devices: [], status: s.active ? 'starting' : 'idle' });
  if (s.active) await ensureOffscreen();
  return snapshot();
}

async function snapshot() {
  const s = await loadState();
  const identity = await getIdentity();
  let target = null;
  if (s.targetTabId != null) {
    const tab = await chrome.tabs.get(s.targetTabId).catch(() => null);
    if (tab) target = { id: tab.id, title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl, ok: isScriptable(tab.url) };
  }
  return { state: s, identity, target };
}

// ---------------------------------------------------------------- mensajes

const handlers = {
  // popup / opciones
  'session:start': (msg) => startSession(msg.tabId ?? null),
  'session:stop': () => stopSession(),
  'session:reset': () => resetCode(),
  'session:get': () => snapshot(),
  'target:set': async (msg) => { await setTarget(msg.tabId); return snapshot(); },
  'device:kick': (msg) => chrome.runtime.sendMessage({ to: 'offscreen', type: 'kick', id: msg.id }).catch(() => {}),

  // documento offscreen
  identity: () => getIdentity(),
  status: (msg) => patchState({ status: msg.status, error: msg.error || null }),
  devices: async (msg) => {
    await patchState({ devices: msg.devices });
    if (msg.event === 'joined' && settings.showToasts) {
      const tabId = await targetTabId();
      if (tabId != null) {
        sendToTab(tabId, { t: 'toast', text: chrome.i18n.getMessage('toastConnected', [msg.device?.name || '']) });
      }
    }
  },
  welcome: () => targetInfo(),
  cmd: (msg) => handleCommand(msg.cmd),

  // scripts de contenido
  'frame:hello': (msg, sender) => {
    if (typeof msg.nonce !== 'string' || !sender.tab) return;
    const entry = probeEntry(msg.nonce);
    if (!entry.frame) {
      entry.frame = { tabId: sender.tab.id, frameId: sender.frameId };
      entry.resolve(entry.frame);
    }
  },
  'frame:route': (msg, sender) => { if (typeof msg.nonce === 'string' && msg.cmd) routeToFrame(msg.nonce, msg.cmd, sender); },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.to !== 'sw' || sender.id !== chrome.runtime.id) return;
  const handler = handlers[msg.type];
  if (!handler) return;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then((res) => sendResponse(res ?? null), (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

// ---------------------------------------------------------------- ciclo de vida

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await unregisterScripts().catch(() => {});
  await chrome.storage.session.set({ state: { ...EMPTY_STATE } });
  state = null;
  updateBadge();
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options.html#bienvenida') });
});

chrome.runtime.onStartup.addListener(async () => {
  await settingsReady;
  if (settings.autoStart) startSession(null);
});

loadState().then(updateBadge);
