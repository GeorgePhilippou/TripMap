(function attachTripMapCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TripMapCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTripMapCore() {
  const CATEGORY_MIGRATIONS = { hotel: 'stays', other: 'general' };
  const LOCALITY_FORMAT_VERSION = 2;
  const FIREBASE_KEY_FORBIDDEN = /[.#$\[\]/]/;

  function isValidRoomCode(roomCode) {
    return typeof roomCode === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(roomCode);
  }

  function generatePrivateRoomCode(fillRandomValues) {
    const bytes = new Uint8Array(18);
    const fill = fillRandomValues || (array => crypto.getRandomValues(array));
    fill(bytes);
    const encoded = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `trip_${encoded}`;
  }

  function buildRoomInviteUrl(baseUrl, roomCode) {
    if (!isValidRoomCode(roomCode)) throw new Error('Invalid room code');
    const inviteUrl = new URL(baseUrl);
    inviteUrl.search = '';
    inviteUrl.hash = new URLSearchParams({ room: roomCode }).toString();
    return inviteUrl.toString();
  }

  function roomCodeFromHash(hash) {
    const value = new URLSearchParams((hash || '').replace(/^#/, '')).get('room');
    return isValidRoomCode(value) ? value : null;
  }

  function buildResolverRequestUrl(endpoint, targetUrl) {
    if (!endpoint) return null;
    let resolver;
    let target;
    try {
      resolver = new URL(endpoint);
      target = new URL(targetUrl);
    } catch (error) {
      return null;
    }
    if (resolver.protocol !== 'https:' || target.protocol !== 'https:') return null;
    resolver.searchParams.set('url', target.toString());
    return resolver.toString();
  }

  function extractSharedSearchText(sharedText, sharedTitle) {
    const cleanPart = value => cleanSearchText((value || '')
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/\b(?:shared from|view on|open in)?\s*(?:Google|Apple) Maps\b/gi, ' '))
      .replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, '')
      .replace(/^maps$/i, '')
      .trim();
    const text = cleanPart(sharedText);
    const title = cleanPart(sharedTitle);
    if (!text) return title;
    if (!title || text.toLowerCase().includes(title.toLowerCase())) return text;
    return `${text}, ${title}`;
  }

  function placesFromRemote(remote) {
    if (Array.isArray(remote)) return remote.filter(place => place && typeof place === 'object');
    if (remote && typeof remote === 'object') {
      return Object.values(remote).filter(place => place && typeof place === 'object');
    }
    return [];
  }

  function placesRecordNeedsMigration(remote) {
    if (Array.isArray(remote)) return true;
    if (!remote || typeof remote !== 'object') return false;
    return Object.entries(remote).some(([key, place]) => place && typeof place === 'object' && place.id !== key);
  }

  function placesToRecord(places) {
    const record = {};
    places.forEach(place => {
      if (!place || typeof place !== 'object' || typeof place.id !== 'string' || !place.id || FIREBASE_KEY_FORBIDDEN.test(place.id)) {
        throw new Error('Every synced place needs a Firebase-safe string ID');
      }
      if (record[place.id]) throw new Error(`Duplicate place ID: ${place.id}`);
      record[place.id] = place;
    });
    return record;
  }

  function computeCountdownText(start, end, now) {
    if (!start) return null;
    const today = now ? new Date(now) : new Date();
    today.setHours(0, 0, 0, 0);
    const startD = new Date(start + 'T00:00:00');
    const endD = end ? new Date(end + 'T00:00:00') : startD;
    const oneDay = 86400000;
    if (today < startD) {
      const days = Math.round((startD - today) / oneDay);
      return days === 1 ? '1 day to go' : `${days} days to go`;
    }
    if (today <= endD) {
      const day = Math.round((today - startD) / oneDay) + 1;
      const total = Math.round((endD - startD) / oneDay) + 1;
      return total > 1 ? `Day ${day} of ${total}` : 'Today';
    }
    return 'Trip complete';
  }

  function zoomForPlaceRank(rank) {
    if (rank == null) return 9;
    if (rank <= 4) return 5;
    if (rank <= 8) return 7;
    if (rank <= 10) return 9;
    if (rank <= 12) return 10;
    if (rank <= 16) return 12;
    if (rank <= 18) return 14;
    return 15;
  }

  function boundsSpanReasonable(bounds, rank) {
    if (!bounds) return false;
    const [[south, west], [north, east]] = bounds;
    const span = Math.max(north - south, east - west);
    const maxAllowed = rank == null ? 15
      : rank <= 4 ? 70 : rank <= 8 ? 15 : rank <= 10 ? 6 : rank <= 12 ? 2.5 : rank <= 16 ? 1.2 : 0.6;
    return span <= maxAllowed;
  }

  function migratePlaces(places) {
    let changed = false;
    places.forEach(place => {
      if (CATEGORY_MIGRATIONS[place.category]) {
        place.category = CATEGORY_MIGRATIONS[place.category];
        changed = true;
      }
      if (place.locality !== undefined && place.localityV !== LOCALITY_FORMAT_VERSION) {
        delete place.locality;
        place.localityV = LOCALITY_FORMAT_VERSION;
        changed = true;
      }
      if (!place.photos) {
        place.photos = place.photo ? [place.photo] : [];
        delete place.photo;
        changed = true;
      }
    });
    return changed;
  }

  function cleanSearchText(raw) {
    return (raw || '').replace(/[\r\n]+/g, ', ').replace(/\s{2,}/g, ' ').trim();
  }

  function coordinatesFromGoogleFeatureId(rawFeatureId) {
    const match = /^0x([0-9a-f]+):0x[0-9a-f]+$/i.exec(rawFeatureId || '');
    if (!match || typeof BigInt !== 'function') return null;

    let bits;
    try {
      bits = BigInt(`0x${match[1]}`).toString(2).padStart(64, '0');
    } catch (error) {
      return null;
    }
    if (bits.length !== 64) return null;

    // The first half of a Google ftid is an S2 cell ID. Decode its face and
    // Hilbert-curve position, then convert the cell centre back to latitude
    // and longitude. Google commonly supplies a leaf cell, whose centre is
    // accurate enough to place the imported pin within a few metres.
    const face = parseInt(bits.slice(0, 3), 2);
    const markerIndex = bits.lastIndexOf('1');
    const positionBits = bits.slice(3, markerIndex);
    if (face > 5 || markerIndex < 3 || positionBits.length % 2 !== 0) return null;

    const position = [];
    for (let i = 0; i < positionBits.length; i += 2) {
      position.push(parseInt(positionBits.slice(i, i + 2), 2));
    }

    const point = { x: 0, y: 0 };
    for (let i = position.length - 1, level = 1; i >= 0; i -= 1, level += 1) {
      const quadrant = position[i];
      const rx = quadrant === 2 || quadrant === 3 ? 1 : 0;
      const ry = quadrant === 1 || quadrant === 2 ? 1 : 0;
      const size = 2 ** (level - 1);
      if (ry === 0) {
        if (rx === 1) {
          point.x = size - 1 - point.x;
          point.y = size - 1 - point.y;
        }
        [point.x, point.y] = [point.y, point.x];
      }
      point.x += size * rx;
      point.y += size * ry;
    }
    if (face % 2 === 1) [point.x, point.y] = [point.y, point.x];

    const scale = 2 ** position.length;
    const stToUv = value => value >= 0.5
      ? (4 * value * value - 1) / 3
      : (1 - 4 * (1 - value) * (1 - value)) / 3;
    const u = stToUv((point.x + 0.5) / scale);
    const v = stToUv((point.y + 0.5) / scale);
    const xyzByFace = [
      [1, u, v], [-u, 1, v], [-u, -v, 1],
      [-1, -v, -u], [v, -1, -u], [v, u, -1],
    ];
    const [x, y, z] = xyzByFace[face];
    return {
      lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI,
      lng: Math.atan2(y, x) * 180 / Math.PI,
    };
  }

  function parseLocationInput(raw) {
    const text = (raw || '').trim();
    if (!text) return null;

    const coordMatch = text.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, name: '' };
    }

    const url = /^https?:\/\//.test(text) ? text : (text.match(/https?:\/\/\S+/) || [])[0] || null;
    if (url) {
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (error) {
        return { query: text };
      }

      // Google may send server-side redirect resolvers through a bot-check or
      // consent page. Those gate URLs retain the real Maps destination in a
      // `continue` parameter, so recover it instead of treating the gate as
      // another unreadable shortened link.
      const continuedUrl = parsedUrl.searchParams.get('continue');
      if (continuedUrl && parsedUrl.hostname.includes('google.')) {
        try {
          const continued = new URL(continuedUrl);
          const continuedIsGoogleMaps = (continued.hostname.includes('google.') && continued.pathname.includes('/maps'))
            || continued.hostname.startsWith('maps.google.');
          if (continuedIsGoogleMaps) return parseLocationInput(continued.toString());
        } catch (error) {
          // Ignore malformed or non-Maps continuation URLs.
        }
      }

      if (parsedUrl.hostname.includes('maps.apple.com')) {
        const coordinates = parsedUrl.searchParams.get('ll') || parsedUrl.searchParams.get('coordinate');
        const name = parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('name') || '';
        if (coordinates) {
          const [lat, lng] = coordinates.split(',').map(parseFloat);
          if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { lat, lng, name };
        }
        const fallback = name || parsedUrl.searchParams.get('address');
        if (fallback) return { query: fallback };
      }

      const isGoogleMaps = (parsedUrl.hostname.includes('google.') && parsedUrl.pathname.includes('/maps'))
        || parsedUrl.hostname.startsWith('maps.google.');
      if (isGoogleMaps) {
        let name = '';
        const placeMatch = parsedUrl.pathname.match(/\/place\/([^/@]+)/);
        if (placeMatch) name = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
        const query = parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('query');
        if (!name && query) name = query.split(',')[0].trim();
        const queryIsCoordinates = query && /^-?\d+\.\d+,-?\d+\.\d+$/.test(query);
        if (queryIsCoordinates) {
          const [lat, lng] = query.split(',').map(parseFloat);
          return { lat, lng, name };
        }
        // Google place URLs can carry a map viewport after "@" as well as the
        // actual place coordinates in their data block. The viewport is not a
        // reliable location (shared links sometimes contain @0,0), so prefer
        // the data-block coordinates when present.
        const placeCoordinates = parsedUrl.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
        if (placeCoordinates) {
          return { lat: parseFloat(placeCoordinates[1]), lng: parseFloat(placeCoordinates[2]), name };
        }
        const alternatePlaceCoordinates = parsedUrl.href.match(/!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/);
        if (alternatePlaceCoordinates) {
          return { lat: parseFloat(alternatePlaceCoordinates[2]), lng: parseFloat(alternatePlaceCoordinates[1]), name };
        }
        const featureCoordinates = coordinatesFromGoogleFeatureId(parsedUrl.searchParams.get('ftid'));
        if (featureCoordinates) return { ...featureCoordinates, name };
        const atMatch = parsedUrl.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]), name };
        const fallback = name || (query ? decodeURIComponent(query.replace(/\+/g, ' ')) : '');
        if (fallback) return { query: fallback };
      }

      return { unresolved: true, url };
    }

    return { query: text };
  }

  return {
    boundsSpanReasonable,
    buildResolverRequestUrl,
    buildRoomInviteUrl,
    cleanSearchText,
    computeCountdownText,
    extractSharedSearchText,
    generatePrivateRoomCode,
    isValidRoomCode,
    LOCALITY_FORMAT_VERSION,
    migratePlaces,
    parseLocationInput,
    placesFromRemote,
    placesRecordNeedsMigration,
    placesToRecord,
    roomCodeFromHash,
    zoomForPlaceRank,
  };
}));
