// Presentazo para escritorio: panel principal (código QR, estado y ajustes).

import qrcode from './lib/qrcode.mjs';
import { PRIVACY_URL, SITE_URL, SOCIAL } from './config.js';
import { SOCIAL_ICONS } from './social-icons.js';

const api = window.presentazo;
const $ = (id) => document.getElementById(id);

let snap = null;
let renderedUrl = '';

if (/Mac/.test(navigator.platform)) document.body.classList.add('mac');

// ---------------------------------------------------------------- QR

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const isEye = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  let dots = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!isEye(r, c) && qr.isDark(r, c)) dots += `<rect x="${c + 0.05}" y="${r + 0.05}" width=".9" height=".9" rx=".3"/>`;
    }
  }
  const eye = (x, y) =>
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.8" fill="none" stroke="currentColor" stroke-width="1"/>` +
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".9"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="geometricPrecision">` +
    `<g fill="currentColor">${dots}${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}</g></svg>`;
}

// ---------------------------------------------------------------- estado

function statusView(s) {
  const n = s.devices.length;
  if (n === 1) return ['ok', '1 celular conectado'];
  if (n > 1) return ['ok', `${n} celulares conectados`];
  if (s.status === 'ready') return ['ok', 'Listo para conectar'];
  if (s.status === 'error') return ['error', 'Sin conexión a internet'];
  return ['warn', 'Conectando…'];
}

function since(ts) {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return 'ahora';
  return new Intl.RelativeTimeFormat('es', { numeric: 'auto' }).format(-minutes, 'minute');
}

function render() {
  if (!snap) return;
  const [tone, text] = statusView(snap);
  $('status').dataset.tone = tone;
  $('status-text').textContent = text;

  if (snap.url !== renderedUrl) {
    $('qr').innerHTML = qrSvg(snap.url);
    renderedUrl = snap.url;
  }
  $('qr-card').classList.toggle('loading', snap.status !== 'ready');

  $('perm').hidden = snap.platform !== 'mac' || snap.trusted;
  $('input-error').hidden = snap.platform !== 'ninguno';

  renderControl();
  document.querySelector('.tips').hidden = snap.devices.length > 0;

  $('devices-card').hidden = !snap.devices.length;
  const list = $('devices');
  list.replaceChildren(...snap.devices.map((d) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = d.name;
    const when = document.createElement('span');
    when.className = 'since muted';
    when.textContent = since(d.since);
    const kick = document.createElement('button');
    kick.className = 'btn small ghost danger';
    kick.textContent = 'Desconectar';
    kick.addEventListener('click', () => api.kick(d.id));
    li.append(dot, name, when, kick);
    return li;
  }));

  renderSettings();
}

// ---------------------------------------------------------------- ajustes

function pressed(group, value) {
  for (const b of $(group).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === value));
}

function renderSettings() {
  const s = snap.settings;
  pressed('laserColor', s.laserColor);
  pressed('laserSize', s.laserSize);
  pressed('spotSize', s.spotSize);
  pressed('nextKey', s.nextKey);
  for (const input of document.querySelectorAll('[data-setting]')) input.checked = !!s[input.dataset.setting];

  $('openAtLogin').disabled = !snap.packaged;
  $('login-note').hidden = snap.packaged && !snap.loginError;
  $('login-note').textContent = !snap.packaged
    ? 'Disponible en la app instalada.'
    : snap.platform === 'mac'
      ? 'macOS no lo permitió. Agrégala en Ajustes del Sistema › General › Ítems de inicio.'
      : 'Windows no lo permitió. Prueba de nuevo o agrégala en Configuración › Aplicaciones › Inicio.';
  const system = snap.platform === 'mac' ? 'para Mac' : snap.platform === 'windows' ? 'para Windows' : '';
  $('version').textContent = `${snap.version} ${system}`.trim();
}

async function save(patch) {
  snap = await api.setSettings(patch);
  render();
}

for (const group of ['laserColor', 'laserSize', 'spotSize', 'nextKey']) {
  for (const b of $(group).querySelectorAll('button')) {
    if (group === 'laserColor') b.style.setProperty('--sw', b.dataset.value);
    b.addEventListener('click', () => save({ [group]: b.dataset.value }));
  }
}
for (const input of document.querySelectorAll('[data-setting]')) {
  input.addEventListener('change', () => save({ [input.dataset.setting]: input.checked }));
}

// ---------------------------------------------------------------- qué se controla

const ICONS = {
  auto: '<svg viewBox="0 0 24 24"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/></svg>',
  screen: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/></svg>',
  window: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/><circle cx="6.5" cy="6.5" r=".6"/><circle cx="9" cy="6.5" r=".6"/></svg>',
  tab: '<svg viewBox="0 0 24 24"><path d="M3 8.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-7l-1.5-3H5a2 2 0 0 0-2 2z"/></svg>',
};

function renderControl() {
  const sel = snap.selection;
  $('control-icon').innerHTML = ICONS[sel.kind] || ICONS.auto;
  $('control-title').textContent = sel.title;
  // En automático, con un celular conectado, se indica qué está al frente ahora.
  $('control-sub').textContent = sel.kind === 'auto' && snap.devices.length && snap.target ? `Ahora: ${snap.target}` : sel.sub;
}

const HELP = {
  screens: 'El puntero aparece en la pantalla elegida y las teclas van a lo que se muestra ahí.',
  windows: 'Al pasar diapositivas, Presentazo trae este programa al frente si hace falta.',
  tabs: 'Presentazo cambia a esta pestaña del navegador antes de cada orden.',
};
const EMPTY = {
  windows: 'No encontré ventanas abiertas. Abre tu presentación y pulsa "Actualizar lista".',
  tabs: 'No encontré pestañas. Abre tu presentación en Chrome, Edge, Brave, Firefox o Safari y pulsa "Actualizar lista".',
};
const KIND_OF = { screens: 'screen', windows: 'window', tabs: 'tab' };

let pickKind = 'windows';
let pickItems = [];
let loading = 0;

// kind: 'auto' o el tipo de lista ('screens', 'windows', 'tabs').
function isSelected(kind, id) {
  const sel = snap.selection;
  if (kind === 'auto') return sel.kind === 'auto';
  return sel.kind === KIND_OF[kind] && sel.id === id;
}

function optionButton({ id, title, sub, icon, number }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'option';
  b.setAttribute('aria-pressed', String(isSelected(pickKind, id)));
  const ic = document.createElement('span');
  ic.className = 'option-icon';
  if (icon) {
    const img = document.createElement('img');
    img.src = icon;
    img.alt = '';
    ic.append(img);
  } else if (number) {
    ic.innerHTML = `<span class="num">${number}</span>`;
  } else {
    ic.innerHTML = ICONS[KIND_OF[pickKind]];
  }
  const text = document.createElement('span');
  text.className = 'option-text';
  const t = document.createElement('span');
  t.className = 'option-title';
  t.textContent = title;
  const st = document.createElement('span');
  st.className = 'option-sub muted';
  st.textContent = sub;
  text.append(t, st);
  b.append(ic, text);
  if (pickKind === 'screens') {
    const idf = document.createElement('span');
    idf.className = 'identify';
    idf.textContent = 'Identificar';
    idf.addEventListener('click', (e) => { e.stopPropagation(); api.identify(id); });
    b.append(idf);
  }
  const check = document.createElement('span');
  check.className = 'check';
  b.append(check);
  b.addEventListener('click', () => choose(KIND_OF[pickKind], id));
  return b;
}

// Dibuja las pantallas en su posición real, como en los ajustes del sistema.
function renderMap(items) {
  const map = $('pick-map');
  map.hidden = items.length < 2;
  if (map.hidden) return;
  const minX = Math.min(...items.map((d) => d.bounds.x));
  const minY = Math.min(...items.map((d) => d.bounds.y));
  const maxX = Math.max(...items.map((d) => d.bounds.x + d.bounds.width));
  const maxY = Math.max(...items.map((d) => d.bounds.y + d.bounds.height));
  const W = map.clientWidth - 24;
  const H = map.clientHeight - 24;
  const k = Math.min(W / (maxX - minX), H / (maxY - minY));
  const ox = 12 + (W - (maxX - minX) * k) / 2;
  const oy = 12 + (H - (maxY - minY) * k) / 2;
  map.replaceChildren(...items.map((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = d.number;
    b.title = d.name;
    b.style.left = `${ox + (d.bounds.x - minX) * k + 2}px`;
    b.style.top = `${oy + (d.bounds.y - minY) * k + 2}px`;
    b.style.width = `${d.bounds.width * k - 4}px`;
    b.style.height = `${d.bounds.height * k - 4}px`;
    b.setAttribute('aria-pressed', String(isSelected('screens', d.id)));
    b.addEventListener('click', () => choose('screen', d.id));
    return b;
  }));
}

function renderPick() {
  for (const b of $('pick-tabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.kind === pickKind));
  $('pick-help').textContent = HELP[pickKind];
  $('pick-auto').setAttribute('aria-pressed', String(isSelected('auto')));
  if (pickKind === 'screens') renderMap(pickItems);
  else $('pick-map').hidden = true;
  $('pick-list').replaceChildren(...pickItems.map((item) => optionButton(pickKind === 'screens'
    ? { id: item.id, title: item.name, sub: `${item.primary ? 'Principal' : `Pantalla ${item.number}`} · ${item.size}`, number: item.number }
    : item)));
}

async function loadPick(kind = pickKind) {
  pickKind = kind;
  const ticket = ++loading;
  pickItems = [];
  $('pick-empty').hidden = false;
  $('pick-empty').textContent = 'Buscando…';
  $('pick-perm').hidden = true;
  renderPick();
  const res = await api.sources(kind);
  if (ticket !== loading) return;
  pickItems = res?.items || [];
  $('pick-perm').hidden = !res?.needsPermission;
  $('pick-empty').hidden = !!pickItems.length || !!res?.needsPermission;
  $('pick-empty').textContent = EMPTY[kind] || '';
  renderPick();
}

async function choose(kind, id) {
  snap = await api.setTarget({ kind, id });
  render();
  renderPick();
}

for (const b of $('pick-tabs').querySelectorAll('button')) b.addEventListener('click', () => loadPick(b.dataset.kind));
$('pick-auto').addEventListener('click', () => choose('auto'));
document.querySelector('#pick-auto .option-icon').innerHTML = ICONS.auto;
$('pick-refresh').addEventListener('click', () => loadPick());
$('pick-perm-btn').addEventListener('click', () => api.askPermission());
$('control-open').addEventListener('click', () => showView('elegir'));

// ---------------------------------------------------------------- vistas

let view = 'inicio';

function showView(next) {
  view = next;
  $('home').hidden = view !== 'inicio';
  $('settings').hidden = view !== 'ajustes';
  $('pick').hidden = view !== 'elegir';
  const away = view !== 'inicio';
  $('icon-settings').hidden = away;
  $('icon-back').hidden = !away;
  $('toggle-settings').title = away ? 'Volver' : 'Ajustes';
  $('toggle-settings').setAttribute('aria-label', away ? 'Volver' : 'Ajustes');
  if (view === 'elegir') {
    const kind = { screen: 'screens', window: 'windows', tab: 'tabs' }[snap.selection.kind] || 'windows';
    loadPick(kind);
  }
}

$('toggle-settings').addEventListener('click', () => showView(view === 'inicio' ? 'ajustes' : 'inicio'));
api.onShow((v) => showView(v));

// ---------------------------------------------------------------- acciones

$('copy').addEventListener('click', async () => {
  await api.copyLink();
  $('copy-text').textContent = 'Enlace copiado';
  setTimeout(() => { $('copy-text').textContent = 'Copiar enlace'; }, 1600);
});

$('reset').addEventListener('click', async () => {
  $('qr-card').classList.add('loading');
  snap = await api.newCode();
  render();
});

$('perm-btn').addEventListener('click', () => api.askPermission());

const LINKS = { site: SITE_URL, privacy: PRIVACY_URL };
for (const a of document.querySelectorAll('[data-link]')) {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    api.open(LINKS[a.dataset.link]);
  });
}

$('social').replaceChildren(...SOCIAL.map((s) => {
  const b = document.createElement('button');
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SOCIAL_ICONS[s.id]}"/></svg>`;
  b.append(s.name);
  b.addEventListener('click', () => api.open(s.url));
  return b;
}));

// ---------------------------------------------------------------- inicio

api.onUpdate((next) => {
  snap = next;
  render();
});

snap = await api.get();
render();
setInterval(render, 30000); // actualiza "hace N minutos"
