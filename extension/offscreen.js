// Mando — documento offscreen.
// Mantiene la conexión WebRTC (PeerJS) con los celulares, valida cada mensaje
// y lo reenvía al service worker, que lo entrega a la pestaña controlada.

/* global Peer */

const devices = new Map();
let identity = null;
let peer = null;
let stopped = false;
let retryTimer = 0;
let retryDelay = 1000;

const toSW = (msg) => chrome.runtime.sendMessage({ to: 'sw', ...msg }).catch(() => null);

function setStatus(status, error = null) {
  toSW({ type: 'status', status, error });
}

function publicDevices() {
  return [...devices.values()].map(({ id, name, since }) => ({ id, name, since }));
}

// ---------------------------------------------------------------- conexión con el servidor de señalización

function connect() {
  if (stopped) return;
  clearTimeout(retryTimer);
  setStatus('connecting');
  peer = new Peer(identity.peerId, { debug: 1 });
  const current = peer;

  current.on('open', () => {
    retryDelay = 1000;
    setStatus('ready');
  });
  current.on('connection', onConnection);
  current.on('disconnected', () => {
    if (stopped || current.destroyed) return;
    scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
  });
  current.on('error', (err) => {
    if (stopped) return;
    switch (err.type) {
      case 'unavailable-id':
        // El identificador sigue registrado por una instancia anterior: reintentar.
        current.destroy();
        setStatus('connecting');
        scheduleRetry(connect);
        break;
      case 'browser-incompatible':
      case 'invalid-id':
      case 'invalid-key':
      case 'ssl-unavailable':
        setStatus('error', err.type);
        break;
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed':
        // PeerJS emite 'disconnected' justo después; el error debe prevalecer.
        setTimeout(() => setStatus('error', 'network'), 0);
        if (current.destroyed) scheduleRetry(connect);
        else scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
        break;
      default:
        console.warn('[Mando]', err.type, err);
    }
  });
}

function scheduleRetry(fn) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(fn, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 15000);
}

// ---------------------------------------------------------------- dispositivos

function deviceName(raw) {
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f<>]/g, '').trim() : '';
  return name.slice(0, 40) || 'Celular';
}

function send(conn, msg) {
  try { if (conn.open) conn.send(msg); } catch {}
}

function onConnection(conn) {
  const device = { id: conn.connectionId, name: 'Celular', since: Date.now(), conn, authed: false };
  const authTimer = setTimeout(() => { if (!device.authed) conn.close(); }, 10000);

  conn.on('data', async (raw) => {
    const msg = typeof raw === 'string' ? safeParse(raw) : raw;
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    if (!device.authed) {
      if (msg.t === 'hello' && typeof msg.k === 'string' && msg.k === identity.token) {
        clearTimeout(authTimer);
        device.authed = true;
        device.name = deviceName(msg.name);
        devices.set(device.id, device);
        const target = await toSW({ type: 'welcome' });
        send(conn, { t: 'welcome', target, v: 1 });
        toSW({ type: 'devices', event: 'joined', device: { id: device.id, name: device.name }, devices: publicDevices() });
      } else {
        send(conn, { t: 'denied' });
        setTimeout(() => conn.close(), 300);
      }
      return;
    }

    if (msg.t === 'ping') {
      send(conn, { t: 'pong', ts: msg.ts });
      return;
    }
    const cmd = clean(msg);
    if (!cmd) return;
    const res = await toSW({ type: 'cmd', cmd });
    if (res?.reply) send(conn, res.reply);
  });

  conn.on('close', () => {
    clearTimeout(authTimer);
    if (devices.delete(device.id)) {
      toSW({ type: 'devices', event: 'left', device: { id: device.id, name: device.name }, devices: publicDevices() });
    }
  });
  conn.on('error', () => {});
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// ---------------------------------------------------------------- validación de comandos

const NAV = new Set(['next', 'prev', 'first', 'last', 'start', 'exit', 'black', 'fullscreen']);
const MODES = new Set(['laser', 'spot', 'pen', 'mouse', 'none']);
const KEYS = new Set([
  'Enter', 'Backspace', 'Tab', 'Escape', 'Delete', ' ',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
]);

const num = (v, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-max, Math.min(max, n)) : 0;
};

function clean(m) {
  switch (m.t) {
    case 'nav':
      return NAV.has(m.a) ? { t: 'nav', a: m.a } : null;
    case 'mode':
      return MODES.has(m.mode) ? { t: 'mode', mode: m.mode } : null;
    case 'ptr':
      return ['down', 'move', 'up'].includes(m.a)
        ? { t: 'ptr', a: m.a, dx: num(m.dx, 4), dy: num(m.dy, 4), ink: m.ink === true }
        : null;
    case 'mouse':
      return ['move', 'click', 'right', 'down', 'up'].includes(m.a)
        ? { t: 'mouse', a: m.a, dx: num(m.dx, 4), dy: num(m.dy, 4), n: m.n === 2 ? 2 : 1 }
        : null;
    case 'scroll':
      return { t: 'scroll', dx: num(m.dx, 4000), dy: num(m.dy, 4000) };
    case 'key':
      return KEYS.has(m.k) ? { t: 'key', k: m.k } : null;
    case 'text':
      return typeof m.s === 'string' && m.s.length ? { t: 'text', s: m.s.slice(0, 2000) } : null;
    case 'del':
      return { t: 'del', n: Math.max(1, Math.min(200, Math.trunc(num(m.n, 200)) || 1)) };
    case 'ink':
      if (!['clear', 'undo', 'color'].includes(m.a)) return null;
      return { t: 'ink', a: m.a, color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : undefined };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- mensajes del service worker

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.to !== 'offscreen') return;
  switch (msg.type) {
    case 'broadcast':
      for (const d of devices.values()) send(d.conn, msg.msg);
      break;
    case 'kick': {
      const d = devices.get(msg.id);
      if (d) {
        send(d.conn, { t: 'bye', reason: 'kicked' });
        setTimeout(() => d.conn.close(), 200);
      }
      break;
    }
    case 'stop':
      stopped = true;
      clearTimeout(retryTimer);
      for (const d of devices.values()) send(d.conn, { t: 'bye', reason: msg.reason || 'stopped' });
      setTimeout(() => {
        try { peer?.destroy(); } catch {}
        sendResponse({ ok: true });
      }, 250);
      return true;
  }
});

// ---------------------------------------------------------------- inicio

(async () => {
  identity = await toSW({ type: 'identity' });
  if (!identity?.peerId) {
    setStatus('error', 'identity');
    return;
  }
  connect();
})();
