// Presentazo para escritorio: proceso principal.
// · Ventana "conexion" (oculta): mantiene la conexión WebRTC con los celulares.
// · Ventana "panel": código QR, estado y ajustes.
// · Ventana "capa": transparente y por encima de todo; dibuja el puntero láser,
//   el foco, el lápiz y la pantalla negra sobre cualquier programa.
// Las teclas y el mouse se envían al programa que está al frente (PowerPoint,
// Keynote, un PDF, el navegador…) con el módulo nativo de cada sistema.

import {
  app, BrowserWindow, Menu, Tray, clipboard, ipcMain, nativeImage, nativeTheme, net, protocol,
  screen, session, shell, systemPreferences,
} from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ID_PREFIX, PRIVACY_URL, REMOTE_URL, SITE_URL, SOCIAL, buildRemoteUrl } from '../ui/config.js';
import { appName, describeApp } from './apps.js';
import { createInput } from './input/index.js';
import { createStore } from './settings.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(HERE, '..', 'ui');
const TRAY_DIR = path.join(HERE, '..', 'recursos', 'bandeja');
const DEV_ICON = path.join(HERE, '..', 'recursos', 'icon.png');
const ORIGIN = 'app://presentazo';
const isMac = process.platform === 'darwin';
const TESTING = !!process.env.PRESENTAZO_PRUEBA;

if (process.env.PRESENTAZO_DATOS) app.setPath('userData', process.env.PRESENTAZO_DATOS);
const remoteBase = (TESTING && process.env.PRESENTAZO_REMOTO) || REMOTE_URL;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// ---------------------------------------------------------------- instancia única

// "--comprobar": carga el control nativo del teclado y el mouse, informa el
// resultado y sale. Lo usa el script de los instaladores para validar cada app.
const CHECK_ONLY = process.argv.includes('--comprobar');

const primaryInstance = CHECK_ONLY || app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
else app.on('second-instance', () => showPanel());

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

if (process.platform === 'win32' && !CHECK_ONLY) app.setAppUserModelId('io.github.mjmc4498.presentazo');

// ---------------------------------------------------------------- estado

let store = null;
let input = null;
let panel = null;
let connection = null;
let overlay = null;
let overlayReady = false;
let overlayQueue = [];
let tray = null;
let quitting = false;

const sessionState = { status: 'starting', error: null, devices: [] };
let lastTarget = '';
let lastExternal = null; // último programa al frente que no es Presentazo
let black = false;
let fullscreen = false;
let pointerMode = 'laser';
let lastTrusted = null;

// Qué se controla: 'auto' (lo que esté al frente), 'screen' (una pantalla),
// 'window' (un programa) o 'tab' (una pestaña del navegador).
let target = { kind: 'auto' };
const sources = { windows: [], tabs: [] };
const iconCache = new Map();
let tabRetryAt = 0;

// ---------------------------------------------------------------- identidad

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const randomId = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHABET[b & 31]).join('');

function ensureIdentity(regenerate = false) {
  if (regenerate || !store.identity) store.setIdentity({ peerId: ID_PREFIX + randomId(16), token: randomId(16) });
  return store.identity;
}

const remoteUrl = () => buildRemoteUrl(remoteBase, store.identity.peerId, store.identity.token);

