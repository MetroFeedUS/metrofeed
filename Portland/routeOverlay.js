/**
 * Shared Route Overlay Module
 * 
 * Provides consistent route drawing logic for both:
 * - Individual route HTML pages (route-XXX-dirY.html)
 * - Main Portland map (portlandindex.html) bus overlay
 * 
 * Usage:
 *   const routeOverlay = attachRouteToMap(map, routeId, directionId, {
 *     mode: 'singleRoutePage' | 'mainOverlay',
 *     routeData: { shape: [...], stops: [...] }, // Optional: if not provided, looks up in masterRoutes
 *     routePageUrl: 'pythonbusroutes/route-293-dir1.html' // Optional: for "Open full route page" link
 *   });
 * 
 * Returns: { remove: function() } - call remove() to clean up the overlay
 */

'use strict';

/**
 * Attach a route to a map instance
 * @param {maplibregl.Map} map - MapLibre GL JS map instance
 * @param {string|number} routeId - Route ID or route number
 * @param {number} directionId - Direction ID (0 or 1)
 * @param {Object} options - Configuration options
 * @param {string} options.mode - 'singleRoutePage' or 'mainOverlay'
 * @param {Object} options.routeData - Optional: route data with shape and stops (if not provided, looks up in masterRoutes)
 * @param {string} options.routePageUrl - Optional: URL to full route page
 * @param {string} options.routeColor - Optional: route line color (default: '#0071CE')
 * @param {boolean} options.fitBounds - Optional: whether to fit map to route bounds (default: true for singleRoutePage, false for mainOverlay)
 * @returns {Object} Overlay object with remove() method
 */
