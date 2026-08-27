const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');

let worker;

test.before(async () => {
  const source = await readFile(resolve(__dirname, '../worker/resolve-maps-link.js'), 'utf8');
  worker = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
});

test('allows only HTTPS Maps short-link targets', () => {
  assert.equal(worker.parseAllowedTarget('https://maps.app.goo.gl/abc').hostname, 'maps.app.goo.gl');
  assert.equal(worker.parseAllowedTarget('https://maps.apple/p/abc').hostname, 'maps.apple');
  assert.equal(worker.parseAllowedTarget('https://goo.gl/maps/abc').hostname, 'goo.gl');
  assert.equal(worker.parseAllowedTarget('http://maps.app.goo.gl/abc'), null);
  assert.equal(worker.parseAllowedTarget('https://example.com/maps/abc'), null);
  assert.equal(worker.parseAllowedTarget('https://goo.gl/not-maps'), null);
  assert.equal(worker.parseAllowedTarget('not a URL'), null);
});

test('rejects unsupported targets without fetching them', async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; };
  try {
    const request = new Request('https://worker.example/?url=' + encodeURIComponent('https://example.com/private'));
    const response = await worker.default.fetch(request);
    assert.equal(response.status, 403);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('follows an allowed link and returns its final URL', async () => {
  const originalFetch = global.fetch;
  let fetchedUrl;
  global.fetch = async url => {
    fetchedUrl = url;
    return { url: 'https://www.google.com/maps/place/Test/@34.1,33.2,16z' };
  };
  try {
    const shortUrl = 'https://maps.app.goo.gl/abc';
    const request = new Request('https://worker.example/?url=' + encodeURIComponent(shortUrl));
    const response = await worker.default.fetch(request);
    assert.equal(response.status, 200);
    assert.equal(fetchedUrl, shortUrl);
    assert.deepEqual(await response.json(), { resolvedUrl: 'https://www.google.com/maps/place/Test/@34.1,33.2,16z' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('supports the supplied Apple Maps short-link redirect shape', async () => {
  const originalFetch = global.fetch;
  const shortUrl = 'https://maps.apple/p/mTearjMg1xfYIn';
  const finalUrl = "https://maps.apple.com/place?address=Dimokratias%20Avenue%2032,%208028%20Paphos,%20Cyprus&coordinate=34.776722,32.443865&name=McDonald's&place-id=I39053CB4E3DAB236&map=h";
  let fetchedUrl;
  global.fetch = async url => {
    fetchedUrl = url;
    return { url: finalUrl };
  };
  try {
    const request = new Request('https://worker.example/?url=' + encodeURIComponent(shortUrl));
    const response = await worker.default.fetch(request);
    assert.equal(response.status, 200);
    assert.equal(fetchedUrl, shortUrl);
    assert.deepEqual(await response.json(), { resolvedUrl: finalUrl });
  } finally {
    global.fetch = originalFetch;
  }
});
