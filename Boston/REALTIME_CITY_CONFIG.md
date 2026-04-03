# City config: realtime / live buses (contract)

This document describes how **`CITY_CONFIG`** (from `city-config.js` via `getCityConfig()`) tells the map **where** live data comes from.

**Boston:** MBTA GTFS-RT decode + V3 JSON fetch helpers live **inside** **`routeOverlay.js`** (single file so production always has one script to upload; avoids a missing second file leaving `window.attachRouteToMap` never set). The UI parts (ETA panel, `formatOccupancy`, etc.) are in the same file.

**Optional future pattern:** split agency code into **`mbtaRealtime.js`** (or `yourCityRealtime.js`) and load it before `routeOverlay.js` only if your deploy process always ships both files together.

## Deploy (Boston)

- Upload **`routeOverlay.js`** whenever you change bus/overlay behavior.
- **`home.html` / `premium.html`** use `routeOverlay.js?v=20260403` — **bump the `?v=` value** when you deploy a new JS file so browsers and CDNs do not serve an old cached copy.

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
| **`realtimeProvider`** | Reserved name if you later want a string key (`"mbta"`, `"trimet"`, …) instead of inferring only from `busApiType`. |

## Adding a second city (later)

1. Add a city entry in **`city-config.js`** with the right **`busApiType`** and URLs.
2. Either add branches in **`routeOverlay.js`** (same pattern as MBTA/TRIMET) or introduce a small adapter file that **`routeOverlay`** calls based on `busApiType`.

Keep **one clear place** for agency-specific fetch/parse so the map code stays “draw + orchestrate.”
