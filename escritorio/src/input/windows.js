// Presentazo para escritorio: teclado, mouse, ventanas y pestañas en Windows.
// Llama a user32.dll, kernel32.dll y dwmapi.dll mediante koffi (FFI). Windows no
// pide permisos especiales para enviar teclas y movimientos del mouse. Las
// pestañas de los navegadores se leen con UI Automation (PowerShell, incluido en Windows).

import { execFile } from 'node:child_process';

import koffi from 'koffi';

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const dwmapi = koffi.load('dwmapi.dll');

const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'int32', dy: 'int32', mouseData: 'int32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
});
const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
});
const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', { uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16' });
const INPUT = koffi.struct('INPUT', {
  type: 'uint32',
  u: koffi.union('INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT }),
});
const INPUT_SIZE = koffi.sizeof(INPUT);
koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const EnumWindowsProc = koffi.proto('int __stdcall EnumWindowsProc(void *hwnd, intptr_t param)');

const SendInput = user32.func('uint32_t __stdcall SendInput(uint32_t count, const INPUT *inputs, int size)');
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int index)');
const MapVirtualKeyW = user32.func('uint32_t __stdcall MapVirtualKeyW(uint32_t code, uint32_t type)');
const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow(void)');
const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(void *hwnd)');
const BringWindowToTop = user32.func('int __stdcall BringWindowToTop(void *hwnd)');
const ShowWindow = user32.func('int __stdcall ShowWindow(void *hwnd, int cmd)');
const IsWindow = user32.func('int __stdcall IsWindow(void *hwnd)');
const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(void *hwnd)');
const IsIconic = user32.func('int __stdcall IsIconic(void *hwnd)');
const GetWindow = user32.func('void * __stdcall GetWindow(void *hwnd, uint32_t cmd)');
const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hwnd, int index)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *hwnd, uint16_t *buf, int max)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(void *hwnd, uint16_t *buf, int max)');
const GetWindowRect = user32.func('int __stdcall GetWindowRect(void *hwnd, _Out_ RECT *rect)');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)');
const AttachThreadInput = user32.func('int __stdcall AttachThreadInput(uint32_t from, uint32_t to, int attach)');
const EnumWindows = user32.func('int __stdcall EnumWindows(EnumWindowsProc *proc, intptr_t param)');
const GetCurrentThreadId = kernel32.func('uint32_t __stdcall GetCurrentThreadId(void)');
const OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)');
const QueryFullProcessImageNameW = kernel32.func('int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, uint16_t *buf, _Inout_ uint32_t *size)');
const CloseHandle = kernel32.func('int __stdcall CloseHandle(void *handle)');
const DwmGetWindowAttribute = dwmapi.func('int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attr, _Out_ int32_t *value, uint32_t size)');

const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;

const M = { move: 0x1, leftDown: 0x2, leftUp: 0x4, rightDown: 0x8, rightUp: 0x10, wheel: 0x800, hwheel: 0x1000, virtualDesk: 0x4000, absolute: 0x8000 };
const K = { extended: 0x1, up: 0x2, unicode: 0x4 };

// Teclas virtuales (VK_*). Las marcadas con true son "extendidas".
const VKEYS = {
  ArrowLeft: [0x25, true], ArrowUp: [0x26, true], ArrowRight: [0x27, true], ArrowDown: [0x28, true],
  PageUp: [0x21, true], PageDown: [0x22, true], Home: [0x24, true], End: [0x23, true], Delete: [0x2e, true],
  Enter: [0x0d], Escape: [0x1b], Backspace: [0x08], Tab: [0x09], ' ': [0x20],
  F5: [0x74], F11: [0x7a],
  a: [0x41], b: [0x42], f: [0x46], l: [0x4c], p: [0x50], w: [0x57],
};
const MODS = { ctrl: 0x11, shift: 0x10, alt: 0x12, meta: 0x5b };
const VK_MENU = 0x12;

