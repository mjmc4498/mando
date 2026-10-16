// Prueba de punta a punta de Presentazo para escritorio: la app de Electron real y
// la página del celular conectadas por PeerJS. Las teclas y el mouse no se envían
// al sistema: un registrador (PRESENTAZO_PRUEBA) anota cada acción y la prueba lo lee.
//
//   npm run test:escritorio
//   PRESENTAZO_APP=/ruta/a/Presentazo.app/Contents/MacOS/Presentazo npm run test:escritorio
//     (prueba la app ya empaquetada en lugar del código fuente)
//
// Usa el servidor local de la raíz del proyecto (npm run serve); si no está
// encendido, la prueba levanta uno propio.
import puppeteer from 'puppeteer';

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'escritorio');
const BASE = process.env.BASE || 'http://localhost:8765';
const OUT = path.join(ROOT, 'test', 'out', 'escritorio');
const PORT = 9333;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'registro.jsonl');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 15000, interval = 150 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(interval);
  }
  return null;
}

const entries = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
let mark = 0;
const since = () => entries().filter((e) => e.ts >= mark);
const setMark = () => { mark = Date.now(); };

// ---------------------------------------------------------------- servidor local

const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  s.on('connect', () => { s.end(); resolve(true); });
  s.on('error', () => resolve(false));
});

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
let server = null;
if (!(await portOpen(8765))) {
  server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(8765, '127.0.0.1');
  await waitFor(() => portOpen(8765), { timeout: 8000 });
}

// ---------------------------------------------------------------- app de escritorio

