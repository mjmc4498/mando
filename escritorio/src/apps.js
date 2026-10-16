// Presentazo para escritorio: reconoce el programa que está al frente y elige
// el atajo para iniciar la presentación en ese programa.

const BROWSER = /^(google chrome|chrome|chromium|microsoft edge|msedge|firefox|safari|brave( browser)?|opera|vivaldi|arc)(\.exe)?$/i;
const SLIDES_TITLE = /presentaciones de google|google slides/i;

const MAC = [
  { match: /^keynote$/i, name: 'Keynote', start: ['p', { meta: true, alt: true }] },
  { match: /powerpoint/i, name: 'PowerPoint', start: ['Enter', { meta: true, shift: true }] },
  { match: /libreoffice|openoffice/i, name: 'LibreOffice Impress', start: ['F5'] },
  { match: /acrobat|adobe reader/i, name: 'Adobe Acrobat', start: ['l', { meta: true }] },
  { match: /^(vista previa|preview)$/i, name: 'Vista Previa', start: ['f', { meta: true, shift: true }] },
];

const WINDOWS = [
  { match: /^powerpnt\.exe$/i, name: 'PowerPoint', start: ['F5'] },
  { match: /^(soffice\.bin|soffice\.exe|simpress\.exe)$/i, name: 'LibreOffice Impress', start: ['F5'] },
  { match: /^(acrobat\.exe|acrord32\.exe)$/i, name: 'Adobe Acrobat', start: ['l', { ctrl: true }] },
  { match: /^wpp\.exe$/i, name: 'WPS Presentation', start: ['F5'] },
];

// Nombres conocidos de programas de Windows (por su ejecutable).
const EXE_NAMES = {
  'chrome.exe': 'Google Chrome', 'msedge.exe': 'Microsoft Edge', 'firefox.exe': 'Firefox', 'brave.exe': 'Brave',
  'opera.exe': 'Opera', 'vivaldi.exe': 'Vivaldi', 'powerpnt.exe': 'PowerPoint', 'winword.exe': 'Word',
  'excel.exe': 'Excel', 'acrobat.exe': 'Adobe Acrobat', 'acrord32.exe': 'Adobe Acrobat Reader',
  'soffice.bin': 'LibreOffice', 'explorer.exe': 'Explorador de archivos', 'notepad.exe': 'Bloc de notas',
  'wpp.exe': 'WPS Presentation', 'canva.exe': 'Canva', 'zoom.exe': 'Zoom', 'ms-teams.exe': 'Microsoft Teams',
};

function prettyExe(exe) {
  const known = EXE_NAMES[exe.toLowerCase()];
  if (known) return known;
  const base = exe.replace(/\.(exe|bin)$/i, '');
  return base ? base[0].toUpperCase() + base.slice(1) : '';
}

// Nombre para mostrar de un programa ({ app } tal como lo entrega el sistema).
export function appName(app, platform) {
  const isMac = platform === 'mac' || platform === 'prueba';
  return isMac ? app || '' : prettyExe(app || '');
}

// front: { app, title } tal como lo entrega el módulo del sistema.
export function describeApp(front, platform) {
  if (!front) return null;
  const app = front.app || '';
  const title = (front.title || '').trim();
  const isMac = platform === 'mac' || platform === 'prueba';
  const known = (isMac ? MAC : WINDOWS).find((a) => a.match.test(app));
  const name = known?.name || appName(app, platform);

  let start = known?.start || null;
  if (!known && BROWSER.test(app)) {
    // En el navegador solo se inicia Presentaciones de Google: en otras páginas
    // el atajo podría hacer otra cosa (por ejemplo, enviar un correo).
    start = SLIDES_TITLE.test(title) ? (isMac ? ['Enter', { meta: true }] : ['F5', { ctrl: true }]) : null;
  } else if (!known && !isMac) {
    // En Windows, F5 inicia la presentación en casi todos los programas del rubro.
    start = ['F5'];
  }

  let label = title || name;
  if (title && name && !title.toLowerCase().includes(name.toLowerCase())) label = `${name} · ${title}`;
  return { name, title, label: label.slice(0, 120), start };
}