const SM = { x: 76, y: 77, w: 78, h: 79 };
const SKIP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow']);

export const BROWSER = /^(chrome|msedge|brave|firefox|opera|vivaldi|chromium)\.exe$/i;

function send(inputs) {
  if (!inputs.length) return 0;
  return SendInput(inputs.length, inputs, INPUT_SIZE);
}

function keyInput(vk, up, extended = false) {
  const scan = MapVirtualKeyW(vk, 0);
  return {
    type: INPUT_KEYBOARD,
    u: { ki: { wVk: vk, wScan: scan, dwFlags: (up ? K.up : 0) | (extended ? K.extended : 0), time: 0, dwExtraInfo: 0 } },
  };
}

function unicodeInput(unit, up) {
  return {
    type: INPUT_KEYBOARD,
    u: { ki: { wVk: 0, wScan: unit, dwFlags: K.unicode | (up ? K.up : 0), time: 0, dwExtraInfo: 0 } },
  };
}

function mouseInput(flags, dx = 0, dy = 0, data = 0) {
  return { type: INPUT_MOUSE, u: { mi: { dx, dy, mouseData: data, dwFlags: flags, time: 0, dwExtraInfo: 0 } } };
}

function wide(fn, hwnd, max = 512) {
  const buf = Buffer.alloc(max * 2);
  const n = fn(hwnd, buf, max);
  return buf.toString('utf16le', 0, Math.max(0, n) * 2);
}

function exePath(pid) {
  const proc = OpenProcess(0x1000, 0, pid); // PROCESS_QUERY_LIMITED_INFORMATION
  if (!proc) return '';
  try {
    const buf = Buffer.alloc(2048);
    const size = [1024];
    return QueryFullProcessImageNameW(proc, 0, buf, size) ? buf.toString('utf16le', 0, size[0] * 2) : '';
  } finally {
    CloseHandle(proc);
  }
}

const pidOf = (hwnd) => {
  const pid = [0];
  GetWindowThreadProcessId(hwnd, pid);
  return pid[0];
};

// Ejecuta un script de PowerShell (UI Automation) y devuelve su salida JSON.
function powershell(script, timeout = 8000) {
  const encoded = Buffer.from(`[Console]::OutputEncoding = [Text.Encoding]::UTF8\n${script}`, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) { resolve(null); return; }
        try { resolve(JSON.parse(stdout.trim() || 'null')); } catch { resolve(null); }
      });
  });
}

const b64 = (text) => Buffer.from(String(text), 'utf8').toString('base64');

