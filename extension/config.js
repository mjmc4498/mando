// Mando — configuración compartida por el service worker, el popup y las opciones.

// Página del control remoto que se abre en el celular (carpeta /remote publicada
// en GitHub Pages). Si la publicas en otra dirección, cámbiala aquí o en Ajustes.
export const REMOTE_URL = 'https://mjmc4498.github.io/mando/';

// Prefijo de los identificadores de sesión en el servidor de señalización PeerJS.
export const ID_PREFIX = 'mando-';

export const DEFAULT_SETTINGS = {
  remoteUrl: '',
  laserColor: '#FF3B30',
  laserSize: 'm',
  spotSize: 'm',
  nextKey: 'arrows',
  clearInkOnSlide: true,
  showToasts: true,
  followActiveTab: false,
  autoStart: false,
};

export async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

export function buildRemoteUrl(base, peerId, token) {
  const url = new URL(base || REMOTE_URL);
  url.hash = new URLSearchParams({ id: peerId, k: token }).toString();
  return url.toString();
}
