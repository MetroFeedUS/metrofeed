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
    otpApi: "https://otp.metrofeedus.com/otp/routers/default/plan", // (unchanged)
    busApi: "https://developer.trimet.org/ws/v2/vehicles",
    trafficApi: "https://api.tomtom.com/traffic/map/4/tile/flow/relative",
    tomtomKey: "9TeeDQJH1C2OrWARNwqFRDBOzVhatnkU",
    
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
    dayStyle: "https://maps.metrofeedus.com/styles/0/style.json",
    nightStyle: "https://maps.metrofeedus.com/styles/1/style.json",
    
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
    otpApi: "https://otp.metrofeedus.com/otp/routers/default/plan", // (unchanged)
    busApi: "https://tarc.rideralerts.com/InfoPoint/GTFS-Realtime.ashx?Type=VehiclePosition",
    trafficApi: "https://api.tomtom.com/traffic/map/4/tile/flow/relative",
    tomtomKey: "9TeeDQJH1C2OrWARNwqFRDBOzVhatnkU",
    
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
    dayStyle: "https://45.77.209.137:8082/styles/0/style.json",
    nightStyle: "https://45.77.209.137:8082/styles/0/style.json",
    
    // File Paths
    mastermapFile: "mastermap.js",
    logoFile: "Sitelogo.png",
    
    // Bus API Type
    busApiType: "tarc-gtfs-rt",
    
    // GTFS-RT endpoint
    gtfsRtUrl: "https://tarc.rideralerts.com/InfoPoint/GTFS-Realtime.ashx?Type=VehiclePosition"
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