const UIA_HEADER = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]
$P = [System.Windows.Automation.AutomationElement]::ControlTypeProperty
function Tabs($h) {
  $root = $A::FromHandle([IntPtr][Int64]$h)
  $strip = $root.FindFirst($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($P, $CT::Tab)))
  if (-not $strip) { return @() }
  return $strip.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($P, $CT::TabItem)))
}
function Text($s) { return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }
`;

// toPhysical / toDip convierten entre los píxeles lógicos de Electron y los
// píxeles reales de la pantalla, que son los que usa Windows.
export function createWindowsInput({ toPhysical, toDip = (r) => r }) {
  let wheelRest = { x: 0, y: 0 };

  function moveInput(x, y) {
    const p = toPhysical({ x, y });
    const vx = GetSystemMetrics(SM.x);
    const vy = GetSystemMetrics(SM.y);
    const vw = Math.max(2, GetSystemMetrics(SM.w));
    const vh = Math.max(2, GetSystemMetrics(SM.h));
    const nx = Math.round(((p.x - vx) * 65535) / (vw - 1));
    const ny = Math.round(((p.y - vy) * 65535) / (vh - 1));
    return mouseInput(M.move | M.absolute | M.virtualDesk, nx, ny);
  }

  function bounds(hwnd) {
    const r = {};
    if (!GetWindowRect(hwnd, r)) return null;
    return toDip({ x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top });
  }

  // Ventanas principales visibles, de adelante hacia atrás.
  function topWindows() {
    const out = [];
    EnumWindows((hwnd) => {
      try {
        if (!IsWindowVisible(hwnd) || GetWindow(hwnd, 4)) return 1; // GW_OWNER
        if (Number(GetWindowLongPtrW(hwnd, -20)) & 0x80) return 1; // WS_EX_TOOLWINDOW
        const cloaked = [0];
        if (DwmGetWindowAttribute(hwnd, 14, cloaked, 4) === 0 && cloaked[0]) return 1; // DWMWA_CLOAKED
        if (SKIP_CLASSES.has(wide(GetClassNameW, hwnd, 256))) return 1;
        const title = wide(GetWindowTextW, hwnd);
        if (!title) return 1;
        const pid = pidOf(hwnd);
        if (pid === process.pid) return 1;
        out.push({ hwnd, pid, title });
      } catch {}
      return 1;
    }, 0);
    return out;
  }

  // Trae una ventana al frente. Windows limita esto para evitar robos de foco;
  // se usan las mismas técnicas que las herramientas de accesibilidad.
  function forceForeground(hwnd) {
    if (!IsWindow(hwnd)) return false;
    if (IsIconic(hwnd)) ShowWindow(hwnd, 9); // SW_RESTORE
    if (GetForegroundWindow() === hwnd) return true;
    const me = GetCurrentThreadId();
    const fg = GetForegroundWindow();
    const fgThread = fg ? GetWindowThreadProcessId(fg, [0]) : 0;
    if (fgThread && fgThread !== me) AttachThreadInput(me, fgThread, 1);
    BringWindowToTop(hwnd);
    SetForegroundWindow(hwnd);
    if (fgThread && fgThread !== me) AttachThreadInput(me, fgThread, 0);
    if (GetForegroundWindow() !== hwnd) {
      // Dos toques de Alt: liberan el bloqueo sin dejar abierto ningún menú.
      send([keyInput(VK_MENU, false), keyInput(VK_MENU, true), keyInput(VK_MENU, false), keyInput(VK_MENU, true)]);
      SetForegroundWindow(hwnd);
    }
    return GetForegroundWindow() === hwnd;
  }

  return {
    platform: 'windows',

    trusted: () => true,

    moveTo(x, y) {
      send([moveInput(x, y)]);
    },

    button(button, down, x, y) {
      const flag = button === 'right' ? (down ? M.rightDown : M.rightUp) : (down ? M.leftDown : M.leftUp);
      send([moveInput(x, y), mouseInput(flag)]);
    },

    click(button, count, x, y) {
      const inputs = [moveInput(x, y)];
      const [down, up] = button === 'right' ? [M.rightDown, M.rightUp] : [M.leftDown, M.leftUp];
      for (let i = 0; i < (button === 'right' ? 1 : count); i++) inputs.push(mouseInput(down), mouseInput(up));
      send(inputs);
    },

    // dx/dy en píxeles, positivos hacia la derecha y hacia abajo. Una muesca de
    // la rueda (120) equivale a unos 100 píxeles en la mayoría de programas.
    scroll(dx, dy) {
      wheelRest.x += dx * 1.2;
      wheelRest.y += -dy * 1.2;
      const wx = Math.trunc(wheelRest.x);
      const wy = Math.trunc(wheelRest.y);
      wheelRest = { x: wheelRest.x - wx, y: wheelRest.y - wy };
      const inputs = [];
      if (wy) inputs.push(mouseInput(M.wheel, 0, 0, wy));
      if (wx) inputs.push(mouseInput(M.hwheel, 0, 0, wx));
      send(inputs);
    },

    key(name, mods = {}) {
      const def = VKEYS[name];
      if (!def) return false;
      const held = Object.keys(MODS).filter((m) => mods[m]).map((m) => MODS[m]);
      const inputs = [
        ...held.map((vk) => keyInput(vk, false, vk === MODS.meta)),
        keyInput(def[0], false, !!def[1]),
        keyInput(def[0], true, !!def[1]),
        ...held.reverse().map((vk) => keyInput(vk, true, vk === MODS.meta)),
      ];
      return send(inputs) === inputs.length;
    },

    text(str) {
      const inputs = [];
      for (const part of str.split(/(\r\n|\n|\r|\t)/)) {
        if (!part) continue;
        if (part === '\t') { inputs.push(keyInput(0x09, false), keyInput(0x09, true)); continue; }
        if (/^[\r\n]+$/.test(part)) { inputs.push(keyInput(0x0d, false), keyInput(0x0d, true)); continue; }
        for (let i = 0; i < part.length; i++) {
          const unit = part.charCodeAt(i);
          inputs.push(unicodeInput(unit, false), unicodeInput(unit, true));
        }
      }
      // Bloques moderados: Windows procesa la cola sin perder pulsaciones.
      for (let i = 0; i < inputs.length; i += 200) send(inputs.slice(i, i + 200));
    },

    // Programa y ventana al frente: { app (nombre del ejecutable), title, pid, bounds }.
    frontmost() {
      const hwnd = GetForegroundWindow();
      if (!hwnd) return null;
      const pid = pidOf(hwnd);
      return { app: exePath(pid).split('\\').pop(), title: wide(GetWindowTextW, hwnd), pid, bounds: bounds(hwnd), id: String(hwnd) };
    },

    // Ventanas abiertas, de adelante hacia atrás.
    listWindows() {
      const paths = new Map();
      return topWindows().map(({ hwnd, pid, title }) => {
        if (!paths.has(pid)) paths.set(pid, exePath(pid));
        const path = paths.get(pid);
        return { id: String(hwnd), pid, app: path.split('\\').pop(), path, title, bounds: bounds(hwnd), minimized: !!IsIconic(hwnd) };
      });
    },

    // Pestañas de los navegadores abiertos (asíncrono: UI Automation tarda un poco).
    async listTabs() {
      const browsers = this.listWindows().filter((w) => BROWSER.test(w.app));
      if (!browsers.length) return [];
      const data = await powershell(`${UIA_HEADER}
