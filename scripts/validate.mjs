import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const read = path => readFile(resolve(root, path), 'utf8');

const jsonFiles = [
  'manifest.json',
  'firebase.json',
  'database.rules.json',
  'trips/index.json',
  'trips/cyprus.json',
  'trips/amsterdam.json',
];
const parsedJson = new Map();
for (const file of jsonFiles) parsedJson.set(file, JSON.parse(await read(file)));

const tripIndex = parsedJson.get('trips/index.json');
assert.ok(Array.isArray(tripIndex) && tripIndex.length > 0, 'trips/index.json must contain trip files');
for (const tripFile of tripIndex) {
  assert.ok(parsedJson.has(`trips/${tripFile}`), `trips/index.json references missing ${tripFile}`);
}

const indexHtml = await read('index.html');
assert.match(indexHtml, /<script src="src\/tripmap-core\.js"><\/script>/, 'index.html must load the tested core utilities');
assert.match(indexHtml, /firebase-auth-compat\.js/, 'index.html must load Firebase Authentication before starting sync');
assert.match(indexHtml, /LOCAL_OFFLINE_MODE/, 'index.html must retain a localhost-only, side-effect-free smoke-test mode');
const categorySource = indexHtml.match(/const CATEGORIES = \[([\s\S]*?)\n\];/);
assert.ok(categorySource, 'index.html must define CATEGORIES');
const categoryKeys = [...categorySource[1].matchAll(/key:'([a-z]+)'/g)].map(match => match[1]);
const expectedCategoryKeys = [
  'sight', 'food', 'beach', 'historical', 'fruit', 'shops', 'activity', 'stays', 'airport', 'general', 'hike',
  'zorbas', 'cafe', 'restaurants', 'nature', 'nightlife', 'essentials', 'transport',
];
assert.deepEqual(categoryKeys, expectedCategoryKeys, 'category keys or their intended order changed unexpectedly');
assert.equal(new Set(categoryKeys).size, categoryKeys.length, 'category keys must be unique');
for (const key of categoryKeys) {
  assert.match(indexHtml, new RegExp(`--${key}:[^;]+;`), `${key} must define a primary colour`);
  assert.match(indexHtml, new RegExp(`--${key}-soft:[^;]+;`), `${key} must define a soft colour`);
}
assert.equal((categorySource[1].match(/icon:svgIcon\(/g) || []).length, categoryKeys.length, 'every category must use the unified SVG icon system');
const inlineScripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.ok(inlineScripts.length > 0, 'index.html must contain its application script');
for (const [, source] of inlineScripts) new vm.Script(source, { filename: 'index.html:inline-script' });

new vm.Script(await read('src/tripmap-core.js'), { filename: 'src/tripmap-core.js' });
new vm.Script(await read('sw.js'), { filename: 'sw.js' });

const workerSource = await read('worker/resolve-maps-link.js');
await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`);

const rules = parsedJson.get('database.rules.json').rules;
assert.equal(rules['.read'], false, 'database root reads must be denied');
assert.equal(rules['.write'], false, 'database root writes must be denied');
assert.equal(rules.rooms.$room['.read'], 'auth != null', 'room reads must require authentication');
assert.equal(rules.rooms.$room['.write'], 'auth != null', 'room writes must require authentication');

console.log(`Validated ${jsonFiles.length} JSON files and all local JavaScript entry points.`);
