// Presentazo para escritorio: conexión con los celulares (ventana oculta).
// Mantiene la conexión WebRTC (PeerJS), valida cada mensaje y lo pasa al proceso
// principal, que lo convierte en teclas, mouse o dibujos sobre la pantalla.
// Usa el mismo protocolo que la extensión de Chrome.

/* global Peer */

import { ICE_ENDPOINT, FALLBACK_ICE } from './config.js';

const bridge = window.presentazo;
const ICE_REFRESH_MS = 3 * 60 * 60 * 1000; // las credenciales duran 4 h

const devices = new Map();
let iceConfig = FALLBACK_ICE;
let identity = null;
let peer = null;
let stopped = false;
let retryTimer = 0;
let retryDelay = 1000;

function setStatus(status, error = null) {
  bridge.status(status, error);
}

function publicDevices() {
  return [...devices.values()].map(({ id, name, since }) => ({ id, name, since }));
}

// ---------------------------------------------------------------- conexión con el servidor de señalización

function connect() {
  if (stopped) return;
  clearTimeout(retryTimer);
  setStatus('connecting');
  // Con debug: 0 los avisos internos de PeerJS (p. ej. «Lost connection to server»)
  // no se imprimen como errores; se manejan abajo.
  peer = new Peer(identity.peerId, { debug: 0, config: iceConfig });
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
        // El servidor aún no liberó el identificador (instancia anterior o
        // reconexión rápida). Si ya estuvo abierto, solo se reintenta la
        // reconexión: destruir el peer cortaría a los celulares conectados.
        setStatus('connecting');
        if (current.destroyed) scheduleRetry(connect);
        else scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
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
        console.debug('[Presentazo]', err.type, err.message);
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
        const target = await bridge.welcome();
        send(conn, { t: 'welcome', target, v: 1 });
        bridge.devices({ event: 'joined', device: { id: device.id, name: device.name }, devices: publicDevices() });
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
    const res = await bridge.command(cmd);
    if (res?.reply) send(conn, res.reply);
  });

  conn.on('close', () => {
    clearTimeout(authTimer);
    if (devices.delete(device.id)) {
      bridge.devices({ event: 'left', device: { id: device.id, name: device.name }, devices: publicDevices() });
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

// ---------------------------------------------------------------- mensajes del proceso principal

bridge.onMain((msg) => {
  switch (msg?.type) {
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
      setTimeout(() => { try { peer?.destroy(); } catch {} }, 250);
      break;
  }
});

// ---------------------------------------------------------------- retransmisión (TURN)

// Pide al Worker de Cloudflare credenciales temporales de retransmisión. Si no
// responde, se sigue con la conexión directa de siempre.
async function loadIce() {
  if (!ICE_ENDPOINT) return FALLBACK_ICE;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(ICE_ENDPOINT, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!Array.isArray(data.iceServers) || !data.iceServers.length) throw new Error('sin servidores');
    return { iceServers: data.iceServers };
  } catch (err) {
    console.debug('[Presentazo] retransmisión no disponible:', err.message);
    return FALLBACK_ICE;
  } finally {
    clearTimeout(timer);
  }
}

// Las credenciales caducan: se renuevan para las conexiones nuevas.
setInterval(async () => {
  iceConfig = await loadIce();
  if (peer && !peer.destroyed) peer.options.config = iceConfig;
}, ICE_REFRESH_MS);

// ---------------------------------------------------------------- inicio

(async () => {
  identity = await bridge.identity();
  if (!identity?.peerId) {
    setStatus('error', 'identity');
    return;
  }
  iceConfig = await loadIce();
  connect();
})();
