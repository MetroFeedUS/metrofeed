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
  - `massdotApiKey` – kept for reference only; not sent from the client.

## Resuming work

1. To change the endpoint: set `massdotTrafficLinksUrl` in `city-config.js`.
2. If the JSON shape changes, update `toTrafficLinkArray()` to read the new array key (e.g. `link-status-list`).
3. If the API adds geometry per link, extend `getLinkCoordinates()` in `home.html` to read it so links can be drawn.
4. Test: Menu → **Traffic Overlay** on the Boston map; console should show `[fetchMassDOTTrafficData] Fetching ...` and `Links: N items`.
