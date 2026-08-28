const test = require('node:test');
const assert = require('node:assert/strict');
const {
  boundsSpanReasonable,
  buildResolverRequestUrl,
  buildRoomInviteUrl,
  cleanSearchText,
  computeCountdownText,
  extractSharedSearchText,
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

test('prefers embedded Google place coordinates over a misleading viewport', () => {
  const parsed = parseLocationInput('https://www.google.com/maps/place/Zorbas+Bakery+(%CE%A6%CE%BF%CF%8D%CF%81%CE%BD%CE%BF%CF%82+%CE%96%CE%9F%CE%A1%CE%A0%CE%91%CE%A3)/@0,0,64m/data=!3m1!1e3!4m6!3m5!1s0x14e7065db83452a9:0x19df4b4277738f81!8m2!3d34.785459!4d32.4219318!16s%2Fg%2F11h12rdx0?entry=ttu');
  assert.deepEqual(parsed, {
    lat: 34.785459,
    lng: 32.4219318,
    name: 'Zorbas Bakery (\u03a6\u03bf\u03cd\u03c1\u03bd\u03bf\u03c2 \u0396\u039f\u03a1\u03a0\u0391\u03a3)',
  });
});

test('recovers a Google Maps destination from a bot-check continuation', () => {
  const destination = 'https://www.google.com/maps/place/Darna+Restaurant/@42.426382,-71.070379,17z/data=!4m6!3m5!1sabc!8m2!3d42.4263781!4d-71.0677987';
  const gate = 'https://www.google.com/sorry/index?continue=' + encodeURIComponent(destination) + '&q=challenge';
  assert.deepEqual(parseLocationInput(gate), {
    lat: 42.4263781,
    lng: -71.0677987,
    name: 'Darna Restaurant',
  });
});

test('parses the full destination returned by an Apple Maps short link', () => {
  const parsed = parseLocationInput("https://maps.apple.com/place?address=Dimokratias%20Avenue%2032,%208028%20Paphos,%20Cyprus&coordinate=34.776722,32.443865&name=McDonald's&place-id=I39053CB4E3DAB236&map=h");
  assert.deepEqual(parsed, { lat: 34.776722, lng: 32.443865, name: "McDonald's" });
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

test('builds a safe Worker request without losing an existing endpoint query', () => {
  const target = 'https://maps.app.goo.gl/abc123';
  assert.equal(
    buildResolverRequestUrl('https://tripmap-resolver.example.workers.dev/?source=tripmap', target),
    'https://tripmap-resolver.example.workers.dev/?source=tripmap&url=https%3A%2F%2Fmaps.app.goo.gl%2Fabc123',
  );
  assert.equal(buildResolverRequestUrl('', target), null);
  assert.equal(buildResolverRequestUrl('http://insecure.example/', target), null);
  assert.equal(buildResolverRequestUrl('https://resolver.example/', 'not a URL'), null);
});

test('extracts a geocodable fallback from mobile Maps share metadata', () => {
  assert.equal(
    extractSharedSearchText('Tombs of the Kings\nPaphos, Cyprus\nhttps://maps.app.goo.gl/abc', 'Google Maps'),
    'Tombs of the Kings, Paphos, Cyprus',
  );
  assert.equal(
    extractSharedSearchText('View on Apple Maps: https://maps.apple/p/abc', 'Kolossi Castle'),
    'Kolossi Castle',
  );
  assert.equal(extractSharedSearchText('https://maps.app.goo.gl/abc', 'Google Maps'), '');
});
