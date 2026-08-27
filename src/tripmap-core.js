(function attachTripMapCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TripMapCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTripMapCore() {
  const CATEGORY_MIGRATIONS = { hotel: 'stays', other: 'general' };
  const LOCALITY_FORMAT_VERSION = 2;

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
        const queryIsCoordinates = query && /^-?\d+\.\d+,-?\d+\.\d+$/.test(query);
        if (queryIsCoordinates) {
          const [lat, lng] = query.split(',').map(parseFloat);
          return { lat, lng, name };
        }
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
    cleanSearchText,
    computeCountdownText,
    migratePlaces,
    parseLocationInput,
    zoomForPlaceRank,
  };
}));
