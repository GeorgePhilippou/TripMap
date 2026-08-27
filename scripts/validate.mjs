import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const read = path => readFile(resolve(root, path), 'utf8');

const jsonFiles = ['manifest.json', 'trips/index.json', 'trips/cyprus.json', 'trips/amsterdam.json'];
const parsedJson = new Map();
for (const file of jsonFiles) parsedJson.set(file, JSON.parse(await read(file)));

const tripIndex = parsedJson.get('trips/index.json');
assert.ok(Array.isArray(tripIndex) && tripIndex.length > 0, 'trips/index.json must contain trip files');
for (const tripFile of tripIndex) {
  assert.ok(parsedJson.has(`trips/${tripFile}`), `trips/index.json references missing ${tripFile}`);
}

const indexHtml = await read('index.html');
assert.match(indexHtml, /<script src="src\/tripmap-core\.js"><\/script>/, 'index.html must load the tested core utilities');
const inlineScripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.ok(inlineScripts.length > 0, 'index.html must contain its application script');
for (const [, source] of inlineScripts) new vm.Script(source, { filename: 'index.html:inline-script' });

new vm.Script(await read('src/tripmap-core.js'), { filename: 'src/tripmap-core.js' });
new vm.Script(await read('sw.js'), { filename: 'sw.js' });

const workerSource = await read('worker/resolve-maps-link.js');
await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`);

console.log(`Validated ${jsonFiles.length} JSON files and all local JavaScript entry points.`);
