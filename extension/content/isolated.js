// Presentazo — script de contenido (mundo aislado).
// · Dibuja la capa visual: puntero láser, foco, lápiz, cursor, pantalla negra y avisos.
// · Ejecuta clics, arrastres y desplazamientos del mouse remoto.
// · Envía teclas y texto al marco con el foco (o al iframe correspondiente).

(() => {
  'use strict';

  const previous = window.__mando;
  if (previous && previous.alive()) return;
  try { previous?.destroy(); } catch {}

  const isTop = window === window.top;
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

  // ------------------------------------------------------------ ajustes

  const DEFAULTS = {
    laserColor: '#FF3B30',
    laserSize: 'm',
    spotSize: 'm',
    nextKey: 'arrows',
    clearInkOnSlide: true,
  };
  let settings = { ...DEFAULTS };

  chrome.storage.sync.get('settings').then(({ settings: s }) => {
    settings = { ...DEFAULTS, ...(s || {}) };
    overlay?.applySettings();
  }).catch(() => {});

  const onStorage = (changes, area) => {
    if (area === 'sync' && changes.settings) {
      settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
      overlay?.applySettings();
    }
  };
  chrome.storage.onChanged.addListener(onStorage);

  // ------------------------------------------------------------ puente con el mundo principal

  function toMain(cmd) {
    document.dispatchEvent(new CustomEvent('mando:cmd', { detail: JSON.stringify({ ...cmd, nextKey: settings.nextKey }) }));
  }

  // ------------------------------------------------------------ iframes de otro origen

  function isFrame(el) {
    return !!el && (el.tagName === 'IFRAME' || el.tagName === 'FRAME');
  }

  function sameOriginDoc(frame) {
    try { return frame.contentDocument || null; } catch { return null; }
  }

  // Si el foco está dentro de un iframe de otro origen, devuelve ese iframe.
  function crossOriginFocusFrame() {
    let doc = document;
    for (let depth = 0; depth < 12; depth++) {
      let el = doc.activeElement;
      while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
      if (!isFrame(el)) return null;
      const inner = sameOriginDoc(el);
      if (!inner) return el;
      doc = inner;
    }
    return null;
  }

  // Envía una orden al script de Presentazo dentro de un iframe de otro origen.
  // La sonda es de un solo uso: el iframe la reporta al service worker,
  // que así conoce su frameId y le entrega la orden directamente.
  function routeToFrame(frame, cmd) {
    const win = frame.contentWindow;
    if (!win) return;
    const nonce = crypto.randomUUID();
    win.postMessage({ mandoProbe: nonce }, '*');
    chrome.runtime.sendMessage({ to: 'sw', type: 'frame:route', nonce, cmd: { ...cmd, nextKey: settings.nextKey } }).catch(() => {});
  }

  const onProbe = (event) => {
    const data = event.data;
    if (isTop || event.source !== window.parent || !data || typeof data.mandoProbe !== 'string') return;
    chrome.runtime.sendMessage({ to: 'sw', type: 'frame:hello', nonce: data.mandoProbe }).catch(() => {});
  };
  window.addEventListener('message', onProbe, true);

  function routeKeys(cmd) {
    const frame = crossOriginFocusFrame();
    if (frame) routeToFrame(frame, cmd);
    else toMain(cmd);
  }

  // ------------------------------------------------------------ mouse sintético

  // Busca el elemento bajo (x, y) atravesando shadow roots e iframes del mismo origen.
  function hitTest(x, y) {
    let doc = document;
    let ox = 0;
    let oy = 0;
    for (let depth = 0; depth < 12; depth++) {
      let el = doc.elementFromPoint(x - ox, y - oy);
      if (!el) return null;
      while (el.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(x - ox, y - oy);
        if (!inner || inner === el) break;
        el = inner;
      }
      if (isFrame(el)) {
        const r = el.getBoundingClientRect();
        const cs = el.ownerDocument.defaultView.getComputedStyle(el);
        const ix = r.left + el.clientLeft + parseFloat(cs.paddingLeft || 0);
        const iy = r.top + el.clientTop + parseFloat(cs.paddingTop || 0);
        const inner = sameOriginDoc(el);
        if (inner) { doc = inner; ox += ix; oy += iy; continue; }
        return { remote: true, frame: el, x: x - ox - ix, y: y - oy - iy };
      }
      return { el, x: x - ox, y: y - oy };
    }
    return null;
  }

  function mouseInit(el, x, y, extra) {
    const view = el.ownerDocument.defaultView;
    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      view,
      clientX: x,
      clientY: y,
      screenX: x + (view.screenX || 0),
      screenY: y + (view.screenY || 0),
      button: 0,
      buttons: 0,
      detail: 1,
      ...extra,
    };
  }

  const POINTER = { pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 };

  function fire(el, type, init, kind = 'MouseEvent') {
    const view = el.ownerDocument.defaultView;
    const Ctor = view[kind] || window[kind];
    return el.dispatchEvent(new Ctor(type, init));
  }

  const FOCUSABLE = 'input:not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled]),a[href],[tabindex],[contenteditable=""],[contenteditable="true"]';

  function focusFor(el, x, y) {
    const doc = el.ownerDocument;
    const target = el.closest?.(FOCUSABLE);
    try {
      if (target) {
        target.focus({ preventScroll: true });
        if (target.isContentEditable && doc.caretRangeFromPoint) {
          const range = doc.caretRangeFromPoint(x, y);
          if (range) {
            const sel = doc.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      } else {
        const active = doc.activeElement;
        if (active && active !== doc.body && !isFrame(active)) active.blur();
      }
    } catch {}
  }

  function clickAt(x, y, button = 0, count = 1) {
    const hit = hitTest(x, y);
    if (!hit) return;
    if (hit.remote) {
      routeToFrame(hit.frame, { t: 'click', x: hit.x, y: hit.y, b: button, n: count });
      return;
    }
    const { el } = hit;
    const pressed = button === 2 ? 2 : 1;
    fire(el, 'pointerdown', mouseInit(el, hit.x, hit.y, { ...POINTER, button, buttons: pressed }), 'PointerEvent');
    const ok = fire(el, 'mousedown', mouseInit(el, hit.x, hit.y, { button, buttons: pressed, detail: count }));
    if (ok && button === 0) focusFor(el, hit.x, hit.y);
    fire(el, 'pointerup', mouseInit(el, hit.x, hit.y, { ...POINTER, button }), 'PointerEvent');
    fire(el, 'mouseup', mouseInit(el, hit.x, hit.y, { button, detail: count }));
    if (button === 0) {
      fire(el, 'click', mouseInit(el, hit.x, hit.y, { detail: count }));
      if (count === 2) fire(el, 'dblclick', mouseInit(el, hit.x, hit.y, { detail: 2 }));
    } else if (button === 2) {
      fire(el, 'contextmenu', mouseInit(el, hit.x, hit.y, { button: 2 }));
    }
  }

  let hoverEl = null;
  let dragEl = null;
  let lastHover = 0;

  function hoverAt(x, y, buttons = 0) {
    const now = performance.now();
    if (!buttons && now - lastHover < 32) return;
    lastHover = now;
    const hit = hitTest(x, y);
    if (!hit || hit.remote) return;
    const { el } = hit;
    if (el !== hoverEl) {
      if (hoverEl?.isConnected) {
        fire(hoverEl, 'pointerout', mouseInit(hoverEl, hit.x, hit.y, { ...POINTER, buttons }), 'PointerEvent');
        fire(hoverEl, 'mouseout', mouseInit(hoverEl, hit.x, hit.y, { buttons, relatedTarget: el }));
      }
      fire(el, 'pointerover', mouseInit(el, hit.x, hit.y, { ...POINTER, buttons }), 'PointerEvent');
      fire(el, 'mouseover', mouseInit(el, hit.x, hit.y, { buttons, relatedTarget: hoverEl?.isConnected ? hoverEl : null }));
      hoverEl = el;
    }
    fire(el, 'pointermove', mouseInit(el, hit.x, hit.y, { ...POINTER, buttons }), 'PointerEvent');
    fire(el, 'mousemove', mouseInit(el, hit.x, hit.y, { buttons }));
  }

  function buttonAt(x, y, action) {
    const hit = hitTest(x, y);
    if (!hit || hit.remote) return;
    const { el } = hit;
    if (action === 'down') {
      dragEl = el;
      fire(el, 'pointerdown', mouseInit(el, hit.x, hit.y, { ...POINTER, buttons: 1 }), 'PointerEvent');
      if (fire(el, 'mousedown', mouseInit(el, hit.x, hit.y, { buttons: 1 }))) focusFor(el, hit.x, hit.y);
    } else {
      fire(el, 'pointerup', mouseInit(el, hit.x, hit.y, POINTER), 'PointerEvent');
      fire(el, 'mouseup', mouseInit(el, hit.x, hit.y));
      if (dragEl === el) fire(el, 'click', mouseInit(el, hit.x, hit.y));
      dragEl = null;
    }
  }

  function canScroll(el, dx, dy) {
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    if (dy && /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
      if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
    }
    if (dx && /(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
      if (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0) return true;
    }
    return false;
  }

  function scrollAt(x, y, dx, dy) {
    const hit = hitTest(x, y);
    if (!hit) { window.scrollBy(dx, dy); return; }
    if (hit.remote) { routeToFrame(hit.frame, { t: 'wheel', x: hit.x, y: hit.y, dx, dy }); return; }
    const { el } = hit;
    const ok = fire(el, 'wheel', mouseInit(el, hit.x, hit.y, { deltaX: dx, deltaY: dy, deltaMode: 0 }), 'WheelEvent');
    if (!ok) return;
    let node = el;
    while (node) {
      if (node.nodeType === 1 && canScroll(node, dx, dy)) {
        node.scrollBy({ left: dx, top: dy, behavior: 'instant' });
        return;
      }
      node = node.parentElement || node.getRootNode?.().host || node.ownerDocument?.defaultView?.frameElement || null;
    }
    (el.ownerDocument.defaultView || window).scrollBy({ left: dx, top: dy, behavior: 'instant' });
  }

  // ------------------------------------------------------------ capa visual (solo marco superior)

  const SIZES = { s: 16, m: 24, l: 34 };
  const SPOTS = { s: 22, m: 32, l: 44 };
  const ARROW = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 2.5v18.2l5.1-4.9 3.3 7.6 3.5-1.5-3.3-7.4 7.1-.3z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .fill { position: absolute; inset: 0; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    .black { background: #000; opacity: 0; transition: opacity .35s ease; }
    .black.on { opacity: 1; }
    .spot {
      position: absolute; left: 0; top: 0; border-radius: 50%;
      width: var(--d); height: var(--d); margin: calc(var(--d) / -2) 0 0 calc(var(--d) / -2);
      box-shadow: 0 0 0 200vmax rgba(0,0,0,.74);
      background: radial-gradient(closest-side, transparent 78%, rgba(0,0,0,.74));
      opacity: 0; transition: opacity .25s ease; will-change: transform;
    }
    .spot.on { opacity: 1; }
    .laser {
      position: absolute; left: 0; top: 0; border-radius: 50%;
      width: var(--s); height: var(--s); margin: calc(var(--s) / -2) 0 0 calc(var(--s) / -2);
      background: radial-gradient(circle, #fff 0 14%, var(--c) 32%, color-mix(in srgb, var(--c) 0%, transparent) 72%);
      box-shadow: 0 0 calc(var(--s) * .9) calc(var(--s) * .2) color-mix(in srgb, var(--c) 55%, transparent);
      opacity: 0; transition: opacity .18s ease; will-change: transform;
    }
    .laser.on { opacity: 1; }
    .pen {
      position: absolute; left: 0; top: 0; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
      border: 2px solid var(--ink); background: color-mix(in srgb, var(--ink) 25%, transparent);
      box-shadow: 0 0 0 1px rgba(255,255,255,.7); opacity: 0; transition: opacity .2s ease; will-change: transform;
    }
    .pen.on { opacity: 1; }
    .cursor {
      position: absolute; left: 0; top: 0; width: 26px; height: 26px; margin: -3px 0 0 -4px;
      filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); opacity: 0; transition: opacity .2s ease; will-change: transform;
    }
    .cursor.on { opacity: 1; }
    .ripple {
      position: absolute; left: 0; top: 0; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%;
      border: 2px solid var(--c); pointer-events: none; animation: ripple .45s cubic-bezier(.2,.8,.2,1) forwards;
    }
    @keyframes ripple {
      from { transform: translate(var(--x), var(--y)) scale(.3); opacity: 1; }
      to { transform: translate(var(--x), var(--y)) scale(1.3); opacity: 0; }
    }
    .toast {
      position: absolute; left: 50%; bottom: 36px; display: flex; align-items: center; gap: 10px;
      padding: 11px 18px 11px 14px; border-radius: 999px; max-width: min(90vw, 520px);
      background: rgba(20,20,22,.9); color: #fff; backdrop-filter: blur(14px);
      font: 500 14px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      letter-spacing: -.01em; box-shadow: 0 10px 30px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.08);
      opacity: 0; transform: translate(-50%, 12px); transition: opacity .25s ease, transform .25s ease;
    }
    .toast.on { opacity: 1; transform: translate(-50%, 0); }
    .toast i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #34C759; box-shadow: 0 0 0 4px rgba(52,199,89,.22); }
    .toast span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;

  class Overlay {
    constructor() {
      this.pos = { x: innerWidth / 2, y: innerHeight / 2 };
      this.shown = { ...this.pos };
      this.mode = 'none';
      this.down = false;
      this.black = false;
      this.inkColor = '#FF3B30';
      this.strokes = [];
      this.stroke = null;
      this.trail = [];
      this.raf = 0;
      this.timers = {};
      this.host = null;
      this.onResize = () => this.resize();
      this.onFullscreen = () => this.raise();
    }

    build() {
      const host = document.createElement('mando-overlay');
      host.setAttribute('popover', 'manual');
      const style = {
        position: 'fixed', inset: '0', width: '100vw', height: '100vh', 'max-width': 'none', 'max-height': 'none',
        margin: '0', padding: '0', border: '0', background: 'transparent', 'pointer-events': 'none',
        'z-index': '2147483647', overflow: 'visible', display: 'block', opacity: '1', visibility: 'visible',
        transform: 'none', filter: 'none', contain: 'strict', 'color-scheme': 'normal',
      };
      for (const [k, v] of Object.entries(style)) host.style.setProperty(k, v, 'important');
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>${CSS}</style>
        <canvas class="ink"></canvas>
        <div class="fill black"></div>
        <div class="spot"></div>
        <canvas class="trail"></canvas>
        <div class="laser"></div>
        <div class="pen"></div>
        <div class="cursor">${ARROW}</div>
        <div class="toast"><i></i><span></span></div>`;
      // Evita que un estilo global ::backdrop de la página oscurezca la pantalla.
      const guard = document.createElement('style');
      guard.textContent = 'mando-overlay::backdrop{display:none!important}';
      host.appendChild(guard);
      this.root = root;
      this.el = {
        ink: root.querySelector('.ink'),
        trail: root.querySelector('.trail'),
        black: root.querySelector('.black'),
        spot: root.querySelector('.spot'),
        laser: root.querySelector('.laser'),
        pen: root.querySelector('.pen'),
        cursor: root.querySelector('.cursor'),
        toast: root.querySelector('.toast'),
      };
      this.inkCtx = this.el.ink.getContext('2d');
      this.trailCtx = this.el.trail.getContext('2d');
      this.host = host;
      addEventListener('resize', this.onResize);
      document.addEventListener('fullscreenchange', this.onFullscreen, true);
      this.applySettings();
    }

    ensure() {
      if (!this.host) this.build();
      if (!this.host.isConnected) {
        document.documentElement.appendChild(this.host);
        this.resize();
        this.raise();
      }
    }

    // Lleva la capa a la "top layer" para que quede por encima incluso de
    // presentaciones en pantalla completa.
    raise() {
      const host = this.host;
      if (!host?.isConnected) return;
      try {
        if (host.matches(':popover-open')) host.hidePopover();
        host.showPopover();
      } catch {
        const fs = document.fullscreenElement;
        const parent = fs && !isFrame(fs) && fs.tagName !== 'VIDEO' ? fs : document.documentElement;
        if (host.parentNode !== parent) parent.appendChild(host);
      }
    }

    applySettings() {
      if (!this.host) return;
      const s = this.host.style;
      s.setProperty('--c', settings.laserColor);
      s.setProperty('--s', `${SIZES[settings.laserSize] || SIZES.m}px`);
      s.setProperty('--d', `${SPOTS[settings.spotSize] || SPOTS.m}vmin`);
      s.setProperty('--ink', this.inkColor);
    }

    resize() {
      if (!this.host) return;
      const dpr = devicePixelRatio || 1;
      for (const [canvas, ctx] of [[this.el.ink, this.inkCtx], [this.el.trail, this.trailCtx]]) {
        canvas.width = Math.round(innerWidth * dpr);
        canvas.height = Math.round(innerHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      this.pos.x = Math.min(this.pos.x, innerWidth - 1);
      this.pos.y = Math.min(this.pos.y, innerHeight - 1);
      this.redrawInk();
    }

    // -------- movimiento

    moveBy(dx, dy) {
      const scale = innerWidth;
      this.pos.x = Math.max(0, Math.min(innerWidth - 1, this.pos.x + dx * scale));
      this.pos.y = Math.max(0, Math.min(innerHeight - 1, this.pos.y + dy * scale));
      this.animate();
    }

    animate() {
      if (!this.raf) this.raf = requestAnimationFrame(() => this.tick());
    }

    tick() {
      this.raf = 0;
      if (!this.host) return;
      const k = this.mode === 'pen' ? 0.7 : 0.5;
      const ddx = this.pos.x - this.shown.x;
      const ddy = this.pos.y - this.shown.y;
      this.shown.x += ddx * k;
      this.shown.y += ddy * k;
      const settled = Math.abs(ddx) < 0.3 && Math.abs(ddy) < 0.3;
      if (settled) { this.shown.x = this.pos.x; this.shown.y = this.pos.y; }

      const t = `translate3d(${this.shown.x}px, ${this.shown.y}px, 0)`;
      this.el.laser.style.transform = t;
      this.el.spot.style.transform = t;
      this.el.pen.style.transform = t;
      this.el.cursor.style.transform = t;

      const now = performance.now();
      if (this.mode === 'laser' && this.down) this.trail.push({ x: this.shown.x, y: this.shown.y, t: now });
      if (this.stroke) this.addInkPoint(this.shown.x, this.shown.y);
      this.drawTrail(now);

      if (!settled || this.trail.length) this.animate();
    }

    drawTrail(now) {
      const ctx = this.trailCtx;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const life = 260;
      this.trail = this.trail.filter((p) => now - p.t < life);
      if (this.trail.length < 2) return;
      const size = SIZES[settings.laserSize] || SIZES.m;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = settings.laserColor;
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1];
        const b = this.trail[i];
        const f = 1 - (now - b.t) / life;
        ctx.globalAlpha = f * 0.5;
        ctx.lineWidth = Math.max(1, size * 0.45 * f);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // -------- modos

    setMode(mode) {
      this.ensure();
      this.raise();
      if (this.stroke) this.endStroke();
      this.mode = mode;
      this.down = false;
      this.el.laser.classList.remove('on');
      this.el.spot.classList.remove('on');
      this.el.pen.classList.remove('on');
      this.el.cursor.classList.toggle('on', mode === 'mouse');
      if (mode === 'mouse') this.autoHide('cursor', 4000);
    }

    pointer(cmd) {
      this.ensure();
      if (cmd.a === 'move') {
        this.moveBy(cmd.dx, cmd.dy);
        if (this.mode === 'pen') { this.el.pen.classList.add('on'); this.autoHide('pen', 2500); }
        if (this.down) this.autoHide('pointer', 15000);
        return;
      }
      if (cmd.a === 'down') {
        this.raise();
        clearTimeout(this.timers.up);
        this.down = true;
        if (this.mode === 'spot') this.el.spot.classList.add('on');
        else if (this.mode === 'pen') {
          this.el.pen.classList.add('on');
          clearTimeout(this.timers.pen);
          if (cmd.ink) this.beginStroke();
        } else {
          if (this.mode !== 'laser') this.setMode('laser');
          this.down = true;
          this.el.laser.classList.add('on');
        }
        this.autoHide('pointer', 15000);
        this.animate();
        return;
      }
      if (cmd.a === 'up') {
        this.down = false;
        if (this.stroke) this.endStroke();
        if (this.mode === 'pen') this.autoHide('pen', 2500);
        this.timers.up = setTimeout(() => {
          this.el.laser.classList.remove('on');
          this.el.spot.classList.remove('on');
        }, 220);
      }
    }

    autoHide(name, ms) {
      clearTimeout(this.timers[name]);
      this.timers[name] = setTimeout(() => {
        if (name === 'cursor') this.el.cursor.classList.remove('on');
        if (name === 'pen') this.el.pen.classList.remove('on');
        if (name === 'pointer') this.pointer({ a: 'up' });
      }, ms);
    }

    mouseMove(dx, dy) {
      this.ensure();
      if (this.mode !== 'mouse') this.setMode('mouse');
      this.el.cursor.classList.add('on');
      this.autoHide('cursor', 4000);
      this.moveBy(dx, dy);
    }

    ripple() {
      const r = document.createElement('div');
      r.className = 'ripple';
      r.style.setProperty('--x', `${this.pos.x}px`);
      r.style.setProperty('--y', `${this.pos.y}px`);
      this.root.appendChild(r);
      setTimeout(() => r.remove(), 500);
    }

    // -------- tinta

    beginStroke() {
      this.stroke = { color: this.inkColor, width: 4, pts: [] };
      this.strokes.push(this.stroke);
      this.addInkPoint(this.shown.x, this.shown.y);
    }

    endStroke() {
      this.addInkPoint(this.pos.x, this.pos.y);
      this.stroke = null;
    }

    addInkPoint(x, y) {
      const pts = this.stroke.pts;
      const p = [x / innerWidth, y / innerHeight];
      const last = pts[pts.length - 1];
      if (last && Math.abs(last[0] - p[0]) * innerWidth < 0.8 && Math.abs(last[1] - p[1]) * innerHeight < 0.8) return;
      pts.push(p);
      this.drawStroke(this.stroke, Math.max(0, pts.length - 3));
    }

    drawStroke(stroke, from = 0) {
      const ctx = this.inkCtx;
      const pts = stroke.pts.map(([x, y]) => [x * innerWidth, y * innerHeight]);
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], stroke.width / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      const start = Math.max(0, from);
      ctx.moveTo(pts[start][0], pts[start][1]);
      for (let i = start + 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last[0], last[1]);
      ctx.stroke();
    }

    redrawInk() {
      if (!this.inkCtx) return;
      this.inkCtx.clearRect(0, 0, innerWidth, innerHeight);
      for (const s of this.strokes) this.drawStroke(s);
    }

    ink(cmd) {
      this.ensure();
      if (cmd.a === 'clear') { this.strokes = []; this.stroke = null; this.redrawInk(); }
      if (cmd.a === 'undo') { if (this.stroke) this.stroke = null; this.strokes.pop(); this.redrawInk(); }
      if (cmd.a === 'color' && cmd.color) { this.inkColor = cmd.color; this.applySettings(); }
    }

    clearInk() {
      if (!this.strokes.length) return;
      this.strokes = [];
      this.stroke = null;
      this.redrawInk();
    }

    // -------- pantalla negra y avisos

    setBlack(on) {
      this.ensure();
      this.raise();
      this.black = on;
      this.el.black.classList.toggle('on', on);
      return on;
    }

    toast(text) {
      this.ensure();
      this.raise();
      this.el.toast.querySelector('span').textContent = text;
      this.el.toast.classList.add('on');
      clearTimeout(this.timers.toast);
      this.timers.toast = setTimeout(() => this.el.toast.classList.remove('on'), 2600);
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      for (const t of Object.values(this.timers)) clearTimeout(t);
      removeEventListener('resize', this.onResize);
      document.removeEventListener('fullscreenchange', this.onFullscreen, true);
      this.host?.remove();
      this.host = null;
    }
  }

  let overlay = isTop ? new Overlay() : null;

  // ------------------------------------------------------------ órdenes

  const SLIDE_NAV = new Set(['next', 'prev', 'first', 'last']);

  function handleTop(cmd) {
    switch (cmd.t) {
      case 'mode':
        overlay.setMode(cmd.mode);
        break;
      case 'ptr':
        overlay.pointer(cmd);
        break;
      case 'ink':
        overlay.ink(cmd);
        break;
      case 'nav':
        if (cmd.a === 'black') return { ok: true, state: { black: overlay.setBlack(!overlay.black) } };
        if (SLIDE_NAV.has(cmd.a)) {
          if (settings.clearInkOnSlide) overlay.clearInk();
          if (overlay.black) overlay.setBlack(false);
        }
        if (cmd.a === 'exit') { overlay.setBlack(false); overlay.clearInk(); }
        routeKeys(cmd);
        break;
      case 'key':
      case 'text':
      case 'del':
        routeKeys(cmd);
        break;
      case 'mouse': {
        if (cmd.a === 'move') {
          overlay.mouseMove(cmd.dx, cmd.dy);
          hoverAt(overlay.pos.x, overlay.pos.y, dragEl ? 1 : 0);
          break;
        }
        overlay.mouseMove(0, 0);
        const { x, y } = overlay.pos;
        if (cmd.a === 'click') { overlay.ripple(); clickAt(x, y, 0, cmd.n); }
        else if (cmd.a === 'right') { overlay.ripple(); clickAt(x, y, 2, 1); }
        else buttonAt(x, y, cmd.a);
        break;
      }
      case 'scroll':
        overlay.ensure();
        scrollAt(overlay.pos.x, overlay.pos.y, cmd.dx, cmd.dy);
        break;
      case 'toast':
        overlay.toast(cmd.text);
        break;
      case 'reset':
        overlay.destroy();
        overlay = new Overlay();
        break;
    }
    return { ok: true };
  }

  // Órdenes que llegan a un iframe de otro origen (ya con coordenadas locales).
  function handleRouted(cmd) {
    switch (cmd.t) {
      case 'click': clickAt(cmd.x, cmd.y, cmd.b, cmd.n); break;
      case 'wheel': scrollAt(cmd.x, cmd.y, cmd.dx, cmd.dy); break;
      case 'nav':
      case 'key':
      case 'text':
      case 'del':
        if (cmd.nextKey) settings = { ...settings, nextKey: cmd.nextKey };
        routeKeys(cmd);
        break;
    }
  }

  const onMessage = (msg, sender, sendResponse) => {
    if (!msg?.mando || sender.id !== chrome.runtime.id) return;
    let res = { ok: true };
    try {
      if (msg.routed) handleRouted(msg.mando);
      else if (isTop) res = handleTop(msg.mando);
    } catch (err) {
      console.debug('[Presentazo]', err);
    }
    sendResponse(res);
  };
  chrome.runtime.onMessage.addListener(onMessage);

  window.__mando = {
    alive,
    destroy() {
      overlay?.destroy();
      window.removeEventListener('message', onProbe, true);
      try { chrome.runtime.onMessage.removeListener(onMessage); } catch {}
      try { chrome.storage.onChanged.removeListener(onStorage); } catch {}
    },
  };
})();