function log(entry) {
  if (TESTING) fs.appendFileSync(process.env.PRESENTAZO_PRUEBA, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`);
}

// ---------------------------------------------------------------- archivos de la interfaz (app://presentazo)

function serveUi() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'panel.html';
    const file = path.normalize(path.join(UI_DIR, rel));
    if (url.host !== 'presentazo' || !file.startsWith(UI_DIR + path.sep)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

const page = (name) => `${ORIGIN}/${name}`;

function hardenWebContents() {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
  });
}

// ---------------------------------------------------------------- pantallas

function displayName(d, i) {
  return d.label || (d.internal ? 'Pantalla integrada' : `Pantalla ${i + 1}`);
}

const displayById = (id) => screen.getAllDisplays().find((d) => String(d.id) === String(id)) || null;

function displayOf(bounds) {
  if (!bounds) return null;
  return screen.getDisplayNearestPoint({ x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) });
}

// Pantalla donde se dibuja el puntero: la elegida, la del programa o pestaña
// elegidos, o en automático: si hay una laptop con un proyector o monitor
// externo, el externo (ahí suele ir la presentación); si no, la del cursor.
function pointerDisplay() {
  const all = screen.getAllDisplays();
  if (target.displayId) {
    const d = displayById(target.displayId);
    if (d) return d;
  }
  if (all.length > 1 && all.some((d) => d.internal)) {
    const external = all.find((d) => !d.internal);
    if (external) return external;
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

// ---------------------------------------------------------------- capa del puntero

function createOverlay() {
  const { bounds } = pointerDisplay();
  overlayReady = false;
  overlay = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    alwaysOnTop: true,
    ...(isMac ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(HERE, 'preload', 'overlay.cjs'),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  overlay.loadURL(page('overlay.html'));
  overlay.on('closed', () => { overlay = null; overlayReady = false; });
}

function placeOverlay(display = pointerDisplay()) {
  if (!overlay) createOverlay();
  const { bounds } = display;
  const current = overlay.getBounds();
  if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) {
    overlay.setBounds(bounds);
  }
}

function showOverlay(display) {
  if (display) placeOverlay(display);
  else if (!overlay || !overlay.isVisible()) placeOverlay();
  if (!overlay.isVisible()) overlay.showInactive();
  overlay.setAlwaysOnTop(true, 'screen-saver');
  if (!isMac) overlay.moveTop();
}

function overlayCmd(cmd, { show = true, display = null } = {}) {
  if (show) showOverlay(display);
  else if (!overlay) createOverlay();
  log({ a: 'capa', cmd: { t: cmd.t, a: cmd.a, mode: cmd.mode } });
  if (overlayReady) overlay.webContents.send('overlay:cmd', cmd);
  else overlayQueue.push(cmd);
}

function overlaySettings() {
  const { laserColor, laserSize, spotSize } = store.settings;
  overlayCmd({ t: 'settings', laserColor, laserSize, spotSize }, { show: false });
}

function setBlack(on) {
  black = on;
  overlayCmd({ t: 'black', on }, { show: on });
}

// ---------------------------------------------------------------- conexión con los celulares

function createConnection() {
  connection = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(HERE, 'preload', 'connection.cjs'),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  connection.loadURL(page('connection.html'));
  connection.on('closed', () => {
    connection = null;
    if (!quitting) setTimeout(createConnection, 1000);
  });
}

const toConnection = (msg) => connection?.webContents.send('conn:main', msg);

async function newCode() {
  toConnection({ type: 'stop', reason: 'revoked' });
  await wait(300);
  ensureIdentity(true);
  Object.assign(sessionState, { status: 'starting', error: null, devices: [] });
  lastTarget = '';
  connection?.webContents.reload();
  log({ a: 'url', url: remoteUrl() });
  refresh();
}

// ---------------------------------------------------------------- programa al frente

function frontApp() {
  let front = null;
  try { front = input.frontmost(); } catch {}
  if (front && front.pid !== process.pid) lastExternal = { ...describeApp(front, input.platform), pid: front.pid };
  return lastExternal;
}

function targetLabel() {
  const front = frontApp();
  if (target.kind === 'tab') return target.label;
  // Con un programa elegido se muestra su ventana al frente (p. ej. la del pase de diapositivas).
  if (target.kind === 'window' && front?.pid !== target.pid) return target.label;
  return front?.label || 'Tu computadora';
}

function targetInfo() {
  if (input.platform === 'ninguno') return { t: 'target', title: '', host: '', ok: false, reason: 'restricted' };
  if (!input.trusted()) return { t: 'target', title: '', host: '', ok: false, reason: 'permission' };
  return { t: 'target', title: targetLabel(), host: '', ok: true };
}

function broadcastTarget(force = false) {
  const info = targetInfo();
  const key = JSON.stringify(info);
  if (!force && key === lastTarget) return;
  lastTarget = key;
  toConnection({ type: 'broadcast', msg: info });
  refresh();
}

setInterval(() => {
  if (input && sessionState.devices.length) broadcastTarget();
}, 1500);

// ---------------------------------------------------------------- órdenes del celular

const NAV_KEYS = {
  arrows: { next: 'ArrowRight', prev: 'ArrowLeft' },
  page: { next: 'PageDown', prev: 'PageUp' },
  space: { next: ' ', prev: 'ArrowLeft' },
};
const SLIDE_NAV = new Set(['next', 'prev', 'first', 'last']);

let lastPermissionNotice = 0;
let lastDeniedReply = 0;

// Respuesta al celular cuando no se pudo actuar (como mucho cada 2 s: los
// movimientos llegan a 60 por segundo).
function denied() {
  if (Date.now() - lastDeniedReply < 2000) return null;
  lastDeniedReply = Date.now();
  return targetInfo();
}

// Sin el permiso de Accesibilidad (macOS) las teclas y el mouse no llegan: se
// avisa al celular y se muestra el panel con el botón para darlo.
function ensureTrusted() {
  if (input.trusted()) return true;
  if (Date.now() - lastPermissionNotice > 30000) {
    lastPermissionNotice = Date.now();
    showPanel();
  }
  return false;
}

// Devuelve el foco al programa de la presentación. En Mac se oculta primero el
// panel: si no, al volver a mostrar la capa del puntero, macOS lo mostraría también.
function stepAside() {
  if (isMac) {
    panel?.hide();
    app.hide();
  } else {
    panel?.minimize();
  }
}

// Si Presentazo está al frente, las teclas llegarían a su propia ventana.
async function leaveSelf() {
  if (!BrowserWindow.getFocusedWindow()) return;
  stepAside();
  await wait(250);
}

// Antes de cada tecla, lo elegido en "Qué vas a controlar" debe estar al frente.
async function ensureTarget() {
  let front = null;
  try { front = input.frontmost(); } catch {}
  const selfFront = !!BrowserWindow.getFocusedWindow();

  if (target.kind === 'window') {
    if (selfFront || !front || front.pid !== target.pid) {
      input.activateWindow(target);
      await wait(250);
    }
    return;
  }

  if (target.kind === 'tab') {
    const sameApp = !selfFront && front?.pid === target.pid;
    // El título de la ventana del navegador es el de su pestaña visible.
    if (sameApp && (front.title || '').startsWith(target.title)) return;
    if (!sameApp || Date.now() > tabRetryAt) {
      if (!(await input.activateTab(target))) {
        tabRetryAt = Date.now() + 10000;
        input.activateWindow(target.window);
      }
      await wait(250);
    }
    return;
  }

  if (target.kind === 'screen') {
    const display = displayById(target.displayId);
    const onScreen = !selfFront && front && displayOf(front.bounds)?.id === display?.id;
    if (display && !onScreen) {
      const win = (input.listWindows() || []).find((w) => !w.minimized && displayOf(w.bounds)?.id === display.id);
      if (win) {
        input.activateWindow(win);
        await wait(250);
        return;
      }
    }
  }

  await leaveSelf();
}

async function pressKeys(fn) {
  if (!ensureTrusted()) return false;
  await ensureTarget();
  fn();
  return true;
}

async function nav(action) {
  if (action === 'black') {
    setBlack(!black);
    return { t: 'state', black };
  }
  if (SLIDE_NAV.has(action)) {
    if (store.settings.clearInkOnSlide) overlayCmd({ t: 'ink', a: 'clear' }, { show: false });
    if (black) setBlack(false);
  }
  if (action === 'exit') {
    if (black) setBlack(false);
    overlayCmd({ t: 'ink', a: 'clear' }, { show: false });
  }
  if (!ensureTrusted()) return denied();
  await ensureTarget();

  switch (action) {
    case 'next':
    case 'prev':
      input.key(NAV_KEYS[store.settings.nextKey][action]);
      return null;
    case 'first':
      input.key('Home');
      return null;
    case 'last':
      input.key('End');
      return null;
    case 'start': {
      const front = frontApp();
      if (!front?.start) {
        if (store.settings.showToasts) overlayCmd({ t: 'toast', text: 'Inicia la presentación desde tu programa' });
        return null;
      }
      input.key(...front.start);
      fullscreen = true;
      return { t: 'state', fullscreen };
    }
    case 'exit':
      input.key('Escape');
      fullscreen = false;
      return { t: 'state', fullscreen, black: false };
    case 'fullscreen':
      if (isMac) input.key('f', { meta: true, ctrl: true });
      else input.key('F11');
      fullscreen = !fullscreen;
      return { t: 'state', fullscreen };
    default:
      return null;
  }
}

// Posición del cursor con decimales: los movimientos finos del celular son de
// menos de un píxel y se perderían al redondear. Mientras el celular mueve el
// mouse se usa la posición propia (el sistema puede tardar en informar la nueva);
// tras una pausa se vuelve a leer la real, por si se usó el mouse de la computadora.
let cursor = null;
let cursorAt = 0;
let dragging = false;

function cursorPosition() {
  if (!cursor || Date.now() - cursorAt > 600) {
    const real = screen.getCursorScreenPoint();
    cursor = { x: real.x, y: real.y };
  }
  return cursor;
}

function moveMouse(dx, dy) {
  const p = cursorPosition();
  const from = screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) });
  let x = p.x + dx * from.bounds.width;
  let y = p.y + dy * from.bounds.width;
  // Pasa a otra pantalla solo si el punto cae dentro de ella; si no, el cursor
  // se queda en el borde de la pantalla actual (no salta a una lejana).
  const inside = ({ bounds: r }) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
  const { bounds: b } = screen.getAllDisplays().find(inside) || from;
  x = clamp(x, b.x, b.x + b.width - 1);
  y = clamp(y, b.y, b.y + b.height - 1);
  cursor = { x, y };
  cursorAt = Date.now();
  input.moveTo(x, y, dragging);
}

function mouse(cmd) {
  if (!ensureTrusted()) return false;
  if (cmd.a === 'move') {
    moveMouse(cmd.dx, cmd.dy);
    return true;
  }
  const { x, y } = cursorPosition();
  if (cmd.a === 'click') input.click('left', cmd.n, x, y);
  else if (cmd.a === 'right') input.click('right', 1, x, y);
  else if (cmd.a === 'down') { dragging = true; input.button('left', true, x, y); }
  else if (cmd.a === 'up') { dragging = false; input.button('left', false, x, y); }
  return true;
}

async function handleCommand(cmd) {
  switch (cmd.t) {
    case 'nav':
      return nav(cmd.a);
    case 'mode':
      pointerMode = cmd.mode;
      overlayCmd(cmd, { show: false });
      return null;
    case 'ptr':
      // El láser y el foco aparecen al tocar; el lápiz muestra su punta al mover.
      overlayCmd(cmd, { show: cmd.a === 'down' || pointerMode === 'pen' || !!overlay?.isVisible() });
      return null;
    case 'ink':
      overlayCmd(cmd);
      return null;
    case 'mouse':
      return mouse(cmd) ? null : denied();
    case 'scroll':
      if (!ensureTrusted()) return denied();
      input.scroll(cmd.dx, cmd.dy);
      return null;
    case 'key':
      return (await pressKeys(() => input.key(cmd.k))) ? null : denied();
    case 'text':
      return (await pressKeys(() => input.text(cmd.s))) ? null : denied();
    case 'del':
      return (await pressKeys(() => { for (let i = 0; i < cmd.n; i++) input.key('Backspace'); })) ? null : denied();
    default:
      return null;
  }
}

// ---------------------------------------------------------------- IPC: conexión

function fromWindow(win) {
  return (event) => !!win && event.sender === win.webContents;
}

function registerConnectionIpc() {
  const ok = (event) => fromWindow(connection)(event);

  ipcMain.handle('conn:identity', (event) => (ok(event) ? store.identity : null));

  ipcMain.on('conn:status', (event, { status, error } = {}) => {
    if (!ok(event)) return;
    sessionState.status = String(status || 'starting');
    sessionState.error = error ? String(error) : null;
    log({ a: 'estado', status: sessionState.status });
    refresh();
  });

  ipcMain.on('conn:devices', (event, payload = {}) => {
    if (!ok(event)) return;
    const before = sessionState.devices.length;
    sessionState.devices = Array.isArray(payload.devices) ? payload.devices.slice(0, 20) : [];
    log({ a: 'celulares', n: sessionState.devices.length, event: payload.event });
    if (payload.event === 'joined') {
      const name = String(payload.device?.name || 'Celular').slice(0, 40);
      if (store.settings.hideOnConnect && before === 0 && panel?.isFocused()) stepAside();
      if (store.settings.showToasts) overlayCmd({ t: 'toast', text: `Conectado: ${name}` });
      broadcastTarget(true);
    }
    refresh();
  });

  ipcMain.handle('conn:welcome', (event) => (ok(event) ? targetInfo() : null));

  ipcMain.handle('conn:cmd', async (event, cmd) => {
    if (!ok(event) || !cmd || typeof cmd.t !== 'string') return null;
    try {
      log({ a: 'orden', cmd });
      const reply = await handleCommand(cmd);
      return reply ? { reply } : null;
    } catch (err) {
      console.error('[Presentazo]', err);
      return null;
    }
  });
}

// ---------------------------------------------------------------- IPC: capa

function registerOverlayIpc() {
  ipcMain.on('overlay:ready', (event) => {
    if (!fromWindow(overlay)(event)) return;
    overlayReady = true;
    const { laserColor, laserSize, spotSize } = store.settings;
    overlay.webContents.send('overlay:cmd', { t: 'settings', laserColor, laserSize, spotSize });
    for (const cmd of overlayQueue.splice(0)) overlay.webContents.send('overlay:cmd', cmd);
  });
  ipcMain.on('overlay:idle', (event) => {
    if (fromWindow(overlay)(event) && overlay.isVisible()) overlay.hide();
  });
}

// ---------------------------------------------------------------- panel

function snapshot() {
  const devices = sessionState.devices;
  return {
    version: app.getVersion(),
    platform: input.platform,
    inputError: input.error || null,
    trusted: input.trusted(),
    status: sessionState.status,
    error: sessionState.error,
    devices,
    url: remoteUrl(),
    target: devices.length ? lastExternal?.label || '' : '',
    settings: store.settings,
    selection: selectionView(),
    packaged: app.isPackaged,
    loginError,
  };
}

let refreshTimer = 0;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (panel && !panel.isDestroyed()) panel.webContents.send('panel:update', snapshot());
    updateTray();
  }, 60);
}

function createPanel({ show = true } = {}) {
  panel = new BrowserWindow({
    width: 400,
    height: 700,
    minWidth: 360,
    minHeight: 560,
    show: false,
    title: 'Presentazo',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0b0c' : '#ffffff',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    icon: isMac ? undefined : path.join(TRAY_DIR, 'icono-windows.png'),
    webPreferences: {
      preload: path.join(HERE, 'preload', 'panel.cjs'),
      sandbox: true,
      contextIsolation: true,
      spellcheck: false,
    },
  });
  if (!isMac) panel.setMenu(null);
  panel.loadURL(page('panel.html'));
  panel.once('ready-to-show', () => { if (show) panel.show(); });
  panel.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    panel.hide();
    if (!isMac) trayHint();
  });
  panel.on('closed', () => { panel = null; });
}

function showPanel(view) {
  if (!panel) createPanel();
  if (panel.isMinimized()) panel.restore();
  panel.show();
  panel.focus();
  if (view) panel.webContents.send('panel:show', view);
}

let hintShown = false;
function trayHint() {
  if (hintShown || !tray) return;
  hintShown = true;
  tray.displayBalloon?.({
    title: 'Presentazo sigue funcionando',
    content: 'Lo encuentras junto al reloj. Desde ahí puedes abrirlo o salir.',
    iconType: 'info',
  });
}

// ---------------------------------------------------------------- qué se controla

function iconFor(file) {
  if (!file) return Promise.resolve(null);
  if (!iconCache.has(file)) {
    iconCache.set(file, app.getFileIcon(file, { size: 'normal' })
      .then((img) => (img.isEmpty() ? null : img.toDataURL()))
      .catch(() => null));
  }
  return iconCache.get(file);
}

function listScreens() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id), number: i + 1, name: displayName(d, i), size: `${d.size.width} × ${d.size.height}`, bounds: d.bounds, primary: d.id === primary,
  }));
}

async function listSources(kind) {
  if (kind === 'screens') return { items: listScreens() };
  if (input.platform === 'ninguno') return { items: [] };
  if (!input.trusted()) return { needsPermission: true, items: [] };
  const name = (a) => appName(a, input.platform);
  if (kind === 'windows') {
    sources.windows = input.listWindows() || [];
    return {
      items: await Promise.all(sources.windows.map(async (w) => ({
        id: w.id,
        title: w.title || name(w.app),
        sub: name(w.app) + (w.minimized ? ' · minimizada' : ''),
        icon: await iconFor(w.path),
      }))),
    };
  }
  if (kind === 'tabs') {
    sources.tabs = (await input.listTabs()) || [];
    return {
      items: await Promise.all(sources.tabs.map(async (t) => ({
        id: t.id,
        title: t.title,
        sub: name(t.app) + (t.selected ? ' · pestaña visible' : ''),
        icon: await iconFor(t.path),
      }))),
    };
  }
  return { items: [] };
}

async function selectTarget(sel = {}) {
  const name = (a) => appName(a, input.platform);
  if (sel.kind === 'screen') {
    const screens = listScreens();
    const d = screens.find((x) => x.id === String(sel.id));
    if (!d) return;
    target = { kind: 'screen', displayId: d.id, label: d.name, number: d.number };
    store.setSettings({ display: d.id });
  } else if (sel.kind === 'window') {
    const w = sources.windows.find((x) => x.id === sel.id);
    if (!w) return;
    target = { ...w, kind: 'window', label: w.title ? `${name(w.app)} · ${w.title}` : name(w.app), displayId: String(displayOf(w.bounds)?.id ?? '') || null };
    store.setSettings({ display: 'auto' });
    input.activateWindow(w);
  } else if (sel.kind === 'tab') {
    const t = sources.tabs.find((x) => x.id === sel.id);
    if (!t) return;
    target = { ...t, kind: 'tab', label: `${t.title} (${name(t.app)})`, displayId: String(displayOf(t.bounds)?.id ?? '') || null };
    store.setSettings({ display: 'auto' });
    tabRetryAt = 0;
    await input.activateTab(t);
  } else {
    target = { kind: 'auto' };
    store.setSettings({ display: 'auto' });
  }
  log({ a: 'objetivo', kind: target.kind, label: target.label || '' });
  if (overlay?.isVisible()) placeOverlay();
  if (sessionState.devices.length) broadcastTarget(true);
  refresh();
}

function selectionView() {
  const name = (a) => appName(a, input.platform);
  switch (target.kind) {
    case 'screen': return { kind: 'screen', id: target.displayId, title: target.label, sub: 'El puntero aparece en esta pantalla' };
    case 'window': return { kind: 'window', id: target.id, title: target.title || name(target.app), sub: name(target.app) };
    case 'tab': return { kind: 'tab', id: target.id, title: target.title, sub: `Pestaña de ${name(target.app)}` };
    default: return { kind: 'auto', title: 'Automático', sub: 'Lo que esté al frente en tu computadora' };
  }
}

const ALLOWED_LINKS = new Set([SITE_URL, PRIVACY_URL, ...SOCIAL.map((s) => s.url)]);

let loginError = false;

// Devuelve false si el sistema no aceptó el cambio (en Mac pasa con apps sin la
// firma de Apple: hay que agregarla a mano en los ítems de inicio).
function applyLoginItem() {
  if (!app.isPackaged) return true;
  // La versión portable de Windows se ejecuta desde una carpeta temporal: el
  // inicio automático debe apuntar al .exe original.
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  const where = portable ? { path: portable, args: ['--oculto'] } : { args: ['--oculto'] };
  const wanted = store.settings.openAtLogin;
  if (app.getLoginItemSettings(where).openAtLogin === wanted) return true;
  app.setLoginItemSettings({ openAtLogin: wanted, ...where });
  return app.getLoginItemSettings(where).openAtLogin === wanted;
}

function registerPanelIpc() {
  const ok = (event) => fromWindow(panel)(event);
  ipcMain.handle('panel:get', (event) => (ok(event) ? snapshot() : null));
  ipcMain.handle('panel:new-code', async (event) => { if (ok(event)) await newCode(); return snapshot(); });
  ipcMain.handle('panel:kick', (event, id) => { if (ok(event)) toConnection({ type: 'kick', id: String(id) }); });
  ipcMain.handle('panel:settings', (event, patch) => {
    if (!ok(event) || !patch || typeof patch !== 'object') return snapshot();
    const before = store.settings;
    const next = store.setSettings(patch);
    if (before.openAtLogin !== next.openAtLogin) {
      loginError = !applyLoginItem();
      if (loginError) store.setSettings({ openAtLogin: before.openAtLogin });
    }
    if (before.laserColor !== next.laserColor || before.laserSize !== next.laserSize || before.spotSize !== next.spotSize) overlaySettings();
    refresh();
    return snapshot();
  });
  ipcMain.handle('panel:permission', (event) => {
    if (!ok(event) || !isMac) return false;
    if (systemPreferences.isTrustedAccessibilityClient(true)) return true;
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    return false;
  });
  ipcMain.handle('panel:copy', (event) => { if (ok(event)) clipboard.writeText(remoteUrl()); return true; });
  ipcMain.handle('panel:open', (event, url) => {
    if (ok(event) && ALLOWED_LINKS.has(url)) shell.openExternal(url);
  });
  ipcMain.handle('panel:sources', async (event, kind) => (ok(event) ? listSources(String(kind)) : null));
  ipcMain.handle('panel:target', async (event, sel) => {
    if (ok(event) && sel && typeof sel === 'object') await selectTarget({ kind: String(sel.kind), id: sel.id == null ? null : String(sel.id) });
    return snapshot();
  });
  ipcMain.handle('panel:identify', (event, id) => {
    if (!ok(event)) return;
    const d = displayById(id);
    const n = listScreens().find((x) => x.id === String(id))?.number;
    if (d) overlayCmd({ t: 'demo', text: `Pantalla ${n}` }, { display: d });
  });
}

// ---------------------------------------------------------------- bandeja y menú

function statusLine() {
  const n = sessionState.devices.length;
  if (n === 1) return '1 celular conectado';
  if (n > 1) return `${n} celulares conectados`;
  if (sessionState.status === 'ready') return 'Esperando al celular';
  if (sessionState.status === 'error') return 'Sin conexión a internet';
  return 'Conectando…';
}

function trayImage() {
  // El mismo ícono de la extensión (a color); en Mac se usa también bandeja@2x.png.
  if (isMac) return nativeImage.createFromPath(path.join(TRAY_DIR, 'bandeja.png'));
  return nativeImage.createFromPath(path.join(TRAY_DIR, 'bandeja-windows.ico'));
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(`Presentazo · ${statusLine()}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: statusLine(), enabled: false },
    { type: 'separator' },
    { label: 'Mostrar código QR', click: () => showPanel() },
    { label: 'Copiar enlace del celular', click: () => clipboard.writeText(remoteUrl()) },
    { label: 'Nuevo código', click: () => newCode() },
    { label: 'Ajustes…', click: () => showPanel('ajustes') },
    { type: 'separator' },
    { label: 'Salir de Presentazo', click: () => quit() },
  ]));
}

