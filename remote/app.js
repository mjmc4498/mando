// Mando — control remoto para el celular.
// Se conecta por WebRTC (PeerJS) con la extensión de Chrome y le envía órdenes.

/* global Peer */
(() => {
  'use strict';

  const VERSION = '1.0.0';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const app = $('#app');

  // ================================================================ textos

  const TEXT = {
    settings: 'Ajustes', timer: 'Cronómetro: toca para iniciar o pausar, mantén para reiniciar',
    present: 'Presentar', black: 'Negro', fullscreen: 'Pantalla', exit: 'Salir',
    previous: 'Anterior', next: 'Siguiente', nextHint: 'Toca o desliza',
    laser: 'Láser', spotlight: 'Foco', pen: 'Lápiz', air: 'Aire',
    hintLaser: 'Desliza el dedo para mover el láser',
    hintSpot: 'Desliza para mover el foco de luz',
    hintPen: 'Dibuja con un dedo · mueve sin dibujar con dos',
    hintAir: 'Mantén presionado y apunta moviendo el celular',
    colorRed: 'Rojo', colorYellow: 'Amarillo', colorGreen: 'Verde', colorBlue: 'Azul', colorWhite: 'Blanco',
    undo: 'Deshacer', clear: 'Borrar todo', scroll: 'Desplazar',
    trackpadHint: 'Toca para hacer clic · dos toques para doble clic\nDos dedos para desplazar o clic derecho',
    click: 'Clic', drag: 'Arrastrar', rightClick: 'Clic derecho',
    typeHere: 'Escribe aquí…', typeHint: 'Lo que escribas aparece al instante en la computadora.',
    arrowUp: 'Arriba', arrowDown: 'Abajo', arrowLeft: 'Izquierda', arrowRight: 'Derecha', backspace: 'Borrar', enter: 'Intro',
    tabSlides: 'Diapositivas', tabPointer: 'Puntero', tabMouse: 'Mouse', tabKeys: 'Teclado',
    retry: 'Reintentar', sensitivity: 'Sensibilidad del puntero', haptics: 'Vibración', keepAwake: 'Mantener la pantalla encendida',
    latency: 'Latencia', forget: 'Olvidar esta computadora', done: 'Listo', madeBy: 'Creado por Miguel Mogrovejo', privacy: 'Privacidad',
    connected: 'Conectado', connecting: 'Conectando…', reconnecting: 'Reconectando…', offline: 'Sin conexión', waiting: 'Esperando…',
    gateIdleTitle: 'Escanea el código', gateIdleBody: 'Abre la extensión Mando en Chrome y escanea el código QR con la cámara de tu celular.',
    gateConnectingTitle: 'Conectando…', gateConnectingBody: 'Buscando tu computadora.',
    gateWaitingTitle: 'Esperando a la computadora', gateWaitingBody: 'Abre el panel de Mando en Chrome. Seguimos intentando automáticamente.',
    gateOfflineTitle: 'Sin conexión', gateOfflineBody: 'Revisa la conexión a internet de tu celular.',
    gateDeniedTitle: 'Código no válido', gateDeniedBody: 'Este código fue renovado. Escanea el código nuevo desde la extensión.',
    gateEndedTitle: 'Sesión finalizada', gateEndedBody: 'La sesión se detuvo en la computadora. Al volver a iniciarla, te reconectaremos solos.',
    gateKickedTitle: 'Desconectado', gateKickedBody: 'La computadora cerró la conexión con este celular.',
    gateUnsupportedTitle: 'Navegador no compatible', gateUnsupportedBody: 'Abre este enlace en Chrome o Safari actualizados.',
    noTarget: 'No hay ninguna pestaña para controlar',
    restricted: 'Chrome no permite controlar esta pestaña',
    notConnected: 'Sin conexión con la computadora',
    timerReset: 'Cronómetro reiniciado',
    airUnsupported: 'Tu celular no permite usar el giroscopio aquí',
    airDenied: 'Permiso de movimiento denegado',
    controlling: 'Controlando',
  };
  const t = (key) => TEXT[key] ?? key;

  document.documentElement.lang = 'es';
  for (const el of $$('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of $$('[data-t-aria]')) el.setAttribute('aria-label', t(el.dataset.tAria));
  for (const el of $$('[data-t-ph]')) el.placeholder = t(el.dataset.tPh);
  $('#timer').setAttribute('aria-label', t('timer'));
  $('#version').textContent = VERSION;

  // ================================================================ preferencias

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(`mando.${key}`);
        return raw == null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try {
        if (value == null) localStorage.removeItem(`mando.${key}`);
        else localStorage.setItem(`mando.${key}`, JSON.stringify(value));
      } catch {}
    },
  };

  const prefs = { sens: 1, haptics: true, wake: true, ptrMode: 'laser', ink: '#FF3B30', ...store.get('prefs', {}) };
  const savePrefs = () => store.set('prefs', prefs);

  // ================================================================ utilidades

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // Vibración: navigator.vibrate en Android; en iOS 18+ un interruptor nativo produce un toque háptico.
  const hapticSwitch = (() => {
    if (!isIOS) return null;
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.append(input);
    label.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;left:-10px;top:-10px';
    label.setAttribute('aria-hidden', 'true');
    document.body.append(label);
    return label;
  })();

  function buzz(ms = 10) {
    if (!prefs.haptics) return;
    if (navigator.vibrate) navigator.vibrate(ms);
    else if (hapticSwitch) hapticSwitch.click();
  }

  let toastTimer = 0;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
  }

  function deviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || isIOS) return 'iPad';
    const m = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/);
    if (m && m[1] && !/^K$|wv/.test(m[1])) return m[1].trim().slice(0, 32);
    if (/Android/.test(ua)) return 'Android';
    return 'Navegador';
  }

  // ================================================================ sesión

  const query = new URLSearchParams(location.search);
  const demo = query.has('demo');
  const hash = new URLSearchParams(location.hash.slice(1));
  let session = null;
  if (hash.get('id') && hash.get('k')) {
    session = { id: hash.get('id'), k: hash.get('k') };
    store.set('session', session);
    // Quitamos el secreto de la barra de direcciones.
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    session = store.get('session', null);
  }

  // ================================================================ estado de conexión

  let conn = null;
  let peer = null;
  let connState = 'idle';
  let everConnected = false;
  let latency = null;
  let retryTimer = 0;
  let retryDelay = 1200;
  let pingTimer = 0;
  let lastPong = 0;

  const GATE = {
    idle: ['gateIdleTitle', 'gateIdleBody', false, false],
    connecting: ['gateConnectingTitle', 'gateConnectingBody', true, false],
    reconnecting: ['gateConnectingTitle', 'gateConnectingBody', true, false],
    waiting: ['gateWaitingTitle', 'gateWaitingBody', true, false],
    offline: ['gateOfflineTitle', 'gateOfflineBody', true, true],
    denied: ['gateDeniedTitle', 'gateDeniedBody', false, false],
    ended: ['gateEndedTitle', 'gateEndedBody', true, true],
    kicked: ['gateKickedTitle', 'gateKickedBody', false, true],
    unsupported: ['gateUnsupportedTitle', 'gateUnsupportedBody', false, false],
  };
  const BLOCKING = new Set(['idle', 'denied', 'ended', 'kicked', 'unsupported']);

  function setConn(state) {
    connState = state;
    const shown = state === 'connecting' && everConnected ? 'reconnecting' : state;
    app.dataset.conn = shown;
    const labels = { connected: 'connected', connecting: 'connecting', reconnecting: 'reconnecting', waiting: 'reconnecting', offline: 'offline' };
    $('#status-text').textContent = t(labels[shown] || 'offline');

    const ready = state === 'connected' || (everConnected && !BLOCKING.has(state));
    app.classList.toggle('ready', ready);
    const [title, body, spinner, retry] = GATE[state] || GATE.connecting;
    $('#gate-title').textContent = t(title);
    $('#gate-body').textContent = t(body);
    $('#gate-spinner').hidden = !spinner;
    $('#gate-retry').hidden = !retry;
  }

  function setTarget(info) {
    const el = $('#target');
    if (!info || !info.title) {
      el.classList.remove('warn');
      $('#target-title').textContent = info && info.ok === false ? t('restricted') : '';
      return;
    }
    el.classList.toggle('warn', info.ok === false);
    $('#target-title').textContent = info.ok === false ? `${t('restricted')} · ${info.title}` : info.title;
  }

  // ================================================================ conexión (PeerJS)

  function scheduleRetry(fn, delay = retryDelay) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(fn, delay);
    retryDelay = Math.min(retryDelay * 1.5, 6000);
  }

  function startPeer() {
    if (!session) { setConn('idle'); return; }
    if (typeof Peer === 'undefined' || !window.RTCPeerConnection) { setConn('unsupported'); return; }
    if (peer && !peer.destroyed) {
      if (peer.disconnected) peer.reconnect();
      else if (peer.open) openConn();
      return;
    }
    if (!everConnected) setConn('connecting');
    peer = new Peer({ debug: 1 });
    const current = peer;
    current.on('open', () => { if (current === peer) openConn(); });
    current.on('disconnected', () => {
      if (current !== peer || current.destroyed) return;
      scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
    });
    current.on('error', (err) => {
      if (current !== peer) return;
      switch (err.type) {
        case 'peer-unavailable':
          if (!BLOCKING.has(connState)) setConn('waiting');
          scheduleRetry(openConn);
          break;
        case 'browser-incompatible':
          setConn('unsupported');
          break;
        case 'network':
        case 'server-error':
        case 'socket-error':
        case 'socket-closed':
          if (!conn?.open) setConn('offline');
          scheduleRetry(restartPeer);
          break;
        default:
          scheduleRetry(restartPeer);
      }
    });
  }

  function restartPeer() {
    try { peer?.destroy(); } catch {}
    peer = null;
    startPeer();
  }

  function openConn() {
    clearTimeout(retryTimer);
    if (!session || !peer || peer.destroyed || peer.disconnected || !peer.open) return;
    if (conn) {
      try { conn.removeAllListeners(); conn.close(); } catch {}
    }
    const c = peer.connect(session.id, { serialization: 'json', reliable: true });
    conn = c;
    if (!BLOCKING.has(connState)) setConn(everConnected ? 'reconnecting' : 'connecting');
    const timeout = setTimeout(() => {
      if (c === conn && !c.open) {
        try { c.close(); } catch {}
        if (!BLOCKING.has(connState)) setConn('waiting');
        scheduleRetry(openConn);
      }
    }, 12000);
    c.on('open', () => {
      clearTimeout(timeout);
      c.send({ t: 'hello', k: session.k, name: deviceName(), v: 1 });
    });
    c.on('data', (msg) => { if (c === conn) onData(msg); });
    c.on('close', () => {
      clearTimeout(timeout);
      if (c !== conn) return;
      conn = null;
      stopPing();
      if (['denied', 'kicked', 'unsupported', 'idle'].includes(connState)) return;
      if (connState !== 'ended') setConn('waiting');
      scheduleRetry(openConn, connState === 'ended' ? 4000 : retryDelay);
    });
    c.on('error', () => {});
  }

  function onData(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        everConnected = true;
        retryDelay = 1200;
        lastPong = Date.now();
        setConn('connected');
        setTarget(msg.target);
        startPing();
        keepAwake();
        buzz(20);
        announceView();
        break;
      case 'target':
        setTarget(msg);
        if (msg.ok === false && app.classList.contains('ready')) toast(t('restricted'));
        break;
      case 'state':
        if ('black' in msg) $('#chip-black').classList.toggle('on', !!msg.black);
        if ('fullscreen' in msg) $('#chip-full').classList.toggle('on', !!msg.fullscreen);
        break;
      case 'pong':
        lastPong = Date.now();
        latency = Math.max(1, Math.round((Date.now() - msg.ts) / 2));
        $('#latency').textContent = `${latency} ms`;
        break;
      case 'error':
        if (msg.error === 'no-target') toast(t('noTarget'));
        break;
      case 'denied':
        session = null;
        store.set('session', null);
        setConn('denied');
        closeConn();
        break;
      case 'bye':
        if (msg.reason === 'revoked') {
          session = null;
          store.set('session', null);
          setConn('denied');
          closeConn();
        } else if (msg.reason === 'kicked') {
          setConn('kicked');
          closeConn();
        } else {
          setConn('ended');
        }
        break;
    }
  }

  function closeConn() {
    clearTimeout(retryTimer);
    stopPing();
    const c = conn;
    conn = null;
    try { c?.removeAllListeners(); c?.close(); } catch {}
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      if (!conn?.open) return;
      if (Date.now() - lastPong > 12000) {
        // Conexión colgada: forzar reconexión.
        const c = conn;
        conn = null;
        try { c.close(); } catch {}
        setConn('waiting');
        restartPeer();
        return;
      }
      send({ t: 'ping', ts: Date.now() });
    }, 4000);
  }

  function stopPing() {
    clearInterval(pingTimer);
  }

  let lastOfflineToast = 0;
  const SILENT = new Set(['ptr', 'scroll', 'ping', 'mode', 'ink']);
  function send(msg) {
    if (demo) return true;
    if (conn?.open && connState === 'connected') {
      try { conn.send(msg); return true; } catch {}
    }
    const silent = SILENT.has(msg.t) || (msg.t === 'mouse' && msg.a === 'move');
    if (!silent && Date.now() - lastOfflineToast > 3000) {
      lastOfflineToast = Date.now();
      toast(t('notConnected'));
    }
    return false;
  }

  // Los movimientos se agrupan por cuadro para no saturar el canal.
  const pending = { ptr: [0, 0], mouse: [0, 0], scroll: [0, 0] };
  let flushQueued = false;

  function queue(kind, dx, dy) {
    pending[kind][0] += dx;
    pending[kind][1] += dy;
    if (!flushQueued) {
      flushQueued = true;
      requestAnimationFrame(flush);
    }
  }

  function flush() {
    flushQueued = false;
    for (const kind of ['ptr', 'mouse', 'scroll']) {
      const [dx, dy] = pending[kind];
      if (!dx && !dy) continue;
      pending[kind] = [0, 0];
      if (kind === 'scroll') send({ t: 'scroll', dx: Math.round(dx), dy: Math.round(dy) });
      else send({ t: kind, a: 'move', dx: +dx.toFixed(5), dy: +dy.toFixed(5) });
    }
  }

  // Aceleración del puntero: movimientos rápidos recorren más pantalla.
  function gain(dx, dy, dt) {
    const speed = Math.hypot(dx, dy) / Math.max(dt, 1);
    return prefs.sens * Math.min(3.2, 0.75 + speed * 1.25);
  }

  // ================================================================ vistas

  const VIEW_MODES = { slides: 'none', pointer: null, mouse: 'mouse', keys: 'none' };

  function setView(view) {
    app.dataset.view = view;
    for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === view));
    store.set('view', view);
    if (view !== 'keys') $('#kbd').blur();
    announceView();
  }

  function announceView() {
    const view = app.dataset.view;
    const mode = VIEW_MODES[view] ?? prefs.ptrMode;
    send({ t: 'mode', mode });
    if (mode === 'pen') send({ t: 'ink', a: 'color', color: prefs.ink });
  }

  for (const b of $$('.tabs button')) {
    b.addEventListener('click', () => {
      setView(b.dataset.tab);
      if (b.dataset.tab === 'keys') $('#kbd').focus();
      buzz(6);
    });
  }

  // Gestos genéricos con Pointer Events (multitáctil).
  function gesture(el, handlers) {
    const points = new Map();
    let maxPoints = 0;
    let moved = 0;
    let startTime = 0;

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch {}
      if (!points.size) {
        maxPoints = 0;
        moved = 0;
        startTime = e.timeStamp;
      }
      points.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
      maxPoints = Math.max(maxPoints, points.size);
      handlers.down?.(points.size, e);
    });

    el.addEventListener('pointermove', (e) => {
      const p = points.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      const dt = e.timeStamp - p.t;
      p.x = e.clientX;
      p.y = e.clientY;
      p.t = e.timeStamp;
      if (!dx && !dy) return;
      moved += Math.abs(dx) + Math.abs(dy);
      const n = points.size;
      handlers.move?.(dx / n, dy / n, dt, n, e);
    });

    const end = (e) => {
      if (!points.delete(e.pointerId)) return;
      handlers.up?.(points.size, e);
      if (!points.size) handlers.end?.({ maxPoints, moved, duration: e.timeStamp - startTime }, e);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function placeDot(dot, pad, e) {
    const r = pad.getBoundingClientRect();
    dot.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
  }

  // ================================================================ diapositivas

  function nav(action) {
    flush();
    send({ t: 'nav', a: action });
    buzz(action === 'next' || action === 'prev' ? 12 : 8);
  }

  for (const b of $$('[data-nav]')) {
    b.addEventListener('click', () => {
      const action = b.dataset.nav;
      nav(action);
      if (action === 'start' && !timer.running) timer.toggle();
      if (action === 'black') b.classList.toggle('on');
      if (action === 'exit') { $('#chip-black').classList.remove('on'); $('#chip-full').classList.remove('on'); }
    });
  }

  // Botón grande: toque = siguiente; deslizar a la izquierda = siguiente, a la derecha = anterior.
  (() => {
    const btn = $('#next');
    let start = null;
    btn.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY };
      btn.classList.add('pressed');
      try { btn.setPointerCapture(e.pointerId); } catch {}
    });
    const finish = (e, cancelled) => {
      btn.classList.remove('pressed');
      if (!start || cancelled) { start = null; return; }
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      let action = 'next';
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) action = dx < 0 ? 'next' : 'prev';
      else if (Math.hypot(dx, dy) > 30) return;
      nav(action);
      btn.classList.add('flash');
      requestAnimationFrame(() => requestAnimationFrame(() => btn.classList.remove('flash')));
    };
    btn.addEventListener('pointerup', (e) => finish(e, false));
    btn.addEventListener('pointercancel', (e) => finish(e, true));
  })();

  // ================================================================ puntero

  const ptrPad = $('#ptr-pad');
  const ptrDot = $('#ptr-dot');
  let drawing = false;
  let air = false;

  function setPtrMode(mode) {
    prefs.ptrMode = mode;
    savePrefs();
    app.dataset.ptr = mode;
    for (const b of $$('#ptr-modes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    updatePtrHint();
    if (app.dataset.view === 'pointer') send({ t: 'mode', mode });
    if (mode === 'pen') send({ t: 'ink', a: 'color', color: prefs.ink });
  }

  function updatePtrHint() {
    const key = air ? 'hintAir' : { laser: 'hintLaser', spot: 'hintSpot', pen: 'hintPen' }[prefs.ptrMode];
    $('#ptr-hint').textContent = t(key);
    ptrPad.classList.toggle('air', air);
  }

  for (const b of $$('#ptr-modes button')) {
    b.addEventListener('click', () => { setPtrMode(b.dataset.mode); buzz(6); });
  }

  function setInk(color) {
    prefs.ink = color;
    savePrefs();
    for (const b of $$('#ink-colors button')) b.setAttribute('aria-pressed', String(b.dataset.color === color));
    send({ t: 'ink', a: 'color', color });
  }
  for (const b of $$('#ink-colors button')) b.addEventListener('click', () => { setInk(b.dataset.color); buzz(6); });
  $('#ink-undo').addEventListener('click', () => { send({ t: 'ink', a: 'undo' }); buzz(8); });
  $('#ink-clear').addEventListener('click', () => { send({ t: 'ink', a: 'clear' }); buzz(14); });

  gesture(ptrPad, {
    down(n, e) {
      ptrPad.classList.add('active');
      placeDot(ptrDot, ptrPad, e);
      if (air) {
        if (n === 1) startMotion();
        return;
      }
      flush();
      if (n === 1) {
        drawing = prefs.ptrMode === 'pen';
        send({ t: 'ptr', a: 'down', ink: drawing });
        buzz(6);
      } else if (drawing) {
        // Con dos dedos el lápiz se mueve sin dibujar.
        send({ t: 'ptr', a: 'up' });
        drawing = false;
      }
    },
    move(dx, dy, dt, n, e) {
      placeDot(ptrDot, ptrPad, e);
      if (air) return;
      const w = ptrPad.clientWidth || 360;
      const g = gain(dx, dy, dt);
      queue('ptr', (dx / w) * g, (dy / w) * g);
    },
    end() {
      ptrPad.classList.remove('active');
      if (air) { stopMotion(); return; }
      flush();
      send({ t: 'ptr', a: 'up' });
      drawing = false;
    },
  });

  // ---------------- modo aire (giroscopio)

  let motionActive = false;
  let motionSeen = false;

  function onMotion(e) {
    const r = e.rotationRate;
    if (!r) return;
    motionSeen = true;
    let interval = e.interval || 16;
    if (interval < 1) interval *= 1000; // iOS lo informa en segundos
    const dt = Math.min(interval, 50) / 1000;
    const dead = 1.5;
    const yaw = Math.abs(r.alpha || 0) > dead ? r.alpha : 0;
    const pitch = Math.abs(r.beta || 0) > dead ? r.beta : 0;
    const k = prefs.sens / 38; // ~38° de giro recorren todo el ancho
    queue('ptr', -yaw * dt * k, -pitch * dt * k);
  }

  function startMotion() {
    if (motionActive) return;
    motionActive = true;
    motionSeen = false;
    window.addEventListener('devicemotion', onMotion);
    send({ t: 'ptr', a: 'down', ink: prefs.ptrMode === 'pen' });
    buzz(8);
    setTimeout(() => {
      if (motionActive && !motionSeen) toast(t('airUnsupported'));
    }, 900);
  }

  function stopMotion() {
    if (!motionActive) return;
    motionActive = false;
    window.removeEventListener('devicemotion', onMotion);
    flush();
    send({ t: 'ptr', a: 'up' });
  }

  $('#air-toggle').addEventListener('click', async () => {
    if (!air) {
      if (typeof DeviceMotionEvent === 'undefined') { toast(t('airUnsupported')); return; }
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
          if ((await DeviceMotionEvent.requestPermission()) !== 'granted') { toast(t('airDenied')); return; }
        } catch {
          toast(t('airDenied'));
          return;
        }
      }
    }
    air = !air;
    $('#air-toggle').classList.toggle('on', air);
    updatePtrHint();
    buzz(10);
  });

  // ================================================================ mouse

  const trackpad = $('#trackpad');
  const mouseDot = $('#mouse-dot');
  let lastTap = 0;
  let holding = false;

  gesture(trackpad, {
    down(n, e) {
      trackpad.classList.add('active');
      placeDot(mouseDot, trackpad, e);
    },
    move(dx, dy, dt, n, e) {
      placeDot(mouseDot, trackpad, e);
      if (n >= 2) {
        queue('scroll', -dx * 2.4, -dy * 2.4);
        return;
      }
      const w = trackpad.clientWidth || 360;
      const g = gain(dx, dy, dt);
      queue('mouse', (dx / w) * g, (dy / w) * g);
    },
    end({ maxPoints, moved, duration }) {
      trackpad.classList.remove('active');
      if (duration > 280 || moved > 14) return;
      flush();
      if (maxPoints >= 2) {
        send({ t: 'mouse', a: 'right' });
      } else {
        const now = Date.now();
        const double = now - lastTap < 330;
        lastTap = double ? 0 : now;
        send({ t: 'mouse', a: 'click', n: double ? 2 : 1 });
      }
      buzz(8);
    },
  });

  const strip = $('#scroll-strip');
  gesture(strip, {
    down() { strip.classList.add('active'); },
    move(dx, dy) { queue('scroll', 0, -dy * 3); },
    end() { strip.classList.remove('active'); },
  });

  $('#m-left').addEventListener('click', () => { flush(); send({ t: 'mouse', a: 'click', n: 1 }); buzz(8); });
  $('#m-right').addEventListener('click', () => { flush(); send({ t: 'mouse', a: 'right' }); buzz(8); });
  $('#m-hold').addEventListener('click', () => {
    holding = !holding;
    flush();
    send({ t: 'mouse', a: holding ? 'down' : 'up' });
    $('#m-hold').classList.toggle('on', holding);
    buzz(10);
  });

  // ================================================================ teclado

  // Un carácter invisible al inicio permite detectar el borrado incluso con
  // el campo vacío (los teclados de Android no siempre envían Backspace).
  const SENTINEL = '​';
  const kbd = $('#kbd');
  let lastText = SENTINEL;
  let composing = false;

  const kbdWrap = $('#kbd-wrap');
  const syncPlaceholder = () => kbdWrap.classList.toggle('empty', kbd.value === SENTINEL || kbd.value === '');

  function resetKbd() {
    kbd.value = SENTINEL;
    lastText = SENTINEL;
    syncPlaceholder();
    try { if (document.activeElement === kbd) kbd.setSelectionRange(1, 1); } catch {}
  }

  function caretToEnd() {
    const end = kbd.value.length;
    try { if (kbd.selectionStart !== end || kbd.selectionEnd !== end) kbd.setSelectionRange(end, end); } catch {}
  }

  kbd.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
      e.preventDefault();
      send({ t: 'key', k: 'Enter' });
      resetKbd();
      buzz(8);
    }
  });

  kbd.addEventListener('input', () => {
    const value = kbd.value;
    let p = 0;
    while (p < lastText.length && p < value.length && lastText[p] === value[p]) p++;
    const removed = lastText.length - p;
    const added = value.slice(p).replaceAll(SENTINEL, '');
    if (removed) send({ t: 'del', n: removed });
    if (added) {
      added.split('\n').forEach((part, i) => {
        if (i) send({ t: 'key', k: 'Enter' });
        if (part) send({ t: 'text', s: part });
      });
    }
    lastText = value;
    syncPlaceholder();
    if (!value.startsWith(SENTINEL)) resetKbd();
    else if (!composing && value.length > 60 && /\s$/.test(value)) resetKbd();
  });

  kbd.addEventListener('compositionstart', () => { composing = true; });
  kbd.addEventListener('compositionend', () => { composing = false; });
  kbd.addEventListener('focus', () => setTimeout(caretToEnd, 0));
  kbd.addEventListener('click', caretToEnd);
  kbd.addEventListener('blur', () => { if (!composing) resetKbd(); });

  for (const b of $$('[data-key]')) {
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // conserva el foco del campo
    b.addEventListener('click', () => {
      send({ t: 'key', k: b.dataset.key });
      buzz(6);
    });
  }

  resetKbd();

  // ================================================================ cronómetro

  const timer = (() => {
    const el = $('#timer');
    const saved = store.get('timer', { running: false, start: 0, elapsed: 0 });
    let { running, start, elapsed } = saved;
    let tick = 0;

    const total = () => elapsed + (running ? Date.now() - start : 0);
    const fmt = (ms) => {
      const s = Math.floor(ms / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = String(s % 60).padStart(2, '0');
      return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
    };
    const render = () => {
      el.textContent = fmt(total());
      el.classList.toggle('running', running);
    };
    const persist = () => store.set('timer', { running, start, elapsed });
    const loop = () => {
      clearInterval(tick);
      if (running) tick = setInterval(render, 250);
      render();
    };

    const api = {
      get running() { return running; },
      toggle() {
        if (running) { elapsed += Date.now() - start; running = false; }
        else { start = Date.now(); running = true; }
        persist();
        loop();
      },
      reset() {
        running = false;
        elapsed = 0;
        start = 0;
        persist();
        loop();
      },
      set(ms, run) {
        elapsed = ms;
        running = run;
        start = Date.now();
        loop();
      },
    };

    let pressTimer = 0;
    let longPress = false;
    el.addEventListener('pointerdown', () => {
      longPress = false;
      pressTimer = setTimeout(() => {
        longPress = true;
        api.reset();
        buzz(25);
        toast(t('timerReset'));
      }, 650);
    });
    const cancel = () => clearTimeout(pressTimer);
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('click', () => {
      if (longPress) return;
      api.toggle();
      buzz(8);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    loop();
    return api;
  })();

  // ================================================================ pantalla encendida

  let wakeLock = null;

  async function keepAwake() {
    if (!prefs.wake || !('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch {}
  }

  function releaseAwake() {
    try { wakeLock?.release(); } catch {}
    wakeLock = null;
  }

  // ================================================================ ajustes

  const sheet = $('#settings');

  function renderSettings() {
    $('#sens').value = prefs.sens;
    $('#sens-value').textContent = `${Number(prefs.sens).toFixed(1)}×`;
    $('#haptics').checked = prefs.haptics;
    $('#wake').checked = prefs.wake;
    $('#latency').textContent = latency != null ? `${latency} ms` : '—';
  }

  $('#open-settings').addEventListener('click', () => {
    renderSettings();
    if (typeof sheet.showModal === 'function') sheet.showModal();
    else sheet.setAttribute('open', '');
  });
  $('#status-btn').addEventListener('click', () => $('#open-settings').click());
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

  $('#sens').addEventListener('input', (e) => {
    prefs.sens = Number(e.target.value);
    $('#sens-value').textContent = `${prefs.sens.toFixed(1)}×`;
    savePrefs();
  });
  $('#haptics').addEventListener('change', (e) => { prefs.haptics = e.target.checked; savePrefs(); buzz(10); });
  $('#wake').addEventListener('change', (e) => {
    prefs.wake = e.target.checked;
    savePrefs();
    if (prefs.wake) keepAwake();
    else releaseAwake();
  });
  $('#forget').addEventListener('click', () => {
    store.set('session', null);
    session = null;
    closeConn();
    try { peer?.destroy(); } catch {}
    peer = null;
    everConnected = false;
    sheet.close();
    setConn('idle');
  });

  $('#gate-retry').addEventListener('click', () => {
    retryDelay = 1200;
    setConn(everConnected ? 'reconnecting' : 'connecting');
    if (peer && !peer.destroyed && peer.open) openConn();
    else restartPeer();
  });

  // ================================================================ teclado en pantalla (iOS)

  if (window.visualViewport) {
    const fit = () => {
      const vv = window.visualViewport;
      const shrunk = vv.height < window.innerHeight - 40;
      app.style.bottom = shrunk ? 'auto' : '';
      app.style.height = shrunk ? `${vv.height}px` : '';
      if (shrunk) window.scrollTo(0, 0);
    };
    window.visualViewport.addEventListener('resize', fit);
  }

  // ================================================================ ciclo de vida

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      stopMotion();
      return;
    }
    keepAwake();
    if (demo || !session) return;
    if (!conn?.open && !['denied', 'kicked', 'unsupported', 'idle'].includes(connState)) {
      retryDelay = 1200;
      if (peer && !peer.destroyed && peer.open) openConn();
      else restartPeer();
    }
  });

  window.addEventListener('pagehide', () => {
    try { conn?.close(); } catch {}
  });

  // Inicio
  setPtrMode(['laser', 'spot', 'pen'].includes(query.get('mode')) ? query.get('mode') : prefs.ptrMode);
  setInk(prefs.ink);
  const initialView = query.get('view') || store.get('view', 'slides');
  setView(['slides', 'pointer', 'mouse', 'keys'].includes(initialView) ? initialView : 'slides');

  if (demo) {
    // Modo demostración: interfaz conectada sin computadora (para capturas y pruebas).
    app.classList.add('instant');
    everConnected = true;
    latency = 14;
    setConn('connected');
    setTarget({ title: query.get('title') || 'Estrategia 2026 — Presentaciones de Google', ok: true });
    timer.set(12 * 60 * 1000 + 48 * 1000, query.get('timer') !== 'paused');
    if (query.has('black')) $('#chip-black').classList.add('on');
  } else if (session) {
    startPeer();
  } else {
    setConn('idle');
  }
})();
