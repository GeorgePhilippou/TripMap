const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');

let worker;

function stubCache(overrides) {
  const store = new Map();
  return {
    default: {
      match: async key => (overrides && overrides.match ? overrides.match(key) : store.get(key.url)),
      put: async (key, response) => { store.set(key.url, response); },
    },
    __store: store,
  };
}

test.before(async () => {
  const source = await readFile(resolve(__dirname, '../worker/geocode-search.js'), 'utf8');
  worker = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
});

test('builds a safe Nominatim URL from an allowlisted set of params, clamping the limit', () => {
  const params = new URLSearchParams({ q: 'Nissi Beach', limit: '999', viewbox: '32,35,33,34', bounded: '1', format: 'xml' });
  const url = worker.buildNominatimUrl(params);
  assert.equal(url.origin + url.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.equal(url.searchParams.get('q'), 'Nissi Beach');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.equal(url.searchParams.get('viewbox'), '32,35,33,34');
  assert.equal(url.searchParams.get('bounded'), '1');
  assert.equal(url.searchParams.get('format'), 'json');
});

test('refuses a request with no query', () => {
  assert.equal(worker.buildNominatimUrl(new URLSearchParams()), null);
});

test('rejects a missing q parameter without calling Nominatim', async () => {
  const originalFetch = global.fetch;
  const originalCaches = global.caches;
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; };
  global.caches = stubCache();
  try {
    const request = new Request('https://worker.example/');
    const response = await worker.default.fetch(request);
    assert.equal(response.status, 400);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
    global.caches = originalCaches;
  }
});

test('proxies a search to Nominatim with an identifying User-Agent and caches the result', async () => {
  const originalFetch = global.fetch;
  const originalCaches = global.caches;
  let sentHeaders;
  global.fetch = async (url, init) => {
    sentHeaders = init.headers;
    return new Response(JSON.stringify([{ lat: '34.9', lon: '33.1' }]), { status: 200 });
  };
  const cache = stubCache();
  global.caches = cache;
  try {
    const request = new Request('https://worker.example/?q=Nissi+Beach&limit=6&viewbox=32,35,33,34&bounded=1');
    const response = await worker.default.fetch(request, {}, { waitUntil: p => p });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ lat: '34.9', lon: '33.1' }]);
    assert.match(sentHeaders['User-Agent'], /TripMap/);
    assert.equal(cache.__store.size, 1);
  } finally {
    global.fetch = originalFetch;
    global.caches = originalCaches;
  }
});

test('serves a cached response without calling Nominatim again', async () => {
  const originalFetch = global.fetch;
  const originalCaches = global.caches;
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; };
  global.caches = {
    default: {
      match: async () => new Response(JSON.stringify([{ lat: '1', lon: '2' }]), { status: 200 }),
      put: async () => {},
    },
  };
  try {
    const request = new Request('https://worker.example/?q=Cached+Place');
    const response = await worker.default.fetch(request);
    assert.equal(fetchCalled, false);
    assert.deepEqual(await response.json(), [{ lat: '1', lon: '2' }]);
  } finally {
    global.fetch = originalFetch;
    global.caches = originalCaches;
  }
});

test('reports an upstream failure without throwing', async () => {
  const originalFetch = global.fetch;
  const originalCaches = global.caches;
  global.fetch = async () => { throw new Error('network down'); };
  global.caches = stubCache();
  try {
    const request = new Request('https://worker.example/?q=Anywhere');
    const response = await worker.default.fetch(request);
    assert.equal(response.status, 502);
  } finally {
    global.fetch = originalFetch;
    global.caches = originalCaches;
  }
});