function createTray() {
  tray = new Tray(trayImage());
  if (!isMac) tray.on('click', () => showPanel());
  updateTray();
}

function createMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Presentazo',
      submenu: [
        { label: 'Acerca de Presentazo', role: 'about' },
        { type: 'separator' },
        { label: 'Ajustes…', accelerator: 'Command+,', click: () => showPanel('ajustes') },
        { type: 'separator' },
        { label: 'Ocultar Presentazo', role: 'hide' },
        { label: 'Ocultar otros', role: 'hideOthers' },
        { label: 'Mostrar todo', role: 'unhide' },
        { type: 'separator' },
        { label: 'Salir de Presentazo', accelerator: 'Command+Q', click: () => quit() },
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { label: 'Deshacer', role: 'undo' },
        { label: 'Rehacer', role: 'redo' },
        { type: 'separator' },
        { label: 'Cortar', role: 'cut' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Pegar', role: 'paste' },
        { label: 'Seleccionar todo', role: 'selectAll' },
      ],
    },
    {
      label: 'Ventana',
      submenu: [
        { label: 'Minimizar', role: 'minimize' },
        { label: 'Cerrar', role: 'close' },
      ],
    },
  ]));
  app.setAboutPanelOptions({
    applicationName: 'Presentazo',
    applicationVersion: app.getVersion(),
    copyright: '© 2026 Miguel Mogrovejo',
    credits: 'Controla tus presentaciones desde el celular.',
  });
}

