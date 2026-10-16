// Presentazo para escritorio: firma "ad hoc" de la app de Mac antes de crear el .dmg y el .zip.
// Sin una firma válida, macOS (sobre todo en los Mac con chip M) muestra la app como
// dañada. La firma ad hoc no identifica al autor: la primera vez hay que abrirla con
// clic derecho > Abrir o desde Privacidad y seguridad (lo explica instaladores/LEEME.md).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function firmar(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // Los atributos extendidos (p. ej. de archivos descargados) impiden firmar.
  execFileSync('xattr', ['-cr', app]);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
