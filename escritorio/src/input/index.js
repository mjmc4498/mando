// Presentazo para escritorio: elige el módulo de teclado y mouse del sistema.
// Con la variable PRESENTAZO_PRUEBA se usa un registrador que anota cada acción
// en un archivo, para las pruebas automáticas.

import fs from 'node:fs';

function createRecorder(file) {
  const log = (entry) => fs.appendFileSync(file, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`);
  return {
    platform: 'prueba',
    trusted: () => true,
    moveTo: (x, y, dragging) => log({ a: 'move', x: Math.round(x), y: Math.round(y), dragging: !!dragging }),
    button: (button, down) => log({ a: 'button', button, down }),
    click: (button, count) => log({ a: 'click', button, count }),
    scroll: (dx, dy) => log({ a: 'scroll', dx: Math.round(dx), dy: Math.round(dy) }),
    key: (name, mods = {}) => { log({ a: 'key', name, mods }); return true; },
    text: (str) => log({ a: 'text', str }),
    frontmost: () => ({ ...front }),
    listWindows: () => WINDOWS.map((w) => ({ ...w })),
    listTabs: async () => TABS.map((t) => ({ ...t })),
    activateWindow: (target) => {
      log({ a: 'activar', id: target.id });
      const w = WINDOWS.find((x) => x.id === target.id);
      if (w) front = { app: w.app, title: w.title, pid: w.pid, bounds: w.bounds };
      return !!w;
    },
    activateTab: async (target) => {
      log({ a: 'pestaña', id: target.id, title: target.title });
      front = { app: target.app, title: target.title, pid: target.pid, bounds: target.bounds };
      return true;
    },
  };
}

// Ventanas y pestañas ficticias para las pruebas.
const BOUNDS = { x: 100, y: 100, width: 1200, height: 800 };
const WINDOWS = [
  { id: '1:0', pid: 1, app: 'Keynote', path: '', title: 'Presentación de prueba', bounds: BOUNDS, minimized: false, index: 0 },
  { id: '2:0', pid: 2, app: 'Microsoft PowerPoint', path: '', title: 'Ventas 2026.pptx', bounds: BOUNDS, minimized: false, index: 0 },
  { id: '3:0', pid: 3, app: 'Google Chrome', path: '', title: 'Mi deck - Presentaciones de Google', bounds: BOUNDS, minimized: false, index: 0 },
];
const TABS = [
  { id: '3:0:0', pid: 3, app: 'Google Chrome', path: '', window: WINDOWS[2], title: 'Mi deck - Presentaciones de Google', selected: true, bounds: BOUNDS },
  { id: '3:0:1', pid: 3, app: 'Google Chrome', path: '', window: WINDOWS[2], title: 'Correo', selected: false, bounds: BOUNDS },
];
let front = { app: 'Keynote', title: 'Presentación de prueba', pid: 1, bounds: BOUNDS };

function createUnavailable(error) {
  const nothing = () => false;
  return {
    platform: 'ninguno',
    error,
    trusted: nothing,
    moveTo: nothing,
    button: nothing,
    click: nothing,
    scroll: nothing,
    key: nothing,
    text: nothing,
    frontmost: () => null,
    listWindows: () => null,
    listTabs: async () => null,
    activateWindow: nothing,
    activateTab: async () => false,
  };
}

export async function createInput(options) {
  if (process.env.PRESENTAZO_PRUEBA) return createRecorder(process.env.PRESENTAZO_PRUEBA);
  try {
    if (process.platform === 'darwin') return (await import('./mac.js')).createMacInput(options);
    if (process.platform === 'win32') return (await import('./windows.js')).createWindowsInput(options);
    return createUnavailable('plataforma');
  } catch (err) {
    console.error('[Presentazo] no se pudo cargar el control del teclado y mouse:', err);
    return createUnavailable(String(err?.message || err));
  }
}
