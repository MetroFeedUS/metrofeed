/**
 * MetroFeed City Configuration
 * 
 * This file contains all city-specific configuration data.
 * To add a new city, create a new entry in the CITIES object.
 * 
 * Usage in template:
 *   const cityId = getCityIdFromPath(); // e.g., "portland", "louisville"
 *   const CITY_CONFIG = CITIES[cityId];
 */

const CITIES = {
  // Portland, Oregon
  portland: {
    // Basic Info
    cityName: "Portland",
    state: "OR",
    timezone: "America/Los_Angeles",
    
    // APIs
    apiKey: "2C4447D4A42083BCD84DE3B8E",
    otpApi: "https://otp.metrofeedus.com/otp/routers/default/plan",
    busApi: "https://developer.trimet.org/ws/v2/vehicles",
    // trafficApi: Removed - will use state DOT APIs in the future
    
    // Map Settings
    defaultCenter: [-122.6784, 45.5152], // [longitude, latitude] for MapLibre GL JS
    defaultZoom: 10.5,
    bounds: {
      north: 45.80,
      south: 45.20,
      east: -122.15,
      west: -123.35
    },
    // Map Tile Styles (base map API)
    dayStyle: "https://tiles.metrofeedus.com/styles/0/style.json",
    nightStyle: "https://tiles.metrofeedus.com/styles/1/style.json",
    
    // File Paths
    mastermapFile: "mastermap.js",
    logoFile: "Sitelogo.png",
    
    // Bus API Type: "trimet" | "tarc-gtfs-rt" | "custom"
    busApiType: "trimet",
    
    // GTFS-RT endpoint (if using GTFS-RT)
    gtfsRtUrl: null
  },
  
  // Louisville, Kentucky
  louisville: {
    // Basic Info
    cityName: "Louisville",
    state: "KY",
    timezone: "America/New_York",
    
    // APIs
    apiKey: "2C4447D4A42083BCD84DE3B8E",
    otpApi: "https://otp.metrofeedus.com/otp/routers/default/plan",
    busApi: "https://tarc.rideralerts.com/InfoPoint/GTFS-Realtime.ashx?Type=VehiclePosition",
    // trafficApi: Removed - will use state DOT APIs in the future
    
    // Map Settings
    defaultCenter: [-85.76, 38.25], // [longitude, latitude] for MapLibre GL JS
    defaultZoom: 10.5,
    bounds: {
      north: 38.5,
      south: 38.0,
      east: -85.4,
      west: -85.9
    },
    // Map Tile Styles (base map API) - Louisville TileServer-GL (custom hosted OpenStreetMap)
    dayStyle: "https://tiles.metrofeedus.com/styles/0/style.json",
    nightStyle: "https://tiles.metrofeedus.com/styles/1/style.json",
    
    // File Paths
    mastermapFile: "mastermap.js",
    logoFile: "Sitelogo.png",
    
    // Bus API Type
    busApiType: "tarc-gtfs-rt",
    
    // GTFS-RT endpoint
    gtfsRtUrl: "https://tarc.rideralerts.com/InfoPoint/GTFS-Realtime.ashx?Type=VehiclePosition"
  },
  
  // Boston, Massachusetts
  boston: {
    // Basic Info
    cityName: "Boston",
    state: "MA",
    timezone: "America/New_York",
    
    // APIs
    apiKey: "2C4447D4A42083BCD84DE3B8E",
    otpApi: "https://otp.metrofeedus.com/otp/transmodel/v3", // Direct endpoint (CORS fixed on server)
    otpGtfsGraphql: "https://otp.metrofeedus.com/otp/gtfs/v1", // Fallback GraphQL endpoint when Transmodel returns no tripPatterns
    busApi: "https://maps.metrofeedus.com/api/mbta/VehiclePositions.pb", // Proxied through VPS
    // Do not put MassDOT or other private API keys in client-side config; use server proxies only.
    // Single endpoint for Go Time link status (link-status-list with travel-time, delay, etc.)
    massdotTrafficLinksUrl: "https://traffic-api.metrofeedus.com/traffic/links.json",
    
    // Map Settings
    // Downtown Boston center (Park Street/Downtown Crossing area)
    defaultCenter: [-71.0619, 42.3551], // [longitude, latitude] for MapLibre GL JS
    defaultZoom: 11,
    bounds: {
      // Default bounds for 90% of use cases (core Boston metro area), then expanded +20% on lat/lon span (same center) for more pan room.
      // - North: Alewife (Red Line), Wonderland (Blue Line)
      // - South: Braintree (Red Line), Forest Hills (Orange Line)
      // - East: Wonderland/Logan Airport (Blue/Silver Lines)
      // - West: Riverside (Green Line D), Alewife (Red Line)
      north: 42.595,
      south: 42.055,
      east: -70.684,
      west: -71.356
    },
    // Maximum extended bounds for full service area (commuter rail, extended routes)
    // Covers ALL MBTA commuter rail lines in ALL directions:
    // - North: Fitchburg Line (Wachusett ~42.7°N), Lowell Line, Haverhill Line, Newburyport/Rockport Lines (~42.8°N)
    // - South: Providence/Stoughton Line (Providence, RI ~41.8°N), Middleborough/Lakeville (~41.8°N), Kingston/Plymouth (~41.9°N), Greenbush (~42.2°N)
    // - East: Greenbush Line (Scituate ~-70.7°E), Rockport Line (Rockport ~-70.6°E), Newburyport Line (~-70.8°E)
    // - West: Worcester Line (Worcester ~-71.8°W), Fitchburg Line (Fitchburg ~-71.8°W), Fairmount Line
    // These bounds ensure users can pan to see any commuter rail route while preventing panning to irrelevant areas
    maxExtendedBounds: {
      north: 43.0,    // Northernmost: Fitchburg Line (Wachusett), Newburyport/Rockport Lines
      south: 41.2,    // Southernmost: Providence, RI (Providence/Stoughton Line), Middleborough/Lakeville, Kingston/Plymouth
      east: -69.5,    // Easternmost: Rockport Line, Newburyport Line, Greenbush Line (Scituate)
      west: -72.2     // Westernmost: Worcester Line (Worcester), Fitchburg Line (Fitchburg)
    },
    // Map Tile Styles (base map API)
    // New England map (shared across multiple cities, bounds locked per city)
    dayStyle: "https://tiles.metrofeedus.com/styles/0/style.json",
    nightStyle: "https://tiles.metrofeedus.com/styles/1/style.json",
    
    // File Paths
    mastermapFile: null, // Boston uses lazy-loading, not mastermap.js
    routesIndexFile: "routes_index.js", // Boston uses routes_index.js
    logoFile: "Sitelogo.png",
    
    // Bus API Type
    busApiType: "mbta-gtfs-rt",
    // GTFS-RT is the primary live-vehicle source; V3 is used for enrichment (ETAs/occupancy) when available
    disableGtfsRt: false,
    
    // GTFS-RT endpoints (proxied through VPS to avoid CORS)
    gtfsRtUrl: "https://maps.metrofeedus.com/api/mbta/VehiclePositions.pb",
    // Additional GTFS-RT endpoints (ready for future use):
    gtfsRtTripUpdatesUrl: "https://maps.metrofeedus.com/api/mbta/TripUpdates.pb",
    gtfsRtAlertsUrl: "https://maps.metrofeedus.com/api/mbta/Alerts.pb",
    
    // Lazy loading flag
    useLazyLoading: true
  },

  /**
   * Test City — Cincinnati stack clone for experiments (bus tracker, OBS, etc.).
   * Map shell is centered on Lexington, KY; transit data/APIs remain Cincinnati so routes
   * and live vehicles still load from the same feeds (pan to Greater Cincinnati to test).
   */
  testcity: {
    cityName: "Test City",
    state: "KY",
    timezone: "America/New_York",

    // Public-style map identifier (MetroFeed-hosted tiles); restrict in tile provider dashboard by domain.
    apiKey: "2C4447D4A42083BCD84DE3B8E",
    // OTP endpoints (Cincinnati deployment — shared with production Cincy).
    otpApi: "https://otp.metrofeedus.com/cincinnati/otp/transmodel/v3",
    otpGtfsGraphql: "https://otp.metrofeedus.com/cincinnati/otp/gtfs/v1",
    busApi: null,

    // Default view: Lexington, KY. Pan limits include full Greater Cincinnati (same as production Cincy).
    defaultCenter: [-84.503, 38.040],
    defaultZoom: 11,
    startupDefaultRouteId: "sorta_4",
    startupDefaultDirectionId: 0,
    // Union of Lexington sandbox + Cincinnati service area (I-75 corridor).
    bounds: {
      north: 39.7114,
      south: 37.4314,
      east: -83.8828,
      west: -85.2172
    },
    maxExtendedBounds: {
      north: 39.9114,
      south: 37.2314,
      east: -83.6828,
      west: -85.5172
    },
    // Ohio road incidents (VPS JSON).
    incidentsFeedUrl: "https://traffic-api.metrofeedus.com/incidents/ohio",
    // Ohio traffic flow / density (VPS JSON).
    flowFeedUrl: "https://traffic-api.metrofeedus.com/flow/ohio",
    // Ohio slowdowns (VPS JSON).
    slowdownsFeedUrl: "https://traffic-api.metrofeedus.com/slowdowns/ohio",
    // Ohio construction (VPS JSON).
    constructionFeedUrl: "https://traffic-api.metrofeedus.com/construction/ohio",
    // Ohio cameras (VPS JSON).
    camerasFeedUrl: "https://traffic-api.metrofeedus.com/cameras/ohio",
    // Pad the visible map bounds by this fraction of width/height when filtering cached incidents (no refetch on pan).
    incidentsViewportPaddingRatio: 0.12,
    dayStyle: "https://tiles.metrofeedus.com/styles/0/style.json",
    nightStyle: "https://tiles.metrofeedus.com/styles/1/style.json",

    // Cincinnati: uses per-route JSON + window.ROUTES (NOT Boston lazy loader)
    mastermapFile: null,
    routesIndexFile: "routes_index.js",
    logoFile: "Sitelogo.png",

    // Realtime: Cincinnati merged GTFS-RT (decoded JSON via VPS proxy)
    busApiType: "gtfs-rt",
    disableGtfsRt: false,
    gtfsRtUrl: null, // legacy single field (unused)
    // Optional second JSON feed (merged with realtimeTripsUrl by trip_id; later URL wins). Use for a **full** trip-updates export so every vehicle trip_id resolves to real stop_updates.
    gtfsRtTripUpdatesUrl: null,
    gtfsRtAlertsUrl: null,
    gtfsRtProxyUrls: [
      "https://routes.metrofeedus.com/realtime/cincinnati/vehicles.json"
    ],
    // Performance: fetch/parse vehicles once and fan-out to all open overlays.
    // Reversible: set to false to return to per-overlay polling.
    useSharedVehicleCache: true,
    sharedVehiclePollMs: 12000,
    realtimeTripsUrl: "https://routes.metrofeedus.com/realtime/cincinnati/trips.json",
    realtimeAlertsUrl: "https://routes.metrofeedus.com/realtime/cincinnati/alerts.json",
    gtfsRtStrictVehicleDirection: true,
    // Legacy: used to flip bearing-only inference. Prefer polyline+tangent matching in routeOverlay instead.
    gtfsRtFlipInferredDirection: false,
    // Stop marker styling: directional "pin + fin" (rotates along route direction at each stop).
    // Disabled for now (stop placement/shape alignment needs deeper work).
    directionalStopMarkers: false,
    // When direction is missing from the feed, do not show the bus unless GPS bearing can infer 0/1 (avoids "every dir" matches).
    gtfsRtExcludeVehicleIfBearingUnknown: true,
    // Only show vehicles whose live trip serves at least N stops on this route+direction sheet (Metro branch pages are narrower than "all route 4").
    gtfsRtFilterVehiclesByTripStopOverlap: true,
    gtfsRtTripStopOverlapMin: 1,
    // Hard safety: only render vehicles within this distance of the route polyline (prevents out-of-area vehicles on same route number).
    busMaxDistanceFromRouteMeters: 1500,

    // Static per-route JSON: same folder as home.html (deploy route_data/ with the city site)
    routeDataBase: "./route_data/",

    // Multi-agency bus modal tabs (Metro / TANK / BCRTA Butler County)
    busModalSystems: [
      { id: "metro", label: "Metro", idPrefix: "sorta_", feedAgency: "sorta" },
      { id: "tank", label: "TANK", idPrefix: "tank_", feedAgency: "tank" },
      { id: "bcrta", label: "BCRTA", idPrefix: "bcrta_", feedAgency: "bcrta" }
    ],

    // Live vehicle marker SVG alignment. bus.svg faces WEST; flip 180° so it faces direction-of-travel.
    busSvgHeadingOffsetDeg: 180,

    /** Test City only: snap position, motion tracker, chevrons, softer opposite-bus styling. */
    busTrackerV2: true,
    busMarkerSnapMaxMeters: 120,
    busMarkerSnapLookaheadSegs: 4,
    busMarkerSnapHysteresisRatio: 0.28,
    busRouteChevronSpacingM: 420,
    /** Spacing of ▸ symbols along the route line (screen pixels, MapLibre symbol-spacing). */
    busRouteArrowSpacingPx: 150,
    busUseMotionDirection: true,
    busSoftOppositeDim: true,

    showRailRoutes: false,

    useLazyLoading: false,

    /** Enable OBS TV at obs-tv.html / home.html?tv=1 */
    tvModeEnabled: true
  }
};

