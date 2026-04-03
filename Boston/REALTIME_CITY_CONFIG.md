# City config: realtime / live buses (contract)

This document describes how **`CITY_CONFIG`** (from `city-config.js` via `getCityConfig()`) tells the map **where** live data comes from, and how Boston scripts fit together.

## Boston script order (required)

1. **`mbtaRealtime.js`** — MBTA-only: GTFS-RT protobuf decode, V3 JSON fetches, **`window.mbtaAdapter`** and **`window.MBTARealtime`**.
2. **`routeOverlay.js`** — Shared route overlay + map UI (ETA panel helpers, `attachRouteToMap`). For MBTA it uses **`window.mbtaAdapter`** from step 1.

**Deploy both files** to the same folder as `home.html` / `premium.html`. If **`mbtaRealtime.js`** is missing or fails, **`window.attachRouteToMap`** may still load, but MBTA vehicle/ETA features will not work correctly.

**Cache bust:** HTML references `mbtaRealtime.js?v=…` and `routeOverlay.js?v=…`. **Bump both query strings** when you deploy new JS so CDNs/browsers fetch fresh files.

## Config fields used for realtime

| Field | Role |
|--------|------|
| **`busApiType`** | Selects the branch inside `attachRouteToMap` (e.g. `"mbta-gtfs-rt"`, `"trimet"`, `"tarc-gtfs-rt"`). |
| **`busApi`** | Legacy / generic vehicle URL (Boston also uses proxied `.pb` here). |
| **`gtfsRtUrl`** | GTFS-RT **VehiclePositions** protobuf URL (when applicable). |
| **`gtfsRtTripUpdatesUrl`** | GTFS-RT **TripUpdates** protobuf URL (MBTA trip/stop predictions). |
| **`disableGtfsRt`** | When `true`, skips GTFS-RT vehicle fetch for that city (V3-only path where implemented). |

Optional future field:

| Field | Role |
|--------|------|
| **`realtimeProvider`** | Reserved if you later want a string key (`"mbta"`, `"trimet"`, …) instead of inferring only from `busApiType`. |

## `window.mbtaAdapter` (Boston)

Defined in **`mbtaRealtime.js`**:

- **`fetchPredictions(routeId, directionId)`** — V3 predictions + stop/vehicle ETA maps.
- **`fetchVehicles(routeId, directionId?)`** — V3 vehicles for markers.
- **`fetchVehiclesFallback(routeId)`** — V3 vehicles without direction filter.
- **`parseVehiclePositions(arrayBuffer)`** — GTFS-RT VehiclePositions → normalized vehicle list.
- **`parseTripUpdates(arrayBuffer)`** — GTFS-RT TripUpdates → stop/trip update maps.

`routeOverlay.js` reads these at load time; it does not use ES modules.

## Adding another agency (later)

1. Add **`city-config.js`** entry with **`busApiType`** and URLs.
2. Add **`yourAgencyRealtime.js`** that sets e.g. **`window.yourAgencyAdapter`** with the same method shape as **`mbtaAdapter`** if you want parallel wiring.
3. Branch on **`busApiType`** inside **`routeOverlay.js`** (or a thin orchestrator) to call the right adapter.

Keep agency fetch/parse out of **HTML**; keep **one file per major feature** where practical.
