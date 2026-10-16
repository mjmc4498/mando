// Prueba del teclado y el mouse nativos de Presentazo para escritorio, sin Electron.
// Se ejecuta en Windows y en Mac (lo usa GitHub Actions en máquinas reales).
//
//   node test/escritorio-nativo.mjs
//
// En Windows abre el Bloc de notas, escribe un texto con tildes y lo lee de vuelta.
// En Mac solo puede enviar eventos si el proceso tiene el permiso de Accesibilidad;
// si no lo tiene, comprueba que las funciones del sistema cargan bien.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'escritorio');
const koffi = createRequire(path.join(APP, 'package.json'))('koffi');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = (rel) => import(pathToFileURL(path.join(APP, rel)).href);

async function waitFor(fn, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(500);
  }
  return null;
}

// Dos páginas con títulos conocidos para probar las pestañas del navegador.
const pages = http.createServer((req, res) => {
  const name = req.url.includes('dos') ? 'Dos' : 'Uno';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>Diapositivas ${name}</title><h1>${name}</h1>`);
}).listen(0, '127.0.0.1');
await new Promise((r) => pages.once('listening', r));
const PAGE = (n) => `http://127.0.0.1:${pages.address().port}/${n}`;

function openBrowser(exe) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'perfil-'));
  return spawn(exe, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--new-window', PAGE('uno'), PAGE('dos')],
    { detached: true, stdio: 'ignore' });
}

async function checkTabs(input, isBrowser) {
  const win = await waitFor(() => (input.listWindows() || []).find((w) => isBrowser(w.app) && w.title.includes('Diapositivas')));
  check('El navegador aparece en la lista de ventanas', !!win, win ? `${win.app}: ${win.title}` : '');
  const tabs = await waitFor(async () => {
    const list = (await input.listTabs()) || [];
    const names = list.map((t) => t.title);
    return names.includes('Diapositivas Uno') && names.includes('Diapositivas Dos') ? list : null;
  }, 15000);
  check('Listar las pestañas del navegador', !!tabs, tabs ? tabs.map((t) => `${t.title}${t.selected ? ' (visible)' : ''}`).join(' | ') : JSON.stringify(await input.listTabs()));
  const uno = tabs?.find((t) => t.title === 'Diapositivas Uno');
  if (!uno) return;
  const ok = await input.activateTab(uno);
  const front = await waitFor(() => { const f = input.frontmost(); return (f?.title || '').startsWith('Diapositivas Uno') ? f : null; }, 5000);
  check('Cambiar a la pestaña elegida', ok && !!front, JSON.stringify(input.frontmost()));
}

