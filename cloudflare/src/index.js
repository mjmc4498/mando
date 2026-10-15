// Mando — Worker de credenciales TURN.
// GET /ice → { iceServers: [...], ttl } con credenciales temporales de
// Cloudflare Realtime TURN. La clave de TURN vive solo como secreto del Worker.

const CF_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';

// Límite simple por IP y por instancia: suficiente para frenar abusos casuales.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

function allowedOrigin(origin, env) {
  if (!origin) return null;
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return origin;
  const list = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function json(body, status, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request.headers.get('Origin'), env);

    if (request.method === 'OPTIONS') return json({}, origin ? 204 : 403, origin);
    if (url.pathname === '/') return json({ servicio: 'Mando · credenciales TURN', ok: true }, 200, origin);
    if (url.pathname !== '/ice' || request.method !== 'GET') return json({ error: 'no-encontrado' }, 404, origin);
    if (!origin) return json({ error: 'origen-no-permitido' }, 403, null);

    const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';
    if (rateLimited(ip)) return json({ error: 'demasiadas-solicitudes' }, 429, origin);

    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ error: 'sin-configurar' }, 503, origin);

    // El ID de la clave TURN tiene 32 caracteres hexadecimales. Se extrae aunque el
    // secreto se haya guardado con texto adicional (una URL o un comando copiado).
    // El API Token tiene 64 caracteres hexadecimales.
    const keyId = (String(env.TURN_KEY_ID).match(/(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/i) || [])[0];
    const token = (String(env.TURN_KEY_API_TOKEN).match(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i) || [])[0];
    if (!keyId || !token) {
      return json({ error: 'clave-turn-invalida', revisar: [!keyId && 'TURN_KEY_ID', !token && 'TURN_KEY_API_TOKEN'].filter(Boolean) }, 503, origin);
    }

    const ttl = Math.max(600, Math.min(172800, Number(env.CREDENTIAL_TTL) || 86400));
    let res;
    try {
      res = await fetch(`${CF_API}/${keyId}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl }),
      });
    } catch {
      return json({ error: 'cloudflare-no-disponible' }, 502, origin);
    }
    if (!res.ok) return json({ error: 'cloudflare-rechazo', estado: res.status }, 502, origin);

    const data = await res.json();
    // El puerto 53 puede tardar en los navegadores: se descarta.
    const iceServers = (data.iceServers || []).map((s) => ({
      ...s,
      urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)),
    })).filter((s) => s.urls.length);

    return json({ iceServers, ttl }, 200, origin);
  },
};
