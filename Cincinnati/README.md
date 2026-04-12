# MetroFeed — Cincinnati (Greater Cincinnati + NKY shell)

This folder is a **copy of the Boston stack** with **Cincinnati `city-config`** entries and **no `route_data`** yet. Use it as the launch surface for SORTA / TANK (and future OTP) without deleting the Boston workbench.

## Config

- Path-based city id: open **`/Cincinnati/home.html`** so `getCityIdFromPath()` resolves to **`cincinnati`** (see `city-config.js` in this folder — same `CITIES` object as Boston, including the `cincinnati` block).
- Edit the **`cincinnati`** entry in `city-config.js` when OTP, GTFS-RT, and tile keys are ready.

## Live vehicles

- `busApiType: "none"` until you add a parser + URLs (e.g. per-agency GTFS-RT). The map and OTP UI still load; buses are not drawn.

## Route JSON

- Drop generated `route-*.json` files under `route_data/` and replace `routes_index.js` using the same format as Boston.

## Boston-specific UI

- Some copy still says “MBTA” in comments or legacy modal titles; trim over time or gate on `CITY_CONFIG` flags.
