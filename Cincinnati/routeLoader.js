/**
 * Route Loader Module for Boston
 * Handles lazy-loading of route data from individual JSON files
 */

(function() {
  'use strict';

  function getRouteDataBase() {
    try {
      const cfg = typeof window !== 'undefined' && window.CITY_CONFIG;
      const raw = cfg && cfg.routeDataBase != null ? String(cfg.routeDataBase).trim() : '';
      if (raw) {
        return raw.endsWith('/') ? raw : raw + '/';
      }
    } catch (e) { /* ignore */ }
    return '/route_data/cincinnati/';
  }

  /**
   * @param {string} filePath - Value from routes_index route entry (`file`)
   * @returns {string} Absolute path on site origin or unchanged http(s) URL
   */
  function resolveRouteDataUrl(filePath) {
    if (filePath == null || filePath === '') {
      return filePath;
    }
    const s = String(filePath).trim();
    if (/^https?:\/\//i.test(s)) {
      return s;
    }
    const routeFile = s.replace(/^.*\//, '');
    const base = getRouteDataBase();
    return base + routeFile;
  }
  
  // In-memory cache for loaded routes
  const routeCache = {};
  
  // Track active requests to prevent race conditions
  const activeRequests = {};
  let requestIdCounter = 0;
  
  // Routes index (loaded on page load)
  let routesIndex = null;
  let routesIndexLoaded = false;
  let routesIndexLoadPromise = null; // Single promise for parallel callers
  /** Set after a script tag for routes_index.js has been injected (success or wrong format). Prevents a second inject. */
  let routesIndexScriptInjected = false;
  const ROUTES_INDEX_SCRIPT_ID = 'metrofeed-routes-index-loader';
  
  /**
   * Load routes_index.js
   * Must be called before any route loading
   */
  function loadRoutesIndex() {
    if (routesIndexLoaded && routesIndex) {
      return Promise.resolve(routesIndex);
    }
    if (routesIndexLoadPromise) {
      return routesIndexLoadPromise;
    }
    if (routesIndexScriptInjected || document.getElementById(ROUTES_INDEX_SCRIPT_ID)) {
      const msg =
        '[routeLoader] routes_index.js was already loaded but did not set window.routesIndex. ' +
        'Lazy-loading requires: window.routesIndex = { version, routes: [...] }. ' +
        'If your file uses const ROUTES = {...} (expansion build), use the correct index or fix the deploy. Hard-refresh after fixing.';
      console.error(msg);
      return Promise.reject(new Error('routes_index.js invalid or already failed; hard-refresh after fixing the file'));
    }
    
    routesIndexLoadPromise = new Promise((resolve, reject) => {
      // Load routes_index.js via script tag (expects global window.routesIndex)
      const script = document.createElement('script');
      script.id = ROUTES_INDEX_SCRIPT_ID;
      script.src = 'routes_index.js?v=' + Date.now(); // Cache bust
      script.onload = () => {
        routesIndexScriptInjected = true;
        if (typeof window.routesIndex !== 'undefined') {
          routesIndex = window.routesIndex;
          routesIndexLoaded = true;
          routesIndexLoadPromise = null;
          console.log('[routeLoader] Routes index loaded:', routesIndex.routes.length, 'routes');
          
          // Check service day
          const serviceCheck = checkServiceDay();
          if (serviceCheck.isHoliday) {
            console.warn(`[routeLoader] ⚠️ Today (${serviceCheck.dayName}) may be a holiday - schedules may differ`);
          }
          
          resolve(routesIndex);
        } else {
          routesIndexLoadPromise = null;
          const hint =
            typeof window.ROUTES !== 'undefined'
              ? ' Loaded script defined window.ROUTES but not window.routesIndex (wrong file for lazy JSON routes).'
              : '';
          console.error(
            '[routeLoader] routes_index.js must assign window.routesIndex = { version, routes: [...] } for lazy loading.' + hint
          );
          reject(new Error('routesIndex not found after loading routes_index.js'));
        }
      };
      script.onerror = () => {
        script.remove();
        routesIndexLoadPromise = null;
        reject(new Error('Failed to load routes_index.js'));
      };
      document.head.appendChild(script);
    });
    return routesIndexLoadPromise;
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
   * Parse version string to date
   * Format: "YYYYMMDD-HHMM" or timestamp
   * @param {string} version - Version string
   * @returns {Date|null} Parsed date or null if invalid
   */
  function parseVersionDate(version) {
    if (!version) return null;
    
    // Try format "YYYYMMDD-HHMM"
    const match = version.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
    if (match) {
      const [, year, month, day, hour, minute] = match;
      return new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1, // Month is 0-indexed
        parseInt(day, 10),
        parseInt(hour, 10),
        parseInt(minute, 10)
      );
    }
    
    // Try timestamp
    const timestamp = parseInt(version, 10);
    if (!isNaN(timestamp)) {
      return new Date(timestamp);
    }
    
    return null;
  }
  
  /**
   * Check if route data is current for today
   * @returns {Object} { isCurrent: boolean, ageDays: number, warning: string|null }
   */
  function validateDataCurrency() {
    if (!routesIndex || !routesIndex.version) {
      return {
        isCurrent: false,
        ageDays: null,
        warning: 'No version information available'
      };
    }
    
    const versionDate = parseVersionDate(routesIndex.version);
    if (!versionDate) {
      return {
        isCurrent: false,
        ageDays: null,
        warning: `Invalid version format: ${routesIndex.version}`
      };
    }
    
    const now = new Date();
    const ageMs = now - versionDate;
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    
    // Consider data stale if older than 7 days
    const isCurrent = ageDays <= 7;
    
    let warning = null;
    if (ageDays > 14) {
      warning = `Route data is ${ageDays} days old (generated ${versionDate.toLocaleDateString()}). Schedules may be inaccurate.`;
    } else if (ageDays > 7) {
      warning = `Route data is ${ageDays} days old. Consider refreshing.`;
    }
    
    return {
      isCurrent,
      ageDays,
      versionDate,
      warning
    };
  }
  
  /**
   * Check if today is a service day based on GTFS service calendar
   * This is a simplified check - full implementation would require calendar.txt
   * @param {Date} date - Date to check (defaults to today)
   * @returns {Object} { isServiceDay: boolean, dayType: string, isHoliday: boolean }
   */
  function checkServiceDay(date = new Date()) {
    const dayOfWeek = date.getDay(); // 0=Sunday, 6=Saturday
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayType = dayOfWeek === 0 ? 'sunday' : (dayOfWeek === 6 ? 'saturday' : 'weekday');
    
    // Simple holiday check (could be expanded with a holiday calendar)
    // Common US holidays that might affect transit
    const month = date.getMonth();
    const day = date.getDate();
    const year = date.getFullYear();
    
    // New Year's Day, Independence Day, Christmas
    const isHoliday = (
      (month === 0 && day === 1) || // Jan 1
      (month === 6 && day === 4) || // Jul 4
      (month === 11 && day === 25)  // Dec 25
    );
    
    return {
      isServiceDay: !isHoliday, // Simplified - assumes holidays use Sunday schedule
      dayType,
      dayName: dayNames[dayOfWeek],
      isHoliday
    };
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
      // Build URL with cache busting (routes_index `file` basename + Cincinnati route data root)
      const version = getVersion();
      const filePath = routeEntry.file;
      const resolvedPath = resolveRouteDataUrl(filePath);
      const url = `${resolvedPath}?v=${encodeURIComponent(version)}`;
      
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
      
      // Validate route data currency
      if (routeData.meta && routeData.meta.generated_date) {
        // Route data loaded successfully
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
    getRouteDataBase,
    resolveRouteDataUrl,
    loadRoute,
    loadRoutesIndex,
    getRoutesIndex,
    isRoutesIndexLoaded,
    clearCache,
    getCacheStats,
    validateDataCurrency,
    checkServiceDay,
    parseVersionDate
  };
  
  console.log('[routeLoader] Module initialized');
})();

