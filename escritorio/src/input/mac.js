// Presentazo para escritorio: teclado, mouse, ventanas y pestañas en macOS.
// Llama a Core Graphics y a la API de Accesibilidad mediante koffi (FFI), sin
// compilar código nativo. macOS solo acepta estos eventos y deja leer las
// ventanas si el usuario da a Presentazo el permiso de Accesibilidad.

import koffi from 'koffi';

const FRAMEWORKS = '/System/Library/Frameworks';
const CG = koffi.load(`${FRAMEWORKS}/CoreGraphics.framework/CoreGraphics`);
const CF = koffi.load(`${FRAMEWORKS}/CoreFoundation.framework/CoreFoundation`);
const AX = koffi.load(`${FRAMEWORKS}/ApplicationServices.framework/ApplicationServices`);
const LIBC = koffi.load('/usr/lib/libSystem.B.dylib');

koffi.struct('CGPoint', { x: 'double', y: 'double' });
koffi.struct('CGSize', { width: 'double', height: 'double' });

const CGEventSourceCreate = CG.func('void *CGEventSourceCreate(int32_t state)');
const CGEventCreateMouseEvent = CG.func('void *CGEventCreateMouseEvent(void *source, uint32_t type, CGPoint pos, uint32_t button)');
const CGEventCreateKeyboardEvent = CG.func('void *CGEventCreateKeyboardEvent(void *source, uint16_t key, bool down)');
const CGEventCreateScrollWheelEvent2 = CG.func('void *CGEventCreateScrollWheelEvent2(void *source, uint32_t units, uint32_t count, int32_t w1, int32_t w2, int32_t w3)');
const CGEventSetFlags = CG.func('void CGEventSetFlags(void *event, uint64_t flags)');
const CGEventSetIntegerValueField = CG.func('void CGEventSetIntegerValueField(void *event, uint32_t field, int64_t value)');
const CGEventKeyboardSetUnicodeString = CG.func('void CGEventKeyboardSetUnicodeString(void *event, unsigned long len, const uint16_t *str)');
const CGEventPost = CG.func('void CGEventPost(uint32_t tap, void *event)');
const CGWindowListCopyWindowInfo = CG.func('void *CGWindowListCopyWindowInfo(uint32_t option, uint32_t relativeTo)');

const CFRelease = CF.func('void CFRelease(void *ref)');
const CFStringCreateWithCString = CF.func('void *CFStringCreateWithCString(void *alloc, const char *str, uint32_t encoding)');
const CFStringGetCString = CF.func('bool CFStringGetCString(void *str, _Out_ uint8_t *buf, long size, uint32_t encoding)');
const CFGetTypeID = CF.func('unsigned long CFGetTypeID(void *ref)');
const CFStringGetTypeID = CF.func('unsigned long CFStringGetTypeID(void)');
const CFNumberGetTypeID = CF.func('unsigned long CFNumberGetTypeID(void)');
const CFBooleanGetTypeID = CF.func('unsigned long CFBooleanGetTypeID(void)');
const CFBooleanGetValue = CF.func('bool CFBooleanGetValue(void *b)');
const CFNumberGetDouble = CF.func('CFNumberGetValue', 'bool', ['void *', 'int', koffi.out(koffi.pointer('double'))]);
const CFArrayGetCount = CF.func('long CFArrayGetCount(void *arr)');
const CFArrayGetValueAtIndex = CF.func('void *CFArrayGetValueAtIndex(void *arr, long index)');
const CFDictionaryGetValue = CF.func('void *CFDictionaryGetValue(void *dict, void *key)');
const kCFBooleanTrue = koffi.decode(CF.symbol('kCFBooleanTrue'), 'void *');
const kCFBooleanFalse = koffi.decode(CF.symbol('kCFBooleanFalse'), 'void *');

