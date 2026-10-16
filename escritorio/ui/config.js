// Presentazo para escritorio: configuración compartida por el proceso principal y las ventanas.
// Usa la misma página del celular y los mismos servidores que la extensión de Chrome,
// así el control remoto funciona igual con las dos.

export const REMOTE_URL = 'https://mjmc4498.github.io/mando/';

export const ID_PREFIX = 'mando-';

export const ICE_ENDPOINT = 'https://mando-turn.mjmc4498.workers.dev/ice';

export const FALLBACK_ICE = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }],
};

export const SITE_URL = 'https://mjmc4498.github.io/mando/';
export const PRIVACY_URL = 'https://mjmc4498.github.io/mando/privacy.html';

export const SOCIAL = [
  { id: 'facebook', name: 'Facebook', url: 'https://www.facebook.com/presentazo/' },
  { id: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/presentazo/' },
  { id: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com/@presentazo' },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/@presentazo' },
  { id: 'x', name: 'X', url: 'https://x.com/presentazo' },
];

export function buildRemoteUrl(base, peerId, token) {
  const url = new URL(base || REMOTE_URL);
  url.hash = new URLSearchParams({ id: peerId, k: token }).toString();
  return url.toString();
}
