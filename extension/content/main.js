// Presentazo — script en el "mundo principal" de la página.
// Solo emite eventos de teclado y escribe texto: muchas apps de presentaciones
// (Google Slides, PowerPoint web…) leen keyCode/which, propiedades que solo
// pueden definirse desde el contexto de la propia página.
// Recibe órdenes del script aislado mediante el evento "mando:cmd".

(() => {
  'use strict';

  const VERSION = 1;
  const SLOT = Symbol.for('mando.main');
  const previous = window[SLOT];
  if (previous && previous.version >= VERSION) return;
  if (previous) document.removeEventListener('mando:cmd', previous.listener, true);

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  const KEYS = {
    ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40],
    PageUp: ['PageUp', 33], PageDown: ['PageDown', 34], Home: ['Home', 36], End: ['End', 35],
    Enter: ['Enter', 13], Escape: ['Escape', 27], Backspace: ['Backspace', 8], Tab: ['Tab', 9],
    Delete: ['Delete', 46], ' ': ['Space', 32], F5: ['F5', 116],
  };

  const NAV_KEYS = {
    arrows: { next: 'ArrowRight', prev: 'ArrowLeft' },
    page: { next: 'PageDown', prev: 'PageUp' },
    space: { next: ' ', prev: 'ArrowLeft' },
  };

  function keyInfo(key) {
    if (KEYS[key]) {
      const [code, keyCode] = KEYS[key];
      return { key, code, keyCode, charCode: key === ' ' ? 32 : key === 'Enter' ? 13 : 0 };
    }
    const upper = key.toUpperCase();
    const letter = /^[a-z]$/i.test(key);
    const digit = /^[0-9]$/.test(key);
    return {
      key,
      code: letter ? `Key${upper}` : digit ? `Digit${key}` : '',
      keyCode: letter ? upper.charCodeAt(0) : digit ? key.charCodeAt(0) : 0,
      charCode: key.codePointAt(0) || 0,
    };
  }

  // ------------------------------------------------------------ foco

  // Elemento que recibiría una pulsación real: baja por iframes del mismo
  // origen y por shadow roots siguiendo document.activeElement.
  function deepFocus() {
    let doc = document;
    for (let depth = 0; depth < 12; depth++) {
      let el = doc.activeElement;
      while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
      if (el && (el.tagName === 'IFRAME' || el.tagName === 'FRAME')) {
        let inner = null;
        try { inner = el.contentDocument; } catch {}
        if (inner) { doc = inner; continue; }
      }
      if (!el || el === doc.documentElement) return doc.body || doc.documentElement;
      return el;
    }
    return document.body || document.documentElement;
  }

  // Google Slides dibuja el modo presentación en un iframe propio.
  function presentationTarget() {
    if (location.hostname === 'docs.google.com') {
      const frame = document.querySelector('iframe.punch-present-iframe');
      if (frame) {
        try {
          const doc = frame.contentDocument;
          if (doc) {
            const el = doc.activeElement;
            return el && el !== doc.documentElement ? el : doc.body || doc.documentElement;
          }
        } catch {}
      }
    }
    return null;
  }

  // ------------------------------------------------------------ eventos

  function fireKey(target, type, info, mods = {}) {
    const doc = target.ownerDocument || target;
    const view = doc.defaultView || window;
    const Ctor = view.KeyboardEvent || KeyboardEvent;
    const ev = new Ctor(type, {
      key: info.key,
      code: info.code,
      bubbles: true,
      cancelable: true,
      composed: true,
      view,
      ctrlKey: !!mods.ctrl,
      shiftKey: !!mods.shift,
      altKey: !!mods.alt,
      metaKey: !!mods.meta,
    });
    const keyCode = type === 'keypress' ? info.charCode : info.keyCode;
    Object.defineProperties(ev, {
      keyCode: { get: () => keyCode },
      which: { get: () => keyCode },
      charCode: { get: () => (type === 'keypress' ? info.charCode : 0) },
    });
    return target.dispatchEvent(ev);
  }

  // Devuelve true si ningún manejador canceló la tecla.
  function press(target, key, mods) {
    const info = keyInfo(key);
    const ok = fireKey(target, 'keydown', info, mods);
    if (ok && info.charCode && !mods?.ctrl && !mods?.meta) fireKey(target, 'keypress', info, mods);
    fireKey(target, 'keyup', info, mods);
    return ok;
  }

  function clickElement(el) {
    const r = el.getBoundingClientRect();
    const view = el.ownerDocument.defaultView;
    const base = { bubbles: true, cancelable: true, composed: true, view, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new view.PointerEvent('pointerover', pointer));
    el.dispatchEvent(new view.MouseEvent('mouseover', base));
    el.dispatchEvent(new view.PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
    el.dispatchEvent(new view.MouseEvent('mousedown', { ...base, buttons: 1 }));
    el.dispatchEvent(new view.PointerEvent('pointerup', pointer));
    el.dispatchEvent(new view.MouseEvent('mouseup', base));
    el.dispatchEvent(new view.MouseEvent('click', base));
  }

  // ------------------------------------------------------------ edición de texto

  const TEXT_INPUTS = /^(text|search|email|url|tel|password|number|)$/i;

  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
    if (el.tagName === 'INPUT') return TEXT_INPUTS.test(el.type) && !el.readOnly && !el.disabled;
    return false;
  }

  function insertText(el, text) {
    const doc = el.ownerDocument;
    let done = false;
    try { done = doc.execCommand('insertText', false, text); } catch {}
    if (done) return;
    if (typeof el.setRangeText === 'function') {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      el.setRangeText(text, start, end, 'end');
      el.dispatchEvent(new (doc.defaultView.InputEvent)('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  function moveCaret(el, key) {
    const doc = el.ownerDocument;
    if (el.isContentEditable) {
      const sel = doc.getSelection();
      const map = {
        ArrowLeft: ['backward', 'character'], ArrowRight: ['forward', 'character'],
        ArrowUp: ['backward', 'line'], ArrowDown: ['forward', 'line'],
        Home: ['backward', 'lineboundary'], End: ['forward', 'lineboundary'],
      };
      if (sel && map[key]) sel.modify('move', ...map[key]);
      return;
    }
    if (typeof el.selectionStart !== 'number') return;
    const v = el.value;
    let pos = el.selectionEnd;
    if (key === 'ArrowLeft') pos = Math.max(0, el.selectionStart - (el.selectionStart === el.selectionEnd ? 1 : 0));
    else if (key === 'ArrowRight') pos = Math.min(v.length, pos + (el.selectionStart === el.selectionEnd ? 1 : 0));
    else if (key === 'Home' || key === 'ArrowUp') pos = key === 'Home' ? v.lastIndexOf('\n', pos - 1) + 1 : 0;
    else if (key === 'End' || key === 'ArrowDown') {
      const nl = v.indexOf('\n', pos);
      pos = key === 'End' && nl !== -1 ? nl : v.length;
    }
    el.setSelectionRange(pos, pos);
  }

  const TABBABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"],[contenteditable=""]';

  function focusNext(el, backwards) {
    const doc = el.ownerDocument;
    const list = [...doc.querySelectorAll(TABBABLE)].filter((n) => n.getClientRects().length);
    if (!list.length) return;
    const i = list.indexOf(el);
    const next = list[(i + (backwards ? -1 : 1) + list.length) % list.length];
    next.focus();
  }

  function scrollPage(el, dy) {
    const view = (el.ownerDocument || document).defaultView || window;
    view.scrollBy({ top: dy, behavior: 'smooth' });
  }

  // Simula la acción por defecto de una tecla cuando la página no la canceló
  // (los eventos sintéticos no la ejecutan por sí solos).
  function defaultAction(el, key, mods = {}) {
    const doc = el.ownerDocument || document;
    const view = doc.defaultView || window;
    if (isEditable(el)) {
      switch (key) {
        case 'Backspace': doc.execCommand('delete'); return;
        case 'Delete': doc.execCommand('forwardDelete'); return;
        case 'Tab': focusNext(el, mods.shift); return;
        case 'Enter':
          if (el.tagName === 'INPUT') { try { el.form?.requestSubmit(); } catch {} }
          else if (el.tagName === 'TEXTAREA') insertText(el, '\n');
          else doc.execCommand('insertParagraph');
          return;
        case ' ': insertText(el, ' '); return;
        case 'Escape': el.blur(); return;
        default: moveCaret(el, key); return;
      }
    }
    const h = view.innerHeight;
    switch (key) {
      case 'Tab': focusNext(el, mods.shift); break;
      case 'Enter':
        if (el.matches?.('a[href],button,[role="button"],input[type="submit"],input[type="button"],summary')) el.click();
        break;
      case ' ':
        if (el.matches?.('button,[role="button"],input[type="checkbox"],input[type="radio"],summary')) el.click();
        else scrollPage(el, h * 0.85);
        break;
      case 'ArrowDown': scrollPage(el, 60); break;
      case 'ArrowUp': scrollPage(el, -60); break;
      case 'PageDown': scrollPage(el, h * 0.85); break;
      case 'PageUp': scrollPage(el, -h * 0.85); break;
      case 'Home': view.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'End': view.scrollTo({ top: doc.documentElement.scrollHeight, behavior: 'smooth' }); break;
    }
  }

  // ------------------------------------------------------------ órdenes

  function nav(action, nextKey) {
    const keys = NAV_KEYS[nextKey] || NAV_KEYS.arrows;
    const key = { next: keys.next, prev: keys.prev, first: 'Home', last: 'End' }[action];
    if (!key) return;
    const target = presentationTarget() || deepFocus();
    if (press(target, key) && (action === 'next' || action === 'prev') && !isEditable(target)) {
      // Nadie atendió la tecla: en páginas desplazables avanzamos una pantalla.
      const doc = target.ownerDocument || document;
      const scroller = doc.scrollingElement;
      if (scroller && scroller.scrollHeight > doc.defaultView.innerHeight + 8) {
        scrollPage(target, (action === 'next' ? 1 : -1) * doc.defaultView.innerHeight * 0.85);
      }
    }
  }

  function startPresentation() {
    if (location.hostname === 'docs.google.com' && location.pathname.startsWith('/presentation')) {
      const button = document.querySelector('#punch-start-presentation-left');
      if (button) { clickElement(button); return; }
      press(deepFocus(), isMac ? 'Enter' : 'F5', isMac ? { meta: true } : { ctrl: true });
      return;
    }
    press(deepFocus(), 'F5');
  }

  function exitPresentation() {
    press(presentationTarget() || deepFocus(), 'Escape');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  function key(k, mods) {
    const el = deepFocus();
    if (press(el, k, mods)) defaultAction(el, k, mods);
  }

  function typeText(text) {
    const chars = [...text];
    if (chars.length > 64) {
      const el = deepFocus();
      if (isEditable(el)) { insertText(el, text); return; }
    }
    for (const ch of chars) {
      if (ch === '\n') { key('Enter'); continue; }
      const el = deepFocus();
      const info = keyInfo(ch);
      const ok = fireKey(el, 'keydown', info);
      const ok2 = ok && fireKey(el, 'keypress', info);
      if (ok && ok2 && isEditable(el)) insertText(el, ch);
      fireKey(el, 'keyup', info);
    }
  }

  function run(cmd) {
    switch (cmd.t) {
      case 'nav':
        if (cmd.a === 'start') startPresentation();
        else if (cmd.a === 'exit') exitPresentation();
        else nav(cmd.a, cmd.nextKey);
        break;
      case 'key':
        key(cmd.k, cmd.mods);
        break;
      case 'text':
        typeText(String(cmd.s || ''));
        break;
      case 'del':
        for (let i = 0; i < Math.min(200, cmd.n | 0); i++) key('Backspace');
        break;
    }
  }

  const listener = (event) => {
    let cmd;
    try { cmd = JSON.parse(event.detail); } catch { return; }
    if (!cmd || typeof cmd !== 'object') return;
    try { run(cmd); } catch (err) { console.debug('[Presentazo]', err); }
  };

  document.addEventListener('mando:cmd', listener, true);
  window[SLOT] = { version: VERSION, listener };
})();