async function windows() {
  const { createWindowsInput } = await load('src/input/windows.js');
  const input = createWindowsInput({ toPhysical: (p) => p });
  const user32 = koffi.load('user32.dll');
  koffi.struct('POINT', { x: 'int32', y: 'int32' });
  const GetCursorPos = user32.func('int __stdcall GetCursorPos(_Out_ POINT *p)');
  const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(void *hwnd)');
  const FindWindowW = user32.func('void * __stdcall FindWindowW(const char16_t *cls, const char16_t *title)');

  input.moveTo(321, 234);
  await sleep(200);
  const p = {};
  GetCursorPos(p);
  check('Mover el cursor (SendInput)', Math.abs(p.x - 321) <= 2 && Math.abs(p.y - 234) <= 2, `${p.x},${p.y}`);

  const notepad = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
  let front = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const hwnd = FindWindowW('Notepad', null);
    if (hwnd) SetForegroundWindow(hwnd);
    front = input.frontmost();
    if (/notepad/i.test(front?.app || '')) break;
  }
  check('Reconocer el programa al frente', /notepad/i.test(front?.app || ''), JSON.stringify(front));

  const text = 'Hola ñandú, Presentazo';
  input.text(text);
  check('Pulsar una tecla (Fin)', input.key('End') === true);
  await sleep(500);
  const ps = `
    Add-Type -AssemblyName UIAutomationClient
    $p = Get-Process notepad | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
    $best = ''
    $types = @([System.Windows.Automation.ControlType]::Document, [System.Windows.Automation.ControlType]::Edit)
    foreach ($t in $types) {
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $t)
      foreach ($el in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
        $text = ''
        $tp = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) { $text = $tp.DocumentRange.GetText(-1) }
        $vp = $null
        if (-not $text -and $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { $text = $vp.Current.Value }
        if ($text.Length -gt $best.Length) { $best = $text }
      }
    }
    [Console]::Out.Write($best)`;
  let typed = '';
  try {
    typed = execFileSync('powershell', ['-NoProfile', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${ps}`], { encoding: 'utf8' }).trim();
  } catch (err) {
    typed = `error: ${err.message}`;
  }
  check('Escribir texto con tildes y ñ en el Bloc de notas', typed.includes(text), JSON.stringify(typed));

  // ---------- ventanas y pestañas
  const chromeExe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
    .find((f) => fs.existsSync(f));
  const browser = chromeExe ? openBrowser(chromeExe) : null;

  const windowsList = input.listWindows();
  const pad = windowsList.find((w) => /notepad/i.test(w.app));
  check('Listar las ventanas abiertas', windowsList.length > 0 && !!pad, windowsList.map((w) => `${w.app}: ${w.title}`).join(' | '));
  if (pad) {
    const other = windowsList.find((w) => w !== pad && !w.minimized);
    if (other) input.activateWindow(other);
    await sleep(400);
    input.activateWindow(pad);
    await sleep(400);
    check('Traer una ventana al frente', /notepad/i.test(input.frontmost()?.app || ''), JSON.stringify(input.frontmost()));
  }

  if (chromeExe) {
    await checkTabs(input, (app) => /^(chrome|msedge)\.exe$/i.test(app));
  } else {
    console.log('INFO  No hay Chrome ni Edge: no se prueban las pestañas.');
  }

  try { process.kill(notepad.pid); } catch {}
  try { execFileSync('taskkill', ['/IM', 'notepad.exe', '/F'], { stdio: 'ignore' }); } catch {}
  if (browser) try { execFileSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
}

async function mac() {
  const { createMacInput } = await load('src/input/mac.js');
  const input = createMacInput();
  check('Cargar Core Graphics y Accesibilidad', typeof input.trusted() === 'boolean');
  const CG = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  const CF = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  koffi.struct('CGPointT', { x: 'double', y: 'double' });
  const CGEventCreate = CG.func('void *CGEventCreate(void *source)');
  const CGEventGetLocation = CG.func('CGPointT CGEventGetLocation(void *event)');
  const CFRelease = CF.func('void CFRelease(void *ref)');
  const where = () => { const e = CGEventCreate(null); const p = CGEventGetLocation(e); CFRelease(e); return p; };

  if (!input.trusted()) {
    console.log('INFO  Este proceso no tiene el permiso de Accesibilidad: no se envían eventos.');
    return;
  }
  input.moveTo(321, 234, false);
  await sleep(200);
  const p = where();
  check('Mover el cursor (Core Graphics)', Math.abs(p.x - 321) <= 2 && Math.abs(p.y - 234) <= 2, `${p.x},${p.y}`);
  check('Pulsar una tecla', input.key('Escape') === true);
  const front = input.frontmost();
  check('Reconocer el programa al frente', !!front?.app, JSON.stringify(front));
  spawn('open', [os.homedir()]); // una ventana del Finder
  const finder = await waitFor(() => (input.listWindows() || []).find((w) => w.app === 'Finder'));
  check('Listar las ventanas abiertas', !!finder, (input.listWindows() || []).map((w) => `${w.app}: ${w.title}`).slice(0, 8).join(' | '));

  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(chrome)) {
    const browser = openBrowser(chrome);
    await checkTabs(input, (app) => app === 'Google Chrome');
    if (finder) {
      input.activateWindow(finder);
      const back = await waitFor(() => (input.frontmost()?.app === 'Finder' ? true : null), 5000);
      check('Traer una ventana al frente', !!back, JSON.stringify(input.frontmost()));
    }
    try { process.kill(browser.pid); } catch {}
  } else {
    console.log('INFO  No hay Chrome: no se prueban las pestañas.');
  }
}

console.log(`Sistema: ${process.platform} ${process.arch}`);
try {
  if (process.platform === 'win32') await windows();
  else if (process.platform === 'darwin') await mac();
  else console.log('Sistema sin módulo nativo.');
} catch (err) {
  check('Sin errores inesperados', false, err.stack || String(err));
}

pages.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
process.exit(failed.length ? 1 : 0);
