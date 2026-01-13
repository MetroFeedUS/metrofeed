'use strict';

/**
 * Shared MetroFeed Map Initialization Module
 * 
 * Provides consistent map setup for both the main map (portlandindex.html)
 * and the Traffic Cameras Editor page.
 * 
 * Usage:
 *   const mapSetup = initMetroFeedMap('map', {
 *     defaultCenter: [-122.6784, 45.5152],
 *     defaultZoom: 12,
 *     bounds: { west: -123.0, east: -122.4, south: 45.4, north: 45.65 }
 *   });
 * 
 * Returns: { map, dayStyle, nightStyle }
 */

function initMetroFeedMap(containerId, options) {
  // Handle default options
  options = options || {};

  // Default configuration (Portland)
  const defaults = {
    defaultCenter: [-122.6784, 45.5152],
    defaultZoom: 12,
    maxZoom: 18,
    minZoom: 8,
    bounds: {
      west: -123.0,
      east: -122.4,
      south: 45.4,
      north: 45.65
    }
  };

  // Merge options with defaults
  const config = {
    defaultCenter: options.defaultCenter || defaults.defaultCenter,
    defaultZoom: options.defaultZoom || defaults.defaultZoom,
    maxZoom: options.maxZoom || defaults.maxZoom,
    minZoom: options.minZoom || defaults.minZoom,
    bounds: options.bounds || defaults.bounds
  };

  // Map style URLs (from config if available, otherwise defaults)
  const dayStyle = options.dayStyle || 'https://maps.metrofeedus.com/styles/0/style.json';
  const nightStyle = options.nightStyle || 'https://maps.metrofeedus.com/styles/1/style.json';

  // Transform request to force HTTPS and remove city path prefixes for metrofeedus.com resources
  // This fixes mixed content errors and removes city path prefixes from tile URLs
  const transformRequest = (url, resourceType) => {
    if (!url || !url.includes('metrofeedus.com')) {
      return { url: url };
    }
    
    // Convert http:// to https://
    if (url.startsWith('http://')) {
      url = url.replace('http://', 'https://');
    }
    
    // Remove city path prefixes and ports from tiles.metrofeedus.com URLs
    if (url.includes('tiles.metrofeedus.com')) {
      // Remove /louisville or /portland path prefixes
      url = url.replace(/\/louisville\//g, '/').replace(/\/portland\//g, '/');
      
      // Remove port numbers (e.g., :8441, :8442)
      url = url.replace(/tiles\.metrofeedus\.com:\d+/, 'tiles.metrofeedus.com');
    }
    
    return { url: url };
  };

  // Create map instance
  const map = new maplibregl.Map({
    container: containerId,
    style: dayStyle,
    center: config.defaultCenter,
    zoom: config.defaultZoom,
    maxZoom: config.maxZoom,
    minZoom: config.minZoom,
    maxBounds: [
      [config.bounds.west, config.bounds.south],
      [config.bounds.east, config.bounds.north]
    ],
    attributionControl: true,
    transformRequest: transformRequest
  });

  // Force attribution to be collapsed by default
  map.on('load', () => {
    const attributionControl = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
    if (attributionControl) {
      attributionControl.classList.add('maplibregl-compact');
      attributionControl.classList.remove('maplibregl-compact-show');
    }
  });

  // Also ensure attribution is collapsed after style changes
  map.on('styledata', () => {
    setTimeout(() => {
      const attributionControl = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
      if (attributionControl) {
        attributionControl.classList.add('maplibregl-compact');
        attributionControl.classList.remove('maplibregl-compact-show');
      }
    }, 100);
  });

  // Return map and style references
  return {
    map: map,
    dayStyle: dayStyle,
    nightStyle: nightStyle
  };
}

// Export to window for global access
window.initMetroFeedMap = initMetroFeedMap;
