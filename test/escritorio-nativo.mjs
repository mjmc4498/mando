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
    $types = @([System.Windows.Automation.ControlType]::Document, [System.Windows.Automation.ControlType]::Edit)
    foreach ($t in $types) {
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $t)
      $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      if ($el) {
        $tp = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) { [Console]::Out.Write($tp.DocumentRange.GetText(-1)); exit 0 }
        $vp = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { [Console]::Out.Write($vp.Current.Value); exit 0 }
      }
    }`;
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
  let browser = null;
  if (chromeExe) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'perfil-'));
    browser = spawn(chromeExe, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--new-window',
      'data:text/html,<title>Diapositivas Uno</title>', 'data:text/html,<title>Diapositivas Dos</title>'], { detached: true, stdio: 'ignore' });
    await sleep(6000);
  }

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
    const tabs = await input.listTabs();
    const names = tabs.map((t) => t.title);
    check('Listar las pestañas del navegador', names.includes('Diapositivas Uno') && names.includes('Diapositivas Dos'), names.join(' | '));
    const uno = tabs.find((t) => t.title === 'Diapositivas Uno');
    if (uno) {
      const ok = await input.activateTab(uno);
      await sleep(600);
      const front = input.frontmost();
      check('Cambiar a la pestaña elegida', ok && (front?.title || '').startsWith('Diapositivas Uno'), JSON.stringify(front));
    }
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
  const wins = input.listWindows() || [];
  check('Listar las ventanas abiertas', wins.length > 0, wins.map((w) => `${w.app}: ${w.title}`).slice(0, 8).join(' | '));
}

console.log(`Sistema: ${process.platform} ${process.arch}`);
try {
  if (process.platform === 'win32') await windows();
  else if (process.platform === 'darwin') await mac();
  else console.log('Sistema sin módulo nativo.');
} catch (err) {
  check('Sin errores inesperados', false, err.stack || String(err));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
process.exit(failed.length ? 1 : 0);
