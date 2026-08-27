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
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const target = new URL(request.url).searchParams.get('url');
    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    try {
      const res = await fetch(target, {
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
