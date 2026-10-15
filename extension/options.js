import { REMOTE_URL, getSettings, saveSettings } from './config.js';
import { applyI18n, t } from './lib/i18n.js';

applyI18n();

const $ = (id) => document.getElementById(id);
let settings = await getSettings();

const manifest = chrome.runtime.getManifest();
$('version').textContent = manifest.version;
$('privacy').href = new URL('privacy.html', REMOTE_URL).toString();
$('remoteUrl').placeholder = REMOTE_URL;

chrome.commands?.getAll?.().then((commands) => {
  const cmd = commands.find((c) => c.name === '_execute_action');
  if (cmd?.shortcut) $('shortcut').textContent = cmd.shortcut;
  else $('shortcut').textContent = t('shortcutNone');
});

let savedTimer = 0;
async function save(patch) {
  settings = await saveSettings(patch);
  render();
  $('saved').classList.add('on');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $('saved').classList.remove('on'), 1200);
}

function bindChoice(id) {
  const group = $(id);
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (btn) save({ [id]: btn.dataset.value });
  });
}

function bindSwitch(id) {
  $(id).addEventListener('change', (e) => save({ [id]: e.target.checked }));
}

function render() {
  for (const id of ['laserColor', 'laserSize', 'spotSize', 'nextKey']) {
    for (const btn of $(id).querySelectorAll('button[data-value]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.value === settings[id]));
    }
  }
  for (const id of ['clearInkOnSlide', 'showToasts', 'followActiveTab', 'autoStart', 'newCodeEachSession']) $(id).checked = !!settings[id];
  if (document.activeElement !== $('remoteUrl')) $('remoteUrl').value = settings.remoteUrl;

  const preview = $('preview');
  preview.style.setProperty('--c', settings.laserColor);
  preview.querySelector('.preview-laser').style.setProperty('--s', `${{ s: 16, m: 24, l: 34 }[settings.laserSize] || 24}px`);
}

['laserColor', 'laserSize', 'spotSize', 'nextKey'].forEach(bindChoice);
['clearInkOnSlide', 'showToasts', 'followActiveTab', 'autoStart', 'newCodeEachSession'].forEach(bindSwitch);

$('remoteUrlSave').addEventListener('click', async () => {
  const msg = $('remoteUrlMsg');
  const value = $('remoteUrl').value.trim();
  msg.classList.remove('error');
  if (!value) {
    await save({ remoteUrl: '' });
    msg.textContent = t('remoteUrlDefault');
    return;
  }
  try {
    const url = new URL(value);
    // http solo se admite en la red local (pruebas antes de publicar).
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/.test(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('https');
    await save({ remoteUrl: url.toString() });
    msg.textContent = t('remoteUrlSaved');
  } catch {
    msg.classList.add('error');
    msg.textContent = t('remoteUrlInvalid');
  }
});

let confirmReset = false;
$('resetCode').addEventListener('click', async () => {
  const btn = $('resetCode');
  if (!confirmReset) {
    confirmReset = true;
    btn.textContent = t('newCodeConfirm');
    setTimeout(() => { confirmReset = false; btn.textContent = t('newCode'); }, 3000);
    return;
  }
  confirmReset = false;
  await chrome.runtime.sendMessage({ to: 'sw', type: 'session:reset' });
  btn.textContent = t('newCodeDone');
  setTimeout(() => { btn.textContent = t('newCode'); }, 2000);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) getSettings().then((s) => { settings = s; render(); });
});

render();