function attachRouteToMap(map, routeId, directionId, options) {
  options = options || {};
  const mode = options.mode || 'mainOverlay';
  const routeColor = options.routeColor || '#0071CE';
  const fitBounds = options.fitBounds !== undefined ? options.fitBounds : (mode === 'singleRoutePage');
  
  // Track created elements for cleanup
  const overlayElements = {
    sources: [],
    layers: [],
    markers: [],
    controls: []
  };
  
  // Find route data
  let routeData = options.routeData;
  if (!routeData && typeof masterRoutes !== 'undefined') {
    // Look up route in masterRoutes
    const routeNumber = String(routeId);
    routeData = masterRoutes.find(r => 
      String(r.route_number) === routeNumber && 
      r.direction_id === directionId
    );
  }
  
  if (!routeData || !routeData.shape || !routeData.stops) {
    console.error('[attachRouteToMap] Route data not found for route:', routeId, 'direction:', directionId);
    return {
      remove: function() {}
    };
  }
  
  const shape = routeData.shape;
  const stops = routeData.stops;
  const routeTitle = routeData.route_title || `Route ${routeId}`;
  
  // Wait for map to load if needed
  const addRouteToMap = () => {
    // Add route line
    const routeSourceId = `route-line-${routeId}-${directionId}`;
    const routeLayerId = `route-layer-${routeId}-${directionId}`;
    
    map.addSource(routeSourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: shape.map(coord => [coord[1], coord[0]]) // Convert lat/lon to lon/lat
        }
      }
    });
    overlayElements.sources.push(routeSourceId);
    
    map.addLayer({
      id: routeLayerId,
      type: 'line',
      source: routeSourceId,
      paint: {
        'line-color': routeColor,
        'line-width': 4,
        'line-opacity': 0.7
      }
    });
    overlayElements.layers.push(routeLayerId);
    
    // Fit map to route bounds (only for single route pages)
    if (fitBounds) {
      const bounds = new maplibregl.LngLatBounds();
      shape.forEach(coord => bounds.extend([coord[1], coord[0]]));
      map.fitBounds(bounds, { padding: 20, maxZoom: 12 });
    }
    
    // Add stops
    const nowPT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const nowMins = nowPT.getHours() * 60 + nowPT.getMinutes();
    
    stops.forEach(stop => {
      // Format stop times
      let highlightedTimes = [];
      let foundNext = false;
      
      if (stop.times && Array.isArray(stop.times)) {
        stop.times.forEach(timeStr => {
          let cleanTime = timeStr.trim();
          
          // Handle both "HH:MM:SS" and "H:MM AM/PM" formats
          let schedMins;
          if (cleanTime.includes('AM') || cleanTime.includes('PM')) {
            // "H:MM AM/PM" format
            let [timePart, ampm] = cleanTime.split(' ');
            let [h, m] = timePart.split(':');
            h = parseInt(h, 10);
            m = parseInt(m, 10);
            if (ampm === 'PM' && h !== 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            schedMins = h * 60 + m;
          } else {
            // "HH:MM:SS" format
            let [h, m] = cleanTime.split(':');
            schedMins = parseInt(h, 10) * 60 + parseInt(m, 10);
            // Convert to 12-hour format for display
            let displayH = parseInt(h, 10);
            let ampm = displayH >= 12 ? 'PM' : 'AM';
            if (displayH > 12) displayH -= 12;
            if (displayH === 0) displayH = 12;
            cleanTime = `${displayH}:${m} ${ampm}`;
          }
          
          // Handle next day
          if (schedMins < nowMins && nowMins - schedMins > 720) {
            schedMins += 1440;
          }
          
          if (!foundNext && schedMins >= nowMins) {
            highlightedTimes.push(`<span style="background:#1E90FF; color:#fff; padding:2px 6px; border-radius:6px; font-weight:bold;">${cleanTime}</span>`);
            foundNext = true;
          } else {
            highlightedTimes.push(cleanTime);
          }
        });
      }
      
      // Create stop marker element
      const stopElement = document.createElement('div');
      stopElement.style.width = '12px';
      stopElement.style.height = '12px';
      stopElement.style.backgroundColor = '#1E90FF';
      stopElement.style.borderRadius = '50%';
      stopElement.style.border = '2px solid #fff';
      stopElement.style.opacity = '0.9';
      stopElement.style.cursor = 'pointer';
      
      const stopMarker = new maplibregl.Marker({
        element: stopElement
      });
      stopMarker.setLngLat([stop.lon, stop.lat]);
      
      // Create popup content
      const popupContent = document.createElement('div');
      popupContent.innerHTML = `
        <div style='border:1px solid #1E90FF; border-radius:8px; padding:10px; background:#222; color:#fff; min-width:200px;'>
          <strong style='color:#1E90FF;'>${stop.name || `Stop ${stop.stop_id}`}</strong>
          ${highlightedTimes.length > 0 ? `
            <hr style='border:none; border-top:1px solid #1E90FF; margin:6px 0;'>
            ${highlightedTimes.join("<br>")}
          ` : ''}
        </div>
      `;
      
      const popup = new maplibregl.Popup().setDOMContent(popupContent);
      stopMarker.setPopup(popup);
      stopMarker.addTo(map);
      
      overlayElements.markers.push(stopMarker);
    });
    
    // Add route info panel for main overlay mode
    if (mode === 'mainOverlay' && options.routePageUrl) {
      const routeInfoPanel = document.createElement('div');
      routeInfoPanel.id = `route-info-${routeId}-${directionId}`;
      routeInfoPanel.style.cssText = `
        position: absolute;
        bottom: 20px;
        left: 20px;
        background: rgba(30, 30, 30, 0.95);
        border: 2px solid #1E90FF;
        border-radius: 8px;
        padding: 12px;
        color: #fff;
        z-index: 1000;
        max-width: 300px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      `;
      routeInfoPanel.innerHTML = `
        <div style="margin-bottom: 8px;">
          <strong style="color: #1E90FF; font-size: 1.1em;">${routeTitle}</strong>
        </div>
        <a href="${options.routePageUrl}" 
           style="color: #1E90FF; text-decoration: none; font-weight: bold; display: inline-block; margin-top: 8px;"
           target="_blank">
          Open full route page →
        </a>
      `;
      map.getContainer().appendChild(routeInfoPanel);
      overlayElements.controls.push(routeInfoPanel);
    }
  };
  
  // Add route when map is ready
  if (map.loaded()) {
    addRouteToMap();
  } else {
    map.once('load', addRouteToMap);
  }
  
  // Return cleanup function
  return {
    remove: function() {
      // Remove layers
      overlayElements.layers.forEach(layerId => {
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
      });
      
      // Remove sources
      overlayElements.sources.forEach(sourceId => {
        if (map.getSource(sourceId)) {
          map.removeSource(sourceId);
        }
      });
      
      // Remove markers
      overlayElements.markers.forEach(marker => {
        marker.remove();
      });
      
      // Remove controls
      overlayElements.controls.forEach(control => {
        if (control.parentNode) {
          control.parentNode.removeChild(control);
        }
      });
      
      // Clear arrays
      overlayElements.sources = [];
      overlayElements.layers = [];
      overlayElements.markers = [];
      overlayElements.controls = [];
    }
  };
}

// Export to window for global access
window.attachRouteToMap = attachRouteToMap;

