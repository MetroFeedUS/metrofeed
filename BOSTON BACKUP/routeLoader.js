/**
 * Route Loader Module for Boston
 * Handles lazy-loading of route data from individual JSON files
 */

(function() {
  'use strict';
  
  // In-memory cache for loaded routes
  const routeCache = {};
  
  // Track active requests to prevent race conditions
  const activeRequests = {};
  let requestIdCounter = 0;
  
  // Routes index (loaded on page load)
  let routesIndex = null;
  let routesIndexLoaded = false;
  
  /**
   * Load routes_index.js
   * Must be called before any route loading
   */
  function loadRoutesIndex() {
    return new Promise((resolve, reject) => {
      if (routesIndexLoaded && routesIndex) {
        resolve(routesIndex);
        return;
      }
      
      // Load routes_index.js via script tag (expects global routesIndex)
      const script = document.createElement('script');
      script.src = 'routes_index.js?v=' + Date.now(); // Cache bust
      script.onload = () => {
        if (typeof window.routesIndex !== 'undefined') {
          routesIndex = window.routesIndex;
          routesIndexLoaded = true;
          console.log('[routeLoader] Routes index loaded:', routesIndex.routes.length, 'routes');
          resolve(routesIndex);
        } else {
          reject(new Error('routesIndex not found after loading routes_index.js'));
        }
      };
      script.onerror = () => {
        reject(new Error('Failed to load routes_index.js'));
      };
      document.head.appendChild(script);
    });
  }
  
  /**
   * Get version string for cache busting
   */
  function getVersion() {
    if (routesIndex && routesIndex.version) {
      return routesIndex.version;
    }
    // Fallback to timestamp if version missing
    return Date.now().toString();
  }
  
  /**
   * Load a single route's data
   * @param {string} routeId - Route ID (e.g., "1", "Red", "CR-Fitchburg")
   * @param {number} directionId - Direction ID (0 or 1)
   * @returns {Promise<Object>} Route data object
   */
  async function loadRoute(routeId, directionId) {
    // Ensure routes index is loaded first
    if (!routesIndexLoaded) {
      await loadRoutesIndex();
    }
    
    // Check cache first
    const cacheKey = `${routeId}_${directionId}`;
    if (routeCache[cacheKey]) {
      console.log('[routeLoader] Route from cache:', cacheKey);
      return routeCache[cacheKey];
    }
    
    // Find route in index
    const routeEntry = routesIndex.routes.find(r => 
      r.route_id === String(routeId) && r.direction_id === directionId
    );
    
    if (!routeEntry) {
      throw new Error(`Route not found: ${routeId} direction ${directionId}`);
    }
    
    // Generate unique request ID for race condition handling
    const requestId = ++requestIdCounter;
    activeRequests[cacheKey] = requestId;
    
    try {
      // Build URL with cache busting
      const version = getVersion();
      const filePath = routeEntry.file;
      const url = `${filePath}?v=${version}`;
      
      console.log('[routeLoader] Fetching route:', url);
      
      // Fetch with timeout (30 seconds)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // Check if this request is still current
      if (activeRequests[cacheKey] !== requestId) {
        console.log('[routeLoader] Request outdated, ignoring:', cacheKey);
        throw new Error('Request superseded by newer request');
      }
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Route file not found: ${filePath}`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const routeData = await response.json();
      
      // Validate response is still current
      if (activeRequests[cacheKey] !== requestId) {
        console.log('[routeLoader] Response outdated, ignoring:', cacheKey);
        throw new Error('Response superseded by newer request');
      }
      
      // Cache the route data
      routeCache[cacheKey] = routeData;
      
      // Clean up active request tracking
      delete activeRequests[cacheKey];
      
      console.log('[routeLoader] Route loaded and cached:', cacheKey);
      return routeData;
      
    } catch (error) {
      // Clean up on error
      delete activeRequests[cacheKey];
      
      if (error.name === 'AbortError') {
        throw new Error('Request timed out after 30 seconds');
      }
      
      throw error;
    }
  }
  
  /**
   * Get routes index (metadata only)
   * @returns {Object} Routes index with version and routes array
   */
  function getRoutesIndex() {
    if (!routesIndexLoaded) {
      throw new Error('Routes index not loaded yet. Call loadRoutesIndex() first.');
    }
    return routesIndex;
  }
  
  /**
   * Check if routes index is loaded
   * @returns {boolean}
   */
  function isRoutesIndexLoaded() {
    return routesIndexLoaded && routesIndex !== null;
  }
  
  /**
   * Clear route cache (useful for testing or forced refresh)
   */
  function clearCache() {
    Object.keys(routeCache).forEach(key => delete routeCache[key]);
    console.log('[routeLoader] Cache cleared');
  }
  
  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  function getCacheStats() {
    return {
      cachedRoutes: Object.keys(routeCache).length,
      activeRequests: Object.keys(activeRequests).length
    };
  }
  
  // Export to window for global access
  window.routeLoader = {
    loadRoute,
    loadRoutesIndex,
    getRoutesIndex,
    isRoutesIndexLoaded,
    clearCache,
    getCacheStats
  };
  
  console.log('[routeLoader] Module initialized');
})();

