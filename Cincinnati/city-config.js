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
   * Greater Cincinnati + Northern Kentucky (launch shell).
   * Replace OTP / GTFS-RT URLs when your Cincy+NKY graph and feeds are live.
   * Map tile key: use referrer-restricted public token only; never ship server-only secrets here.
   */
  cincinnati: {
    cityName: "Cincinnati",
    state: "OH",
    timezone: "America/New_York",

    // Public-style map identifier (MetroFeed-hosted tiles); restrict in tile provider dashboard by domain.
    apiKey: "2C4447D4A42083BCD84DE3B8E",
    // TODO: point to your Cincinnati OTP router when deployed (same pattern as Boston).
    otpApi: "https://otp.metrofeedus.com/otp/transmodel/v3",
    otpGtfsGraphql: "https://otp.metrofeedus.com/otp/gtfs/v1",
    busApi: null,

    defaultCenter: [-84.512, 39.103],
    defaultZoom: 11,
    bounds: {
      north: 39.35,
      south: 38.95,
      east: -84.35,
      west: -84.75
    },
    maxExtendedBounds: {
      north: 39.55,
      south: 38.75,
      east: -84.15,
      west: -85.05
    },
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
    realtimeTripsUrl: "https://routes.metrofeedus.com/realtime/cincinnati/trips.json",
    realtimeAlertsUrl: "https://routes.metrofeedus.com/realtime/cincinnati/alerts.json",
    gtfsRtStrictVehicleDirection: true,
    // Cincinnati: route JSON shape point order may be opposite of rider-facing dir0/dir1.
    // When direction is missing and we infer from GPS bearing, flip 0↔1 so buses land on correct inbound/outbound overlays.
    gtfsRtFlipInferredDirection: true,
    // Stop marker styling: directional "pin + fin" (rotates along route direction at each stop).
    directionalStopMarkers: true,
    // When direction is missing from the feed, do not show the bus unless GPS bearing can infer 0/1 (avoids "every dir" matches).
    gtfsRtExcludeVehicleIfBearingUnknown: true,
    // Only show vehicles whose live trip serves at least N stops on this route+direction sheet (Metro branch pages are narrower than "all route 4").
    gtfsRtFilterVehiclesByTripStopOverlap: true,
    gtfsRtTripStopOverlapMin: 2,

    // Static per-route JSON hosting
    routeDataBase: "https://routes.metrofeedus.com/route_data/cincinnati/",

    // Multi-agency bus modal tabs (Metro / TANK)
    busModalSystems: [
      { id: "metro", label: "Metro", idPrefix: "sorta_" },
      { id: "tank", label: "TANK", idPrefix: "tank_" }
    ],

    showRailRoutes: false,

    useLazyLoading: false
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

// Export for use in template
window.CITIES = CITIES;
window.getCityConfig = getCityConfig;
window.getCityIdFromPath = getCityIdFromPath;