const AXIsProcessTrusted = AX.func('bool AXIsProcessTrusted(void)');
const AXUIElementCreateSystemWide = AX.func('void *AXUIElementCreateSystemWide(void)');
const AXUIElementCreateApplication = AX.func('void *AXUIElementCreateApplication(int32_t pid)');
const AXUIElementCopyAttributeValue = AX.func('int32_t AXUIElementCopyAttributeValue(void *el, void *attr, _Out_ void **value)');
const AXUIElementSetAttributeValue = AX.func('int32_t AXUIElementSetAttributeValue(void *el, void *attr, void *value)');
const AXUIElementPerformAction = AX.func('int32_t AXUIElementPerformAction(void *el, void *action)');
const AXUIElementGetPid = AX.func('int32_t AXUIElementGetPid(void *el, _Out_ int32_t *pid)');
const AXUIElementSetMessagingTimeout = AX.func('int32_t AXUIElementSetMessagingTimeout(void *el, float seconds)');
const AXValueGetPoint = AX.func('AXValueGetValue', 'bool', ['void *', 'uint32_t', koffi.out(koffi.pointer('CGPoint'))]);
const AXValueGetSize = AX.func('AXValueGetValue', 'bool', ['void *', 'uint32_t', koffi.out(koffi.pointer('CGSize'))]);

const procPidPath = LIBC.func('int proc_pidpath(int pid, _Out_ uint8_t *buf, uint32_t size)');

const UTF8 = 0x08000100;
const HID_TAP = 0;
const SOURCE = CGEventSourceCreate(1); // kCGEventSourceStateHIDSystemState

const EV = { leftDown: 1, leftUp: 2, rightDown: 3, rightUp: 4, moved: 5, leftDragged: 6 };
const CLICK_STATE = 1; // kCGMouseEventClickState

const FLAGS = { shift: 0x20000, ctrl: 0x40000, alt: 0x80000, meta: 0x100000 };

// Códigos de tecla virtuales de macOS (kVK_*).
const KEYCODES = {
  ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126,
  PageUp: 116, PageDown: 121, Home: 115, End: 119,
  Enter: 36, Escape: 53, Backspace: 51, Delete: 117, Tab: 48, ' ': 49,
  F5: 96, F11: 103,
  a: 0, b: 11, c: 8, f: 3, l: 37, p: 35, w: 13,
};

export const BROWSER = /^(google chrome|chromium|microsoft edge|brave browser|safari|firefox|opera|vivaldi|arc)$/i;

function post(event) {
  if (!event) return;
  CGEventPost(HID_TAP, event);
  CFRelease(event);
}

function mouseEvent(type, x, y, button = 0, clicks = 0) {
  const ev = CGEventCreateMouseEvent(SOURCE, type, { x, y }, button);
  if (ev && clicks) CGEventSetIntegerValueField(ev, CLICK_STATE, clicks);
  post(ev);
}

// -------------------------------------------------------------- utilidades de Core Foundation

const cfStrings = new Map();
function cfString(text) {
  if (!cfStrings.has(text)) cfStrings.set(text, CFStringCreateWithCString(null, text, UTF8));
  return cfStrings.get(text);
}

// Lee un CFString sin liberarlo.
function readString(ref) {
  if (!ref || CFGetTypeID(ref) !== CFStringGetTypeID()) return '';
  const buf = Buffer.alloc(2048);
  if (!CFStringGetCString(ref, buf, buf.length, UTF8)) return '';
  const end = buf.indexOf(0);
  return buf.toString('utf8', 0, end < 0 ? buf.length : end);
}

function readNumber(ref) {
  if (!ref || CFGetTypeID(ref) !== CFNumberGetTypeID()) return null;
  const out = [0];
  return CFNumberGetDouble(ref, 13, out) ? out[0] : null; // kCFNumberDoubleType
}

// -------------------------------------------------------------- accesibilidad

let systemWide = null;
function ensureSystemWide() {
  if (!systemWide) {
    systemWide = AXUIElementCreateSystemWide();
    // Una app colgada no debe bloquear a Presentazo por mucho tiempo. Chrome
    // tarda en responder la primera vez que se le consulta.
    AXUIElementSetMessagingTimeout(systemWide, 1.0);
  }
  return systemWide;
}

// Devuelve el valor de un atributo (hay que liberarlo con CFRelease) o null.
function copyAttr(el, name) {
  const out = [null];
  const err = AXUIElementCopyAttributeValue(el, cfString(name), out);
  return err === 0 && out[0] ? out[0] : null;
}

function attrString(el, name) {
  const ref = copyAttr(el, name);
  if (!ref) return '';
  try { return readString(ref); } finally { CFRelease(ref); }
}

