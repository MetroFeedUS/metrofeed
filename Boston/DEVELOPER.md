# MetroFeed Boston — developer & handoff guide

This is the **instruction manual** for someone joining the project, doing maintenance, or evaluating the codebase. It complements **`README.md`** (template overview) with **how Boston is wired** and **where to change things**.

## What you are looking at

- **Static site:** HTML + plain `.js` files loaded with `<script src="...">`. No build step is required to run Boston locally.
- **Config-driven:** `city-config.js` exposes `getCityConfig()`. The active city is inferred from the URL path (e.g. `/boston/home.html` → Boston block in `CITIES`).
- **Large `home.html`:** Most UI and page logic still lives here. Over time, prefer moving **new** features into separate `.js` files and keeping `home.html` as the shell that loads them.

## Run locally

1. Open `home.html` in a browser **or** serve the folder (recommended so module paths behave like production):
   ```bash
   cd Boston
   python -m http.server 8080
   ```
   Then visit `http://localhost:8080/home.html`.

2. **Premium** tier uses `premium.html` instead.

## Deploy checklist (Boston)

Upload **together** when you change map/transit behavior:

| File | Role |
|------|------|
| `home.html` / `premium.html` | Page shell, script tags, cache-bust `?v=` on JS |
| `city-config.js` | APIs, bounds, `busApiType`, GTFS URLs |
| `mbtaRealtime.js` | MBTA GTFS-RT decode + V3 fetches; sets `window.mbtaAdapter` |
| `routeOverlay.js` | Route lines, stops UI, bus markers orchestration; uses `mbtaAdapter` for MBTA |

If **`mbtaRealtime.js`** is missing on the server, MBTA live features break; **`routeOverlay.js`** may still load, but `attachRouteToMap` depends on the overlay script completing—always verify after deploy.

**Bump** the `?v=` query string on `mbtaRealtime.js` and `routeOverlay.js` in HTML when you deploy new JS so caches refresh.

## Script load order (map stack)

Order matters. In `home.html`, after MapLibre:

1. `metroFeedMap.js`, `mapBoundsManager.js`, `cameraIcon.js`
2. **`mbtaRealtime.js`** (must be before route overlay)
3. **`routeOverlay.js`** → defines **`window.attachRouteToMap`**
4. `otp.js`, `trafficCamerasOverlay.js`, etc.

See comments in `home.html` above those tags. For **what each config field means** for buses, read **`REALTIME_CITY_CONFIG.md`**.

## Where logic lives (mental map)

| Concern | Primary files |
|--------|----------------|
| City APIs, keys, bounds | `city-config.js` |
| MBTA protobuf + V3 HTTP | `mbtaRealtime.js` (`window.mbtaAdapter`) |
| Drawing route on map, bus markers, ETA panel UI | `routeOverlay.js` |
| OTP / trip planning | `otp.js` |
| Traffic cameras layer | `trafficCamerasOverlay.js` |
| Strings / i18n | `translations.js` |
| Route list data | `routes_index.js` (and loaders) |

## Security note

API keys appear in **`city-config.js`** in this repo. For a sale or public repo, plan to **rotate keys** and move secrets to **server-side proxies** (you already proxy some MBTA traffic through `maps.metrofeedus.com`).

## Deeper topics

- **Realtime contract (URLs, `busApiType`, adapter shape):** `REALTIME_CITY_CONFIG.md`
- **Route branches / GTFS pipeline (longer-term):** `ROUTE_BRANCHES_PLAN.md`

## Code comments in the tree

Complex areas include **inline “tooltip” blocks** (especially `routeOverlay.js` bus tracking and `mbtaRealtime.js` vehicle parser). Those are meant for the **next developer**, not for end users.
