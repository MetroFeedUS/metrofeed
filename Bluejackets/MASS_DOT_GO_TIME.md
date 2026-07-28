# MassDOT Go Time Integration

This document describes how **MassDOT Go Time** (real-time travel time / RTTIS) is integrated into the Boston map.

## Data source

- **Official API:** [https://data-api.massgotime.com/](https://data-api.massgotime.com/)  
  (RESTful API; sign-up: [https://api-signup.massgotime.com/](https://api-signup.massgotime.com/))
- **Frontend:** fetches a single URL from MetroFeed traffic API (no auth needed in browser):
  - `CITY_CONFIG.massdotTrafficLinksUrl` = `https://traffic-api.metrofeedus.com/traffic/links.json`

## Endpoint we call

- **GET** `https://traffic-api.metrofeedus.com/traffic/links.json`  
  Returns a JSON object with a **link-status-list** array.

## Response shape

Example response:

```json
{
  "link-status-list": [
    {
      "network-id": "1",
      "link-id": "0",
      "link-name": "495SB-TTS-34.1-C (1/4)",
      "link-data-type": "actual",
      "link-status": "open",
      "delay": 0,
      "travel-time": 63,
      "travel-time-increase": -19,
      "last-update-time": "2026-03-06T13:17:03"
    }
  ],
  "organization-information": { ... },
  "extended-properties": { ... }
}
```

- **travel-time** is in **seconds**.
- There is **no geometry** in this response; links are not drawn on the map unless geometry is provided by another source.

## Field mapping (frontend)

### Links (link-status-list)

- **Id / name:** `link-id`, `link-name` (API uses hyphenated keys).
- **Status / travel time:** `link-status`, or `travel-time` (seconds). If `travel-time` > 120 we treat it as seconds and convert to minutes for color: ≥15 min → red, ≥8 min → orange, else green.
- **Geometry:** This endpoint does not include geometry. If a link has no coordinates (e.g. from `geometry.coordinates`, `coordinates`, or start/end lat-lon), it is skipped for drawing. So with the current API, the overlay turns on and data is loaded but no lines are drawn until geometry is available from another source.

## Where it's implemented

- **Boston `home.html`**  
  - `fetchMassDOTTrafficData()` – fetches `massdotTrafficLinksUrl` (links.json).  
  - `toTrafficLinkArray()` – extracts array from `link-status-list`.  
  - `displayTrafficLinks()` – builds map layer from links that have geometry; uses `link-id`, `link-name`, `travel-time`, `getLinkStatus()` for color.  
  - `toggleTrafficOverlay()` – turns overlay on/off from the dropdown (Traffic button).  
- **Boston `city-config.js`**  
  - `massdotTrafficLinksUrl` – full URL to links.json.  
  - MassDOT API keys must not live in client-side `city-config.js`; use server-side config or env only.

## What we're missing: geometry

The map can only draw **real** road segments if each link has **coordinates**. Right now the API gives status/travel time but no location.

### What to get from the API (any one of these per link)

The frontend already supports these shapes. Add **one** of them to each item in `link-status-list`:

| Shape | Example | Notes |
|-------|---------|--------|
| **Start/end lat-lon** | `"start_lon": -71.05, "start_lat": 42.35, "end_lon": -71.04, "end_lat": 42.36` | Easiest: two points per segment. |
| **GeoJSON-style** | `"geometry": { "type": "LineString", "coordinates": [[-71.05, 42.35], [-71.04, 42.36], ...] }` | Full centerline; multiple points per link. |
| **Flat arrays** | `"coordinates": [[-71.05, 42.35], [-71.04, 42.36]]` or `"points": [...]` | Same idea as geometry.coordinates. |
| **Alternate names** | `"from_lng", "from_lat", "to_lng", "to_lat"` | Same as start/end, different key names. |

Coordinates are **[longitude, latitude]** (e.g. Boston ≈ -71.06, 42.36).

### Where to get it

- **MetroFeed traffic API** (`traffic-api.metrofeedus.com`): If you control this backend, add one of the fields above to each link (e.g. from your own link geometry DB or from MassDOT).
- **MassDOT Go Time** ([data-api.massgotime.com](https://data-api.massgotime.com/)): Check their docs or support for a **link geometry** endpoint or a reference file that maps `link-id` to coordinates. Some RTTIS systems expose geometry in a separate feed or in extended fields.
- **Static file**: A one-time export of `link-id` → geometry (e.g. `links-geometry.json`) that the frontend or your proxy merges with the live link-status list.

Until geometry is available, the app uses **synthetic geometry** (a grid of short segments around Boston) so all links still show and are colored by status.

---

## Resuming work

1. To change the endpoint: set `massdotTrafficLinksUrl` in `city-config.js`.
2. If the JSON shape changes, update `toTrafficLinkArray()` to read the new array key (e.g. `link-status-list`).
3. If the API adds geometry per link, `getLinkCoordinates()` in `home.html` already reads the shapes above; no code change needed unless you use a new field name.
4. Test: Menu → **Traffic Overlay** on the Boston map; console should show `[fetchMassDOTTrafficData] Fetching ...` and `Links: N items`.