function attrBool(el, name) {
  const ref = copyAttr(el, name);
  if (!ref) return null;
  try {
    if (CFGetTypeID(ref) === CFBooleanGetTypeID()) return CFBooleanGetValue(ref);
    const n = readNumber(ref);
    return n === null ? null : n !== 0;
  } finally {
    CFRelease(ref);
  }
}

function frame(el) {
  const posRef = copyAttr(el, 'AXPosition');
  const sizeRef = copyAttr(el, 'AXSize');
  const pos = {};
  const size = {};
  try {
    if (!posRef || !sizeRef || !AXValueGetPoint(posRef, 1, pos) || !AXValueGetSize(sizeRef, 2, size)) return null;
    return { x: Math.round(pos.x), y: Math.round(pos.y), width: Math.round(size.width), height: Math.round(size.height) };
  } finally {
    if (posRef) CFRelease(posRef);
    if (sizeRef) CFRelease(sizeRef);
  }
}

// Recorre un arreglo de elementos de accesibilidad (atributo AXWindows, AXChildren…).
function eachElement(el, attr, fn) {
  const arr = copyAttr(el, attr);
  if (!arr) return;
  try {
    const n = CFArrayGetCount(arr);
    for (let i = 0; i < n; i++) {
      if (fn(CFArrayGetValueAtIndex(arr, i), i) === false) break;
    }
  } finally {
    CFRelease(arr);
  }
}

// Programas con ventanas, de adelante hacia atrás (lo que se ve primero, primero).
export function appsByZOrder() {
  const list = CGWindowListCopyWindowInfo(16, 0); // todas, sin elementos del escritorio
  const apps = new Map();
  if (!list) return apps;
  try {
    const n = CFArrayGetCount(list);
    for (let i = 0; i < n; i++) {
      const d = CFArrayGetValueAtIndex(list, i);
      if (readNumber(CFDictionaryGetValue(d, cfString('kCGWindowLayer'))) !== 0) continue;
      const pid = readNumber(CFDictionaryGetValue(d, cfString('kCGWindowOwnerPID')));
      if (!pid || pid === process.pid || apps.has(pid)) continue;
      apps.set(pid, readString(CFDictionaryGetValue(d, cfString('kCGWindowOwnerName'))));
    }
  } finally {
    CFRelease(list);
  }
  return apps;
}

export function appPath(pid) {
  const buf = Buffer.alloc(4096);
  const n = procPidPath(pid, buf, buf.length);
  if (n <= 0) return '';
  const exe = buf.toString('utf8', 0, n);
  const i = exe.indexOf('.app/');
  return i >= 0 ? exe.slice(0, i + 4) : exe;
}

// Ventanas normales de un programa: { index, title, bounds, minimized }.
function appWindows(appEl, fn) {
  eachElement(appEl, 'AXWindows', (win, index) => {
    if (attrString(win, 'AXSubrole') !== 'AXStandardWindow') return undefined;
    const bounds = frame(win);
    if (!bounds || bounds.width < 80 || bounds.height < 60) return undefined;
    return fn(win, { index, title: attrString(win, 'AXTitle'), bounds, minimized: !!attrBool(win, 'AXMinimized') });
  });
}

// Busca las pestañas dentro de una ventana del navegador (grupo AXTabGroup).
function findTabs(win) {
  const tabs = [];
  const queue = [{ el: win, depth: 0 }];
  const arrays = [];
  let visited = 0;
  try {
    while (queue.length && visited < 800) {
      const { el, depth } = queue.shift();
      visited++;
      const role = attrString(el, 'AXRole');
      if (role === 'AXTabGroup') {
        eachElement(el, 'AXChildren', (child) => {
          const r = attrString(child, 'AXRole');
          if (r !== 'AXRadioButton' && r !== 'AXTab') return;
          const title = attrString(child, 'AXTitle') || attrString(child, 'AXDescription');
          if (title) tabs.push({ el: child, title, selected: !!attrBool(child, 'AXValue') || !!attrBool(child, 'AXSelected') });
        });
        if (tabs.length) break;
        continue;
      }
      // El contenido de las páginas no tiene pestañas y es muy grande: se salta.
      if (depth >= 10 || role === 'AXWebArea' || role === 'AXScrollArea' || role === 'AXTable') continue;
      const arr = copyAttr(el, 'AXChildren');
      if (!arr) continue;
      arrays.push(arr);
      const n = CFArrayGetCount(arr);
      for (let i = 0; i < n; i++) queue.push({ el: CFArrayGetValueAtIndex(arr, i), depth: depth + 1 });
    }
    // Los elementos se usan mientras sus arreglos siguen vivos.
    return tabs.map(({ title, selected }) => ({ title, selected }));
  } finally {
    for (const arr of arrays) CFRelease(arr);
  }
}

