# City config: realtime / live buses (contract)

How **`CITY_CONFIG`** (from `city-config.js`) drives live vehicle behavior. Map drawing + MBTA fetch/parse live in **`routeOverlay.js`** (bundled as **one file** so deploy cannot “forget” a second script and break `window.attachRouteToMap`).

## Deploy

- Upload **`routeOverlay.js`** with **`home.html` / `premium.html`** (bump `?v=` on the script URL when the JS changes).

## Config fields used for realtime

| Field | Role |
|--------|------|
| **`busApiType`** | Branch inside `attachRouteToMap` (e.g. `"mbta-gtfs-rt"`, `"trimet"`, `"tarc-gtfs-rt"`). |
| **`busApi`** | Vehicle URL (Boston uses proxied `.pb` here too). |
| **`gtfsRtUrl`** | GTFS-RT **VehiclePositions** protobuf URL. |
| **`gtfsRtTripUpdatesUrl`** | GTFS-RT **TripUpdates** protobuf URL. |
| **`disableGtfsRt`** | Skip GTFS-RT vehicle fetch when `true` (V3-only path where implemented). |

Optional future: **`realtimeProvider`** string if you outgrow `busApiType` alone.

## Adding another agency (later)

New city: add **`city-config.js`** entry + either new branches in **`routeOverlay.js`** or a separate adapter file loaded **before** the overlay (only if you commit to always deploying both).
