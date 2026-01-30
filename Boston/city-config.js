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
    busApi: "https://maps.metrofeedus.com/api/mbta/VehiclePositions.pb", // Proxied through VPS
    // trafficApi: Removed - will use state DOT APIs in the future
    
    // Map Settings
    // Downtown Boston center (Park Street/Downtown Crossing area)
    defaultCenter: [-71.0619, 42.3551], // [longitude, latitude] for MapLibre GL JS
    defaultZoom: 11,
    bounds: {
      // Expanded bounds to cover full MBTA system (expanded N, S, E by 40% total):
      // - North: Alewife (Red Line), Wonderland (Blue Line)
      // - South: Braintree (Red Line), Forest Hills (Orange Line)
      // - East: Wonderland/Logan Airport (Blue/Silver Lines)
      // - West: Riverside (Green Line D), Alewife (Red Line)
      north: 42.55,   // Expanded from 42.45 (+0.10, 40% of 0.25 range)
      south: 42.10,   // Expanded from 42.20 (-0.10, 40% of 0.25 range)
      east: -70.74,   // Expanded from -70.90 (+0.16, 40% of 0.40 range)
      west: -71.30    // Unchanged
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
    
    // GTFS-RT endpoints (proxied through VPS to avoid CORS)
    gtfsRtUrl: "https://maps.metrofeedus.com/api/mbta/VehiclePositions.pb",
    // Additional GTFS-RT endpoints (ready for future use):
    gtfsRtTripUpdatesUrl: "https://maps.metrofeedus.com/api/mbta/TripUpdates.pb",
    gtfsRtAlertsUrl: "https://maps.metrofeedus.com/api/mbta/Alerts.pb",
    
    // Lazy loading flag
    useLazyLoading: true
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

