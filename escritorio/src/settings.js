// Presentazo para escritorio: ajustes guardados en un archivo JSON de la carpeta de datos de la app.

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  laserColor: '#FF3B30',
  laserSize: 'm',
  spotSize: 'm',
  nextKey: 'arrows',
  display: 'auto',
  clearInkOnSlide: true,
  showToasts: true,
  newCodeEachSession: true,
  hideOnConnect: true,
  openAtLogin: false,
};

const COLORS = ['#FF3B30', '#34C759', '#0A84FF', '#FFD60A', '#FF2D92'];
const SIZES = ['s', 'm', 'l'];
const NEXT_KEYS = ['arrows', 'page', 'space'];

// Solo se aceptan valores conocidos: el archivo podría editarse a mano.
function sanitize(raw) {
  const s = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return s;
  if (COLORS.includes(raw.laserColor)) s.laserColor = raw.laserColor;
  if (SIZES.includes(raw.laserSize)) s.laserSize = raw.laserSize;
  if (SIZES.includes(raw.spotSize)) s.spotSize = raw.spotSize;
  if (NEXT_KEYS.includes(raw.nextKey)) s.nextKey = raw.nextKey;
  if (typeof raw.display === 'string' && /^(auto|\d{1,20})$/.test(raw.display)) s.display = raw.display;
  for (const k of ['clearInkOnSlide', 'showToasts', 'newCodeEachSession', 'hideOnConnect', 'openAtLogin']) {
    if (typeof raw[k] === 'boolean') s[k] = raw[k];
  }
  return s;
}

export function createStore(dir) {
  const file = path.join(dir, 'ajustes.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}

  let settings = sanitize(data.settings);
  let identity = data.identity && typeof data.identity.peerId === 'string' ? data.identity : null;

  function persist() {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ settings, identity }, null, 2));
    fs.renameSync(tmp, file);
  }

  return {
    get settings() { return settings; },
    get identity() { return identity; },
    setSettings(patch) {
      settings = sanitize({ ...settings, ...patch });
      persist();
      return settings;
    },
    setIdentity(next) {
      identity = next;
      persist();
      return identity;
    },
  };
}
