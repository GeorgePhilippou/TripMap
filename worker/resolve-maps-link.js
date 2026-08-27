// Cloudflare Worker: resolves a shortened Maps link (maps.app.goo.gl,
// maps.apple/p/...) to its final destination URL.
//
// A plain server-side fetch following redirects handles Apple's short links
// fine (they're a normal 302 chain), and a mobile Safari User-Agent gets
// Google's Firebase Dynamic Links to issue their real redirect too, instead
// of the JS-driven "open in app" interstitial they show to non-mobile/bot
// user agents.
//
// Deploy via the Cloudflare dashboard (Workers & Pages > Create > paste this
// in the editor > Deploy), then point TripMap's RESOLVE_WORKER_URL at the
// resulting *.workers.dev address.

const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Content-Type-Options': 'nosniff',
};

const ALLOWED_EXACT_HOSTS = new Set([
  'maps.app.goo.gl',
  'maps.apple',
  'maps.apple.com',
]);

export function parseAllowedTarget(rawTarget) {
  let target;
  try {
    target = new URL(rawTarget);
  } catch (error) {
    return null;
  }

  if (target.protocol !== 'https:' || target.username || target.password || target.port) return null;
  const hostname = target.hostname.toLowerCase();
  if (ALLOWED_EXACT_HOSTS.has(hostname)) return target;
  if (hostname === 'goo.gl' && target.pathname.startsWith('/maps')) return target;
  return null;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const rawTarget = new URL(request.url).searchParams.get('url');
    if (!rawTarget) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    const target = parseAllowedTarget(rawTarget);
    if (!target) {
      return new Response(JSON.stringify({ error: 'Only supported Google Maps and Apple Maps short links are allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    try {
      const res = await fetch(target.toString(), {
        redirect: 'follow',
        headers: { 'User-Agent': MOBILE_USER_AGENT },
      });
      return new Response(JSON.stringify({ resolvedUrl: res.url }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
  },
};
