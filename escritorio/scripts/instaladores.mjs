// Presentazo para escritorio: genera los instaladores de Windows, Mac Intel y Mac con chip M
// y los ordena en la carpeta instaladores/ de la raíz del proyecto.
//
//   cd escritorio && npm run instaladores            # todos
//   npm run instaladores -- mac-intel windows        # solo algunos
//
// Se puede ejecutar desde una Mac: la parte nativa (koffi) de cada sistema se
// descarga ya compilada y se copia dentro de cada app.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import builder from 'electron-builder';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(APP, '..');
const OUT = path.join(ROOT, 'instaladores');
// Las apps se arman fuera del proyecto: si la carpeta está sincronizada (por
// ejemplo, el Escritorio con iCloud), macOS les agrega atributos que impiden firmarlas.
const BUILD = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Caches', 'presentazo-escritorio')
  : path.join(APP, 'salida');
const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
const KOFFI = JSON.parse(fs.readFileSync(path.join(APP, 'node_modules', 'koffi', 'package.json'), 'utf8')).version;
const V = pkg.version;

const SYSTEMS = {
  'mac-intel': {
    koffi: 'darwin_x64',
    host: ['darwin', 'x64'],
    exe: 'mac/Presentazo.app/Contents/MacOS/Presentazo',
    resources: 'mac/Presentazo.app/Contents/Resources',
    targets: () => builder.Platform.MAC.createTarget(['dmg', 'zip'], builder.Arch.x64),
    files: [
      [`Presentazo-${V}-mac-x64.dmg`, 'instalador', `Presentazo-${V}-Mac-Intel.dmg`],
      [`Presentazo-${V}-mac-x64.zip`, 'portable', `Presentazo-${V}-Mac-Intel.zip`],
    ],
  },
  'mac-chip-m': {
    koffi: 'darwin_arm64',
    host: ['darwin', 'arm64'],
    exe: 'mac-arm64/Presentazo.app/Contents/MacOS/Presentazo',
    resources: 'mac-arm64/Presentazo.app/Contents/Resources',
    targets: () => builder.Platform.MAC.createTarget(['dmg', 'zip'], builder.Arch.arm64),
    files: [
      [`Presentazo-${V}-mac-arm64.dmg`, 'instalador', `Presentazo-${V}-Mac-Chip-M.dmg`],
      [`Presentazo-${V}-mac-arm64.zip`, 'portable', `Presentazo-${V}-Mac-Chip-M.zip`],
    ],
  },
  windows: {
    koffi: 'win32_x64',
    host: ['win32', 'x64'],
    exe: 'win-unpacked/Presentazo.exe',
    resources: 'win-unpacked/resources',
    targets: () => builder.Platform.WINDOWS.createTarget(['nsis', 'portable'], builder.Arch.x64),
    files: [
      [`Presentazo-${V}-windows-instalador.exe`, 'instalador', `Presentazo-${V}-Windows-Instalador.exe`],
      [`Presentazo-${V}-windows-portable.exe`, 'portable', `Presentazo-${V}-Windows-Portable.exe`],
    ],
  },
};

// Descarga el módulo nativo de koffi para un sistema (paquete @koromix/koffi-*).
function ensureKoffi(triplet) {
  const dest = path.join(APP, 'vendor', 'koffi', triplet, 'koffi.node');
  if (fs.existsSync(dest)) return;
  const name = `@koromix/koffi-${triplet.replace('_', '-')}@${KOFFI}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koffi-'));
  console.log(`▸ Descargando ${name}`);
  const tgz = execFileSync('npm', ['pack', name, '--silent'], { cwd: tmp, encoding: 'utf8', shell: process.platform === 'win32' }).trim().split('\n').pop();
  execFileSync('tar', ['-xzf', tgz], { cwd: tmp });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(tmp, 'package', triplet, 'koffi.node'), dest);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// Cada app debe llevar solo la parte nativa de su sistema y arquitectura.
function verifyNative(id, sys) {
  const dir = path.join(BUILD, sys.resources, 'koffi');
  const found = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  if (found.length !== 1 || found[0] !== sys.koffi) {
    throw new Error(`${id}: se esperaba koffi/${sys.koffi} y se encontró ${found.join(', ') || 'nada'}`);
  }
  const bin = fs.readFileSync(path.join(dir, sys.koffi, 'koffi.node'));
  const isPe = bin[0] === 0x4d && bin[1] === 0x5a; // "MZ"
  const machO = bin.readUInt32LE(0) === 0xfeedfacf ? bin.readUInt32LE(4) : 0; // tipo de CPU
  const ok = sys.koffi === 'win32_x64' ? isPe
    : sys.koffi === 'darwin_x64' ? machO === 0x01000007
    : machO === 0x0100000c;
  if (!ok) throw new Error(`${id}: koffi.node no corresponde a ${sys.koffi}`);
  console.log(`  ✓ parte nativa verificada: ${sys.koffi}`);

  // Si la app es de este mismo sistema, se abre de verdad para comprobar que
  // carga el control del teclado y el mouse.
  if (process.platform === sys.host[0] && process.arch === sys.host[1]) {
    const out = execFileSync(path.join(BUILD, sys.exe), ['--comprobar'], { encoding: 'utf8', timeout: 60000 });
    const line = out.split('\n').find((l) => l.includes('"comprobacion"'));
    const res = line ? JSON.parse(line) : null;
    const expected = sys.host[0] === 'win32' ? 'windows' : 'mac';
    if (res?.platform !== expected) throw new Error(`${id}: la app no cargó el control nativo (${line || out})`);
    console.log(`  ✓ la app abre y carga el control del teclado y el mouse`);
  }
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const wanted = process.argv.slice(2).filter((a) => SYSTEMS[a]);
const systems = wanted.length ? wanted : Object.keys(SYSTEMS);

for (const id of systems) {
  const sys = SYSTEMS[id];
  ensureKoffi(sys.koffi);
  console.log(`\n▸ Creando instaladores: ${id}`);
  await builder.build({ projectDir: APP, targets: sys.targets(), publish: 'never', config: { directories: { output: BUILD } } });
  verifyNative(id, sys);
  for (const [built, type, name] of sys.files) {
    const dir = path.join(OUT, id, type);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(BUILD, built), path.join(dir, name));
    console.log(`  ✓ instaladores/${id}/${type}/${name}`);
  }
}

// Sumas de verificación de todo lo que hay en instaladores/.
const lines = [];
for (const id of Object.keys(SYSTEMS)) {
  for (const type of ['instalador', 'portable']) {
    const dir = path.join(OUT, id, type);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) lines.push(`${sha256(path.join(dir, f))}  ${id}/${type}/${f}`);
  }
}
fs.writeFileSync(path.join(OUT, 'SHA256.txt'), `${lines.join('\n')}\n`);
console.log('\n▸ Listo. Sumas SHA-256 en instaladores/SHA256.txt');
