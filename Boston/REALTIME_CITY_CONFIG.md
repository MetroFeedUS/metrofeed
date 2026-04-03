# City config: realtime / live buses (contract)

This document describes how **`CITY_CONFIG`** (from `city-config.js` via `getCityConfig()`) tells the map **where** live data comes from. **`routeOverlay.js`** stays oriented on **drawing** (lines, markers, ETAs UI); **agency-specific fetch/parse** lives in adapter modules (e.g. **`mbtaRealtime.js`** for Boston).

## Script load order (Boston)

1. `mbtaRealtime.js` — defines `window.mbtaAdapter` and `window.MBTARealtime`.
2. `routeOverlay.js` — reads `window.mbtaAdapter` at load time for MBTA-only code paths.

**Deploy both files** whenever you deploy Boston `home.html` / `premium.html`. If `mbtaRealtime.js` is missing, `window.attachRouteToMap` may still load, but MBTA vehicle/ETA features will not work.

## Config fields used for realtime

| Field | Role |
|--------|------|
| **`busApiType`** | Selects the branch inside `attachRouteToMap` (e.g. `"mbta-gtfs-rt"`, `"trimet"`, `"tarc-gtfs-rt"`). |
| **`busApi`** | Legacy / generic vehicle URL (Boston also uses proxied `.pb` here). |
| **`gtfsRtUrl`** | GTFS-RT **VehiclePositions** protobuf URL (when applicable). |
| **`gtfsRtTripUpdatesUrl`** | GTFS-RT **TripUpdates** protobuf URL (MBTA trip/stop predictions). |
| **`disableGtfsRt`** | When `true`, skips GTFS-RT vehicle fetch for that city (V3-only path where implemented). |

Optional future field (not required today):

| Field | Role |
|--------|------|
| **`realtimeProvider`** | Reserved name if you later want a string key (`"mbta"`, `"trimet"`, …) instead of inferring only from `busApiType`. Can alias the same logic as `busApiType`. |

## `window.mbtaAdapter` (Boston)

Implemented in **`mbtaRealtime.js`**. Shape:

- **`fetchPredictions(routeId, directionId)`** — V3 predictions + stop/vehicle ETA maps.
- **`fetchVehicles(routeId, directionId?)`** — V3 vehicles for markers.
- **`fetchVehiclesFallback(routeId)`** — V3 vehicles without direction filter.
- **`parseVehiclePositions(arrayBuffer)`** — GTFS-RT VehiclePositions → normalized vehicle list.
- **`parseTripUpdates(arrayBuffer)`** — GTFS-RT TripUpdates → stop/trip update maps.

`routeOverlay.js` binds these once at startup; it does not import modules (plain browser scripts).

## Adding a second city (phase 4 / later)

1. Add a city entry in **`city-config.js`** with the right **`busApiType`** and URLs.
2. Add a small **`yourCityRealtime.js`** (or shared `transit/` module) that exposes **`window.yourCityAdapter`** with the **same method names** as `mbtaAdapter` if you want to reuse the same overlay wiring—or extend `routeOverlay.js` with a **`busApiType`** branch that calls your adapter.
3. Load that script **before** `routeOverlay.js` on that city’s HTML pages.

Keep **one adapter per agency**; avoid embedding agency URLs inside `routeOverlay.js` when possible.
