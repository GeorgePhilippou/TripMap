# TripMap

TripMap is a mobile-first trip planner for collecting places, building itineraries, and sharing planning data with another traveller in real time. It runs as a static progressive web app and is designed for phones, iPads, and desktop browsers.

## Current capabilities

- Leaflet maps with marker clustering, street and satellite layers, routing, and location search
- Places organised into configurable categories, with notes, photos, visited state, and cover images
- Day-by-day itinerary, flights, trip dates, weather, checklist notes, recap, and nearest-place tools
- Google Maps and Apple Maps link parsing, share-target handling, and bulk paste
- Anonymous Firebase identity and Realtime Database rooms for live synchronisation
- IndexedDB and local-storage caches, JSON import/export, and an installable PWA shell

## Architecture

TripMap deliberately has no application build step. The browser loads `index.html`, external browser libraries from their CDNs, and the tested utilities in `src/tripmap-core.js`.

| Area | Implementation |
| --- | --- |
| Interface and app orchestration | `index.html` |
| Pure parsing, date, bounds, and migration utilities | `src/tripmap-core.js` |
| Committed trip definitions | `trips/*.json` |
| Live shared data | Firebase Realtime Database |
| Browser identity | Firebase Anonymous Authentication |
| Large local place/photo cache | IndexedDB through `idb-keyval` |
| Small preferences and offline fallback data | `localStorage` |
| PWA shell caching | `sw.js` |
| Shortened Maps-link resolver | `worker/resolve-maps-link.js` |

The Firebase browser configuration in `index.html` identifies the Firebase project; it is not an authentication secret. TripMap signs each browser in anonymously, and the versioned rules in `database.rules.json` deny root access and require an authenticated Firebase session for room reads and writes.

Room codes are bearer credentials rather than user accounts: an authenticated browser that knows a room code can access that room. Newly generated codes contain 144 random bits and invite links keep the code in the URL fragment, which browsers do not send to the static host in an HTTP request. Do not publish room codes or invite URLs. The original `philippou-megan-8x4q` room remains a legacy compatibility path and should not be considered private because its code exists in the public source history.

## Run locally

Serve the repository over HTTP because service workers, fetches, and browser storage do not behave correctly when `index.html` is opened directly from disk.

```sh
python3 -m http.server 8765
```

Then open `http://localhost:8765`.

For UI testing without creating an anonymous Firebase identity or touching live data, open `http://localhost:8765/?offline=1`. This switch is accepted only on localhost.

## Validate changes

Node.js 20 or newer is required. The project has no npm dependencies, so installation is unnecessary.

```sh
npm test
```

The command validates all JSON and JavaScript entry points, checks that every indexed trip definition exists, verifies the authenticated database-rule boundary, and runs unit tests for parsing, migrations, date calculations, geocoder framing, room invitations, record conversion, and Worker URL restrictions. GitHub Actions runs the same command for pushes and pull requests.

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
4. Set `RESOLVE_WORKER_URL` in `index.html` to the deployed HTTPS Worker URL.
5. Keep the existing client-side fallbacks until the Worker has been observed in production.

TripMap tries the configured Worker first. When a mobile share includes a place name or address as well as its short URL, that text is retained as a geocoding fallback. A copied short URL contains no such metadata, so reliable resolution of copied links still requires the deployed Worker.

Deployment and wiring are intentionally separate from this repository baseline: committing the Worker does not change production infrastructure.

## Firebase security rollout

Authentication and database rules must be rolled out in this order. Applying the rules first will lock the existing client out.

1. Export every important trip through TripMap and save the currently deployed Firebase rules separately as a rollback artifact.
2. In Firebase Console, enable **Authentication → Sign-in method → Anonymous**.
3. Deploy the updated static app while leaving the existing database rules in place.
4. Verify that two browsers can load and edit an existing trip and that Firebase Authentication shows anonymous users.
5. Use **Create private room** in TripMap. It copies the currently open trip into a new random room. Test its fragment-based invite on the second browser.
6. Deploy `database.rules.json` to the `tripmap-48cc1` project:

   ```sh
   firebase deploy --only database --project tripmap-48cc1
   ```

7. Confirm that an unauthenticated REST request is rejected and authenticated TripMap clients can still read and write.
8. Open each important trip in the updated app. A legacy places array is converted atomically to an ID-keyed record on first load.
9. Move collaborators away from the legacy room, then stop sharing or using its embedded code.

To roll back, redeploy the rules artifact saved in step 1 and redeploy the previous static version. The previous application already reads ID-keyed place records through `Object.values`, so the place conversion is backward-readable. It may write the data back as an array on a later edit, which is acceptable during a rollback.

The checked-in rules provide authenticated bearer-room access, not named accounts, revocable invitations, or per-user membership. Those features require a trusted invitation service or callable backend and belong in a later security phase.

Firebase references: [anonymous web authentication](https://firebase.google.com/docs/auth/web/anonymous-auth) and [Realtime Database security rules](https://firebase.google.com/docs/database/security/get-started).

## Data model and current limitations

Shared records live below `rooms/{room}/trips/{trip}`. Places are stored below `places/{placeId}` and normal additions, edits, visited toggles, geocoded locality updates, repositioning, deletion, undo, and bulk imports update only the affected children. Explicit JSON import remains a deliberate full-collection replacement. Legacy arrays are accepted and converted to an ID-keyed record on load.

Local caches are namespaced by room and trip. Existing room-agnostic caches are adopted only by the original legacy room; they are never reused when joining a different room. This prevents cached data from one room being displayed or uploaded into another.

Photos are currently stored as base64 data inside place records. IndexedDB avoids the small browser local-storage limit, but shared records can still become large. Moving original images and thumbnails to object storage is another planned migration.

Do not change the live Firebase structure, rules, or room behaviour without a migration and rollback plan for existing trip data.
