// Prueba de punta a punta de Mando: extensión + página del celular conectadas por PeerJS.
// Requiere un servidor local en la raíz del proyecto:  npm run serve   (otra terminal)
// y luego:  npm run test:e2e
import puppeteer from 'puppeteer';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');
const BASE = process.env.BASE || 'http://localhost:8765';
const OUT = process.env.OUT || path.join(ROOT, 'test', 'out');
await import('node:fs').then((fs) => fs.mkdirSync(OUT, { recursive: true }));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 15000, interval = 150 } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(interval);
  }
  return null;
}

const browser = await puppeteer.launch({
  headless: process.env.HEADFUL ? false : true,
  pipe: true,
  enableExtensions: [EXT],
  args: ['--window-size=1280,860'],
  defaultViewport: null,
});

try {
  // ---------- extensión cargada
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  check('Service worker cargado', !!extId, extId);

  // Cerrar la pestaña de bienvenida que abre la instalación (si existe) tras verificarla
  const welcome = await waitFor(async () => (await browser.pages()).find((p) => p.url().includes('options.html')), { timeout: 5000 });
  check('Se abre la página de bienvenida al instalar', !!welcome);

  // ---------- presentación de prueba
  const deck = await browser.newPage();
  await deck.setViewport({ width: 1280, height: 800 });
  await deck.goto(`${BASE}/test/index.html`, { waitUntil: 'networkidle0' });

  // Página de la extensión para hablar con el service worker
  const ctl = welcome || (await browser.newPage());
  if (!welcome) await ctl.goto(`chrome-extension://${extId}/options.html`);
  const sw = (msg) => ctl.evaluate((m) => chrome.runtime.sendMessage({ to: 'sw', ...m }), msg);
  const deckTabId = await ctl.evaluate(async (base) => (await chrome.tabs.query({ url: `${base}/test/*` }))[0]?.id, BASE);
  check('Pestaña de la presentación encontrada', deckTabId != null, `tabId ${deckTabId}`);

  await deck.bringToFront();
  const snap = await sw({ type: 'session:start', tabId: deckTabId });
  check('Sesión iniciada', snap?.state?.active === true, `peerId ${snap?.identity?.peerId}`);
  check('Pestaña objetivo correcta', snap?.state?.targetTabId === deckTabId);

  const ready = await waitFor(async () => {
    const { state } = await ctl.evaluate(() => chrome.storage.session.get('state'));
    return state?.status === 'ready' ? state : null;
  }, { timeout: 20000 });
  check('Conectado al servidor de señalización (PeerJS)', !!ready);

  const scripts = await ctl.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  check('Scripts de contenido registrados durante la sesión', scripts.length === 2, scripts.map((s) => `${s.id}:${s.world}`).join(', '));

  // ---------- celular
  const { identity } = await ctl.evaluate(() => chrome.storage.local.get('identity'));
  const phoneCtx = await browser.createBrowserContext();
  const phone = await phoneCtx.newPage();
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: false, deviceScaleFactor: 2 });
  await phone.goto(`${BASE}/remote/#id=${identity.peerId}&k=${identity.token}`);
  const connected = await waitFor(() => phone.evaluate(() => document.getElementById('app').dataset.conn === 'connected'), { timeout: 30000 });
  check('El celular se conecta por WebRTC', !!connected);
  check('El secreto se quita de la URL del celular', !(await phone.evaluate(() => location.hash)).includes('k='));

  const target = await phone.evaluate(() => document.getElementById('target-title').textContent);
  check('El celular muestra la pestaña controlada', target.includes('Presentación de prueba'), target);

  const devices = await waitFor(async () => {
    const { state } = await ctl.evaluate(() => chrome.storage.session.get('state'));
    return state?.devices?.length ? state.devices : null;
  });
  check('La extensión registra el dispositivo', !!devices, devices?.map((d) => d.name).join(', '));

  const toastText = await waitFor(() => deck.evaluate(() => {
    const host = document.querySelector('mando-overlay');
    return host ? true : null;
  }), { timeout: 5000 });
  check('Aparece la capa de Mando en la presentación (aviso de conexión)', !!toastText);

  console.log('visibilidad: deck', await deck.evaluate(() => document.visibilityState), '| phone', await phone.evaluate(() => document.visibilityState));

  const deckEvents = () => deck.evaluate(() => window.events.slice());
  const slideText = () => deck.evaluate(() => document.getElementById('slide').textContent);

  // ---------- avanzar / retroceder
  await phone.click('#next');
  let ok = await waitFor(async () => (await slideText()) === 'Diapositiva 2', { timeout: 5000 });
  let ev = await deckEvents();
  check('Siguiente → ArrowRight con keyCode 39', !!ok, ev.filter((e) => e.includes('keydown')).slice(-1)[0]);

  await phone.click('.prev');
  ok = await waitFor(async () => (await slideText()) === 'Diapositiva 1' && (await deckEvents()).some((e) => e.includes('keyCode=37')), { timeout: 5000 });
  check('Anterior → ArrowLeft', !!ok);

  // Deslizar sobre el botón grande hacia la izquierda = siguiente
  const nb = await (await phone.$('#next')).boundingBox();
  await phone.mouse.move(nb.x + nb.width * 0.8, nb.y + nb.height / 2);
  await phone.mouse.down();
  await phone.mouse.move(nb.x + nb.width * 0.2, nb.y + nb.height / 2, { steps: 6 });
  await phone.mouse.up();
  ok = await waitFor(async () => (await slideText()) === 'Diapositiva 2', { timeout: 5000 });
  check('Deslizar a la izquierda → siguiente', !!ok);

  // ---------- pantalla negra
  await phone.click('#chip-black');
  ok = await waitFor(() => deck.evaluate(() => {
    const host = document.querySelector('mando-overlay');
    return host && host.matches(':popover-open');
  }), { timeout: 5000 });
  check('La capa está en la top layer (popover)', !!ok);
  const blackOn = await waitFor(() => phone.evaluate(() => document.getElementById('chip-black').classList.contains('on')), { timeout: 3000 });
  check('Pantalla negra activada', !!blackOn);
  await phone.click('#chip-black');

  // ---------- puntero láser
  await phone.click('.tabs [data-tab="pointer"]');
  await phone.click('#ptr-modes [data-mode="laser"]');
  const pad = await (await phone.$('#ptr-pad')).boundingBox();
  await phone.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
  await phone.mouse.down();
  await phone.mouse.move(pad.x + pad.width / 2 + 80, pad.y + pad.height / 2 + 40, { steps: 10 });
  await sleep(400);
  await deck.screenshot({ path: `${OUT}/e2e-laser.png` });
  await phone.mouse.up();
  check('Láser dibujado (captura e2e-laser.png)', true);

  // ---------- lápiz
  await phone.click('#ptr-modes [data-mode="pen"]');
  await phone.mouse.move(pad.x + 60, pad.y + 120);
  await phone.mouse.down();
  for (let i = 0; i <= 20; i++) await phone.mouse.move(pad.x + 60 + i * 10, pad.y + 120 + Math.sin(i / 3) * 40);
  await phone.mouse.up();
  await sleep(400);
  await deck.screenshot({ path: `${OUT}/e2e-pen.png` });
  check('Trazo de lápiz (captura e2e-pen.png)', true);

  // ---------- mouse remoto: clic preciso en el botón usando órdenes directas
  const box = await deck.evaluate(() => {
    const r = document.getElementById('btn').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, W: innerWidth, H: innerHeight };
  });
  const cmd = (c) => sw({ type: 'cmd', cmd: c });
  // Llevar el cursor a la esquina superior izquierda y luego al botón
  await cmd({ t: 'mouse', a: 'move', dx: -4, dy: -4 });
  await cmd({ t: 'mouse', a: 'move', dx: box.x / box.W, dy: box.y / box.W });
  await cmd({ t: 'mouse', a: 'click', n: 1 });
  ok = await waitFor(async () => (await deckEvents()).some((e) => e.startsWith('click btn')), { timeout: 3000 });
  check('Clic remoto sobre un botón', !!ok);
  await cmd({ t: 'mouse', a: 'right' });
  ok = await waitFor(async () => (await deckEvents()).includes('contextmenu btn'), { timeout: 3000 });
  check('Clic derecho remoto (contextmenu)', !!ok);

  // ---------- escribir en un campo
  const goTo = async (selector, frameSel) => {
    const p = await deck.evaluate((sel, fsel) => {
      let x = 0, y = 0;
      let doc = document;
      if (fsel) {
        const f = document.querySelector(fsel).getBoundingClientRect();
        x = f.left + 2; y = f.top + 2;
        if (!sel) return { x: x + 60, y: y + 40, W: innerWidth };
        doc = document.querySelector(fsel).contentDocument;
      }
      const r = doc.querySelector(sel).getBoundingClientRect();
      return { x: x + r.left + r.width / 2, y: y + r.top + r.height / 2, W: innerWidth };
    }, selector, frameSel);
    await cmd({ t: 'mouse', a: 'move', dx: -4, dy: -4 });
    await cmd({ t: 'mouse', a: 'move', dx: p.x / p.W, dy: p.y / p.W });
  };
  await goTo('#field');
  await cmd({ t: 'mouse', a: 'click', n: 1 });
  await sleep(150);
  await cmd({ t: 'text', s: 'Hola Mando' });
  ok = await waitFor(async () => (await deck.evaluate(() => document.getElementById('field').value)) === 'Hola Mando', { timeout: 3000 });
  check('Texto escrito en el campo enfocado', !!ok, await deck.evaluate(() => document.getElementById('field').value));
  await cmd({ t: 'del', n: 2 });
  ok = await waitFor(async () => (await deck.evaluate(() => document.getElementById('field').value)) === 'Hola Man', { timeout: 3000 });
  check('Borrado (Backspace) remoto', !!ok, await deck.evaluate(() => document.getElementById('field').value));

  // Teclado del celular (escritura en vivo)
  await phone.click('.tabs [data-tab="keys"]');
  await phone.focus('#kbd');
  await phone.keyboard.type('do!');
  ok = await waitFor(async () => (await deck.evaluate(() => document.getElementById('field').value)) === 'Hola Mando!', { timeout: 4000 });
  check('Teclado del celular escribe en vivo', !!ok, await deck.evaluate(() => document.getElementById('field').value));
  await phone.keyboard.press('Backspace');
  ok = await waitFor(async () => (await deck.evaluate(() => document.getElementById('field').value)) === 'Hola Mando', { timeout: 4000 });
  check('Borrar desde el teclado del celular', !!ok);
  // Borrar con el campo del celular vacío (centinela)
  await phone.evaluate(() => { const k = document.getElementById('kbd'); k.blur(); });
  await phone.focus('#kbd');
  await phone.keyboard.press('Backspace');
  ok = await waitFor(async () => (await deck.evaluate(() => document.getElementById('field').value)) === 'Hola Mand', { timeout: 4000 });
  check('Borrar con el campo del celular vacío', !!ok, await deck.evaluate(() => document.getElementById('field').value));

  // ---------- iframe del mismo origen
  await goTo('#f', '#same');
  await cmd({ t: 'mouse', a: 'click', n: 1 });
  await sleep(150);
  await cmd({ t: 'text', s: 'abc' });
  ok = await waitFor(async () => (await deck.evaluate(() => document.querySelector('#same').contentDocument.getElementById('f').value)) === 'abc', { timeout: 3000 });
  check('Escribir dentro de un iframe del mismo origen', !!ok);
  await cmd({ t: 'nav', a: 'next' });
  ok = await waitFor(async () => (await deckEvents()).some((e) => e.includes('[same] keydown key=ArrowRight keyCode=39')), { timeout: 3000 });
  check('Teclas llegan al iframe enfocado (mismo origen)', !!ok);

  // ---------- iframe de otro origen
  const crossBox = await deck.evaluate(() => {
    const f = document.querySelector('#cross').getBoundingClientRect();
    return { x: f.left, y: f.top, W: innerWidth };
  });
  // Botón dentro del iframe cruzado: aproximar por su posición conocida
  const innerBtn = await (await deck.$('#cross')).contentFrame().then((fr) => fr.evaluate(() => {
    const r = document.getElementById('b').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }));
  await cmd({ t: 'mouse', a: 'move', dx: -4, dy: -4 });
  await cmd({ t: 'mouse', a: 'move', dx: (crossBox.x + 2 + innerBtn.x) / crossBox.W, dy: (crossBox.y + 2 + innerBtn.y) / crossBox.W });
  await cmd({ t: 'mouse', a: 'click', n: 1 });
  ok = await waitFor(async () => (await deckEvents()).includes('[cross] click iframe button'), { timeout: 4000 });
  check('Clic dentro de un iframe de otro origen', !!ok);

  const innerField = await (await deck.$('#cross')).contentFrame().then((fr) => fr.evaluate(() => {
    const r = document.getElementById('f').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }));
  await cmd({ t: 'mouse', a: 'move', dx: -4, dy: -4 });
  await cmd({ t: 'mouse', a: 'move', dx: (crossBox.x + 2 + innerField.x) / crossBox.W, dy: (crossBox.y + 2 + innerField.y) / crossBox.W });
  await cmd({ t: 'mouse', a: 'click', n: 1 });
  await sleep(300);
  await cmd({ t: 'text', s: 'xyz' });
  ok = await waitFor(async () => (await deckEvents()).some((e) => e.includes('[cross] input value=xyz')), { timeout: 4000 });
  check('Escribir dentro de un iframe de otro origen', !!ok);
  await cmd({ t: 'key', k: 'ArrowRight' });
  ok = await waitFor(async () => (await deckEvents()).some((e) => e.includes('[cross] keydown key=ArrowRight keyCode=39')), { timeout: 4000 });
  check('Teclas llegan al iframe enfocado (otro origen)', !!ok);

  // ---------- desplazamiento
  const sc = await deck.evaluate(() => {
    const r = document.getElementById('scroller').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, W: innerWidth };
  });
  await cmd({ t: 'mouse', a: 'move', dx: -4, dy: -4 });
  await cmd({ t: 'mouse', a: 'move', dx: sc.x / sc.W, dy: sc.y / sc.W });
  await cmd({ t: 'scroll', dx: 0, dy: 200 });
  ok = await waitFor(async () => (await deck.evaluate(() => document.getElementById('scroller').scrollTop)) >= 190, { timeout: 3000 });
  check('Desplazamiento dentro del elemento bajo el cursor', !!ok);

  // ---------- popup
  const popup = await browser.newPage();
  await popup.setViewport({ width: 340, height: 600, deviceScaleFactor: 2 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await waitFor(() => popup.evaluate(() => !!document.querySelector('#qr svg')), { timeout: 5000 });
  const popupInfo = await popup.evaluate(() => ({
    status: document.getElementById('status-text').textContent,
    target: document.getElementById('target-title').textContent,
    devices: document.querySelectorAll('#devices li').length,
    useTab: !document.getElementById('use-tab').hidden,
  }));
  check('Popup: estado y QR', popupInfo.status.length > 0 && popupInfo.devices === 1, JSON.stringify(popupInfo));
  const height = await popup.evaluate(() => document.documentElement.scrollHeight);
  await popup.setViewport({ width: 340, height, deviceScaleFactor: 2 });
  await popup.screenshot({ path: `${OUT}/e2e-popup.png` });
  await popup.close();

  // ---------- detener sesión
  await deck.bringToFront();
  await sw({ type: 'session:stop' });
  ok = await waitFor(() => phone.evaluate(() => document.getElementById('app').dataset.conn === 'ended'), { timeout: 6000 });
  check('El celular recibe «sesión finalizada»', !!ok);
  const after = await ctl.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  check('Scripts de contenido desregistrados al detener', after.length === 0);
  const overlayGone = await waitFor(() => deck.evaluate(() => !document.querySelector('mando-overlay')), { timeout: 3000 });
  check('La capa visual se retira de la presentación', !!overlayGone);

  // ---------- reconexión automática al reiniciar
  await sw({ type: 'session:start', tabId: deckTabId });
  ok = await waitFor(() => phone.evaluate(() => document.getElementById('app').dataset.conn === 'connected'), { timeout: 30000 });
  check('El celular se reconecta solo al reiniciar la sesión', !!ok);

  // ---------- nuevo código revoca el anterior
  await sw({ type: 'session:reset' });
  ok = await waitFor(() => phone.evaluate(() => document.getElementById('app').dataset.conn === 'denied'), { timeout: 8000 });
  check('«Nuevo código» desconecta al celular', !!ok);

  await deck.screenshot({ path: `${OUT}/e2e-deck-final.png` });
} catch (err) {
  console.error(err);
  check('Sin excepciones', false, String(err && err.message));
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones superadas`);
  process.exit(failed.length ? 1 : 0);
}
