/**
 * MetroFeed Route Overlay Module (clean version)
 *
 * Shared route drawing logic for:
 *  - Individual route HTML pages (route-XXX-dirY.html)
 *  - Main Portland map (bus overlay on portlandindex.html)
 *
 * USAGE EXAMPLES
 * --------------
 * // On a route page (small embedded map)
 * const routeOverlay = attachRouteToMap(map, "15", 0, {
 *   mode: "singleRoutePage",
 *   routeData: routeDataFromThisPage,
 *   routePageUrl: "pythonbusroutes/route-15-dir0.html"
 * });
 *
 * // On the main city map (overlay)
 * const routeOverlay = attachRouteToMap(mainMap, "15", 0, {
 *   mode: "mainOverlay",
 *   routeData: someRouteDataObject,
 *   routePageUrl: "pythonbusroutes/route-15-dir0.html",
 *   fitBounds: false
 * });
 *
 * routeOverlay.remove(); // cleans up layers, markers, panel
 */

"use strict";

// MBTA realtime: mbtaRealtime.js must load before this file (Boston / MBTA maps).
const mbtaAdapter = window.mbtaAdapter;
if (typeof mbtaAdapter === "undefined") {
  console.warn("[routeOverlay] window.mbtaAdapter missing; MBTA bus/ETA features need mbtaRealtime.js before routeOverlay.js");
}
const parseMBTAGTFSTripUpdates = mbtaAdapter && mbtaAdapter.parseTripUpdates;
const fetchMBTAV3Predictions = mbtaAdapter && mbtaAdapter.fetchPredictions;
const fetchMBTAV3Vehicles = mbtaAdapter && mbtaAdapter.fetchVehicles;
const fetchMBTAV3VehiclesFallback = mbtaAdapter && mbtaAdapter.fetchVehiclesFallback;
const parseMBTAGTFSRT = mbtaAdapter && mbtaAdapter.parseVehiclePositions;


/**
 * Format occupancy status to friendly text
 * @param {string} occupancy - Raw occupancy status from V3 API
 * @returns {string} Friendly occupancy text
 */
function formatOccupancy(occupancy) {
  if (!occupancy || occupancy === 'Unknown') return 'Unknown';
  
  const occupancyMap = {
    'MANY_SEATS_AVAILABLE': 'Many Seats Available',
    'FEW_SEATS_AVAILABLE': 'Few Seats Available',
    'STANDING_ROOM_ONLY': 'Standing Room Only',
    'CRUSHED_STANDING_ROOM_ONLY': 'Crushed Standing Room Only',
    'FULL': 'Full',
    'NOT_ACCEPTING_PASSENGERS': 'Not Accepting Passengers'
  };
  
  return occupancyMap[occupancy] || occupancy;
}

/**
 * Format ETA time to human-readable string
 * @param {Date} etaDate - ETA date object
 * @returns {string} Formatted time (e.g., "2m 30s", "Now")
 */
function formatETA(etaDate) {
  const now = new Date();
  const diffMs = etaDate - now;
  
  if (diffMs < 0) return 'Now';
  
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  
  if (minutes < 1) {
    return `${seconds}s`;
  } else {
    return `${minutes}m ${seconds > 0 ? seconds + 's' : ''}`.trim();
  }
}

/**
 * Get or create the ETA panel dynamically
 * @returns {HTMLElement} The ETA panel element
 */