function pressTab(win, title) {
  const queue = [{ el: win, depth: 0 }];
  const arrays = [];
  let visited = 0;
  try {
    while (queue.length && visited < 800) {
      const { el, depth } = queue.shift();
      visited++;
      const role = attrString(el, 'AXRole');
      if (role === 'AXTabGroup') {
        let pressed = false;
        eachElement(el, 'AXChildren', (child) => {
          const name = attrString(child, 'AXTitle') || attrString(child, 'AXDescription');
          if (name !== title) return undefined;
          pressed = AXUIElementPerformAction(child, cfString('AXPress')) === 0
            || AXUIElementSetAttributeValue(child, cfString('AXSelected'), kCFBooleanTrue) === 0;
          return false;
        });
        if (pressed) return true;
        continue;
      }
      if (depth >= 10 || role === 'AXWebArea' || role === 'AXScrollArea' || role === 'AXTable') continue;
      const arr = copyAttr(el, 'AXChildren');
      if (!arr) continue;
      arrays.push(arr);
      const n = CFArrayGetCount(arr);
      for (let i = 0; i < n; i++) queue.push({ el: CFArrayGetValueAtIndex(arr, i), depth: depth + 1 });
    }
    return false;
  } finally {
    for (const arr of arrays) CFRelease(arr);
  }
}

function raiseWindow(appEl, win, minimized) {
  AXUIElementSetAttributeValue(appEl, cfString('AXFrontmost'), kCFBooleanTrue);
  if (minimized) AXUIElementSetAttributeValue(win, cfString('AXMinimized'), kCFBooleanFalse);
  AXUIElementPerformAction(win, cfString('AXRaise'));
  AXUIElementSetAttributeValue(win, cfString('AXMain'), kCFBooleanTrue);
}

// Elige la ventana guardada: primero por título, luego por posición y luego por orden.
function matchWindow(candidates, target) {
  return candidates.find((w) => target.title && w.info.title === target.title)
    || candidates.find((w) => target.bounds && JSON.stringify(w.info.bounds) === JSON.stringify(target.bounds))
    || candidates.find((w) => w.info.index === target.index)
    || candidates[0];
}

function withApp(pid, fn) {
  ensureSystemWide();
  const appEl = AXUIElementCreateApplication(pid);
  if (!appEl) return null;
  try { return fn(appEl); } finally { CFRelease(appEl); }
}

// -------------------------------------------------------------- módulo

