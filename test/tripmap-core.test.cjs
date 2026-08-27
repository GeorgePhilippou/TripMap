const test = require('node:test');
const assert = require('node:assert/strict');
const {
  boundsSpanReasonable,
  buildRoomInviteUrl,
  cleanSearchText,
  computeCountdownText,
  generatePrivateRoomCode,
  isValidRoomCode,
  migratePlaces,
  parseLocationInput,
  placesFromRemote,
  placesRecordNeedsMigration,
  placesToRecord,
  roomCodeFromHash,
  zoomForPlaceRank,
} = require('../src/tripmap-core.js');

test('cleans multiline addresses without joining words together', () => {
  assert.equal(cleanSearchText('Museum\n  Main Street\r\nLondon'), 'Museum, Main Street, London');
});

test('parses coordinates and rejects out-of-range coordinates', () => {
  assert.deepEqual(parseLocationInput('34.772, 32.425'), { lat: 34.772, lng: 32.425, name: '' });
  assert.deepEqual(parseLocationInput('91, 32'), { query: '91, 32' });
});

test('parses Apple Maps coordinates and names', () => {
  const parsed = parseLocationInput('https://maps.apple.com/?ll=34.772,32.425&q=Sea+Caves');
  assert.deepEqual(parsed, { lat: 34.772, lng: 32.425, name: 'Sea Caves' });
});

test('preserves multi-word Google place names when coordinates are present', () => {
  const parsed = parseLocationInput('https://www.google.com/maps/place/Some Restaurant/@34.772,32.425,16z');
  assert.deepEqual(parsed, { lat: 34.772, lng: 32.425, name: 'Some Restaurant' });
});

test('returns a query for coordinate-free Google Maps links', () => {
  const parsed = parseLocationInput('https://www.google.com/maps/search/?api=1&query=British+Museum');
  assert.deepEqual(parsed, { query: 'British Museum' });
});

test('marks shortened links for asynchronous resolution', () => {
  const url = 'https://maps.app.goo.gl/abc123';
  assert.deepEqual(parseLocationInput(url), { unresolved: true, url });
});

test('computes countdown states deterministically', () => {
  const now = new Date('2026-08-27T12:00:00');
  assert.equal(computeCountdownText('2026-08-28', '2026-08-30', now), '1 day to go');
  assert.equal(computeCountdownText('2026-08-26', '2026-08-28', now), 'Day 2 of 3');
  assert.equal(computeCountdownText('2026-08-27', null, now), 'Today');
  assert.equal(computeCountdownText('2026-08-20', '2026-08-21', now), 'Trip complete');
});

test('maps geocoder place ranks to suitable zoom levels and bounds limits', () => {
  assert.equal(zoomForPlaceRank(4), 5);
  assert.equal(zoomForPlaceRank(16), 12);
  assert.equal(zoomForPlaceRank(20), 15);
  assert.equal(boundsSpanReasonable([[34, 32], [35, 33]], 16), true);
  assert.equal(boundsSpanReasonable([[30, 20], [40, 35]], 16), false);
});

test('migrates legacy categories, locality metadata, and photos once', () => {
  const places = [{ category: 'hotel', locality: 'Old Area', localityV: 1, photo: 'data:image/jpeg;base64,x' }];
  assert.equal(migratePlaces(places), true);
  assert.deepEqual(places, [{ category: 'stays', localityV: 2, photos: ['data:image/jpeg;base64,x'] }]);
  assert.equal(migratePlaces(places), false);
});

test('generates high-entropy private room codes in a Firebase-safe format', () => {
  const room = generatePrivateRoomCode(bytes => bytes.forEach((_, index) => { bytes[index] = index; }));
  assert.equal(room, 'trip_000102030405060708090a0b0c0d0e0f1011');
  assert.equal(isValidRoomCode(room), true);
  assert.equal(isValidRoomCode('bad/room'), false);
  assert.equal(isValidRoomCode('short'), false);
});

test('builds and reads fragment-based room invites without retaining query data', () => {
  const room = 'trip_000102030405060708090a0b0c0d0e0f1011';
  const invite = buildRoomInviteUrl('https://example.com/tripmap/?old=value#previous', room);
  assert.equal(invite, `https://example.com/tripmap/#room=${room}`);
  assert.equal(roomCodeFromHash(new URL(invite).hash), room);
  assert.equal(roomCodeFromHash('#room=bad%2Froom'), null);
});

test('converts legacy place arrays to ID-keyed records and back', () => {
  const places = [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }];
  const record = placesToRecord(places);
  assert.deepEqual(record, { one: places[0], two: places[1] });
  assert.deepEqual(placesFromRemote(record), places);
  assert.deepEqual(placesFromRemote(places), places);
  assert.deepEqual(placesFromRemote(null), []);
  assert.equal(placesRecordNeedsMigration(places), true);
  assert.equal(placesRecordNeedsMigration(record), false);
  assert.equal(placesRecordNeedsMigration({ 0: places[0], two: places[1] }), true);
});

test('refuses unsafe or duplicate place IDs before a collection write', () => {
  assert.throws(() => placesToRecord([{ id: 'bad/id' }]), /Firebase-safe/);
  assert.throws(() => placesToRecord([{ id: 'same' }, { id: 'same' }]), /Duplicate place ID/);
});
