// Cloudflare Worker: proxies OpenStreetMap Nominatim search requests so
// TripMap's client never calls the public API directly from every visitor's
// browser with no identifying User-Agent and no shared caching - both of
// which Nominatim's usage policy asks for
// (https://operations.osmfoundation.org/policies/nominatim/). Repeat
// searches (retyping the same place, reopening a trip near the same area)
// are served from the Worker's edge cache instead of hitting Nominatim
// again, and only a small allowlist of query params is ever forwarded, so
// this can't become an open proxy for arbitrary Nominatim requests.
//
// Deploy via the Cloudflare dashboard (Workers & Pages > Create > paste this
// in the editor > Deploy), then point TripMap's GEOCODE_WORKER_URL at the
// resulting *.workers.dev address. Until that's set, TripMap falls back to
// calling Nominatim directly, exactly as it always has.

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const APP_USER_AGENT = 'TripMap/1 (personal trip-planning PWA; https://github.com/GeorgePhilippou/tripmap)';
const CACHE_TTL_SECONDS = 3600;
const MAX_LIMIT = 10;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Content-Type-Options': 'nosniff',
};

export function buildNominatimUrl(searchParams) {
  const q = searchParams.get('q');
  if (!q) return null;
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set('format', 'json');
  url.searchParams.set('q', q);
  const requestedLimit = parseInt(searchParams.get('limit') || '5', 10);
  const limit = Math.min(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 5, MAX_LIMIT);
  url.searchParams.set('limit', String(limit));
  const viewbox = searchParams.get('viewbox');
  if (viewbox) url.searchParams.set('viewbox', viewbox);
  if (searchParams.get('bounded') === '1') url.searchParams.set('bounded', '1');
  return url;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const incoming = new URL(request.url);
    const target = buildNominatimUrl(incoming.searchParams);
    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing q parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    const cache = caches.default;
    const cacheKey = new Request(target.toString(), { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) {
      const response = new Response(cached.body, cached);
      Object.entries(CORS_HEADERS).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    try {
      const res = await fetch(target.toString(), {
        headers: {
          'User-Agent': APP_USER_AGENT,
          'Accept-Language': request.headers.get('Accept-Language') || 'en',
        },
      });
      const body = await res.text();
      const response = new Response(body, {
        status: res.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
          ...CORS_HEADERS,
        },
      });
      if (res.ok) {
        const toCache = response.clone();
        if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, toCache));
        else await cache.put(cacheKey, toCache);
      }
      return response;
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
  },
};