export function createMacInput() {
  return {
    platform: 'mac',

    trusted: () => AXIsProcessTrusted(),

    moveTo(x, y, dragging) {
      mouseEvent(dragging ? EV.leftDragged : EV.moved, x, y);
    },

    button(button, down, x, y) {
      if (button === 'right') mouseEvent(down ? EV.rightDown : EV.rightUp, x, y, 1, 1);
      else mouseEvent(down ? EV.leftDown : EV.leftUp, x, y, 0, 1);
    },

    click(button, count, x, y) {
      if (button === 'right') {
        mouseEvent(EV.rightDown, x, y, 1, 1);
        mouseEvent(EV.rightUp, x, y, 1, 1);
        return;
      }
      for (let i = 1; i <= count; i++) {
        mouseEvent(EV.leftDown, x, y, 0, i);
        mouseEvent(EV.leftUp, x, y, 0, i);
      }
    },

    // dx/dy en píxeles, positivos hacia la derecha y hacia abajo (como window.scrollBy).
    scroll(dx, dy) {
      post(CGEventCreateScrollWheelEvent2(SOURCE, 0, 2, -Math.round(dy), -Math.round(dx), 0));
    },

    key(name, mods = {}) {
      const code = KEYCODES[name];
      if (code === undefined) return false;
      let flags = 0;
      for (const [k, v] of Object.entries(FLAGS)) if (mods[k]) flags |= v;
      for (const down of [true, false]) {
        const ev = CGEventCreateKeyboardEvent(SOURCE, code, down);
        if (!ev) continue;
        CGEventSetFlags(ev, flags);
        post(ev);
      }
      return true;
    },

    text(str) {
      // Los saltos de línea se envían como Intro; el resto, como texto Unicode
      // en bloques de hasta 20 unidades (límite de macOS por evento).
      for (const part of str.split(/(\r\n|\n|\r|\t)/)) {
        if (!part) continue;
        if (part === '\t') { this.key('Tab'); continue; }
        if (/^[\r\n]+$/.test(part)) { this.key('Enter'); continue; }
        // Se agrupa por caracteres completos para no partir emojis ni acentos.
        const chunks = [];
        for (const ch of part) {
          const last = chunks[chunks.length - 1];
          if (last !== undefined && last.length + ch.length <= 20) chunks[chunks.length - 1] = last + ch;
          else chunks.push(ch);
        }
        for (const chunk of chunks) {
          const utf16 = new Uint16Array(chunk.length);
          for (let i = 0; i < chunk.length; i++) utf16[i] = chunk.charCodeAt(i);
          for (const down of [true, false]) {
            const ev = CGEventCreateKeyboardEvent(SOURCE, 0, down);
            if (!ev) continue;
            CGEventSetFlags(ev, 0);
            CGEventKeyboardSetUnicodeString(ev, utf16.length, utf16);
            post(ev);
          }
        }
      }
    },

    // Programa y ventana al frente: { app, title, pid, bounds }.
    frontmost() {
      if (!AXIsProcessTrusted()) return null;
      const appEl = copyAttr(ensureSystemWide(), 'AXFocusedApplication');
      if (!appEl) return null;
      try {
        const pid = [0];
        AXUIElementGetPid(appEl, pid);
        const result = { app: attrString(appEl, 'AXTitle'), title: '', pid: pid[0], bounds: null };
        const win = copyAttr(appEl, 'AXFocusedWindow');
        if (win) {
          result.title = attrString(win, 'AXTitle');
          result.bounds = frame(win);
          CFRelease(win);
        }
        return result;
      } finally {
        CFRelease(appEl);
      }
    },

    // Ventanas abiertas de todos los programas, de adelante hacia atrás.
    listWindows() {
      if (!AXIsProcessTrusted()) return null;
      const out = [];
      for (const [pid, app] of appsByZOrder()) {
        withApp(pid, (appEl) => appWindows(appEl, (_win, info) => {
          out.push({ id: `${pid}:${info.index}`, pid, app, path: appPath(pid), ...info });
        }));
      }
      return out;
    },

    // Pestañas de los navegadores abiertos.
    listTabs() {
      if (!AXIsProcessTrusted()) return null;
      const out = [];
      for (const [pid, app] of appsByZOrder()) {
        if (!BROWSER.test(app)) continue;
        withApp(pid, (appEl) => appWindows(appEl, (win, info) => {
          for (const tab of findTabs(win)) {
            out.push({
              id: `${pid}:${info.index}:${out.length}`,
              pid, app, path: appPath(pid), window: info, title: tab.title, selected: tab.selected, bounds: info.bounds,
            });
          }
        }));
      }
      return out;
    },

    // target: { pid, title, bounds, index } tal como lo devolvió listWindows.
    activateWindow(target) {
      return !!withApp(target.pid, (appEl) => {
        const candidates = [];
        appWindows(appEl, (win, info) => { candidates.push({ win, info }); });
        // Los elementos solo valen mientras se recorre: se vuelve a buscar y se actúa ahí.
        const chosen = matchWindow(candidates, target);
        let done = false;
        appWindows(appEl, (win, info) => {
          if (!chosen || info.index !== chosen.info.index) return undefined;
          raiseWindow(appEl, win, info.minimized);
          done = true;
          return false;
        });
        if (!done) AXUIElementSetAttributeValue(appEl, cfString('AXFrontmost'), kCFBooleanTrue);
        return true;
      });
    },

    // target: { pid, title, window } tal como lo devolvió listTabs.
    activateTab(target) {
      return !!withApp(target.pid, (appEl) => {
        let done = false;
        appWindows(appEl, (win, info) => {
          if (!pressTab(win, target.title)) return undefined;
          raiseWindow(appEl, win, info.minimized);
          done = true;
          return false;
        });
        if (!done) AXUIElementSetAttributeValue(appEl, cfString('AXFrontmost'), kCFBooleanTrue);
        return done;
      });
    },
  };
}
