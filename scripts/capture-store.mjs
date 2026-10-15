// Capturas reales de la extensión para las imágenes de la Chrome Web Store.
// Requiere `npm run serve` en otra terminal. Después: npm run store:images
import puppeteer from 'puppeteer';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'design', 'store', 'captures');
const BASE = process.env.BASE || 'http://localhost:8765';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1440;
const H = 810;

const browser = await puppeteer.launch({ headless: true, pipe: true, enableExtensions: [EXT], defaultViewport: null, args: [`--window-size=${W},${H + 100}`] });
try {
  const swT = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'));
  const extId = new URL(swT.url()).host;
  await sleep(500);

  const deck = await browser.newPage();
  await deck.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
  await deck.goto(`${BASE}/design/store/deck.html`, { waitUntil: 'networkidle0' });

  const ctl = await browser.newPage();
  await ctl.goto(`chrome-extension://${extId}/options.html`);
  const tabId = await ctl.evaluate(async (b) => (await chrome.tabs.query({ url: `${b}/design/*` }))[0]?.id, BASE);
  await deck.bringToFront();
  await ctl.evaluate((id) => chrome.runtime.sendMessage({ to: 'sw', type: 'session:start', tabId: id }), tabId);
  await ctl.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      const { state } = await chrome.storage.session.get('state');
      if (state?.status === 'ready') return;
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  const { identity } = await ctl.evaluate(() => chrome.storage.local.get('identity'));

  // Celular (iPhone)
  const phoneCtx = await browser.createBrowserContext();
  const phone = await phoneCtx.newPage();
  await phone.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
  await phone.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await phone.goto(`${BASE}/remote/#id=${identity.peerId}&k=${identity.token}`);
  await phone.waitForFunction(() => document.getElementById('app').dataset.conn === 'connected', { timeout: 30000 });

  const cmd = (c) => ctl.evaluate((c) => chrome.runtime.sendMessage({ to: 'sw', type: 'cmd', cmd: c }), c);
  const goTo = async (x, y) => {
    await cmd({ t: 'mouse', a: 'move', dx: -4, dy: -4 });
    await cmd({ t: 'mouse', a: 'move', dx: x / W, dy: y / W });
  };

  const geo = await deck.evaluate(() => {
    const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    return { stat: r('.stat'), h1: r('h1'), bar: r('.bar.hl'), bar3: r('.bar:nth-child(3)') };
  });

  // Aviso de conexión
  await deck.bringToFront();
  await sleep(300);
  await deck.screenshot({ path: `${OUT}/deck-toast.png` });
  await sleep(2800);
  await deck.screenshot({ path: `${OUT}/deck-clean.png` });

  // Láser con estela sobre la barra T4
  await cmd({ t: 'mode', mode: 'laser' });
  await goTo(geo.bar3.x + geo.bar3.w / 2 - 60, geo.bar3.y + 90);
  await cmd({ t: 'mode', mode: 'laser' });
  await cmd({ t: 'ptr', a: 'down' });
  for (let i = 0; i < 14; i++) {
    await cmd({ t: 'ptr', a: 'move', dx: 9 / W, dy: -6 / W });
    await sleep(14);
  }
  await deck.screenshot({ path: `${OUT}/deck-laser.png` });
  await cmd({ t: 'ptr', a: 'up' });
  await sleep(400);

  // Foco
  await cmd({ t: 'mode', mode: 'spot' });
  await goTo(geo.bar.x + geo.bar.w / 2, geo.bar.y + 40);
  await cmd({ t: 'mode', mode: 'spot' });
  await cmd({ t: 'ptr', a: 'down' });
  await sleep(500);
  await deck.screenshot({ path: `${OUT}/deck-spot.png` });
  await cmd({ t: 'ptr', a: 'up' });
  await sleep(400);

  // Lápiz: círculo alrededor de "+38%" y subrayado del título
  await cmd({ t: 'mode', mode: 'pen' });
  await cmd({ t: 'ink', a: 'color', color: '#FF3B30' });
  const cx = geo.stat.x + geo.stat.w / 2;
  const cy = geo.stat.y + geo.stat.h / 2;
  const rx = geo.stat.w / 2 + 26;
  const ry = geo.stat.h / 2 + 14;
  await goTo(cx + rx, cy);
  await cmd({ t: 'mode', mode: 'pen' });
  await sleep(250);
  await cmd({ t: 'ptr', a: 'down', ink: true });
  let px = cx + rx;
  let py = cy;
  for (let i = 1; i <= 46; i++) {
    const a = (i / 40) * Math.PI * 2;
    const nx = cx + rx * Math.cos(a) * (1 + i * 0.002);
    const ny = cy - ry * Math.sin(a);
    await cmd({ t: 'ptr', a: 'move', dx: (nx - px) / W, dy: (ny - py) / W });
    px = nx;
    py = ny;
    await sleep(18);
  }
  await sleep(150);
  await cmd({ t: 'ptr', a: 'up' });
  await cmd({ t: 'ink', a: 'color', color: '#0A84FF' });
  const ux = geo.h1.x;
  const uy = geo.h1.y + geo.h1.h + 4;
  await goTo(ux, uy);
  await cmd({ t: 'mode', mode: 'pen' });
  await sleep(250);
  await cmd({ t: 'ptr', a: 'down', ink: true });
  px = ux;
  py = uy;
  for (let i = 1; i <= 30; i++) {
    const nx = ux + i * 13;
    const ny = uy + Math.sin(i / 2.2) * 2.5;
    await cmd({ t: 'ptr', a: 'move', dx: (nx - px) / W, dy: (ny - py) / W });
    px = nx;
    py = ny;
    await sleep(16);
  }
  await sleep(150);
  await cmd({ t: 'ptr', a: 'up' });
  await sleep(300);
  await deck.screenshot({ path: `${OUT}/deck-pen.png` });
  await cmd({ t: 'ink', a: 'clear' });

  // Cursor del mouse remoto con clic
  await goTo(geo.bar3.x + geo.bar3.w * 0.55, geo.bar3.y + geo.bar3.h * 0.45);
  await sleep(350);
  await cmd({ t: 'mouse', a: 'click', n: 1 });
  await sleep(90);
  await deck.screenshot({ path: `${OUT}/deck-cursor.png` });

  // Popup real
  const popup = await browser.newPage();
  await popup.setViewport({ width: 340, height: 700, deviceScaleFactor: 2 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForFunction(() => document.querySelectorAll('#devices li').length === 1, { timeout: 8000 });
  await popup.evaluate(() => { document.getElementById('use-tab').hidden = true; });
  const ph = await popup.evaluate(() => document.documentElement.scrollHeight);
  await popup.setViewport({ width: 340, height: ph, deviceScaleFactor: 2 });
  await sleep(200);
  await popup.screenshot({ path: `${OUT}/popup.png` });
  await popup.close();

  // Ajustes reales
  const opts = await browser.newPage();
  await opts.setViewport({ width: 1100, height: 1400, deviceScaleFactor: 2 });
  await opts.goto(`chrome-extension://${extId}/options.html`);
  await sleep(500);
  await opts.screenshot({ path: `${OUT}/options.png` });
  await opts.close();

  console.log('capturas listas');
} catch (e) {
  console.error('ERROR', e);
} finally {
  await browser.close();
}
