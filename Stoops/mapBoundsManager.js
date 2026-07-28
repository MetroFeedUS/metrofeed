/**
 * Map Bounds Manager
 * 
 * Dynamically adjusts map maxBounds to accommodate routes that extend beyond
 * the default city bounds (e.g., commuter rail lines, extended bus routes).
 * 
 * Strategy:
 * - Default bounds remain tight for 90% of use cases
 * - When routes extend beyond bounds, temporarily expand maxBounds
 * - Reset to default bounds when all routes are cleared
 * - Optionally auto-fit map to show all active routes
 */

(function() {
  'use strict';

  // Store default bounds for reset
  let defaultBounds = null;
  let mapInstance = null;
  let extendedBounds = null;
  let maxExtendedBounds = null; // Maximum allowed extended bounds (e.g., full service area)

  /**
   * Initialize the bounds manager
   * @param {Object} map - MapLibre map instance
   * @param {Object} defaultBoundsConfig - Default bounds {west, east, south, north}
   * @param {Object} maxExtendedBoundsConfig - Optional maximum extended bounds {west, east, south, north}
   *                                          If not provided, will be calculated from route extents
   */
  function initBoundsManager(map, defaultBoundsConfig, maxExtendedBoundsConfig = null) {
    mapInstance = map;
    defaultBounds = defaultBoundsConfig;
    extendedBounds = null;
    
    // Set maximum extended bounds (e.g., full service area: Boston to Providence, RI)
    // If not provided, will allow expansion based on route extents
    maxExtendedBounds = maxExtendedBoundsConfig;
    
    console.log('[MapBoundsManager] Initialized with default bounds:', defaultBounds);
    if (maxExtendedBounds) {
      console.log('[MapBoundsManager] Maximum extended bounds set:', maxExtendedBounds);
    }
  }

  /**
   * Calculate the extent of all active route overlays
   * @param {Object} activeRouteOverlays - Object of active route overlays
   * @param {Object} activeRouteOverlayDescriptors - Object of route descriptors with routeData
   * @returns {Object|null} - Extended bounds {west, east, south, north} or null if no routes
   */
  function calculateRouteExtent(activeRouteOverlays, activeRouteOverlayDescriptors) {
    if (!activeRouteOverlayDescriptors || Object.keys(activeRouteOverlayDescriptors).length === 0) {
      return null;
    }

    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let hasRoutes = false;

    // Iterate through all route descriptors to find the full extent
    Object.values(activeRouteOverlayDescriptors).forEach(descriptor => {
      if (!descriptor || !descriptor.options || !descriptor.options.routeData) {
        return;
      }

      const routeData = descriptor.options.routeData;
      const shapes = routeData.shapes || (routeData.shape ? [routeData.shape] : []);

      shapes.forEach(shape => {
        if (!Array.isArray(shape) || shape.length === 0) {
          return;
        }

        shape.forEach(coord => {
          if (Array.isArray(coord) && coord.length >= 2) {
            const [lat, lon] = coord; // Route data is [lat, lon]
            minLon = Math.min(minLon, lon);
            maxLon = Math.max(maxLon, lon);
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            hasRoutes = true;
          }
        });
      });
    });

    if (!hasRoutes) {
      return null;
    }

    // Add padding (5% on each side)
    const lonPadding = (maxLon - minLon) * 0.05;
    const latPadding = (maxLat - minLat) * 0.05;

    return {
      west: minLon - lonPadding,
      east: maxLon + lonPadding,
      south: minLat - latPadding,
      north: maxLat + latPadding
    };
  }

  /**
   * Check if route extent extends beyond default bounds
   * @param {Object} routeExtent - Route extent {west, east, south, north}
   * @returns {boolean}
   */
  function extendsBeyondDefaultBounds(routeExtent) {
    if (!routeExtent || !defaultBounds) {
      return false;
    }

    return (
      routeExtent.west < defaultBounds.west ||
      routeExtent.east > defaultBounds.east ||
      routeExtent.south < defaultBounds.south ||
      routeExtent.north > defaultBounds.north
    );
  }

  /**
   * Calculate expanded bounds that include both default and route extents
   * Clamps to maximum extended bounds if set
   * @param {Object} routeExtent - Route extent {west, east, south, north}
   * @returns {Object} - Expanded bounds (clamped to maxExtendedBounds if set)
   */
  function calculateExpandedBounds(routeExtent) {
    if (!routeExtent || !defaultBounds) {
      return defaultBounds;
    }

    let expanded = {
      west: Math.min(defaultBounds.west, routeExtent.west),
      east: Math.max(defaultBounds.east, routeExtent.east),
      south: Math.min(defaultBounds.south, routeExtent.south),
      north: Math.max(defaultBounds.north, routeExtent.north)
    };

    // Clamp to maximum extended bounds if set (prevents panning to irrelevant areas)
    if (maxExtendedBounds) {
      expanded = {
        west: Math.max(maxExtendedBounds.west, expanded.west),
        east: Math.min(maxExtendedBounds.east, expanded.east),
        south: Math.max(maxExtendedBounds.south, expanded.south),
        north: Math.min(maxExtendedBounds.north, expanded.north)
      };
    }

    return expanded;
  }

  /**
   * Update map maxBounds based on active routes
   * @param {Object} activeRouteOverlays - Object of active route overlays
   * @param {Object} activeRouteOverlayDescriptors - Object of route descriptors
   * @param {Object} options - Options {autoFit: boolean, padding: number}
   */
  function updateBoundsForRoutes(activeRouteOverlays, activeRouteOverlayDescriptors, options = {}) {
    if (!mapInstance || !defaultBounds) {
      console.warn('[MapBoundsManager] Not initialized');
      return;
    }

    const routeExtent = calculateRouteExtent(activeRouteOverlays, activeRouteOverlayDescriptors);

    if (!routeExtent) {
      // No routes active - reset to default bounds
      if (extendedBounds) {
        console.log('[MapBoundsManager] No routes active, resetting to default bounds');
        mapInstance.setMaxBounds([
          [defaultBounds.west, defaultBounds.south],
          [defaultBounds.east, defaultBounds.north]
        ]);
        extendedBounds = null;
      }
      return;
    }

    // Check if routes extend beyond default bounds
    if (extendsBeyondDefaultBounds(routeExtent)) {
      const expandedBounds = calculateExpandedBounds(routeExtent);
      extendedBounds = expandedBounds;

      console.log('[MapBoundsManager] Routes extend beyond default bounds, expanding maxBounds');
      console.log('[MapBoundsManager] Default:', defaultBounds);
      console.log('[MapBoundsManager] Route extent:', routeExtent);
      console.log('[MapBoundsManager] Expanded bounds:', expandedBounds);

      // Update maxBounds to allow panning to extended routes
      mapInstance.setMaxBounds([
        [expandedBounds.west, expandedBounds.south],
        [expandedBounds.east, expandedBounds.north]
      ]);

      // Optionally auto-fit to show all routes
      if (options.autoFit !== false) {
        const bounds = new maplibregl.LngLatBounds();
        bounds.extend([routeExtent.west, routeExtent.south]);
        bounds.extend([routeExtent.east, routeExtent.north]);

        const padding = options.padding || 40;
        mapInstance.fitBounds(bounds, {
          padding: padding,
          maxZoom: options.maxZoom || 12,
          duration: options.duration || 1000
        });
      }
    } else {
      // Routes are within default bounds - reset if we had extended bounds
      if (extendedBounds) {
        console.log('[MapBoundsManager] Routes within default bounds, resetting maxBounds');
        mapInstance.setMaxBounds([
          [defaultBounds.west, defaultBounds.south],
          [defaultBounds.east, defaultBounds.north]
        ]);
        extendedBounds = null;
      }
    }
  }

  /**
   * Reset bounds to default
   */
  function resetToDefaultBounds() {
    if (!mapInstance || !defaultBounds) {
      return;
    }

    console.log('[MapBoundsManager] Resetting to default bounds');
    mapInstance.setMaxBounds([
      [defaultBounds.west, defaultBounds.south],
      [defaultBounds.east, defaultBounds.north]
    ]);
    extendedBounds = null;
  }

  /**
   * Get current bounds state
   * @returns {Object} - {isExtended: boolean, currentBounds: Object, defaultBounds: Object}
   */
  function getBoundsState() {
    return {
      isExtended: extendedBounds !== null,
      currentBounds: extendedBounds || defaultBounds,
      defaultBounds: defaultBounds
    };
  }

  // Export to window
  window.MapBoundsManager = {
    init: initBoundsManager,
    updateForRoutes: updateBoundsForRoutes,
    reset: resetToDefaultBounds,
    getState: getBoundsState
  };

})();