function getOrCreateETAPanel() {
  let panel = document.getElementById('etaPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'etaPanel';
    panel.className = 'eta-panel';
    panel.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      width: 90%;
      max-width: 600px;
      max-height: 300px;
      background: rgba(30, 30, 30, 0.95);
      border: 2px solid #1E90FF;
      border-radius: 8px;
      padding: 12px;
      color: #fff;
      font-family: Arial, sans-serif;
      font-size: 14px;
      z-index: 1000;
      overflow-y: auto;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      display: none;
    `;
    
    // Insert after map container or at end of body
    const mapContainer = document.getElementById('map');
    if (mapContainer && mapContainer.parentNode) {
      mapContainer.parentNode.insertBefore(panel, mapContainer.nextSibling);
    } else {
      document.body.appendChild(panel);
    }
  }
  return panel;
}

/**
 * Display ETAs in the panel
 * @param {Array} predictions - Array of prediction objects
 */
function displayETAs(predictions) {
  const panel = getOrCreateETAPanel();
  
  if (!predictions || predictions.length === 0) {
    panel.style.display = 'none';
    return;
  }
  
  // Show next 10 predictions (V3: ETAs + occupancy when available)
  const displayPredictions = predictions.slice(0, 10);
  
  let html = '<div style="font-weight: bold; margin-bottom: 8px; color: #1E90FF; text-align: center;">⏰ Next Arrivals</div>';
  html += '<div style="max-height: 250px; overflow-y: auto;">';
  
  displayPredictions.forEach(pred => {
    const etaDate = new Date(pred.eta);
    const timeStr = formatETA(etaDate);
    const occupancyStr = formatOccupancy(pred.occupancy);
    
    html += `
      <div style="padding: 6px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center;">
        <div style="flex: 1;">
          <div style="font-weight: bold; color: #fff;">${pred.stopName}</div>
          <div style="font-size: 12px; color: #888;">${occupancyStr}</div>
        </div>
        <div style="color: #1E90FF; font-weight: bold; margin-left: 12px;">${timeStr}</div>
      </div>
    `;
  });
  
  html += '</div>';
  panel.innerHTML = html;
  panel.style.display = 'block';
}


/**
 * Attach a route overlay to a MapLibre map
 *
 * @param {maplibregl.Map} map              - MapLibre GL JS map instance
 * @param {string|number}  routeId          - Route ID / number (for labels only)
 * @param {number}         directionId      - Direction ID (0 or 1, for labels only)
 * @param {Object}         options
 * @param {Object}         options.routeData   - REQUIRED: { shape: [[lat,lon]...] OR shapes: [[[lat,lon]...], ...], stops: [...] }
 *                                               Supports both single shape (backward compatible) and multiple shapes (trunk-and-branch routes)
 * @param {string}         options.mode        - "singleRoutePage" | "mainOverlay" (default: "mainOverlay")
 * @param {string}         options.routePageUrl- Optional: URL to full route page
 * @param {string}         options.routeColor  - Optional: line color (default MetroFeed blue)
 * @param {boolean}        options.fitBounds   - Optional: fit map to route (default: true for singleRoutePage)
 * @param {string}         options.apiKey      - Optional: TriMet API key for bus tracking
 * @param {boolean}        options.trackBuses  - Optional: enable bus tracking (default: true for mainOverlay)
 *
 * @returns {{ remove: function }} overlay handle
 */
/**
 * Get route color based on route name
 * Returns a consistent color for routes with the same name
 * @param {string} routeName - Route name (route_title, route_label, route_name, etc.)
 * @returns {string} Hex color code
 */
function getRouteColorByName(routeName) {
  if (!routeName) return "#708090"; // Default steel grey
  
  const name = String(routeName).toLowerCase().trim();
  
  // MBTA Subway colors (exact matches)
  if (name.includes('red line') || name === 'red') return "#DA291C";
  if (name.includes('orange line') || name === 'orange') return "#ED8B00";
  if (name.includes('blue line') || name === 'blue') return "#003DA5";
  if (name.includes('green line') || name.startsWith('green')) return "#00843D";
  
  // Commuter Rail (purple-ish)
  if (name.includes('commuter') || name.includes('cr-') || name.startsWith('fitchburg') || 
      name.startsWith('lowell') || name.startsWith('haverhill') || name.startsWith('newburyport') ||
      name.startsWith('rockport') || name.startsWith('fairmount') || name.startsWith('needham') ||
      name.startsWith('franklin') || name.startsWith('providence') || name.startsWith('middleborough') ||
      name.startsWith('kingston') || name.startsWith('greenbush') || name.startsWith('worcester') ||
      name.startsWith('framingham') || name.startsWith('foxboro')) {
    return "#80276C";
  }
  
  // Generate consistent color from route name hash
  // This ensures same route name always gets same color
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Generate a color from the hash (avoid too dark/light colors)
  // Bounds ensure colors are visible and distinct:
  // - Hue: 0-360 (full spectrum)
  // - Saturation: 50-85% (vibrant, not washed out)
  // - Lightness: 40-70% (visible, avoiding near-black and near-white)
  const hue = Math.abs(hash) % 360;
  const saturation = 50 + (Math.abs(hash) % 35); // 50-85% saturation
  const lightness = 40 + (Math.abs(hash) % 30); // 40-70% lightness
  
  // Convert HSL to hex
  const h = hue / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  
  let r, g, b;
  if (h < 1/6) {
    r = c; g = x; b = 0;
  } else if (h < 2/6) {
    r = x; g = c; b = 0;
  } else if (h < 3/6) {
    r = 0; g = c; b = x;
  } else if (h < 4/6) {
    r = 0; g = x; b = c;
  } else if (h < 5/6) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  
  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);
  
  // Safety check: ensure color is not too close to black or white
  // If any RGB component is too low (< 30) or too high (> 240), adjust it
  const minComponent = 30;  // Minimum RGB value (prevents near-black)
  const maxComponent = 240; // Maximum RGB value (prevents near-white)
  
  if (r < minComponent && g < minComponent && b < minComponent) {
    // Too dark, brighten it
    const avg = (r + g + b) / 3;
    const scale = minComponent / avg;
    r = Math.min(255, Math.round(r * scale));
    g = Math.min(255, Math.round(g * scale));
    b = Math.min(255, Math.round(b * scale));
  } else if (r > maxComponent && g > maxComponent && b > maxComponent) {
    // Too light, darken it
    const avg = (r + g + b) / 3;
    const scale = maxComponent / avg;
    r = Math.max(0, Math.round(r * scale));
    g = Math.max(0, Math.round(g * scale));
    b = Math.max(0, Math.round(b * scale));
  }
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function attachRouteToMap(map, routeId, directionId, options) {
  options = options || {};

  const mode        = options.mode || "mainOverlay";
  
  // Get route color: use provided color, or determine from route name, or default to steel grey
  let routeColor = options.routeColor;
  if (!routeColor && options.routeData) {
    // Try to get route name from routeData
    const routeName = options.routeData.route_label || 
                      options.routeData.route_title || 
                      options.routeData.route_name || 
                      options.routeData.route_long_name || 
                      routeId;
    routeColor = getRouteColorByName(routeName);
  }
  routeColor = routeColor || "#708090"; // Default steel grey (#708090)
  
  const fitBounds   =
    options.fitBounds !== undefined
      ? options.fitBounds
      : mode === "singleRoutePage";
  const trackBuses  = options.trackBuses !== undefined ? options.trackBuses : (mode === "mainOverlay");
  const apiKey      = options.apiKey || null;

  const routeData = options.routeData;

  // ==== Basic validation =====================================================
  if (!map || typeof map.addSource !== "function") {
    console.error("[attachRouteToMap] Invalid MapLibre map instance.");
    return { remove: function () {} };
  }

  // Support both single shape (backward compatibility) and multiple shapes (trunk-and-branch routes)
  const hasShapes = Array.isArray(routeData.shapes) && routeData.shapes.length > 0;
  const hasSingleShape = Array.isArray(routeData.shape) && routeData.shape.length > 0;
  
  if (!routeData || (!hasShapes && !hasSingleShape) || !Array.isArray(routeData.stops)) {
    console.error("[attachRouteToMap] routeData with shape[] or shapes[] and stops[] is REQUIRED.", {
      routeId,
      directionId,
      routeData,
      hasShapes,
      hasSingleShape
    });
    return { remove: function () {} };
  }

  // Normalize to shapes array for consistent processing
  // If shapes array exists, use it; otherwise wrap single shape in array
  const shapes = hasShapes ? routeData.shapes : [routeData.shape];
  const primaryShape = hasShapes ? routeData.shapes[0] : routeData.shape; // Use first shape for bounds/stops
  
  const stops      = routeData.stops; // [{lat,lon,times,name,stop_id}, ...]
  const routeTitle = routeData.route_title || `Route ${routeId}`;

  // ==== Tracking created objects for cleanup =================================
  const overlayElements = {
    sources:  [],
    layers:   [],
    markers:  [],
    controls: [],
    intervals: [], // For bus tracking intervals
    stopMarkers: [], // Store stop markers with their data for pulsing
    stopPopupRefreshers: [], // { overlayKey, fn } refresh stop popup when V3/TripUpdates load
    busPopupRefreshers: [] // functions to refresh bus popups when ETAs load
  };

  // ==== Internal: build & attach =================================================
  const addRouteToMap = () => {
    // ⚠️ CRITICAL: shapes[] rendering is LINE-ONLY
    // 
    // When rendering multiple shapes for a route (trunk-and-branch):
    // - Each shape in shapes[] is rendered as a line
    // - Stops are rendered ONCE from routeData.stops (deduped by stop_id)
    // - Vehicles are fetched ONCE by (routeId, directionId) - not per shape
    // 
    // This prevents duplicate stop markers and vehicle markers when multiple shapes overlap
    // (e.g., Green Line branches sharing the trunk segment, Red Line branches at JFK/UMass)
    //
    // Route identity model:
    // - route_label: User-facing group (e.g., "Green Line", "Red Line")
    // - route_id: File key (e.g., "Green-B", "Red")
    // - shapes[]: All unique shape_ids for this route_label (from GTFS pipeline)
    //
    // ⚠️ SEPARATION: Basic route display vs OTP context
    // - Basic route display: Normal opacity (0.8), normal width (4px) - shows all branches clearly
    // - OTP context mode: Faint opacity (0.25), thinner width (3px) - provides context for OTP highlight
    //
    // ---------- Render all shapes (for trunk-and-branch routes) ----------
    // All shapes in shapes[] are rendered; opacity/width depends on OTP state
    shapes.forEach((shape, shapeIndex) => {
      const isPrimaryShape = shapeIndex === 0;
      const routeSourceId = `route-line-${routeId}-${directionId}-${shapeIndex}`;
      const routeLayerId  = `route-layer-${routeId}-${directionId}-${shapeIndex}`;

      // Guard against duplicate IDs
      if (map.getLayer(routeLayerId)) {
        map.removeLayer(routeLayerId);
      }
      if (map.getSource(routeSourceId)) {
        map.removeSource(routeSourceId);
      }

      map.addSource(routeSourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: shape.map((coord) => [coord[1], coord[0]]) // [lat,lon] -> [lon,lat]
          }
        }
      });
      overlayElements.sources.push(routeSourceId);

      // Determine if OTP is active (for context layer styling)
      // OTP is active if routeLegLines exist (OTP journey is drawn)
      const isOtpActive = window.routeLegLines && window.routeLegLines.length > 0;
      
      // Find the first OTP layer to place route overlay layers before it (if OTP active)
      let beforeId = undefined;
      if (isOtpActive) {
        for (const otpLayerId of window.routeLegLines) {
          if (map.getLayer(otpLayerId)) {
            beforeId = otpLayerId;
            break;
          }
        }
      }
      
      // ⚠️ SEPARATION: Basic route display vs OTP context
      // - Basic route display (no OTP): Normal opacity (0.9), normal width (4px)
      // - OTP context (OTP active): Faint opacity (0.25), thinner width (3px) for context
      const lineOpacity = isOtpActive ? 0.25 : 0.9;  // Slightly higher opacity for better visibility
      const lineWidth = isOtpActive ? 3 : 4;          // Normal width
      
      map.addLayer({
        id: routeLayerId,
        type: "line",
        source: routeSourceId,
        paint: {
          "line-color": routeColor,
          "line-width": lineWidth,
          "line-opacity": lineOpacity
        },
        // Place route overlay layers before OTP segments (only if OTP active)
        beforeId: beforeId
      });
      overlayElements.layers.push(routeLayerId);
    });

    // ---------- Fit bounds (if desired) ----------
    // Calculate bounds from all shapes
    if (fitBounds && primaryShape.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      
      // Include all shapes in bounds calculation
      shapes.forEach(shape => {
        shape.forEach((coord) => bounds.extend([coord[1], coord[0]]));
      });
      
      // Auto-expand bounds by 20% to ensure route fits (especially for long commuter rail routes)
      const currentBounds = bounds.toArray();
      const [[west, south], [east, north]] = currentBounds;
      const latRange = north - south;
      const lonRange = east - west;
      const expansion = 0.20; // 20% expansion
      
      const expandedBounds = new maplibregl.LngLatBounds();
      expandedBounds.extend([west - (lonRange * expansion), south - (latRange * expansion)]);
      expandedBounds.extend([east + (lonRange * expansion), north + (latRange * expansion)]);
      
      map.fitBounds(expandedBounds, { padding: 40, maxZoom: 14 });
    }

    // ---------- Stops + popups ----------
    // ⚠️ SANITY CHECK: Stops are rendered ONCE from routeData.stops, not per shape
    // This ensures no duplicate stop markers even when multiple shapes share stops
    // (e.g., Green Line branches sharing Park Street, Red Line branches sharing JFK/UMass)
    //
    // Get timezone from route metadata or fallback
    const agencyTimezone = (routeData.meta && routeData.meta.agency_timezone) 
      ? routeData.meta.agency_timezone 
      : "America/New_York"; // Default fallback
    
    // Get current time in the correct timezone (proper timezone-aware calculation)
    const now = new Date();
    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: agencyTimezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false
    });
    const parts = timeFormatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === "hour").value, 10);
    const minute = parseInt(parts.find(p => p.type === "minute").value, 10);
    const nowMins = hour * 60 + minute;
    
    // Get current day in the timezone
    const dayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: agencyTimezone,
      weekday: "long"
    });
    const currentDay = now.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    
    // Determine which schedule bucket to use
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let scheduleBucket = "weekday";
    if (currentDay === 0) {
      scheduleBucket = "sunday";
    } else if (currentDay === 6) {
      scheduleBucket = "saturday";
    } else {
      scheduleBucket = "weekday";
    }
    
    console.log(`[attachRouteToMap] 📅 Today is ${dayNames[currentDay]} (day ${currentDay}) - Using schedule bucket: "${scheduleBucket}"`);
    
    // Check service day for holiday adjustments
    if (window.routeLoader) {
      const serviceCheck = window.routeLoader.checkServiceDay(now);
      if (serviceCheck.isHoliday) {
        console.warn(`[attachRouteToMap] ⚠️ Today (${serviceCheck.dayName}) may be a holiday - schedules may differ`);
        // On holidays, many agencies use Sunday schedule
        if (scheduleBucket === "weekday") {
          scheduleBucket = "sunday";
          console.log(`[attachRouteToMap] 📅 Holiday detected - Changed schedule bucket to: "sunday"`);
        }
      }
    }
    
    // Get weeklyTimes from routeData (new format) or fallback to legacy stop.times
    const weeklyTimes = routeData.weeklyTimes || {};
    
    // Log available schedule buckets
    const availableBuckets = Object.keys(weeklyTimes);
    console.log(`[attachRouteToMap] 📋 Available schedule buckets in route data: ${availableBuckets.length > 0 ? availableBuckets.join(', ') : 'none (using legacy format)'}`);
    
    // Warn if schedule bucket doesn't exist
    if (!weeklyTimes[scheduleBucket] && Object.keys(weeklyTimes).length > 0) {
      console.warn(`[attachRouteToMap] ⚠️ Schedule bucket "${scheduleBucket}" not found in route data. Available: ${availableBuckets.join(', ')}. Falling back to weekday.`);
      scheduleBucket = "weekday";
    } else if (weeklyTimes[scheduleBucket]) {
      console.log(`[attachRouteToMap] ✅ Using "${scheduleBucket}" schedule (${Object.keys(weeklyTimes[scheduleBucket]).length} stops have times)`);
    } else {
      console.warn(`[attachRouteToMap] ⚠️ No weeklyTimes data found - using legacy stop.times format`);
    }

    stops.forEach((stop) => {
      const lat = stop.lat;
      const lon = stop.lon;

      if (typeof lat !== "number" || typeof lon !== "number") return;

      // Get times for this stop from weeklyTimes
      const stopId = String(stop.stop_id || "");
      let timesArray = [];
      let timesSource = 'none';
      
      // Try to get from weeklyTimes first (new format)
      if (weeklyTimes[scheduleBucket] && weeklyTimes[scheduleBucket][stopId]) {
        timesArray = weeklyTimes[scheduleBucket][stopId];
        timesSource = scheduleBucket;
      } else if (weeklyTimes.weekday && weeklyTimes.weekday[stopId]) {
        // Fallback to weekday if current day bucket doesn't exist
        timesArray = weeklyTimes.weekday[stopId];
        timesSource = 'weekday (fallback)';
        if (scheduleBucket !== 'weekday') {
          console.warn(`[attachRouteToMap] ⚠️ Stop ${stopId} (${stop.name}) has no "${scheduleBucket}" times - using weekday schedule`);
        }
      } else if (Array.isArray(stop.times)) {
        // Legacy fallback to stop.times
        timesArray = stop.times;
        timesSource = 'legacy stop.times';
      }
      
      // Log first stop to show what's being used
      if (stops.indexOf(stop) === 0 && timesArray.length > 0) {
        console.log(`[attachRouteToMap] 📍 First stop "${stop.name}" (${stopId}): Using ${timesArray.length} times from "${timesSource}" schedule`);
      }

      // Process times: convert to minutes and find next upcoming time
      const allTimes = [];
      timesArray.forEach((timeStrRaw) => {
        let timeStr = String(timeStrRaw).trim();
        if (!timeStr) return;
        
        // Parse HH:MM:SS or HH:MM format
        const parts = timeStr.split(":");
        if (parts.length < 2) return;
        
        let h = parseInt(parts[0], 10);
        let m = parseInt(parts[1], 10);
        
        if (isNaN(h) || isNaN(m)) return;
        
        // Handle times > 24:00:00 (next day)
        if (h >= 24) {
          h = h - 24;
        }
        
        const schedMins = h * 60 + m;
        
        // Handle past times: if time is in the past (even by a minute), treat it as tomorrow
        // This ensures we always show future times
        let adjustedMins = schedMins;
        if (schedMins < nowMins) {
          // Time is in the past, add 1440 minutes (24 hours) to make it "tomorrow"
          adjustedMins = schedMins + 1440;
        }
        
        // Convert to 12-hour display format
        let displayH = h;
        const ampm = displayH >= 12 ? "PM" : "AM";
        if (displayH > 12) displayH -= 12;
        if (displayH === 0) displayH = 12;
        const mStr = String(m).padStart(2, "0");
        const displayTime = `${displayH}:${mStr} ${ampm}`;
        
        allTimes.push({
          displayTime: displayTime,
          schedMins: adjustedMins,
          originalMins: schedMins
        });
      });

      // Sort all times by adjusted minutes (schedMins contains adjusted value)
      allTimes.sort((a, b) => a.schedMins - b.schedMins);
      
      // Find the next upcoming time
      // Priority: times today (originalMins >= nowMins) over times tomorrow (adjustedMins >= 1440)
      let nextTimeIndex = -1;
      
      // First pass: look for times today that are in the future
      for (let i = 0; i < allTimes.length; i++) {
        const timeData = allTimes[i];
        // If this is a today time (originalMins < 1440) and it's in the future
        if (timeData.originalMins < 1440 && timeData.originalMins >= nowMins) {
          nextTimeIndex = i;
          break;
        }
      }
      
      // Second pass: if no today time found, use first tomorrow time
      if (nextTimeIndex === -1) {
        for (let i = 0; i < allTimes.length; i++) {
          const timeData = allTimes[i];
          // If this is a tomorrow time (originalMins was in the past, so adjustedMins >= 1440)
          if (timeData.schedMins >= 1440) {
            nextTimeIndex = i;
            break;
          }
        }
      }
      
      // Fallback: use first time if nothing found
      if (nextTimeIndex === -1 && allTimes.length > 0) {
        nextTimeIndex = 0;
      }
      
      // Build display: 2 before, next (highlighted), 3 after (6 total, no repeats)
      const highlightedTimes = [];
      const timesToShow = 6;
      const timesBefore = 2;
      const timesAfter = 3;
      
      if (nextTimeIndex >= 0) {
        // Get past times (originalMins < nowMins) - these are actual past times from today
        const pastTimes = allTimes.filter(timeData => 
          timeData.originalMins < 1440 && timeData.originalMins < nowMins
        );
        // Sort past times by originalMins descending (most recent first)
        pastTimes.sort((a, b) => b.originalMins - a.originalMins);
        // Get the 2 most recent past times
        const beforeTimes = pastTimes.slice(0, timesBefore);
        
        // Add before times (most recent past times first)
        beforeTimes.reverse().forEach(timeData => {
          highlightedTimes.push(timeData.displayTime);
        });
        
        // Add next time (highlighted)
        highlightedTimes.push(
          `<span style="background:#1E90FF;color:#fff;padding:2px 6px;border-radius:6px;font-weight:bold;">${allTimes[nextTimeIndex].displayTime}</span>`
        );
        
        // Add after times (up to 3, no wrap-around)
        const afterEnd = Math.min(allTimes.length, nextTimeIndex + 1 + timesAfter);
        const afterTimes = allTimes.slice(nextTimeIndex + 1, afterEnd);
        
        afterTimes.forEach(timeData => {
          highlightedTimes.push(timeData.displayTime);
        });
        
        // No wrap-around - just show what we have (max 6 times)
      } else if (allTimes.length > 0) {
        // No next time found, just show first 6 times
        allTimes.slice(0, timesToShow).forEach((timeData, index) => {
          if (index === 0) {
            highlightedTimes.push(
              `<span style="background:#1E90FF;color:#fff;padding:2px 6px;border-radius:6px;font-weight:bold;">${timeData.displayTime}</span>`
            );
          } else {
            highlightedTimes.push(timeData.displayTime);
          }
        });
      }

      // Stop marker element
      const stopElement = document.createElement("div");
      stopElement.style.width          = "12px";
      stopElement.style.height         = "12px";
      stopElement.style.backgroundColor= "#1E90FF";
      stopElement.style.borderRadius   = "50%";
      stopElement.style.border         = "2px solid #fff";
      stopElement.style.opacity        = "0.9";
      stopElement.style.cursor         = "pointer";

      const stopMarker = new maplibregl.Marker({ element: stopElement })
        .setLngLat([lon, lat]);

      // ETA display (V3 predictions primary; TripUpdates fallback)
      const getETADisplay = () => {
        try {
          const overlayKey = `${routeId}-${directionId}`;
          const etas = (window.currentRouteETAs && window.currentRouteETAs.overlayKey === overlayKey)
            ? window.currentRouteETAs
            : null;

          const stopIdKey = String(stop.stop_id || stopId);
          const stopETAsMap = etas && etas.stopETAs ? etas.stopETAs : null;
          let v3List = stopETAsMap && stopETAsMap[stopIdKey] ? stopETAsMap[stopIdKey] : [];
          if (v3List.length === 0 && stopETAsMap) {
            const alt = stop.stop_id != null ? String(stop.stop_id) : null;
            if (alt && alt !== stopIdKey && stopETAsMap[alt]) v3List = stopETAsMap[alt];
          }
          const nextV3 = v3List.slice(0, 2).map(p => {
            const t = p.etaDate ? formatETA(p.etaDate) : formatETA(new Date(p.eta));
            const occ = p.occupancy ? formatOccupancy(p.occupancy) : 'Unknown';
            return `<div style="display:flex;justify-content:space-between;gap:10px;"><span style="color:#bbb;">V3</span><span style="color:#1E90FF;font-weight:bold;">${t}</span><span style="color:#888;font-size:12px;">${occ}</span></div>`;
          });

          const tu = (window.currentRouteTripUpdates && window.currentRouteTripUpdates.overlayKey === overlayKey)
            ? window.currentRouteTripUpdates
            : null;
          const tuListRaw = tu && tu.updatesByStopId && tu.updatesByStopId[stopIdKey] ? tu.updatesByStopId[stopIdKey] : [];
          const tuList = tuListRaw
            .filter(u => !u.routeId || String(u.routeId) === String(routeId))
            .filter(u => u.directionId === null || u.directionId === undefined || u.directionId == directionId)
            .slice(0, 2)
            .map(u => {
              const t = formatETA(new Date((u.time || 0) * 1000));
              const delay = (u.delay || u.delay === 0) ? `${u.delay >= 0 ? '+' : ''}${u.delay}s` : '';
              return `<div style="display:flex;justify-content:space-between;gap:10px;"><span style="color:#bbb;">TripUpdates</span><span style="color:#1E90FF;font-weight:bold;">${t}</span><span style="color:#888;font-size:12px;">${delay}</span></div>`;
            });

          if (nextV3.length === 0 && tuList.length === 0) return '';

          return `
            <hr style="border:none;border-top:1px solid #1E90FF;margin:6px 0;">
            <div style="font-size:12px;color:#fff;margin-bottom:4px;"><strong>Next arrivals</strong></div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              ${nextV3.join('')}
              ${tuList.join('')}
            </div>
          `;
        } catch (_) {
          return '';
        }
      };
      
      // Popup content (reads latest ETA data when created/updated)
      const popupContent = document.createElement("div");
      const updatePopupContent = () => {
        const etaDisplay = getETADisplay();
        popupContent.innerHTML = `
          <div style="border:1px solid #1E90FF;border-radius:8px;padding:10px;background:#222;color:#fff;min-width:200px;">
            <strong style="color:#1E90FF;">${stop.name || `Stop ${stop.stop_id}`}</strong>
            ${etaDisplay}
            ${
              highlightedTimes.length
                ? `
              <hr style="border:none;border-top:1px solid #1E90FF;margin:6px 0;">
              ${highlightedTimes.join("<br>")}
              <hr style="border:none;border-top:1px solid #1E90FF;margin:8px 0;">
              <button onclick="window.showStopTimesModal && window.showStopTimesModal('${routeId}', ${directionId}, '${stopId}', '${(stop.name || `Stop ${stop.stop_id}`).replace(/'/g, "\\'")}')" style="width:100%;background:#1E90FF;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:0.9rem;font-weight:bold;margin-top:4px;">See all times</button>
            `
                : ""
            }
          </div>
        `;
      };
      
      // Initial content (reads current ETA data)
      updatePopupContent();
      
      const popup = new maplibregl.Popup().setDOMContent(popupContent);
      
      const overlayKeyForStops = `${routeId}-${directionId}`;
      overlayElements.stopPopupRefreshers.push({
        overlayKey: overlayKeyForStops,
        update: updatePopupContent
      });

      stopMarker.setPopup(popup);
      stopMarker.addTo(map);

      overlayElements.markers.push(stopMarker);
    });

    // ---------- Route info panel (mainOverlay only) ----------
    if (mode === "mainOverlay" && options.routePageUrl) {
      const panelId = `route-info-${routeId}-${directionId}`;
      const existing = document.getElementById(panelId);
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

      const routeInfoPanel = document.createElement("div");
      routeInfoPanel.id = panelId;
      routeInfoPanel.className = "route-info-panel";
      
      // Start collapsed as a circle in the corner
      // Find the next available position (highest existing index + 1)
      const allPanels = Array.from(map.getContainer().querySelectorAll('.route-info-panel'));
      const collapsedPanels = allPanels.filter(panel => 
        panel.getAttribute('data-collapsed') === 'true'
      );
      
      // Find the highest index from stored collapse-index attributes
      let maxIndex = -1;
      collapsedPanels.forEach(panel => {
        const storedIndex = panel.getAttribute('data-collapse-index');
        if (storedIndex !== null) {
          maxIndex = Math.max(maxIndex, parseInt(storedIndex, 10));
        }
      });
      
      const panelIndex = maxIndex + 1; // Next available position
      const circleSize = 40; // Circle size
      const circleSpacing = 10; // Space between circles
      const topOffset = 250; // Start from top to avoid overlapping with other UI elements
      const verticalPosition = topOffset + (panelIndex * (circleSize + circleSpacing));
      
      // Set initial collapsed state (circle in corner)
      routeInfoPanel.setAttribute('data-collapsed', 'true');
      routeInfoPanel.setAttribute('data-collapse-index', panelIndex.toString());
      
      routeInfoPanel.style.cssText = `
        position:absolute;
        left:calc(100% - ${circleSize + 10}px);
        top:${verticalPosition}px;
        width:${circleSize}px;
        height:${circleSize}px;
        min-width:${circleSize}px;
        max-width:${circleSize}px;
        min-height:${circleSize}px;
        max-height:${circleSize}px;
        padding:0;
        border-radius:50%;
        border:3px solid #fff;
        background:#FF6B35;
        color:#fff;
        z-index:1000;
        box-shadow:0 4px 12px rgba(0,0,0,0.5);
        transition:all 0.3s ease;
        display:flex;
        align-items:center;
        justify-content:center;
        cursor:pointer;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      `;
      
      // Create collapse button (starts pointing right ▶ to collapse)
      const collapseBtn = document.createElement("button");
      collapseBtn.innerHTML = "▶";
      collapseBtn.style.cssText = `
        position:absolute;
        right:32px;
        top:4px;
        background:transparent;
        color:#fff;
        border:none;
        padding:2px 6px;
        cursor:pointer;
        font-size:16px;
        z-index:1001;
        line-height:1;
      `;
      collapseBtn.onmouseover = () => collapseBtn.style.background = "rgba(255,255,255,0.2)";
      collapseBtn.onmouseout = () => collapseBtn.style.background = "transparent";
      
      let isCollapsed = true; // Start collapsed
      
      // Make the panel clickable when collapsed to expand it
      routeInfoPanel.addEventListener('click', function(e) {
        // Check if panel is collapsed by checking the data attribute
        if (this.getAttribute('data-collapsed') === 'true') {
          // Expand when clicking anywhere on the collapsed circle
          e.stopPropagation();
          // Manually trigger the expand logic by calling collapseBtn.onclick
          // This will toggle isCollapsed and update the panel
          if (collapseBtn && typeof collapseBtn.onclick === 'function') {
            const fakeEvent = { stopPropagation: () => {}, preventDefault: () => {} };
            collapseBtn.onclick(fakeEvent);
          }
        }
      });
      
      collapseBtn.onclick = (e) => {
        e.stopPropagation();
        isCollapsed = !isCollapsed;
        if (isCollapsed) {
          // Collapse to right side - circle with route number
          // Find the next available position (highest existing index + 1)
          const allPanels = Array.from(map.getContainer().querySelectorAll('.route-info-panel'));
          const collapsedPanels = allPanels.filter(panel => 
            panel.getAttribute('data-collapsed') === 'true' && panel !== routeInfoPanel
          );
          
          // Find the highest index from stored collapse-index attributes
          let maxIndex = -1;
          collapsedPanels.forEach(panel => {
            const storedIndex = panel.getAttribute('data-collapse-index');
            if (storedIndex !== null) {
              maxIndex = Math.max(maxIndex, parseInt(storedIndex, 10));
            }
          });
          
          const panelIndex = maxIndex + 1; // Next available position
          const circleSize = 40; // 20% smaller than 50px
          const circleSpacing = 10; // Space between circles
          const topOffset = 250; // Start from top to avoid overlapping with other UI elements
          const verticalPosition = topOffset + (panelIndex * (circleSize + circleSpacing));
          
          // Mark this panel as collapsed and store its position index
          routeInfoPanel.setAttribute('data-collapsed', 'true');
          routeInfoPanel.setAttribute('data-collapse-index', panelIndex.toString());
          
          routeInfoPanel.style.left = `calc(100% - ${circleSize + 10}px)`; // Position from right edge with margin
          routeInfoPanel.style.top = `${verticalPosition}px`;
          routeInfoPanel.style.transform = "none"; // Remove centering transform
          routeInfoPanel.style.width = `${circleSize}px`;
          routeInfoPanel.style.height = `${circleSize}px`;
          routeInfoPanel.style.minWidth = `${circleSize}px`;
          routeInfoPanel.style.maxWidth = `${circleSize}px`;
          routeInfoPanel.style.minHeight = `${circleSize}px`;
          routeInfoPanel.style.maxHeight = `${circleSize}px`;
          routeInfoPanel.style.padding = "0";
          routeInfoPanel.style.borderRadius = "50%"; // Perfect circle
          routeInfoPanel.style.border = "3px solid #fff"; // White border
          routeInfoPanel.style.background = "#FF6B35"; // Orange background
          routeInfoPanel.style.display = "flex";
          routeInfoPanel.style.alignItems = "center";
          routeInfoPanel.style.justifyContent = "center";
          routeInfoPanel.style.cursor = "pointer"; // Make it clear it's clickable
          // Hide collapse button and close button
          collapseBtn.style.display = "none";
          closeBtn.style.display = "none";
          routeInfoPanel.querySelector(".route-info-content").style.display = "none";
          // Show collapsed route number (circle)
          const collapsedName = routeInfoPanel.querySelector(".route-name-collapsed");
          if (collapsedName) {
            collapsedName.style.display = "block";
            collapsedName.style.color = "#fff"; // White text
            collapsedName.style.fontWeight = "bold";
            collapsedName.style.fontSize = "1rem"; // Slightly smaller for 40px circle
          }
        } else {
          // Expand back to center - restore original panel styles
          routeInfoPanel.removeAttribute('data-collapsed');
          routeInfoPanel.style.left = "50%";
          routeInfoPanel.style.top = "50%";
          routeInfoPanel.style.transform = "translate(-50%, -50%)";
          routeInfoPanel.style.width = "auto";
          routeInfoPanel.style.minWidth = "200px";
          routeInfoPanel.style.maxWidth = "none";
          routeInfoPanel.style.height = "auto";
          routeInfoPanel.style.minHeight = "auto";
          routeInfoPanel.style.maxHeight = "none";
          routeInfoPanel.style.padding = "12px";
          routeInfoPanel.style.borderRadius = "8px";
          routeInfoPanel.style.background = "rgba(30,30,30,0.95)";
          routeInfoPanel.style.border = "2px solid #1E90FF";
          routeInfoPanel.style.display = "block";
          routeInfoPanel.style.cursor = "default";
          
          // Don't recalculate positions - keep other collapsed panels locked in place
          // Each panel maintains its own position when collapsed, so they don't move when others expand
          // Move collapse button back to top-right (left of close button)
          collapseBtn.style.right = "32px";
          collapseBtn.style.left = "auto";
          collapseBtn.style.top = "4px";
          collapseBtn.style.transform = "none";
          collapseBtn.style.display = "flex";
          collapseBtn.innerHTML = "▶"; // Point right to collapse
          closeBtn.style.display = "flex";
          routeInfoPanel.querySelector(".route-info-content").style.display = "block";
          // Hide collapsed route name
          const collapsedName = routeInfoPanel.querySelector(".route-name-collapsed");
          if (collapsedName) {
            collapsedName.style.display = "none";
          }
        }
      };
      
      // Create close button
      const closeBtn = document.createElement("button");
      closeBtn.innerHTML = "×";
      closeBtn.style.cssText = `
        position:absolute;
        top:4px;
        right:4px;
        background:transparent;
        color:#fff;
        border:none;
        font-size:20px;
        cursor:pointer;
        width:24px;
        height:24px;
        display:flex;
        align-items:center;
        justify-content:center;
        border-radius:4px;
        line-height:1;
      `;
      closeBtn.onmouseover = () => closeBtn.style.background = "rgba(255,255,255,0.2)";
      closeBtn.onmouseout = () => closeBtn.style.background = "transparent";
      // Get the actual overlay key from options (for branch routes like "Red-Ashmont-0")
      // If not provided, construct from routeId (for non-branch routes)
      const actualOverlayKey = options.overlayKey || `${routeId}-${directionId}`;
      
      // Store overlay key in panel for reference
      routeInfoPanel.setAttribute('data-overlay-key', actualOverlayKey);
      
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        // Find and remove this overlay using the actual overlay key
        if (window.activeRouteOverlays) {
          if (window.activeRouteOverlays[actualOverlayKey]) {
            window.activeRouteOverlays[actualOverlayKey].remove();
            delete window.activeRouteOverlays[actualOverlayKey];
          } else {
            // Fallback: try to find by routeId if stored key doesn't match
            console.warn('[routeOverlay] Overlay key not found:', actualOverlayKey, 'Available keys:', Object.keys(window.activeRouteOverlays));
            // Try alternative key format
            const altKey = `${routeId}-${directionId}`;
            if (window.activeRouteOverlays[altKey]) {
              window.activeRouteOverlays[altKey].remove();
              delete window.activeRouteOverlays[altKey];
            }
          }
        }
        
        // Also remove from descriptors
        if (window.activeRouteOverlayDescriptors) {
          delete window.activeRouteOverlayDescriptors[actualOverlayKey];
        }

        // Keep active route tracking + alert indicator in sync (avoid ghost alerts)
        try {
          const baseRouteId = String(routeId).includes('-') ? String(routeId).split('-')[0] : String(routeId);
          if (window.activeRouteIds && typeof window.activeRouteIds.delete === 'function') {
            // Only remove if no other overlays still reference this base route
            const hasOtherOverlays = window.activeRouteOverlays
              ? Object.keys(window.activeRouteOverlays).some(k => {
                  const other = String(k).split('-')[0];
                  return other === baseRouteId;
                })
              : false;
            if (!hasOtherOverlays) {
              window.activeRouteIds.delete(baseRouteId);
            }
          }
          if (typeof window.updateAlertIndicator === 'function') {
            window.updateAlertIndicator();
          }
          if (window.MapBoundsManager && typeof window.MapBoundsManager.updateForRoutes === 'function') {
            window.MapBoundsManager.updateForRoutes(
              window.activeRouteOverlays || {},
              window.activeRouteOverlayDescriptors || {},
              { autoFit: false }
            );
          }
        } catch (err) {
          // Non-fatal: closing overlay should still succeed even if indicator update fails
        }
      };
      
      // Content wrapper
      const contentDiv = document.createElement("div");
      contentDiv.className = "route-info-content";
      contentDiv.innerHTML = `
        <div style="margin-bottom:12px; padding-right:20px;">
          <strong style="color:#1E90FF;font-size:1em;">${routeTitle}</strong>
        </div>
        <button id="close-route-btn" style="background:#1E90FF;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:0.9em;width:100%;">Close</button>
      `;
      
      // Add close button functionality
      const closeRouteBtn = contentDiv.querySelector('#close-route-btn');
      if (closeRouteBtn) {
        closeRouteBtn.onclick = (e) => {
          e.stopPropagation();
          closeBtn.onclick(e);
        };
      }
      
      // Collapsed route number (circle display)
      const collapsedName = document.createElement("div");
      collapsedName.className = "route-name-collapsed";
      // Use the parent route ID (routeId parameter) - this is the actual route number
      // For bus routes: routeId is like "15", "4", "12", etc.
      // For rail routes: routeId is like "Red", "Orange", "Red-Ashmont", etc.
      let routeNumber = String(routeId);
      
      // Handle branch routes: "Red-Ashmont" -> "Red", "Green-D" -> "Green"
      if (routeNumber.includes('-') && (routeNumber.startsWith('Red-') || routeNumber.startsWith('Green-'))) {
        routeNumber = routeNumber.split('-')[0]; // "Red" or "Green"
      } else {
        // Extract just the numeric part if routeId has non-numeric characters
        const numericMatch = routeNumber.match(/\d+/);
        if (numericMatch) {
          routeNumber = numericMatch[0];
        }
      }
      collapsedName.innerHTML = routeNumber;
      collapsedName.style.cssText = `
        display:none;
        position:relative;
        color:#fff;
        font-weight:bold;
        font-size:1rem;
        pointer-events:none;
        text-align:center;
        line-height:1;
        margin:0;
        padding:0;
      `;
      
      routeInfoPanel.appendChild(closeBtn);
      routeInfoPanel.appendChild(contentDiv);
      routeInfoPanel.appendChild(collapsedName);
      routeInfoPanel.appendChild(collapseBtn);
      
      // Initially hide content and collapse button, show collapsed name (circle state)
      closeBtn.style.display = "none";
      contentDiv.style.display = "none";
      collapseBtn.style.display = "none";
      collapsedName.style.display = "block";
      collapsedName.style.color = "#fff";
      collapsedName.style.fontWeight = "bold";
      collapsedName.style.fontSize = "1rem";
      collapsedName.style.pointerEvents = "none"; // Don't block clicks on the circle

      map.getContainer().appendChild(routeInfoPanel);
      overlayElements.controls.push(routeInfoPanel);
    }

    // ---------- Bus tracking (for mainOverlay mode only) ----------
    if (trackBuses && mode === "mainOverlay") {
      const busMarkers = {}; // Store bus markers separately
      let busesFetchInFlight = false;
      let busesFetchSeq = 0;
      let lastEmergencyGtfsRtFallbackAt = 0;
      
      // Get API configuration from options or global CITY_CONFIG
      const busApiType = options.busApiType || (window.CITY_CONFIG && window.CITY_CONFIG.busApiType) || 'trimet';
      const gtfsRtUrl = options.gtfsRtUrl || (window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtUrl) || null;
      const gtfsRtTripUpdatesUrl = options.gtfsRtTripUpdatesUrl || (window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtTripUpdatesUrl) || null;
      const apiKey = options.apiKey || null;
      const disableGtfsRt = options.disableGtfsRt ?? (window.CITY_CONFIG && window.CITY_CONFIG.disableGtfsRt) ?? false;
      const allowEmergencyGtfsRtFallback =
        options.allowEmergencyGtfsRtFallback ??
        (window.CITY_CONFIG && window.CITY_CONFIG.allowEmergencyGtfsRtFallback) ??
        true; // keep map usable if V3 proxy is down

      const isTimeoutAbort = (err) => {
        if (!err) return false;
        return err.name === 'AbortError' || String(err).includes('timed out') || String(err).includes('AbortError');
      };
      
      async function fetchAndDisplayBuses() {
        if (busesFetchInFlight) {
          // Avoid overlapping V3/GTFS requests (can pile up when upstream is slow)
          console.log('[attachRouteToMap] Bus fetch skipped (in-flight)', { routeId, directionId, busesFetchSeq });
          return;
        }
        busesFetchSeq += 1;
        const seq = busesFetchSeq;
        busesFetchInFlight = true;
        try {
          let allBuses = [];
          
          console.log('[attachRouteToMap] fetchAndDisplayBuses start', {
            seq,
            routeId,
            directionId,
            busApiType,
            disableGtfsRt,
            gtfsRtUrl,
            now: new Date().toISOString()
          });
          
          // V3-only fast path (GTFS-RT disabled): skip protobuf fetch/parse and any GTFS-RT matching work
          if (busApiType === 'mbta-gtfs-rt' && disableGtfsRt) {
            const routeNum = String(routeId);
            console.log('[attachRouteToMap] V3-only mode', { seq, routeNum, directionId });
            
            // Remove old bus markers first (so stale markers don't linger if fetch fails)
            Object.keys(busMarkers).forEach(vehicleId => {
              const marker = busMarkers[vehicleId];
              if (marker && typeof marker.remove === "function") {
                marker.remove();
                const index = overlayElements.markers.indexOf(marker);
                if (index > -1) overlayElements.markers.splice(index, 1);
              }
              delete busMarkers[vehicleId];
            });
            
            let v3VehiclesForMarkers = [];
            try {
              const t0 = performance.now();
              v3VehiclesForMarkers = await fetchMBTAV3Vehicles(routeNum, directionId);
              const t1 = performance.now();
              console.log('[attachRouteToMap] V3 vehicles fetch done', { seq, routeNum, directionId, ms: Math.round(t1 - t0), count: v3VehiclesForMarkers.length });
              console.log(`[attachRouteToMap] Fetched ${v3VehiclesForMarkers.length} V3 vehicles for bus markers`);
            } catch (v3Error) {
              console.warn('[attachRouteToMap] V3 vehicles unavailable:', v3Error);
              v3VehiclesForMarkers = [];

              // Emergency fallback: V3 proxy can hang for long periods. If allowed, do a single GTFS-RT pull
              // (throttled) so users still see live vehicles.
              const now = Date.now();
              const canFallback =
                allowEmergencyGtfsRtFallback &&
                gtfsRtUrl &&
                isTimeoutAbort(v3Error) &&
                (now - lastEmergencyGtfsRtFallbackAt) > 120000; // max once per 2 minutes per overlay

              if (canFallback) {
                lastEmergencyGtfsRtFallbackAt = now;
                console.warn('[attachRouteToMap] V3 timed out; trying emergency GTFS-RT fallback once', { seq, routeNum, directionId, gtfsRtUrl });
                try {
                  const controller = new AbortController();
                  const timeout = setTimeout(() => controller.abort(), 12000);
                  const res = await fetch(gtfsRtUrl, { signal: controller.signal });
                  clearTimeout(timeout);
                  if (!res.ok) throw new Error(`GTFS-RT HTTP ${res.status}: ${res.statusText}`);
                  const buffer = await res.arrayBuffer();
                  const allRt = await parseMBTAGTFSRT(buffer);
                  const fallback = allRt.filter(v => String(v.routeNumber) === String(routeNum) && v.direction == directionId);
                  v3VehiclesForMarkers = fallback;
                  console.warn('[attachRouteToMap] Emergency GTFS-RT fallback vehicles', { seq, routeNum, directionId, count: fallback.length });
                } catch (rtErr) {
                  console.warn('[attachRouteToMap] Emergency GTFS-RT fallback failed', rtErr);
                }
              }
            }
            
            overlayElements.busPopupRefreshers.length = 0;
            // Create markers for buses (same ETA/occupancy refresh pattern as GTFS-RT path)
            v3VehiclesForMarkers.forEach(bus => {
              if (!bus.latitude || !bus.longitude) return;
              const blockId = bus.blockID || bus.vehicleID || '';
              if (!blockId) return;
              
              const displayVehicleID = (bus.vehicleID || '').replace(/\D/g, '') || bus.vehicleID;
              const vidKey = bus.vehicleID != null ? String(bus.vehicleID) : '';
              
              const getNextStopFromETAs = () => {
                const etas = window.currentRouteETAs;
                if (!etas || !etas.vehicleETAs || !vidKey) return null;
                const list = etas.vehicleETAs[bus.vehicleID] || etas.vehicleETAs[vidKey];
                if (!list || !list.length) return null;
                const nextPred = list[0];
                return { stopName: nextPred.stopName, eta: formatETA(nextPred.etaDate || new Date(nextPred.eta)) };
              };
              const getOccupancyTextLive = () => {
                const vi = window.currentRouteETAs?.vehicleInfo;
                const occ =
                  (vi && vidKey && vi[bus.vehicleID]?.occupancy_status) ||
                  (vi && vidKey && vi[vidKey]?.occupancy_status) ||
                  bus.occupancy ||
                  null;
                return occ ? formatOccupancy(occ) : 'Unknown';
              };
              
              const busElement = document.createElement('div');
              busElement.style.textAlign = 'center';
              busElement.innerHTML = `
                <div style='background:${routeColor};color:#fff;padding:3px 8px;border-radius:8px;font-weight:bold;font-size:11px;box-shadow:0 2px 4px rgba(0,0,0,0.3);border:2px solid #fff;'>
                  <span style='background:#fff;color:${routeColor};padding:1px 3px;border-radius:2px;font-size:9px;margin-right:4px;'>${routeNum}</span>${displayVehicleID}
                </div>
                <div style='width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:12px solid ${routeColor};margin:auto;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.3));'></div>
              `;
              
              const busMarker = new maplibregl.Marker({ element: busElement }).setLngLat([bus.longitude, bus.latitude]);
              const directionText = bus.direction === 1 ? 'Inbound' : bus.direction === 0 ? 'Outbound' : bus.direction;
              const popupContent = document.createElement('div');
              const refreshBusPopup = () => {
                const nextStopETA = getNextStopFromETAs();
                let nextStopHTML = nextStopETA
                  ? `<div style='margin-bottom:4px;'><strong>Next Stop:</strong> ${nextStopETA.stopName}</div><div style='margin-bottom:4px; color:#4CAF50;'><strong>ETA:</strong> ${nextStopETA.eta}</div>`
                  : '<div style="margin-bottom:4px; color:#888;"><strong>Next Stop:</strong> Loading…</div>';
                popupContent.innerHTML = `
                <div style='border:1px solid ${routeColor}; border-radius:8px; padding:10px; background:#222; color:#fff; min-width:180px;'>
                  <div style='text-align:center; margin-bottom:6px;'>
                    <div style='background:${routeColor};color:#fff;padding:3px 8px;border-radius:6px;font-weight:bold;font-size:12px;'>🚌 Bus ${displayVehicleID}</div>
                  </div>
                  <div style='margin-bottom:4px;'><strong>Route:</strong> ${routeNum}</div>
                  <div style='margin-bottom:4px;'><strong>Direction:</strong> ${directionText}</div>
                  ${nextStopHTML}
                  <div style='margin-bottom:4px;'><strong>Occupancy:</strong> ${getOccupancyTextLive()}</div>
                </div>
              `;
              };
              refreshBusPopup();
              overlayElements.busPopupRefreshers.push(refreshBusPopup);
              busMarker.setPopup(new maplibregl.Popup().setDOMContent(popupContent));
              busMarker.addTo(map);
              
              busMarkers[bus.vehicleID] = busMarker;
              overlayElements.markers.push(busMarker);
            });
            
            console.log(`[attachRouteToMap] Displayed ${v3VehiclesForMarkers.length} buses for route ${routeNum} direction ${directionId}`);
            return;
          }
          
          if (busApiType === 'mbta-gtfs-rt' && gtfsRtUrl && !disableGtfsRt) {
            // MBTA GTFS-RT feed
            console.log('[attachRouteToMap] Fetching MBTA GTFS-RT feed:', gtfsRtUrl);
            const res = await fetch(gtfsRtUrl);
            console.log('[attachRouteToMap] Fetch response status:', res.status, res.statusText);
            if (!res.ok) {
              throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            const buffer = await res.arrayBuffer();
            console.log('[attachRouteToMap] Received buffer size:', buffer.byteLength, 'bytes');
            
            // Check content type
            const contentType = res.headers.get('content-type');
            console.log('[attachRouteToMap] Response Content-Type:', contentType);
            
            // Log first few bytes to verify it's protobuf
            const uint8Preview = new Uint8Array(buffer.slice(0, 50));
            console.log('[attachRouteToMap] First 50 bytes (hex):', Array.from(uint8Preview).map(b => b.toString(16).padStart(2, '0')).join(' '));
            
            try {
              allBuses = await parseMBTAGTFSRT(buffer);
              console.log('[attachRouteToMap] Parsed', allBuses.length, 'vehicles from MBTA GTFS-RT');
            } catch (parseError) {
              console.error('[attachRouteToMap] Error parsing GTFS-RT:', parseError);
              console.error('[attachRouteToMap] Parse error stack:', parseError.stack);
              throw parseError;
            }
            
            if (allBuses.length === 0) {
              console.warn('[attachRouteToMap] ⚠️ No buses found in GTFS-RT feed. This could mean:');
              console.warn('[attachRouteToMap]   1. No buses are currently running');
              console.warn('[attachRouteToMap]   2. The feed is empty or malformed');
              console.warn('[attachRouteToMap]   3. There was a parsing error');
            }
          } else {
            if (busApiType === 'mbta-gtfs-rt' && disableGtfsRt) {
              console.log('[attachRouteToMap] GTFS-RT disabled; using V3 vehicles only');
            } else {
              console.warn('[attachRouteToMap] MBTA GTFS-RT not configured. busApiType:', busApiType, 'gtfsRtUrl:', gtfsRtUrl);
            }
          }
          
          // Filter buses for this route and direction
          // For MBTA, routeId might be a string like "1", "Red", "Green-B", etc.
          // Also check routeData.route_id if available (from routes_index.js)
          const routeNum = String(routeId);
          const routeDataRouteId = routeData?.route_id || routeData?.meta?.route_id || null;
          
          // Debug: Log what we're looking for and what we have
          console.log(`[attachRouteToMap] Looking for route: "${routeNum}"${routeDataRouteId ? ` (route_id: "${routeDataRouteId}")` : ''}, direction: ${directionId}`);
          if (allBuses.length > 0) {
            const uniqueRoutes = [...new Set(allBuses.map(v => v.routeNumber))];
            console.log(`[attachRouteToMap] Available routes in GTFS-RT:`, uniqueRoutes.slice(0, 20));
            const uniqueDirections = [...new Set(allBuses.map(v => v.direction))];
            console.log(`[attachRouteToMap] Available directions:`, uniqueDirections);
            
            // Show sample buses for debugging
            const sampleBuses = allBuses.slice(0, 5);
            console.log(`[attachRouteToMap] Sample buses:`, sampleBuses.map(v => ({ route: v.routeNumber, dir: v.direction, vehicle: v.vehicleID })));
          }
          
          // Normalize route for comparison: "7" and "07" and 7 should match
          const normalizeRouteId = (r) => {
            const s = String(r || '').trim();
            const digits = s.replace(/[^0-9]/g, '');
            return digits ? { str: s, numeric: digits.replace(/^0+/, '') || digits } : { str: s, numeric: '' };
          };
          const routeNorm = normalizeRouteId(routeNum);
          const routeDataNorm = routeDataRouteId ? normalizeRouteId(routeDataRouteId) : null;
          
          const routeBuses = allBuses.filter(v => {
            const vNorm = normalizeRouteId(v.routeNumber);
            // 1. Exact string match
            const exactMatch = String(v.routeNumber) === routeNum;
            // 2. Match with routeData.route_id
            const routeIdMatch = routeDataNorm && vNorm.str === routeDataNorm.str;
            // 3. Numeric match: "7", "07", 7 all match
            const numericMatch = routeNorm.numeric && vNorm.numeric && routeNorm.numeric === vNorm.numeric;
            // 4. Fallback string match
            const stringMatch = String(v.routeNumber) === String(routeId);
            
            const routeMatch = exactMatch || routeIdMatch || numericMatch || stringMatch;
            const directionMatch = v.direction == directionId;
            
            if (routeMatch && directionMatch) {
              console.log(`[attachRouteToMap] ✅ Matched bus: route "${v.routeNumber}" == "${routeNum}"${routeDataRouteId ? ` (route_id: "${routeDataRouteId}")` : ''}, direction ${v.direction} == ${directionId}`);
            }
            
            return routeMatch && directionMatch;
          });
          
          // V3 Fallback: If GTFS-RT parsed vehicles but none matched route+direction
          const totalParsedVehicles = allBuses.length;
          if (!disableGtfsRt && busApiType === 'mbta-gtfs-rt' && totalParsedVehicles > 0 && routeBuses.length === 0) {
            console.warn(`[attachRouteToMap] GTFS-RT parsed ${totalParsedVehicles} vehicles but 0 matched route "${routeNum}" direction ${directionId}. Trying V3 fallback...`);
            try {
              // Use routeNum (already defined in this scope from line 1434)
              const v3Vehicles = await fetchMBTAV3VehiclesFallback(routeNum);
              
              // Client-filter by direction
              let filteredV3Vehicles = v3Vehicles.filter(v => v.direction == directionId);
              
              if (filteredV3Vehicles.length === 0 && v3Vehicles.length > 0) {
                console.warn(`[attachRouteToMap] MBTA direction mismatch — showing route vehicles only`);
                filteredV3Vehicles = v3Vehicles; // Show all route vehicles if direction doesn't match
              }
              
              if (filteredV3Vehicles.length > 0) {
                // Convert V3 vehicles to same format and add to routeBuses
                filteredV3Vehicles.forEach(v => {
                  routeBuses.push(v);
                });
                console.log(`[attachRouteToMap] V3 fallback added ${filteredV3Vehicles.length} vehicles`);
              }
            } catch (v3Error) {
              console.warn('[attachRouteToMap] V3 fallback failed:', v3Error);
              // Continue with empty routeBuses - don't break anything
            }
          }
          
          overlayElements.busPopupRefreshers.length = 0;
          // Remove old bus markers from map and overlayElements
          Object.keys(busMarkers).forEach(vehicleId => {
            const marker = busMarkers[vehicleId];
            if (marker && typeof marker.remove === "function") {
              marker.remove();
              // Remove from overlayElements.markers
              const index = overlayElements.markers.indexOf(marker);
              if (index > -1) {
                overlayElements.markers.splice(index, 1);
              }
            }
            delete busMarkers[vehicleId];
          });
          
          // ⚠️ SANITY CHECK: Vehicles are fetched ONCE by (routeId, directionId), not per shape
          // This ensures no duplicate vehicle markers even when multiple shapes exist for the route
          // Vehicles are keyed by vehicleId, so duplicates are naturally prevented
          //
          // Live vehicles: GTFS-RT is primary for coordinates/positions.
          // V3 vehicles is optional enrichment only (do NOT block markers on it).
          let v3VehiclesForMarkers = routeBuses;
          let v3ByVehicleId = null;
          if (busApiType === 'mbta-gtfs-rt') {
            try {
              const v3Vehicles = await fetchMBTAV3Vehicles(routeNum, directionId);
              console.log(`[attachRouteToMap] (Enrichment) Fetched ${v3Vehicles.length} V3 vehicles`);
              v3ByVehicleId = Object.create(null);
              v3Vehicles.forEach(v => { if (v && v.vehicleID) v3ByVehicleId[v.vehicleID] = v; });
            } catch (v3Error) {
              console.warn('[attachRouteToMap] (Enrichment) V3 vehicles unavailable:', v3Error);
            }
          }
          
          // Create markers for buses (matching "All Buses Mode" style)
          // Note: Vehicles are deduped by vehicleId, so no duplicates even with multiple shapes
          v3VehiclesForMarkers.forEach(bus => {
            if (!bus.latitude || !bus.longitude) return;
            const blockId = bus.blockID || bus.vehicleID || '';
            if (!blockId) return;
            
            // Get occupancy from vehicleInfo if available
            const v3Enriched = v3ByVehicleId && bus.vehicleID ? v3ByVehicleId[bus.vehicleID] : null;
            const occupancy = (v3Enriched && v3Enriched.occupancy) || bus.occupancy || 
                            (window.currentRouteETAs && window.currentRouteETAs.vehicleInfo && 
                             window.currentRouteETAs.vehicleInfo[bus.vehicleID]?.occupancy_status) || 
                            null;
            const occupancyText = occupancy ? formatOccupancy(occupancy) : 'Unknown';
            
            // Format vehicle ID for display (remove non-numeric characters, visual only)
            const displayVehicleID = (bus.vehicleID || '').replace(/\D/g, '') || bus.vehicleID;
            
            const vidKey = bus.vehicleID != null ? String(bus.vehicleID) : '';
            
            const getNextStopFromETAs = () => {
              const etas = window.currentRouteETAs;
              if (!etas || !etas.vehicleETAs || !vidKey) return null;
              const list = etas.vehicleETAs[bus.vehicleID] || etas.vehicleETAs[vidKey];
              if (!list || !list.length) return null;
              const nextPred = list[0];
              return {
                stopName: nextPred.stopName,
                eta: formatETA(nextPred.etaDate || new Date(nextPred.eta))
              };
            };
            
            const getOccupancyTextLive = () => {
              const vi = window.currentRouteETAs?.vehicleInfo;
              const occ =
                (vi && vidKey && vi[bus.vehicleID]?.occupancy_status) ||
                (vi && vidKey && vi[vidKey]?.occupancy_status) ||
                (v3Enriched && v3Enriched.occupancy) ||
                bus.occupancy ||
                null;
              return occ ? formatOccupancy(occ) : 'Unknown';
            };
            
            // Create bus marker element matching createBusMarker style
            const busElement = document.createElement('div');
            busElement.style.textAlign = 'center';
            busElement.innerHTML = `
              <div style='background:${routeColor};color:#fff;padding:3px 8px;border-radius:8px;font-weight:bold;font-size:11px;box-shadow:0 2px 4px rgba(0,0,0,0.3);border:2px solid #fff;'>
                <span style='background:#fff;color:${routeColor};padding:1px 3px;border-radius:2px;font-size:9px;margin-right:4px;'>${routeNum}</span>${displayVehicleID}
              </div>
              <div style='width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:12px solid ${routeColor};margin:auto;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.3));'></div>
            `;
            
            const busMarker = new maplibregl.Marker({
              element: busElement
            });
            busMarker.setLngLat([bus.longitude, bus.latitude]);
            
            const popupContent = document.createElement('div');
            const directionText = bus.direction === 1 ? 'Inbound' : bus.direction === 0 ? 'Outbound' : bus.direction;
            
            const refreshBusPopup = () => {
              const nextStopETA = getNextStopFromETAs();
              let nextStopHTML = '';
              if (nextStopETA) {
                nextStopHTML = `<div style='margin-bottom:4px;'><strong>Next Stop:</strong> ${nextStopETA.stopName}</div><div style='margin-bottom:4px; color:#4CAF50;'><strong>ETA:</strong> ${nextStopETA.eta}</div>`;
              } else {
                nextStopHTML = '<div style="margin-bottom:4px; color:#888;"><strong>Next Stop:</strong> Loading…</div>';
              }
              popupContent.innerHTML = `
              <div style='border:1px solid ${routeColor}; border-radius:8px; padding:10px; background:#222; color:#fff; min-width:180px;'>
                <div style='text-align:center; margin-bottom:6px;'>
                  <div style='background:${routeColor};color:#fff;padding:3px 8px;border-radius:6px;font-weight:bold;font-size:12px;'>🚌 Bus ${displayVehicleID}</div>
                </div>
                <div style='margin-bottom:4px;'><strong>Route:</strong> ${routeNum}</div>
                <div style='margin-bottom:4px;'><strong>Direction:</strong> ${directionText}</div>
                ${nextStopHTML}
                <div style='margin-bottom:4px;'><strong>Occupancy:</strong> ${getOccupancyTextLive()}</div>
              </div>
            `;
            };
            
            refreshBusPopup();
            overlayElements.busPopupRefreshers.push(refreshBusPopup);
            
            const popup = new maplibregl.Popup().setDOMContent(popupContent);
            busMarker.setPopup(popup);
            busMarker.addTo(map);
            
            busMarkers[bus.vehicleID] = busMarker;
            overlayElements.markers.push(busMarker);
          });
          
          console.log(`[attachRouteToMap] Displayed ${v3VehiclesForMarkers.length} buses for route ${routeNum} direction ${directionId}`);
          
          if (routeBuses.length === 0 && allBuses.length > 0) {
            console.warn(`[attachRouteToMap] ⚠️ No buses matched for route "${routeNum}" direction ${directionId}, but ${allBuses.length} total buses found in feed`);
            console.warn(`[attachRouteToMap] This suggests a route ID mismatch. Check route matching logic.`);
          }
        } catch (error) {
          console.error('[attachRouteToMap] Error fetching buses:', error);
          console.error('[attachRouteToMap] Error stack:', error.stack);
        } finally {
          console.log('[attachRouteToMap] fetchAndDisplayBuses end', { seq, routeId, directionId });
          busesFetchInFlight = false;
        }
      }
      
      // Fetch buses immediately
      fetchAndDisplayBuses();
      
      // Update buses every 30 seconds (V3 proxy can be slow; avoid stacking requests)
      const busInterval = setInterval(fetchAndDisplayBuses, 30000);
      overlayElements.intervals.push(busInterval);
      
      // MBTA V3 ETAs: Fetch and display predictions, store in global lookup
      let etaInterval = null;
      if (busApiType === 'mbta-gtfs-rt') {
        // Get route number for ETA calls (same logic as in fetchAndDisplayBuses)
        const routeNumForETAs = String(routeId);
        
        const fetchETAs = async () => {
          try {
            const { predictions, stopETAs, vehicleInfo, stopIdByName, vehicleETAs } = await fetchMBTAV3Predictions(routeNumForETAs, directionId);
            
            console.log('[fetchETAs] Received vehicleETAs from fetchMBTAV3Predictions:', !!vehicleETAs);
            console.log('[fetchETAs] vehicleETAs count:', vehicleETAs ? Object.keys(vehicleETAs).length : 0);
            
            // Store in global currentRouteETAs for stop popups and bus markers
            window.currentRouteETAs = {
              overlayKey: options.overlayKey || `${routeId}-${directionId}`,
              routeId: routeNumForETAs,
              directionId: directionId,
              stopETAs: stopETAs,
              vehicleInfo: vehicleInfo,
              stopIdByName: stopIdByName,
              vehicleETAs: vehicleETAs, // Lookup by vehicleId
              fetchedAt: new Date()
            };
            
            console.log('[fetchETAs] Stored vehicleETAs with', Object.keys(vehicleETAs).length, 'vehicles');
            console.log('[fetchETAs] Sample vehicle IDs in stored data:', Object.keys(vehicleETAs).slice(0, 10));
            
            // Display ETAs in bottom panel (bulk list)
            displayETAs(predictions);
            
            const etaOverlayKey = options.overlayKey || `${routeId}-${directionId}`;
            overlayElements.stopPopupRefreshers.forEach(({ overlayKey, update }) => {
              if (overlayKey === etaOverlayKey) {
                try { update(); } catch (e) {}
              }
            });
            overlayElements.busPopupRefreshers.forEach(fn => {
              try { fn(); } catch (e) {}
            });
          } catch (error) {
            console.warn('[attachRouteToMap] V3 ETAs unavailable:', error);
            // Clear global state on error
            window.currentRouteETAs = null;
            const etaPanel = document.getElementById('etaPanel');
            if (etaPanel) etaPanel.style.display = 'none';
          }
        };
        
        // Fetch ETAs immediately
        fetchETAs();
        
        // Update ETAs every 25 seconds
        etaInterval = setInterval(fetchETAs, 25000);
        overlayElements.intervals.push(etaInterval);
      }

      // GTFS-RT TripUpdates enrichment (non-blocking)
      let tripUpdatesInterval = null;
      if (busApiType === 'mbta-gtfs-rt' && gtfsRtTripUpdatesUrl) {
        const overlayKey = options.overlayKey || `${routeId}-${directionId}`;
        const fetchTripUpdates = async () => {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(gtfsRtTripUpdatesUrl, { signal: controller.signal });
            clearTimeout(timeout);
            if (!res.ok) throw new Error(`TripUpdates HTTP ${res.status}: ${res.statusText}`);
            const buffer = await res.arrayBuffer();
            const parsed = parseMBTAGTFSTripUpdates(buffer);
            window.currentRouteTripUpdates = {
              overlayKey,
              routeId: String(routeId),
              directionId,
              updatesByStopId: parsed.updatesByStopId,
              fetchedAt: new Date()
            };
            overlayElements.stopPopupRefreshers.forEach(({ overlayKey: ok, update }) => {
              if (ok === overlayKey) {
                try { update(); } catch (e) {}
              }
            });
          } catch (e) {
            // Don't nuke existing data on transient errors; just log.
            console.warn('[TripUpdates] Unavailable:', e);
          }
        };
        fetchTripUpdates();
        tripUpdatesInterval = setInterval(fetchTripUpdates, 30000);
        overlayElements.intervals.push(tripUpdatesInterval);
      }
    }
  };

  // ==== Wait for map load if needed ==========================================
  if (map.loaded && map.loaded()) {
    addRouteToMap();
  } else {
    map.once("load", addRouteToMap);
  }

  // ==== Cleanup handle =======================================================
  return {
    remove: function () {
      // Hide ETA panel when route overlay is removed
      const etaPanel = document.getElementById('etaPanel');
      if (etaPanel) {
        etaPanel.style.display = 'none';
      }
      
      // Clear global currentRouteETAs when this overlay is removed
      const thisOverlayKey = options.overlayKey || `${routeId}-${directionId}`;
      if (window.currentRouteETAs && window.currentRouteETAs.overlayKey === thisOverlayKey) {
        window.currentRouteETAs = null;
      }
      if (window.currentRouteTripUpdates && window.currentRouteTripUpdates.overlayKey === thisOverlayKey) {
        window.currentRouteTripUpdates = null;
      }

      // Safety: ensure any bus markers created for this overlay are removed
      try {
        Object.keys(busMarkers || {}).forEach(vehicleId => {
          const marker = busMarkers[vehicleId];
          if (marker && typeof marker.remove === 'function') marker.remove();
          delete busMarkers[vehicleId];
        });
      } catch (e) {}
      
      // Layers
      overlayElements.layers.forEach((layerId) => {
        if (map.getLayer && map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
      });

      // Sources
      overlayElements.sources.forEach((sourceId) => {
        if (map.getSource && map.getSource(sourceId)) {
          map.removeSource(sourceId);
        }
      });

      // Markers
      overlayElements.markers.forEach((marker) => {
        if (marker && typeof marker.remove === "function") marker.remove();
      });

      // Controls / panels
      overlayElements.controls.forEach((el) => {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });

      // Intervals (bus tracking)
      overlayElements.intervals.forEach((interval) => {
        if (interval) clearInterval(interval);
      });

      overlayElements.sources  = [];
      overlayElements.layers   = [];
      overlayElements.markers  = [];
      overlayElements.controls = [];
      overlayElements.intervals = [];
    }
  };
}

// Expose globally for both route pages and main map
window.attachRouteToMap = attachRouteToMap;