const packaged = process.env.PRESENTAZO_APP;
const electron = packaged || createRequire(path.join(APP, 'package.json'))('electron');
const proc = spawn(electron, [...(packaged ? [] : [APP]), `--remote-debugging-port=${PORT}`], {
  env: {
    ...process.env,
    PRESENTAZO_PRUEBA: LOG,
    PRESENTAZO_DATOS: path.join(OUT, 'datos'),
    PRESENTAZO_REMOTO: `${BASE}/remote/`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let appOutput = '';
proc.stdout.on('data', (d) => { appOutput += d; });
proc.stderr.on('data', (d) => { appOutput += d; });

let phoneBrowser = null;
let app = null;

try {
  const ready = await waitFor(() => entries().find((e) => e.a === 'estado' && e.status === 'ready'), { timeout: 30000 });
  check('La app se conecta al servidor de señalización', !!ready);
  const url = entries().find((e) => e.a === 'url')?.url;
  check('La app genera el enlace del celular', !!url && url.includes('#id=mando-') && url.includes('&k='), url);

  app = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  const findPage = async (name) => (await app.pages()).find((p) => p.url().endsWith(name));
  const panel = await waitFor(() => findPage('panel.html'));
  const overlay = await waitFor(() => findPage('overlay.html'));
  check('Se abren el panel y la capa del puntero', !!panel && !!overlay);

  if (packaged) {
    const version = await panel.evaluate(() => document.getElementById('version').textContent);
    check('Se prueba la app empaquetada', !!version, version);
  }
  // Clic por el DOM: no enfoca la ventana del panel (así no la oculta Presentazo).
  const clickPanel = (sel) => panel.evaluate((x) => document.querySelector(x).click(), sel);
  const panelText = (sel) => panel.evaluate((x) => document.querySelector(x)?.textContent || '', sel);
  const qr = await panel.evaluate(() => document.querySelectorAll('#qr svg rect').length);
  check('El panel muestra el código QR', qr > 100, `${qr} módulos`);
  await panel.screenshot({ path: path.join(OUT, '1-panel.png') });

  // ---------- celular
  phoneBrowser = await puppeteer.launch({ headless: process.env.HEADFUL ? false : true, args: ['--window-size=420,900'] });
  const phone = await phoneBrowser.newPage();
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: false, deviceScaleFactor: 2 });
  await phone.goto(`${BASE}/remote/${new URL(url).hash}`);
  const connected = await waitFor(() => phone.evaluate(() => document.getElementById('app').dataset.conn === 'connected'), { timeout: 30000 });
  check('El celular se conecta a la app de escritorio', !!connected);

  const title = await waitFor(() => phone.evaluate(() => document.getElementById('target-title').textContent || null), { timeout: 5000 });
  check('El celular muestra el programa al frente', title === 'Keynote · Presentación de prueba', title);

  const panelStatus = await waitFor(async () => {
    const t = await panel.evaluate(() => document.getElementById('status-text').textContent);
    return t === '1 celular conectado' ? t : null;
  }, { timeout: 5000 });
  check('El panel muestra el celular conectado', !!panelStatus);
  check('El panel muestra qué se controla', !!(await waitFor(async () => (await panelText('#control-sub')) === 'Ahora: Keynote · Presentación de prueba', { timeout: 4000 })), await panelText('#control-sub'));
  await panel.screenshot({ path: path.join(OUT, '2-panel-conectado.png') });

  const hasKey = (name, mods) => since().some((e) => e.a === 'key' && e.name === name && (!mods || JSON.stringify(e.mods) === JSON.stringify(mods)));

  // ---------- diapositivas
  setMark();
  await phone.click('#next');
  check('Siguiente diapositiva: flecha derecha', !!(await waitFor(() => hasKey('ArrowRight'), { timeout: 4000 })));
  setMark();
  await phone.click('.prev');
  check('Diapositiva anterior: flecha izquierda', !!(await waitFor(() => hasKey('ArrowLeft'), { timeout: 4000 })));

  setMark();
  await phone.click('[data-nav="start"]');
  check('Iniciar presentación en Keynote: Cmd+Opción+P', !!(await waitFor(() => hasKey('p', { meta: true, alt: true }), { timeout: 4000 })));

  setMark();
  await phone.click('[data-nav="exit"]');
  check('Salir de la presentación: Escape', !!(await waitFor(() => hasKey('Escape'), { timeout: 4000 })));

  // ---------- pantalla negra
  await phone.click('#chip-black');
  const blackOn = await waitFor(() => overlay.evaluate(() => document.querySelector('.black').classList.contains('on')), { timeout: 4000 });
  check('Pantalla negra en la capa', !!blackOn);
  check('El celular marca la pantalla negra', !!(await waitFor(() => phone.evaluate(() => document.getElementById('chip-black').classList.contains('on')), { timeout: 3000 })));
  check('La capa se muestra encima', (await overlay.evaluate(() => document.visibilityState)) === 'visible');
  await phone.click('#chip-black');
  check('Quitar la pantalla negra', !!(await waitFor(() => overlay.evaluate(() => !document.querySelector('.black').classList.contains('on')), { timeout: 4000 })));

  // ---------- puntero láser
  await phone.click('.tabs [data-tab="pointer"]');
  await phone.click('#ptr-modes [data-mode="laser"]');
  const pad = await (await phone.$('#ptr-pad')).boundingBox();
  await phone.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
  await phone.mouse.down();
  await phone.mouse.move(pad.x + pad.width / 2 + 80, pad.y + pad.height / 2 + 40, { steps: 10 });
  const laser = await waitFor(() => overlay.evaluate(() => document.querySelector('.laser').classList.contains('on')), { timeout: 4000 });
  check('Puntero láser visible en la capa', !!laser);
  const moved = await overlay.evaluate(() => document.querySelector('.laser').style.transform);
  check('El láser sigue el dedo', /translate3d/.test(moved), moved);
  await phone.mouse.up();
  check('El láser se apaga al soltar', !!(await waitFor(() => overlay.evaluate(() => !document.querySelector('.laser').classList.contains('on')), { timeout: 4000 })));

  // ---------- lápiz
  await phone.click('#ptr-modes [data-mode="pen"]');
  await phone.mouse.move(pad.x + 60, pad.y + 120);
  await phone.mouse.down();
  for (let i = 0; i <= 20; i++) await phone.mouse.move(pad.x + 60 + i * 10, pad.y + 120 + Math.sin(i / 3) * 40);
  await phone.mouse.up();
  const inkPixels = () => overlay.evaluate(() => {
    const c = document.querySelector('.ink');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });
  const drawn = await waitFor(async () => ((await inkPixels()) > 200 ? inkPixels() : null), { timeout: 4000 });
  check('El lápiz dibuja sobre la pantalla', !!drawn, `${drawn} píxeles`);
  await phone.click('.tabs [data-tab="slides"]');
  await phone.click('#next');
  check('Los dibujos se borran al pasar de diapositiva', !!(await waitFor(async () => (await inkPixels()) === 0, { timeout: 4000 })));

  // ---------- mouse remoto
  await phone.click('.tabs [data-tab="mouse"]');
  const tp = await (await phone.$('#trackpad')).boundingBox();
  // Primero hacia arriba a la izquierda (por si el cursor real está en una esquina)
  // y enseguida hacia abajo a la derecha, que es lo que se mide.
  await phone.mouse.move(tp.x + 200, tp.y + 160);
  await phone.mouse.down();
  await phone.mouse.move(tp.x + 80, tp.y + 80, { steps: 6 });
  await phone.mouse.up();
  setMark();
  await phone.mouse.move(tp.x + 80, tp.y + 80);
  await phone.mouse.down();
  await phone.mouse.move(tp.x + 200, tp.y + 160, { steps: 12 });
  await phone.mouse.up();
  const moves = await waitFor(() => { const m = since().filter((e) => e.a === 'move'); return m.length >= 3 ? m : null; }, { timeout: 4000 });
  check('Mover el mouse desde el celular', !!moves, moves ? `${moves.length} movimientos` : '');
  if (moves) {
    const first = moves[0];
    const last = moves[moves.length - 1];
    check('El cursor se mueve hacia abajo a la derecha', last.x > first.x && last.y > first.y, `${first.x},${first.y} → ${last.x},${last.y}`);
  }
  setMark();
  await phone.click('#m-left');
  check('Clic izquierdo', !!(await waitFor(() => since().some((e) => e.a === 'click' && e.button === 'left' && e.count === 1), { timeout: 4000 })));
  setMark();
  await phone.click('#m-right');
  check('Clic derecho', !!(await waitFor(() => since().some((e) => e.a === 'click' && e.button === 'right'), { timeout: 4000 })));
  setMark();
  const strip = await (await phone.$('#scroll-strip')).boundingBox();
  await phone.mouse.move(strip.x + strip.width / 2, strip.y + strip.height * 0.7);
  await phone.mouse.down();
  await phone.mouse.move(strip.x + strip.width / 2, strip.y + strip.height * 0.3, { steps: 8 });
  await phone.mouse.up();
  check('Desplazar con la tira lateral', !!(await waitFor(() => since().some((e) => e.a === 'scroll' && e.dy !== 0), { timeout: 4000 })));

  // ---------- teclado
  await phone.click('.tabs [data-tab="keys"]');
  setMark();
  await phone.focus('#kbd');
  await phone.keyboard.type('Hola ñandú');
  const typed = await waitFor(() => {
    const s = since().filter((e) => e.a === 'text').map((e) => e.str).join('');
    return s === 'Hola ñandú' ? s : null;
  }, { timeout: 5000 });
  check('Escribir texto con tildes y ñ', !!typed, since().filter((e) => e.a === 'text').map((e) => e.str).join(''));
  setMark();
  await phone.keyboard.press('Backspace');
  check('Borrar desde el celular', !!(await waitFor(() => hasKey('Backspace'), { timeout: 4000 })));

  // ---------- qué se controla: programa, pestaña y pantalla
  const hasEntry = (fn) => since().some(fn);
  const optionTitles = () => panel.evaluate(() => [...document.querySelectorAll('#pick-list .option-title')].map((e) => e.textContent));
  const chooseOption = (title) => panel.evaluate((t) => {
    const b = [...document.querySelectorAll('#pick-list .option')].find((o) => o.querySelector('.option-title').textContent === t);
    b?.click();
    return !!b;
  }, title);
  const phoneTarget = () => phone.evaluate(() => document.getElementById('target-title').textContent);

  await clickPanel('#control-open');
  const windowsList = await waitFor(async () => { const t = await optionTitles(); return t.length >= 3 ? t : null; }, { timeout: 5000 });
  check('El selector lista los programas abiertos', !!windowsList, (windowsList || []).join(' | '));
  await panel.screenshot({ path: path.join(OUT, '3-elegir-programa.png') });
  setMark();
  await chooseOption('Ventas 2026.pptx');
  check('Elegir un programa lo trae al frente', !!(await waitFor(() => hasEntry((e) => e.a === 'activar' && e.id === '2:0'), { timeout: 4000 })));
  check('El panel muestra el programa elegido', !!(await waitFor(async () => (await panelText('#control-title')) === 'Ventas 2026.pptx', { timeout: 3000 })));
  const ppt = await waitFor(async () => ((await phoneTarget()) === 'PowerPoint · Ventas 2026.pptx' ? true : null), { timeout: 5000 });
  check('El celular muestra el programa elegido', !!ppt, await phoneTarget());
  await phone.click('.tabs [data-tab="slides"]');
  setMark();
  await phone.click('#next');
  await waitFor(() => hasKey('ArrowRight'), { timeout: 4000 });
  check('Con el programa al frente, la tecla llega sin reactivarlo', hasKey('ArrowRight') && !hasEntry((e) => e.a === 'activar'));

  await clickPanel('#pick-tabs [data-kind="tabs"]');
  const tabsList = await waitFor(async () => { const t = await optionTitles(); return t.includes('Correo') ? t : null; }, { timeout: 5000 });
  check('El selector lista las pestañas del navegador', !!tabsList, (tabsList || []).join(' | '));
  await panel.screenshot({ path: path.join(OUT, '4-elegir-pestana.png') });
  setMark();
  await chooseOption('Correo');
  check('Elegir una pestaña la muestra en el navegador', !!(await waitFor(() => hasEntry((e) => e.a === 'pestaña' && e.title === 'Correo'), { timeout: 4000 })));
  const tabShown = await waitFor(async () => ((await phoneTarget()) === 'Correo (Google Chrome)' ? true : null), { timeout: 5000 });
  check('El celular muestra la pestaña elegida', !!tabShown, await phoneTarget());

  await clickPanel('#pick-tabs [data-kind="screens"]');
  const screens = await waitFor(async () => { const t = await optionTitles(); return t.length ? t : null; }, { timeout: 5000 });
  check('El selector lista las pantallas', !!screens, (screens || []).join(' | '));
  await panel.screenshot({ path: path.join(OUT, '5-elegir-pantalla.png') });
  await panel.evaluate(() => document.querySelector('#pick-list .identify').click());
  const ident = await waitFor(() => overlay.evaluate(() => (document.querySelector('.demo').classList.contains('on') ? document.querySelector('.demo span').textContent : null)), { timeout: 4000 });
  check('Identificar muestra el número en la pantalla', ident === 'Pantalla 1', ident);
  await chooseOption(screens[0]);
  const savedScreen = await waitFor(() => {
    const st = JSON.parse(fs.readFileSync(path.join(OUT, 'datos', 'ajustes.json'), 'utf8'));
    return st.settings.display !== 'auto' ? st.settings.display : null;
  }, { timeout: 3000 });
  check('Elegir una pantalla se guarda', !!savedScreen, savedScreen);
  await clickPanel('#pick-auto');
  check('Volver a automático', !!(await waitFor(async () => (await panelText('#control-title')) === 'Automático', { timeout: 3000 })));
  await clickPanel('#toggle-settings');

  // ---------- ajustes
  await clickPanel('#toggle-settings');
  await clickPanel('#nextKey [data-value="page"]');
  await phone.click('.tabs [data-tab="slides"]');
  setMark();
  await phone.click('#next');
  check('Ajuste "Re Pág / Av Pág" cambia la tecla de avance', !!(await waitFor(() => hasKey('PageDown'), { timeout: 4000 })));
  const saved = JSON.parse(fs.readFileSync(path.join(OUT, 'datos', 'ajustes.json'), 'utf8'));
  check('Los ajustes se guardan', saved.settings.nextKey === 'page');
  await clickPanel('#nextKey [data-value="arrows"]');
  await clickPanel('#laserColor [data-value="#0A84FF"]');
  const color = await waitFor(() => overlay.evaluate(() => (document.body.style.getPropertyValue('--c') === '#0A84FF' ? true : null)), { timeout: 3000 });
  check('El color del láser llega a la capa', !!color);
  await panel.screenshot({ path: path.join(OUT, '6-ajustes.png') });
  await clickPanel('#toggle-settings');

  // ---------- código nuevo
  await clickPanel('#reset');
  const revoked = await waitFor(() => phone.evaluate(() => document.getElementById('app').dataset.conn === 'denied'), { timeout: 8000 });
  check('Con un código nuevo el celular anterior queda desconectado', !!revoked);
  const newUrl = await waitFor(() => entries().filter((e) => e.a === 'url').at(-1)?.url !== url && entries().filter((e) => e.a === 'url').at(-1)?.url, { timeout: 5000 });
  check('El código nuevo es distinto', !!newUrl && newUrl !== url);
  const qrChanged = await waitFor(() => panel.evaluate(() => !document.getElementById('qr-card').classList.contains('loading')), { timeout: 15000 });
  check('El panel vuelve a estar listo con el código nuevo', !!qrChanged);
} catch (err) {
  check('Sin errores inesperados', false, err.stack || String(err));
} finally {
  try { app?.disconnect(); } catch {}
  await phoneBrowser?.close().catch(() => {});
  proc.kill();
  server?.close();
  fs.writeFileSync(path.join(OUT, 'salida-app.txt'), appOutput);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
process.exit(failed.length ? 1 : 0);
