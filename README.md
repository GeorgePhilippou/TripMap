# TripMap

TripMap is a mobile-first trip planner for collecting places, building itineraries, and sharing planning data with another traveller in real time. It runs as a static progressive web app and is designed for phones, iPads, and desktop browsers.

## Current capabilities

- Leaflet maps with marker clustering, street and satellite layers, routing, and location search
- Places organised into configurable categories, with notes, photos, visited state, and cover images
- Day-by-day itinerary, flights, trip dates, weather, checklist notes, recap, and nearest-place tools
- Google Maps and Apple Maps link parsing, share-target handling, and bulk paste
- Firebase Realtime Database rooms for live synchronisation
- IndexedDB and local-storage caches, JSON import/export, and an installable PWA shell

## Architecture

TripMap deliberately has no application build step. The browser loads `index.html`, external browser libraries from their CDNs, and the tested utilities in `src/tripmap-core.js`.

| Area | Implementation |
| --- | --- |
| Interface and app orchestration | `index.html` |
| Pure parsing, date, bounds, and migration utilities | `src/tripmap-core.js` |
| Committed trip definitions | `trips/*.json` |
| Live shared data | Firebase Realtime Database |
| Large local place/photo cache | IndexedDB through `idb-keyval` |
| Small preferences and offline fallback data | `localStorage` |
| PWA shell caching | `sw.js` |
| Shortened Maps-link resolver | `worker/resolve-maps-link.js` |

The Firebase browser configuration in `index.html` identifies the Firebase project; it is not an authentication secret. Data protection depends on Firebase Authentication and Realtime Database security rules. Those controls are not currently represented in this repository and must be addressed before treating a room code as private access control.

## Run locally

Serve the repository over HTTP because service workers, fetches, and browser storage do not behave correctly when `index.html` is opened directly from disk.

```sh
python3 -m http.server 8765
```

Then open `http://localhost:8765`.

## Validate changes

Node.js 20 or newer is required. The project has no npm dependencies, so installation is unnecessary.

```sh
npm test
```

The command validates all JSON and JavaScript entry points, checks that every indexed trip definition exists, and runs unit tests for parsing, migrations, date calculations, geocoder framing, and Worker URL restrictions. GitHub Actions runs the same command for pushes and pull requests.

## Static app deployment

Deploy the repository root to an HTTPS static host. Preserve the relative paths used by `index.html`, `manifest.json`, `sw.js`, `src/`, `icons/`, and `trips/`. Every release that changes cached application files must also change `CACHE_NAME` in `sw.js`, allowing existing PWA installations to discard the previous cache.

The application currently loads Leaflet, routing, sorting, photo, IndexedDB, Firebase, and font resources from third-party CDNs. The service worker caches the local shell but not all of those remote dependencies, so a first load and some functionality still require a network connection.

## Cloudflare Maps-link Worker

`worker/resolve-maps-link.js` follows shortened Google Maps and Apple Maps redirects server-side. It intentionally accepts only HTTPS links on these short-link hosts:

- `maps.app.goo.gl`
- `goo.gl/maps/...`
- `maps.apple`
- `maps.apple.com`

This allowlist prevents the Worker from becoming a general-purpose public fetch proxy.

To deploy it:

1. Create a module Worker in Cloudflare Workers.
2. Deploy the contents of `worker/resolve-maps-link.js`.
3. Test allowed Google and Apple short links and confirm unrelated URLs return HTTP 403.
4. Add the deployed Worker URL to TripMap's shortened-link resolution chain in `index.html`.
5. Keep the existing client-side fallbacks until the Worker has been observed in production.

Deployment and wiring are intentionally separate from this repository baseline: committing the Worker does not change production infrastructure.

## Data model and current limitations

Shared records live below `rooms/{room}/trips/{trip}`. Places, dates, flights, checklist items, and category covers are synchronised independently, but places are still written as one complete array. Concurrent place edits can therefore overwrite one another. A future data-model migration should store places by stable ID and update individual children atomically.

Photos are currently stored as base64 data inside place records. IndexedDB avoids the small browser local-storage limit, but shared records can still become large. Moving original images and thumbnails to object storage is another planned migration.

Do not change the live Firebase structure, rules, or room behaviour without a migration and rollback plan for existing trip data.