$out = @()
foreach ($h in '${browsers.map((w) => w.id).join(',')}'.Split(',')) {
  try {
    foreach ($it in (Tabs $h)) {
      $sel = $false
      $sp = $null
      if ($it.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sp)) { $sel = $sp.Current.IsSelected }
      $out += [pscustomobject]@{ hwnd = $h; title = $it.Current.Name; selected = $sel }
    }
  } catch {}
}
ConvertTo-Json -InputObject @($out) -Compress`);
      if (!Array.isArray(data)) return [];
      return data.filter((t) => t && t.title).map((t, i) => {
        const win = browsers.find((w) => w.id === String(t.hwnd));
        return { id: `${t.hwnd}:${i}`, pid: win.pid, app: win.app, path: win.path, window: win, title: String(t.title), selected: !!t.selected, bounds: win.bounds };
      });
    },

    // target: { id } tal como lo devolvió listWindows.
    activateWindow(target) {
      try { return forceForeground(BigInt(target.id)); } catch { return false; }
    },

    // target: { window: { id }, title } tal como lo devolvió listTabs.
    async activateTab(target) {
      const hwnd = BigInt(target.window.id);
      if (!forceForeground(hwnd)) return false;
      const ok = await powershell(`${UIA_HEADER}
$name = Text '${b64(target.title)}'
$done = $false
foreach ($it in (Tabs '${target.window.id}')) {
  if ($it.Current.Name -eq $name) {
    $sp = $null
    if ($it.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sp)) { $sp.Select(); $done = $true }
    break
  }
}
ConvertTo-Json $done`, 5000);
      return ok === true;
    },
  };
}