function quit() {
  quitting = true;
  toConnection({ type: 'stop', reason: 'stopped' });
  setTimeout(() => app.quit(), 300);
}

// ---------------------------------------------------------------- inicio

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {}); // sigue en la bandeja
app.on('activate', () => showPanel());

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  if (CHECK_ONLY) {
    const probe = await createInput({ toPhysical: (p) => p });
    console.log(JSON.stringify({ comprobacion: 'presentazo', platform: probe.platform, error: probe.error || null }));
    app.exit(probe.platform === 'ninguno' ? 1 : 0);
    return;
  }
  store = createStore(app.getPath('userData'));
  ensureIdentity(store.settings.newCodeEachSession);
  // En modo desarrollo macOS mostraría el ícono de Electron.
  if (isMac && !app.isPackaged) app.dock?.setIcon(DEV_ICON);
  input = await createInput({
    toPhysical: (p) => (screen.dipToScreenPoint ? screen.dipToScreenPoint(p) : p),
    toDip: (r) => (screen.screenToDipRect ? screen.screenToDipRect(null, r) : r),
  });
  log({ a: 'url', url: remoteUrl(), platform: input.platform });

  if (store.settings.display !== 'auto' && displayById(store.settings.display)) {
    const d = listScreens().find((x) => x.id === store.settings.display);
    target = { kind: 'screen', displayId: d.id, label: d.name, number: d.number };
  }

  serveUi();
  hardenWebContents();
  registerConnectionIpc();
  registerOverlayIpc();
  registerPanelIpc();
  createMenu();
  createTray();
  createConnection();
  createOverlay();

  const startedHidden = process.argv.includes('--oculto') || (isMac && app.getLoginItemSettings().wasOpenedAtLogin);
  createPanel({ show: !startedHidden });
  applyLoginItem();

  for (const evt of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(evt, () => {
      if (overlay?.isVisible()) placeOverlay();
      refresh();
    });
  }
  // El permiso de Accesibilidad se puede dar mientras la app está abierta.
  setInterval(() => {
    const trusted = input.trusted();
    if (trusted !== lastTrusted) {
      lastTrusted = trusted;
      refresh();
      if (sessionState.devices.length) broadcastTarget(true);
    }
  }, 2000);
});