/**
 * Get city ID from current path or URL
 * Assumes folder structure: /CityName/home.html
 */
function getCityIdFromPath() {
  const path = window.location.pathname;
  const match = path.match(/\/([^\/]+)\//);
  if (match) {
    return match[1].toLowerCase();
  }
  // Fallback: try to get from current directory name
  const segments = path.split('/');
  const citySegment = segments[segments.length - 2];
  return citySegment ? citySegment.toLowerCase() : 'portland';
}

/**
 * Get city configuration
 * @param {string} cityId - Optional city ID, defaults to auto-detect
 * @returns {Object} City configuration object
 */
function getCityConfig(cityId) {
  cityId = cityId || getCityIdFromPath();
  const config = CITIES[cityId];
  
  if (!config) {
    console.warn(`[getCityConfig] City "${cityId}" not found, using Portland as default`);
    return CITIES.portland;
  }
  
  return config;
}

/**
 * Cincinnati multi-agency route ids (sorta_, tank_, bcrta_) → display + realtime feed agency key.
 * @param {string} routeId
 * @returns {{ feedAgency: string, label: string, idPrefix: string, digits: string }|null}
 */
function metrofeedAgencyFromRouteId(routeId) {
  const r = String(routeId || "");
  const cfg = typeof getCityConfig === "function" ? getCityConfig() : null;
  const systems = cfg && Array.isArray(cfg.busModalSystems) ? cfg.busModalSystems : [];
  for (let i = 0; i < systems.length; i++) {
    const sys = systems[i];
    const pref = sys && sys.idPrefix ? String(sys.idPrefix) : "";
    if (!pref || !r.startsWith(pref)) continue;
    const feedAgency =
      sys.feedAgency != null && String(sys.feedAgency).trim() !== ""
        ? String(sys.feedAgency).toLowerCase()
        : pref === "sorta_"
          ? "sorta"
          : pref === "tank_"
            ? "tank"
            : pref === "bcrta_"
              ? "bcrta"
              : String(sys.id || "").toLowerCase();
    return {
      feedAgency,
      label: String(sys.label || sys.id || ""),
      idPrefix: pref,
      digits: r.slice(pref.length)
    };
  }
  return null;
}

// Export for use in template
window.CITIES = CITIES;
window.getCityConfig = getCityConfig;
window.getCityIdFromPath = getCityIdFromPath;
window.metrofeedAgencyFromRouteId = metrofeedAgencyFromRouteId;

