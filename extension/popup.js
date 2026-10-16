import { REMOTE_URL, buildRemoteUrl, getSettings, saveSettings } from './config.js';
import qrcode from './lib/qrcode.mjs';
import { applyI18n, t } from './lib/i18n.js';

applyI18n();

const $ = (id) => document.getElementById(id);
const sw = (type, extra = {}) => chrome.runtime.sendMessage({ to: 'sw', type, ...extra });
const lang = 'es';

let settings = await getSettings();
let snap = null;
let renderedUrl = '';
const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });

// ---------------------------------------------------------------- QR

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const isEye = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  let dots = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!isEye(r, c) && qr.isDark(r, c)) dots += `<rect x="${c + 0.05}" y="${r + 0.05}" width=".9" height=".9" rx=".3"/>`;
    }
  }
  const eye = (x, y) =>
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.8" fill="none" stroke="currentColor" stroke-width="1"/>` +
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".9"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="geometricPrecision">` +
    `<g fill="currentColor">${dots}${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}</g></svg>`;
}

function remoteUrl() {
  if (!snap?.identity) return '';
  return buildRemoteUrl(settings.remoteUrl || REMOTE_URL, snap.identity.peerId, snap.identity.token);
}

// ---------------------------------------------------------------- render

function statusView(state) {
  if (!state.active) return ['muted', t('statusStopped')];
  if (state.devices.length) return ['ok', state.devices.length === 1 ? t('statusConnectedOne') : t('statusConnectedMany', [String(state.devices.length)])];
  switch (state.status) {
    case 'ready': return ['ok', t('statusReady')];
    case 'error': return ['error', t('statusOffline')];
    default: return ['warn', t('statusConnecting')];
  }
}

function since(ts) {
  const minutes = Math.round((Date.now() - ts) / 60000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  return minutes < 1 ? t('justNow') : rtf.format(-minutes, 'minute');
}

function render() {
  if (!snap) return;
  const { state, target } = snap;

  const [tone, text] = statusView(state);
  $('status').dataset.tone = tone;
  $('status-text').textContent = text;

  $('scan').hidden = !state.active;
  $('stopped').hidden = state.active;
  $('copy').disabled = !state.active;
  $('reset').disabled = !state.active;
  $('stop').hidden = !state.active;
  $('follow-row').hidden = !state.active;

  const url = remoteUrl();
  if (state.active && url && url !== renderedUrl) {
    $('qr').innerHTML = qrSvg(url);
    renderedUrl = url;
  }
  $('qr-card').classList.toggle('loading', state.status !== 'ready');

  // Avisos
  let alert = '';
  if (state.active && state.status === 'error') alert = state.error === 'network' ? t('errorNetwork') : t('errorGeneric');
  else if (state.active && target && !target.ok) alert = target.reason === 'access' ? t('needsAccess') : t('restrictedTab');
  $('alert').hidden = !alert;
  $('alert').textContent = alert;

  // Pestaña controlada
  $('target-card').hidden = !state.active || !target;
  if (target) {
    $('target-title').textContent = target.title || target.url || '';
    const icon = $('target-icon');
    if (target.favIconUrl && /^https?:|^data:/.test(target.favIconUrl)) {
      icon.src = target.favIconUrl;
      icon.hidden = false;
      $('target-fallback').hidden = true;
    } else {
      icon.hidden = true;
      $('target-fallback').hidden = false;
      $('target-fallback').textContent = (target.title || '?').trim().charAt(0);
    }
  }
  $('use-tab').hidden = !state.active || !currentTab || settings.followActiveTab || target?.id === currentTab.id;
  $('follow').checked = settings.followActiveTab;

  // Dispositivos
  $('devices-card').hidden = !state.active || !state.devices.length;
  const list = $('devices');
  list.replaceChildren(...state.devices.map((d) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="dev-icon"></span><span class="dev-text"><span class="dev-name"></span><span class="dev-since"></span></span>';
    li.querySelector('.dev-name').textContent = d.name;
    li.querySelector('.dev-since').textContent = `${t('connected')} · ${since(d.since)}`;
    const kick = document.createElement('button');
    kick.className = 'btn small ghost';
    kick.textContent = t('disconnect');
    kick.addEventListener('click', () => sw('device:kick', { id: d.id }));
    li.append(kick);
    return li;
  }));
}

async function refresh() {
  snap = await sw('session:get');
  render();
}

// ---------------------------------------------------------------- acciones

$('start').addEventListener('click', async () => {
  snap = await sw('session:start', { tabId: currentTab?.id });
  render();
});

$('stop').addEventListener('click', async () => {
  snap = await sw('session:stop');
  render();
});

$('use-tab').addEventListener('click', async () => {
  snap = await sw('target:set', { tabId: currentTab.id });
  render();
  checkEmbedded();
});

// «Seguir la pestaña activa» necesita acceso a todos los sitios: se pide en el
// mismo clic (Chrome exige un gesto del usuario).
const ALL_SITES = { origins: ['<all_urls>'] };
$('follow').addEventListener('change', async (e) => {
  const on = e.target.checked;
  if (on && !(await chrome.permissions.request(ALL_SITES).catch(() => false))) {
    e.target.checked = false;
    return;
  }
  settings = await saveSettings({ followActiveTab: on });
  setTimeout(refresh, 300);
});

// Presentación incrustada desde otro sitio: ofrece permitir ese sitio.
let embeddedPatterns = [];
async function checkEmbedded() {
  const res = await sw('frames:missing').catch(() => null);
  embeddedPatterns = res?.patterns || [];
  const hosts = embeddedPatterns.map((p) => p.replace(/^https?:\/\//, '').replace(/\/\*$/, ''));
  $('embedded-card').hidden = !embeddedPatterns.length;
  if (hosts.length) $('embedded-text').textContent = t('embeddedBody', [hosts.join(', ')]);
}

$('embedded-allow').addEventListener('click', async () => {
  if (!embeddedPatterns.length) return;
  const granted = await chrome.permissions.request({ origins: embeddedPatterns }).catch(() => false);
  if (!granted) return;
  await sw('frames:inject');
  $('embedded-card').hidden = true;
});

$('copy').addEventListener('click', async () => {
  const label = $('copy').querySelector('span');
  try {
    await navigator.clipboard.writeText(remoteUrl());
    label.textContent = t('copied');
  } catch {
    label.textContent = t('copyFailed');
  }
  setTimeout(() => { label.textContent = t('copyLink'); }, 1600);
});

let confirmTimer = 0;
$('reset').addEventListener('click', async () => {
  const btn = $('reset');
  const label = btn.querySelector('span');
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    label.textContent = t('newCodeConfirm');
    confirmTimer = setTimeout(() => {
      btn.classList.remove('confirm');
      label.textContent = t('newCode');
    }, 3000);
    return;
  }
  clearTimeout(confirmTimer);
  btn.classList.remove('confirm');
  label.textContent = t('newCode');
  snap = await sw('session:reset');
  render();
});

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

chrome.storage.session.onChanged.addListener((changes) => { if (changes.state) refresh(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    getSettings().then((s) => { settings = s; render(); });
  }
});

// Abrir el popup inicia (o reanuda) la sesión sobre la pestaña actual. Pulsar el
// ícono da acceso a esa pestaña (activeTab).
snap = await sw('session:start', { tabId: currentTab?.id });
render();
checkEmbedded();
setInterval(render, 30000);
