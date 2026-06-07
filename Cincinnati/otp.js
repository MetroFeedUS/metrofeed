/**
 * OTP (OpenTripPlanner) Integration Module for MetroFeed
 * Handles trip planning, itinerary rendering, and route visualization
 * Uses OTP 2.9 GraphQL API (Transmodel v3)
 */

// OTP State Variables
let currentItins = null; // Store current itineraries globally
let routePolylines = []; // Store route polylines for cleanup
let routeStopMarkers = [];
let activeTripSelected = false; // Track if user has selected a trip option

// Array of distinct colors for individual route legs (MetroFeed colors)
const legColors = [
  '#FB4F14', // MetroFeed Orange (Denver Broncos style)
  '#1E3A8A', // MetroFeed Blue (Denver Broncos style) 
  '#8B5CF6', // Purple
  '#A0522D'  // Brown
];

// Keep walk color consistent
const WALK_COLOR = "#666";

// Export constants to window for global access
window.legColors = legColors;
window.WALK_COLOR = WALK_COLOR;

// Debug modal system
let debugLogs = [];
let debugModalOpen = false;

// TEMP WORKAROUND (can remove later):
// If the OTP server's schedule data is stale, clamp "now" into the last available service window
// so the UI still returns trip options while the site is under active development.
// Set `window.OTP_ALLOW_STALE_CLAMP = false` in DevTools to disable.
if (typeof window !== 'undefined' && typeof window.OTP_ALLOW_STALE_CLAMP === 'undefined') {
  window.OTP_ALLOW_STALE_CLAMP = true;
}

/**
 * Add a debug log entry
 * @param {string} step - Step name (e.g., "Route Extraction", "Branch Determination")
 * @param {Object} data - Data to display
 * @param {string} decision - Human-readable decision/result
 */
function addDebugLog(step, data, decision) {
  debugLogs.push({
    step,
    data: JSON.parse(JSON.stringify(data)), // Deep clone
    decision,
    timestamp: new Date().toISOString()
  });
}

/**
 * Trip-planning console helper. In DevTools filter: OTP_DEBUG
 * @param {string} stage - Short label
 * @param {object} [payload] - Serializable context
 */
function logOtpDebug(stage, payload) {
  if (payload !== undefined) {
    console.log('[OTP_DEBUG]', stage, payload);
  } else {
    console.log('[OTP_DEBUG]', stage);
  }
}

function getOtpGtfsGraphqlEndpoint() {
  const cfg = (typeof window !== 'undefined' && window.CITY_CONFIG) ? window.CITY_CONFIG
    : (typeof CITY_CONFIG !== 'undefined' ? CITY_CONFIG : null);
  return cfg?.otpGtfsGraphql || 'https://otp.metrofeedus.com/otp/gtfs/v1';
}

/** Cached GTFS service calendar (Unix seconds); OTP refuses trips outside this window. */
let otpServiceRangeCache = null;
let otpServiceRangePromise = null;

async function getOtpServiceTimeRangeSec() {
  if (otpServiceRangeCache) return otpServiceRangeCache;
  if (otpServiceRangePromise) return otpServiceRangePromise;
  const endpoint = getOtpGtfsGraphqlEndpoint();
  otpServiceRangePromise = fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ serviceTimeRange { start end } }' })
  })
    .then((r) => r.json())
    .then((j) => {
      const t = j.data && j.data.serviceTimeRange;
      if (!t || typeof t.start !== 'number' || typeof t.end !== 'number') {
        otpServiceRangeCache = null;
        return null;
      }
      otpServiceRangeCache = { start: t.start, end: t.end };
      logOtpDebug('SERVICE_TIME_RANGE', otpServiceRangeCache);
      return otpServiceRangeCache;
    })
    .catch((e) => {
      console.warn('[OTP] serviceTimeRange fetch failed:', e);
      return null;
    })
    .finally(() => {
      otpServiceRangePromise = null;
    });
  return otpServiceRangePromise;
}

/**
 * Pick a trip search time in ms, clamped to loaded GTFS service period.
 * When "now" is after the feed end (common when GTFS is stale), we clamp so routing still returns options.
 */
async function resolveOtpTripDateTimeMs(departureType, departureTime) {
  let ms = Date.now();
  if (departureType === 'departure' && departureTime) {
    const depDate = new Date(departureTime);
    if (!isNaN(depDate.getTime())) {
      ms = depDate.getTime();
    }
  }

  // If user picked a specific departure time, do NOT clamp it.
  // Clamping is only for "now" (and only when enabled) so dev builds can still show *something*
  // when the server's GTFS is stale.
  const allowClamp =
    typeof window !== 'undefined'
      ? window.OTP_ALLOW_STALE_CLAMP === true && departureType !== 'departure'
      : departureType !== 'departure';

  if (!allowClamp) {
    return { ms, clampNote: null, range: null };
  }

  const range = await getOtpServiceTimeRangeSec();
  let clampNote = null;
  if (range) {
    const startMs = range.start * 1000;
    const endMs = range.end * 1000;
    if (ms < startMs) {
      ms = startMs + 5 * 60 * 1000;
      clampNote = 'before_service_period';
    } else if (ms > endMs) {
      ms = Math.max(startMs + 5 * 60 * 1000, endMs - 60 * 60 * 1000);
      clampNote = 'after_service_period';
    }
  }
  return { ms, clampNote, range };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function otpLegModeIsWalk(mode) {
  const m = String(mode || '').toLowerCase();
  return m === 'walk' || m === 'foot' || m === 'bicycle';
}

function otpItineraryHasTransit(itin) {
  return (itin && itin.legs ? itin.legs : []).some((leg) => !otpLegModeIsWalk(leg.mode));
}

function otpTripPatternHasTransit(pattern) {
  return (pattern && pattern.legs ? pattern.legs : []).some((leg) => !otpLegModeIsWalk(leg.mode));
}

function otpFirstRoutingError(errors) {
  return Array.isArray(errors) && errors.length ? errors[0] : null;
}

/** OTP often returns a long walk-only pattern when routing fails; do not treat that as a transit trip. */
function otpRenderNoTransitFound(itinList, routingErrors, extraHint) {
  const rErr = otpFirstRoutingError(routingErrors);
  const detail = rErr && (rErr.description || rErr.code) ? escapeHtml(rErr.description || rErr.code) : '';
  const hint =
    extraHint ||
    'Try tapping closer to a bus stop, or open a nearby route from the map. The trip planner needs a working transit graph on the server.';
  const hintHtml = hint
    ? `<div style="color:#aaa;font-size:12px;margin-top:8px;line-height:1.35;">${escapeHtml(hint)}</div>`
    : '';
  const detailHtml = detail
    ? `<div style="color:#aaa;font-size:12px;margin-top:8px;line-height:1.35;">${detail}</div>`
    : '';
  itinList.innerHTML =
    `<em style='color: #f55;'>No transit trips found.</em>${detailHtml}${hintHtml}`;
  try {
    if (typeof window.metrofeedAnnounceKey === 'function') window.metrofeedAnnounceKey('sr_no_trips_found');
    else if (typeof window.metrofeedAnnounce === 'function') window.metrofeedAnnounce('No transit trips found.');
  } catch (_) {}
}

function otpFmtCoord(n) {
  const x = Number(n);
  if (!isFinite(x)) return '0';
  return x.toFixed(6);
}

/**
 * GTFS GraphQL fallback: OTP 2.x uses planConnection(origin/destination, dateTime, modes) and returns edges { node { legs } }.
 * Older from/to/itineraries queries are invalid on current servers.
 */
async function fetchGtfsPlanItineraries({ fromLat, fromLon, toLat, toLon, dateTimeIso }) {
  const endpoint = getOtpGtfsGraphqlEndpoint();
  const when = dateTimeIso || new Date().toISOString();

  const query = `
    query GtfsPlanFallback($when: OffsetDateTime!) {
      planConnection(
        origin: { location: { coordinate: { latitude: ${otpFmtCoord(fromLat)}, longitude: ${otpFmtCoord(fromLon)} } } }
        destination: { location: { coordinate: { latitude: ${otpFmtCoord(toLat)}, longitude: ${otpFmtCoord(toLon)} } } }
        dateTime: { earliestDeparture: $when }
        modes: { direct: [WALK], transit: { transit: [{ mode: BUS }, { mode: RAIL }, { mode: SUBWAY }, { mode: TRAM }, { mode: FERRY }] } }
        first: 8
      ) {
        routingErrors { code description }
        edges {
          node {
            duration
            start
            end
            legs {
              mode
              distance
              duration
              startTime
              endTime
              from { name lat lon }
              to { name lat lon }
              legGeometry { points }
              route { shortName longName }
              trip { gtfsId }
            }
          }
        }
      }
    }
  `;

  logOtpDebug('GTFS_FETCH', { label: 'planConnection', endpoint, when });
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { when } })
  });
  logOtpDebug('GTFS_HTTP', { ok: res.ok, status: res.status, statusText: res.statusText });
  const json = await res.json();
  logOtpDebug('GTFS_SHAPE', {
    hasErrors: Array.isArray(json.errors) && json.errors.length > 0,
    errorMessages: json.errors?.map((e) => e.message) || [],
    hasData: !!json.data
  });

  if (json.errors && json.errors.length) {
    console.warn('[OTP] GTFS planConnection GraphQL errors:', json.errors);
  }

  const pcon = json.data && json.data.planConnection;
  const routingErrors = (pcon && pcon.routingErrors) || [];
  if (routingErrors.length) {
    logOtpDebug('GTFS_ROUTING_ERRORS', routingErrors);
  }

  const edges = (pcon && pcon.edges) || [];
  const nodes = edges.map((e) => e && e.node).filter(Boolean);
  if (!nodes.length) {
    return [];
  }

  const itins = nodes.map((node) => ({
    startTime: node.start,
    endTime: node.end,
    duration: node.duration,
    legs: node.legs || []
  }));

  // Convert GTFS GraphQL itinerary -> existing internal itinerary shape used by normalizeItineraries/renderItinListVisual
  const converted = itins.map((itin) => {
    const startTime = itin.startTime;
    const endTime = itin.endTime;
    const duration = itin.duration;

    const legs = (itin.legs || []).map((leg) => {
      const normalizedModeRaw = (leg.mode || '').toString();
      const normalizedMode = normalizedModeRaw.toUpperCase();

      const fromPlace = leg.from ? {
        name: leg.from.name,
        latitude: leg.from.lat,
        longitude: leg.from.lon,
        vertexType: null
      } : null;
      const toPlace = leg.to ? {
        name: leg.to.name,
        latitude: leg.to.lat,
        longitude: leg.to.lon,
        vertexType: null
      } : null;

      const routeShortName = leg.route?.shortName || null;
      const routeLongName = leg.route?.longName || routeShortName || null;

      const convertedLeg = {
        mode: normalizedMode === 'CAR' ? 'WALK' : normalizedMode, // defensive: keep non-transit oddities from breaking UI
        duration: leg.duration,
        distance: leg.distance,
        fromPlace,
        toPlace,
        from: fromPlace ? { name: fromPlace.name, lat: fromPlace.latitude, lon: fromPlace.longitude } : null,
        to: toPlace ? { name: toPlace.name, lat: toPlace.latitude, lon: toPlace.longitude } : null,
        pointsOnLink: leg.legGeometry?.points ? { points: leg.legGeometry.points } : null
      };

      if (routeShortName || routeLongName) {
        convertedLeg.route = routeShortName || routeLongName;
        convertedLeg.routeShortName = routeShortName || convertedLeg.route;
        convertedLeg.routeLongName = routeLongName || convertedLeg.route;
        convertedLeg.line = { publicCode: convertedLeg.routeShortName, name: convertedLeg.routeLongName };
      }

      if (leg.trip?.gtfsId) {
        convertedLeg.tripId = leg.trip.gtfsId;
        convertedLeg.serviceJourney = { id: leg.trip.gtfsId };
      }

      return convertedLeg;
    });

    return { startTime, endTime, duration, legs };
  });

  return converted;
}

/**
 * Show debug modal with all collected logs
 */
function showDebugModal() {
  if (debugModalOpen) return; // Prevent multiple modals
  
  debugModalOpen = true;
  
  const modal = document.createElement('div');
  modal.id = 'otp-debug-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.85);
    z-index: 100000;
    overflow-y: auto;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    max-width: 1200px;
    margin: 20px auto;
    background: #1e1e1e;
    border-radius: 8px;
    padding: 20px;
    color: #fff;
  `;
  
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid var(--rr-accent, #9333ea); padding-bottom: 10px;';
  header.innerHTML = `
    <h2 style="margin: 0; color: var(--rr-accent, #9333ea);">🔍 OTP Debug Log</h2>
    <button id="close-debug-modal" style="background: var(--rr-accent, #9333ea); color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;">Close</button>
  `;
  
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear Logs';
  clearBtn.style.cssText = 'background: #666; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-left: 10px;';
  clearBtn.onclick = () => {
    debugLogs = [];
    content.removeChild(logsContainer);
    logsContainer = createLogsContainer();
    content.appendChild(logsContainer);
  };
  header.appendChild(clearBtn);
  
  function createLogsContainer() {
    const container = document.createElement('div');
    container.id = 'debug-logs-container';
    
    if (debugLogs.length === 0) {
      container.innerHTML = '<p style="color: #888; text-align: center; padding: 40px;">No debug logs yet. Process a trip to see debug information.</p>';
      return container;
    }
    
    debugLogs.forEach((log, idx) => {
      const logEntry = document.createElement('div');
      logEntry.style.cssText = `
        background: #2a2a2a;
        border-left: 4px solid var(--rr-accent, #9333ea);
        padding: 15px;
        margin-bottom: 15px;
        border-radius: 4px;
      `;
      
      const stepHeader = document.createElement('div');
      stepHeader.style.cssText = 'font-weight: bold; color: var(--rr-accent, #9333ea); font-size: 16px; margin-bottom: 10px;';
      stepHeader.textContent = `${idx + 1}. ${log.step}`;
      
      const decisionDiv = document.createElement('div');
      decisionDiv.style.cssText = 'background: #333; padding: 10px; border-radius: 4px; margin: 10px 0; color: #4CAF50; font-weight: bold;';
      decisionDiv.textContent = `✅ Decision: ${log.decision}`;
      
      const dataDiv = document.createElement('details');
      dataDiv.style.cssText = 'margin-top: 10px;';
      const summary = document.createElement('summary');
      summary.style.cssText = 'cursor: pointer; color: #888; user-select: none;';
      summary.textContent = '📊 View Data';
      const pre = document.createElement('pre');
      pre.style.cssText = 'background: #1a1a1a; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px; margin-top: 10px;';
      pre.textContent = JSON.stringify(log.data, null, 2);
      dataDiv.appendChild(summary);
      dataDiv.appendChild(pre);
      
      const timestamp = document.createElement('div');
      timestamp.style.cssText = 'color: #666; font-size: 11px; margin-top: 5px;';
      timestamp.textContent = `Time: ${new Date(log.timestamp).toLocaleTimeString()}`;
      
      logEntry.appendChild(stepHeader);
      logEntry.appendChild(decisionDiv);
      logEntry.appendChild(dataDiv);
      logEntry.appendChild(timestamp);
      container.appendChild(logEntry);
    });
    
    return container;
  }
  
  let logsContainer = createLogsContainer();
  
  content.appendChild(header);
  content.appendChild(logsContainer);
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  document.getElementById('close-debug-modal').onclick = () => {
    document.body.removeChild(modal);
    debugModalOpen = false;
  };
  
  // Close on Escape key
  const escapeHandler = (e) => {
    if (e.key === 'Escape' && debugModalOpen) {
      document.body.removeChild(modal);
      debugModalOpen = false;
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);
}

// Export to window for global access
window.showDebugModal = showDebugModal;
window.addDebugLog = addDebugLog;
window.clearDebugLogs = () => { debugLogs = []; console.log('🔍 Debug logs cleared'); };

// Console command to show debug modal
console.log('%c🔍 OTP Debug Tools Available:', 'color: #9333ea; font-weight: bold;');
console.log('%c  - showDebugModal() - Show debug log modal', 'color: #888;');
console.log('%c  - clearDebugLogs() - Clear all debug logs', 'color: #888;');

/**
 * Decode encoded polyline string to coordinate array
 * @param {string} encoded - Encoded polyline string
 * @returns {Array} Array of [lat, lng] coordinates
 */
function decodePolyline(encoded) {
  let points = [], index = 0, len = encoded.length, lat = 0, lng = 0;
  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} aLat - Latitude of point A
 * @param {number} aLon - Longitude of point A
 * @param {number} bLat - Latitude of point B
 * @param {number} bLon - Longitude of point B
 * @returns {number} Distance in meters
 */
function haversineMeters(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Find the index of the nearest point in an array to a target coordinate
 * @param {Array} latLonPoints - Array of [lat, lon] coordinates
 * @param {number} targetLat - Target latitude
 * @param {number} targetLon - Target longitude
 * @returns {number} Index of nearest point
 */
function findNearestPointIndex(latLonPoints, targetLat, targetLon) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < latLonPoints.length; i++) {
    const p = latLonPoints[i];
    const d = haversineMeters(p[0], p[1], targetLat, targetLon);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Convert [lat, lon] coordinates to [lng, lat] for MapLibre GL JS
 * @param {Array} latLonPoints - Array of [lat, lon] coordinates
 * @returns {Array} Array of [lng, lat] coordinates
 */
function toMapLibreCoords(latLonPoints) {
  return latLonPoints.map(p => [p[1], p[0]]); // [lng, lat]
}

/**
 * Safely remove a layer and source from the map
 * @param {Object} map - MapLibre map instance
 * @param {string} id - Layer/source ID
 */
function safeRemoveLayerAndSource(map, id) {
  try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {}
  try { if (map.getSource(id)) map.removeSource(id); } catch (_) {}
}

/**
 * Add a line layer to the map
 * @param {Object} map - MapLibre map instance
 * @param {string} id - Layer/source ID
 * @param {Array} lngLatCoords - Array of [lng, lat] coordinates
 * @param {Object} paint - Paint properties for the line
 * @returns {string} The layer ID
 */
function addLine(map, id, lngLatCoords, paint) {
  safeRemoveLayerAndSource(map, id);

  map.addSource(id, {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: lngLatCoords }
    }
  });

  map.addLayer({ id, type: "line", source: id, paint });
  return id;
}

/**
 * Show raw OTP data in a modal for diagnosis
 * @param {Array} patterns - OTP trip patterns
 */
/**
 * Fetch and display OTP itineraries using GraphQL API
 * @param {number} fromLat - Starting latitude
 * @param {number} fromLon - Starting longitude
 * @param {number} toLat - Destination latitude
 * @param {number} toLon - Destination longitude
 * @param {number} maxWalkDistance - Maximum walking distance (not used in GraphQL, kept for compatibility)
 * @param {string} departureType - Departure type ('now' or 'departure')
 * @param {string} departureTime - Departure time string
 * @param {string} modes - Transit modes
 */
async function fetchAndShowOtpItineraries(fromLat, fromLon, toLat, toLon, maxWalkDistance = 800, departureType = 'now', departureTime = '', modes = 'TRANSIT,WALK') {
  logOtpDebug('START', {
    endpoint: typeof OTP_API !== 'undefined' ? OTP_API : '(OTP_API undefined — check script order / CITY_CONFIG)',
    fromLat,
    fromLon,
    toLat,
    toLon,
    departureType,
    dateTimeArgWillUse: departureType === 'departure' && departureTime ? 'yes' : 'no'
  });
  console.log('[fetchAndShowOtpItineraries] Function called with params:', { fromLat, fromLon, toLat, toLon, maxWalkDistance, departureType, departureTime, modes });
  
  // PHASE 2: Show messages for unsupported features
  if (maxWalkDistance !== 800) {
    const msg = document.createElement('div');
    msg.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ffc107;color:#000;padding:10px 20px;border-radius:4px;z-index:10000;font-weight:bold;';
    msg.textContent = 'Max walk distance not wired yet';
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 3000);
  }
  
  if (modes !== 'TRANSIT,WALK') {
    const msg = document.createElement('div');
    msg.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ffc107;color:#000;padding:10px 20px;border-radius:4px;z-index:10000;font-weight:bold;';
    msg.textContent = 'Modes filtering not wired yet';
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 3000);
  }
  
  // Transmodel trip query + variables are built inside try {} after await resolveOtpTripDateTimeMs(...)
  
  // Clear previous state for multiple trips
  window.otpBusInfo = {};
  currentItins = null;
  activeTripSelected = false;
  window.activeTripSelected = false; // Also clear on window
  try {
    if (typeof window.metrofeedSyncTripGuideDockVisibility === 'function') {
      window.metrofeedSyncTripGuideDockVisibility();
    }
  } catch (_) {}
  window.currentLegColorMapping = null;
  window.routesToTrack = []; // Clear routes to track
  
  // Clear debug logs for new trip
  debugLogs = [];
  console.log('🔍 [Debug] Cleared debug logs for new trip');
  
  // Clear any existing OTP route lines and stop markers
  if (window.routeLegLines && window.routeLegLines.length) {
    window.routeLegLines.forEach(lineId => {
      if (map.getLayer(lineId)) {
        map.removeLayer(lineId);
      }
      if (map.getSource(lineId)) {
        map.removeSource(lineId);
      }
    });
    window.routeLegLines = [];
  }
  
  if (window.routeStopMarkers && window.routeStopMarkers.length) {
    window.routeStopMarkers.forEach(marker => marker.remove());
    window.routeStopMarkers = [];
  }
  
  // Stop any existing OTP bus tracking
  if (window.otpBusTrackingInterval) {
    clearInterval(window.otpBusTrackingInterval);
    window.otpBusTrackingInterval = null;
  }

  // Show loading state
  const itinList = document.getElementById('itinList');
  if (!itinList) {
    logOtpDebug('DOM_MISSING', { id: 'itinList', hint: 'OTP modal markup missing or wrong page' });
    console.error('[OTP] #itinList not found — cannot show trip options');
    return;
  }
  itinList.innerHTML = "<em style='color: var(--rr-accent, #9333ea);'>Loading trip options...</em>";
  try {
    if (typeof window.metrofeedAnnounceKey === 'function') window.metrofeedAnnounceKey('sr_searching_trip_options');
    else if (typeof window.metrofeedAnnounce === 'function') window.metrofeedAnnounce('Searching for trip options.');
  } catch (_) {}
  showOtpModal();
  
  // Check for holiday schedule adjustments
  if (window.routeLoader && window.routeLoader.checkServiceDay) {
    const serviceCheck = window.routeLoader.checkServiceDay();
    if (serviceCheck.isHoliday) {
      console.warn(`[OTP] ⚠️ Today (${serviceCheck.dayName}) may be a holiday - schedules may differ from normal`);
    }
  }

  try {
    const { ms: tripMs, clampNote: otpClampNote } = await resolveOtpTripDateTimeMs(departureType, departureTime);
    const tripDateTimeIso = new Date(tripMs).toISOString();
    logOtpDebug('TRIP_DATETIME', { tripDateTimeIso, otpClampNote, tripMs });

    // User preferences (from Trip Options modal). Used for both server request (if supported) and client rerank (always).
    const otpPrefs = (() => {
      try {
        const p = window.OTP_USER_PREFS || null;
        if (!p) return null;
        const walkReluctance = Number(p.walkReluctance);
        const waitReluctance = Number(p.waitReluctance);
        const transferPenalty = Number(p.transferPenalty);
        return {
          walkReluctance: Number.isFinite(walkReluctance) ? walkReluctance : null,
          waitReluctance: Number.isFinite(waitReluctance) ? waitReluctance : null,
          transferPenalty: Number.isFinite(transferPenalty) ? transferPenalty : null
        };
      } catch (_) {
        return null;
      }
    })();

    let clampBanner = '';
    if (otpClampNote === 'after_service_period') {
      clampBanner =
        "<div style=\"color:#ffb74d;font-size:12px;margin-bottom:8px;line-height:1.35;\">The loaded MBTA schedule on the server ends before your current time. Showing options using the last available service window instead.</div>";
    } else if (otpClampNote === 'before_service_period') {
      clampBanner =
        "<div style=\"color:#ffb74d;font-size:12px;margin-bottom:8px;line-height:1.35;\">Your departure time is before the loaded schedule range; search time was moved to the start of available data.</div>";
    }
    itinList.innerHTML = clampBanner + "<em style='color: var(--rr-accent, #9333ea);'>Loading trip options...</em>";

    const buildTripPlanQuery = (withTuning) => {
      const tuningArgs = withTuning
        ? `
        walkReluctance: $walkReluctance
        waitReluctance: $waitReluctance
        transferPenalty: $transferPenalty
        `
        : '';
      const tuningVars = withTuning
        ? `, $walkReluctance: Float!, $waitReluctance: Float!, $transferPenalty: Int!`
        : '';
      return `
    query TripPlan($fromLat: Float!, $fromLon: Float!, $toLat: Float!, $toLon: Float!, $dateTime: DateTime!, $searchWindow: Int!${tuningVars}) {
      trip(
        from: { coordinates: { latitude: $fromLat, longitude: $fromLon } }
        to: { coordinates: { latitude: $toLat, longitude: $toLon } }
        dateTime: $dateTime
        searchWindow: $searchWindow
        numTripPatterns: 8
        ${tuningArgs}
      ) {
        routingErrors { code description }
        tripPatterns {
          startTime
          endTime
          duration
          legs {
            mode
            distance
            duration
            fromPlace {
              name
              vertexType
              latitude
              longitude
            }
            toPlace {
              name
              vertexType
              latitude
              longitude
            }
            pointsOnLink {
              points
            }
            line {
              publicCode
              name
            }
            serviceJourney {
              id
            }
            serviceJourneyEstimatedCalls {
              quay {
                id
                name
                latitude
                longitude
              }
              aimedArrivalTime
              aimedDepartureTime
              expectedArrivalTime
              expectedDepartureTime
            }
          }
        }
      }
    }
  `;
    };

    const variablesBase = {
      fromLat: fromLat,
      fromLon: fromLon,
      toLat: toLat,
      toLon: toLon,
      dateTime: tripDateTimeIso,
      searchWindow: 120
    };
    const variablesTuning =
      otpPrefs && otpPrefs.walkReluctance != null && otpPrefs.waitReluctance != null && otpPrefs.transferPenalty != null
        ? {
            ...variablesBase,
            walkReluctance: Number(otpPrefs.walkReluctance),
            waitReluctance: Number(otpPrefs.waitReluctance),
            transferPenalty: Math.round(Number(otpPrefs.transferPenalty))
          }
        : null;

    console.log('[fetchAndShowOtpItineraries] GraphQL query variables:', variablesTuning || variablesBase);

    // POST GraphQL request (try tuned args first; if server rejects unknown args, fallback cleanly).
    const postGraphql = async (query, vars) => {
      logOtpDebug('FETCH', { method: 'POST', url: typeof OTP_API !== 'undefined' ? OTP_API : null });
      const res = await fetch(OTP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: vars })
      });
      logOtpDebug('HTTP', { ok: res.ok, status: res.status, statusText: res.statusText });
      if (!res.ok) throw new Error("OTP server error: " + res.status);
      return await res.json();
    };

    let response = null;
    if (variablesTuning) {
      try {
        response = await postGraphql(buildTripPlanQuery(true), variablesTuning);
        const errs = Array.isArray(response && response.errors) ? response.errors : [];
        const msg = errs.map((e) => String(e && (e.message || e)).toLowerCase()).join(' | ');
        const unknownArg = msg.includes('unknown argument') || msg.includes('unknown field') || msg.includes('cannot query field');
        if (unknownArg) {
          console.warn('[OTP] Tuned args not supported by server; falling back to base query.');
          response = await postGraphql(buildTripPlanQuery(false), variablesBase);
        }
      } catch (e) {
        console.warn('[OTP] Tuned query failed; falling back to base query.', e);
        response = await postGraphql(buildTripPlanQuery(false), variablesBase);
      }
    } else {
      response = await postGraphql(buildTripPlanQuery(false), variablesBase);
    }

    logOtpDebug('RESPONSE_SHAPE', {
      hasErrors: Array.isArray(response.errors) && response.errors.length > 0,
      errorMessages: response.errors?.map(e => e.message) || [],
      hasData: !!response.data,
      dataKeys: response.data ? Object.keys(response.data) : [],
      tripIsNull: response.data && response.data.trip === null,
      tripPatternsType: response.data?.trip?.tripPatterns != null
        ? (Array.isArray(response.data.trip.tripPatterns) ? 'array' : typeof response.data.trip.tripPatterns)
        : 'missing',
      tripPatternsLength: Array.isArray(response.data?.trip?.tripPatterns) ? response.data.trip.tripPatterns.length : null
    });
    console.log('Full OTP GraphQL response:', response); // Debug the full response

    // Check for GraphQL errors
    if (response.errors) {
      console.error('GraphQL errors:', response.errors);
      logOtpDebug('GRAPHQL_ERRORS', { messages: response.errors.map((e) => e.message) });
      itinList.innerHTML = `<em style='color: #f55;'>Error: ${response.errors.map((e) => escapeHtml(e.message)).join(', ')}</em>`;
      return;
    }

    const tripRoutingErrors = response.data?.trip?.routingErrors;
    if (Array.isArray(tripRoutingErrors) && tripRoutingErrors.length) {
      logOtpDebug('TRANSMODEL_ROUTING_ERRORS', tripRoutingErrors);
    }

    // OTP 2.9 GraphQL returns { data: { trip: { tripPatterns: [...] } } }
    const tripPatternsProbe = response.data?.trip?.tripPatterns;
    const tripPatternsArr = Array.isArray(tripPatternsProbe) ? tripPatternsProbe : [];
    const transmodelHasTransit = tripPatternsArr.some(otpTripPatternHasTransit);

    if (!response.data?.trip || !tripPatternsArr.length || !transmodelHasTransit) {
      const rErr = otpFirstRoutingError(tripRoutingErrors);
      logOtpDebug('NO_TRIP_PATTERNS', {
        hasData: !!response.data,
        hasTripField: !!response.data?.trip,
        tripPatternsLength: tripPatternsArr.length,
        transmodelHasTransit,
        routingError: rErr?.description || rErr?.code || null,
        note: 'No usable transit patterns from Transmodel; trying GTFS planConnection fallback'
      });

      try {
        const gtfsConverted = await fetchGtfsPlanItineraries({ fromLat, fromLon, toLat, toLon, dateTimeIso: tripDateTimeIso });
        const gtfsTransit = gtfsConverted.filter(otpItineraryHasTransit);
        logOtpDebug('GTFS_CONVERTED', { count: gtfsConverted.length, withTransit: gtfsTransit.length });
        if (!gtfsTransit.length) {
          otpRenderNoTransitFound(itinList, tripRoutingErrors);
          return;
        }

        currentItins = gtfsTransit;
        window.currentItins = currentItins;

        console.log('🔄 [fetchAndShowOtpItineraries] Normalizing GTFS fallback itineraries into Journey objects...');
        const journeys = await normalizeItineraries(currentItins);
        window.journeys = journeys;
        logOtpDebug('GTFS_NORMALIZED', { journeys: journeys.length });

        logOtpSummary('AFTER_NORMALIZE_GTFS');
        logOtpDebug('RENDER_CALL', { itineraries: currentItins.length, source: 'gtfs-fallback' });
        renderItinListVisual(currentItins);
        return;
      } catch (fallbackErr) {
        logOtpDebug('GTFS_FALLBACK_ERROR', { message: fallbackErr?.message || String(fallbackErr) });
        console.error('[OTP] GTFS fallback error:', fallbackErr);
        otpRenderNoTransitFound(itinList, tripRoutingErrors);
        return;
      }
    }

    // Work directly with GraphQL response structure
    // PHASE 1: Limit client-side if numTripPatterns doesn't exist in schema
    const tripPatterns = response.data.trip.tripPatterns;
    const numItineraries = 4; // Default limit
    const limitedPatterns = tripPatterns.slice(0, numItineraries);
    
    // 🔍 LOG RAW OTP RESPONSE
    console.log('🔍 [OTP] ===== RAW OTP RESPONSE =====');
    console.log('🔍 [OTP] Number of itineraries:', limitedPatterns.length);
    
    limitedPatterns.forEach((pattern, idx) => {
      console.log(`🔍 [OTP] Itinerary ${idx + 1}:`, {
        startTime: pattern.startTime,
        endTime: pattern.endTime,
        duration: pattern.duration,
        legsCount: pattern.legs?.length || 0
      });
      
      pattern.legs?.forEach((leg, legIdx) => {
        console.log(`🔍 [OTP]   Leg ${legIdx + 1} (${leg.mode}):`, {
          mode: leg.mode,
          duration: leg.duration,
          distance: leg.distance,
          fromPlace: leg.fromPlace ? {
            name: leg.fromPlace.name,
            lat: leg.fromPlace.latitude,
            lon: leg.fromPlace.longitude,
            vertexType: leg.fromPlace.vertexType
          } : null,
          toPlace: leg.toPlace ? {
            name: leg.toPlace.name,
            lat: leg.toPlace.latitude,
            lon: leg.toPlace.longitude,
            vertexType: leg.toPlace.vertexType
          } : null,
          line: leg.line ? {
            publicCode: leg.line.publicCode,
            name: leg.line.name,
            id: leg.line.id || null
          } : null,
          serviceJourney: leg.serviceJourney ? {
            id: leg.serviceJourney.id
          } : null,
          estimatedCallsCount: leg.serviceJourneyEstimatedCalls?.length || 0,
          estimatedCalls: leg.serviceJourneyEstimatedCalls?.slice(0, 5).map(call => ({
            quay: call.quay?.name || null,
            aimedArrival: call.aimedArrivalTime,
            expectedArrival: call.expectedArrivalTime
          })) || null,
          pointsOnLink: leg.pointsOnLink ? {
            hasPoints: !!leg.pointsOnLink.points,
            pointsLength: leg.pointsOnLink.points?.length || 0
          } : null
        });
        
        // Show full stop sequence if available
        if (leg.serviceJourneyEstimatedCalls && leg.serviceJourneyEstimatedCalls.length > 0) {
          console.log(`🔍 [OTP]     Full stop sequence (${leg.serviceJourneyEstimatedCalls.length} stops):`);
          leg.serviceJourneyEstimatedCalls.forEach((call, stopIdx) => {
            console.log(`🔍 [OTP]       Stop ${stopIdx + 1}: ${call.quay?.name || 'Unknown'} (${call.aimedArrivalTime || call.expectedArrivalTime || 'no time'})`);
          });
        }
      });
    });
    console.log('🔍 [OTP] ===== END RAW OTP RESPONSE =====');
    
    const convertedItineraries = limitedPatterns.map(pattern => {
      // Map GraphQL tripPattern to simplified format (keeping GraphQL structure where possible)
      const itinerary = {
        startTime: pattern.startTime,
        endTime: pattern.endTime,
        duration: pattern.duration,
        legs: pattern.legs.map(leg => {
          // Normalize mode to uppercase for consistency
          // OTP returns lowercase modes: bus, walk, foot, subway, metro, rail, tram, ferry, etc.
          let normalizedMode = leg.mode;
          if (leg.mode === 'bus') {
            normalizedMode = 'BUS';
          } else if (leg.mode === 'walk' || leg.mode === 'foot') {
            normalizedMode = 'WALK';
          } else if (leg.mode === 'subway' || leg.mode === 'metro') {
            normalizedMode = 'SUBWAY';
          } else if (leg.mode === 'rail' || leg.mode === 'train') {
            normalizedMode = 'RAIL';
          } else {
            // Uppercase other modes (tram, ferry, cable_car, etc.)
            normalizedMode = leg.mode.toUpperCase();
          }
          
          // Build leg object with GraphQL data
          const convertedLeg = {
            mode: normalizedMode,
            duration: leg.duration,
            distance: leg.distance,
            // Preserve GraphQL Place structure (using latitude/longitude)
            fromPlace: leg.fromPlace,
            toPlace: leg.toPlace,
            // Note: legGeometry not available in Transmodel v3 Leg type
            // Path rendering will need to use fromPlace/toPlace coordinates
            // For compatibility, also provide from/to with lat/lon
            from: leg.fromPlace ? {
              name: leg.fromPlace.name,
              lat: leg.fromPlace.latitude || null,
              lon: leg.fromPlace.longitude || null
            } : null,
            to: leg.toPlace ? {
              name: leg.toPlace.name,
              lat: leg.toPlace.latitude || null,
              lon: leg.toPlace.longitude || null
            } : null
          };
          
          // Extract route info from line (for all transit legs: bus, rail, tram, etc.)
          if (leg.line) {
            convertedLeg.route = leg.line.publicCode; // Route number/code (e.g., "504", "Red", "CR-Fairmount")
            convertedLeg.routeShortName = leg.line.publicCode;
            convertedLeg.routeLongName = leg.line.name || leg.line.publicCode;
            // Also preserve line object for direct access
            convertedLeg.line = leg.line;
          }
          
          // Service journey ID if available
          if (leg.serviceJourney) {
            convertedLeg.tripId = leg.serviceJourney.id;
            convertedLeg.serviceJourney = leg.serviceJourney;
          }
          
          // Store estimated calls (stops) if available
          if (leg.serviceJourneyEstimatedCalls && Array.isArray(leg.serviceJourneyEstimatedCalls)) {
            convertedLeg.estimatedCalls = leg.serviceJourneyEstimatedCalls;
            console.log(`[OTP] Found ${leg.serviceJourneyEstimatedCalls.length} estimated calls for ${leg.mode} leg`);
          }
          
          // Store geometry data from OTP
          convertedLeg.pointsOnLink = leg.pointsOnLink || null;
          
          return convertedLeg;
        })
      };
      return itinerary;
    });

    // Store converted itineraries globally
    // Filter itineraries to max 2 transfers (walk legs don't count)
    const MAX_TRANSFERS = 2;
    function countTransfers(itin) {
      const transitLegs = (itin.legs || []).filter(l => l.mode !== 'WALK');
      return Math.max(0, transitLegs.length - 1);
    }

    function sumWalkSeconds(itin) {
      try {
        return (itin.legs || [])
          .filter((l) => String(l.mode || '').toUpperCase() === 'WALK')
          .reduce((acc, l) => acc + (Number(l.duration) || 0), 0);
      } catch (_) {
        return 0;
      }
    }

    function clientScore(itin) {
      const dur = Number(itin && itin.duration) || 0; // seconds
      const transfers = countTransfers(itin);
      const walkS = sumWalkSeconds(itin);
      let walkRel = 7;
      let transferPen = 350;
      let waitRel = 1.7;
      try {
        const p = window.OTP_USER_PREFS || null;
        if (p) {
          if (Number.isFinite(Number(p.walkReluctance))) walkRel = Number(p.walkReluctance);
          if (Number.isFinite(Number(p.transferPenalty))) transferPen = Number(p.transferPenalty);
          if (Number.isFinite(Number(p.waitReluctance))) waitRel = Number(p.waitReluctance);
        }
      } catch (_) {}
      // Wait reluctance: we don't have explicit wait segments; keep it as a mild global multiplier for now.
      const waitFactor = Math.max(1, Number(waitRel) || 1.7);
      return dur * waitFactor + walkS * (Number(walkRel) || 7) + transfers * (Number(transferPen) || 350);
    }
    
    // Sort by OTP user prefs (if present), otherwise duration (shortest first)
    try {
      if (window.OTP_USER_PREFS) {
        convertedItineraries.sort((a, b) => clientScore(a) - clientScore(b));
      } else {
        convertedItineraries.sort((a, b) => a.duration - b.duration);
      }
    } catch (_) {
      convertedItineraries.sort((a, b) => a.duration - b.duration);
    }
    
    // Filter to max transfers
    const filtered = convertedItineraries.filter(it => countTransfers(it) <= MAX_TRANSFERS);
    
    const transitItins = filtered.filter(otpItineraryHasTransit);
    if (!transitItins.length) {
      logOtpDebug('WALK_ONLY_REJECTED', {
        converted: convertedItineraries.length,
        note: 'Transmodel returned only walk/foot patterns (routing failure)'
      });
      otpRenderNoTransitFound(itinList, tripRoutingErrors);
      return;
    }

    currentItins = transitItins;
    window.currentItins = currentItins; // Also set on window for compatibility
    logOtpDebug('TRANSFER_FILTER', {
      rawPatterns: tripPatterns.length,
      converted: convertedItineraries.length,
      afterMaxTransfers: filtered.length,
      usingFallbackAll: filtered.length === 0 && convertedItineraries.length > 0,
      finalCount: currentItins.length,
      maxTransfers: MAX_TRANSFERS
    });
    console.log('Converted itineraries:', currentItins);
    console.log(`Filtered ${convertedItineraries.length} itineraries to ${currentItins.length} (max ${MAX_TRANSFERS} transfers)`);
    
    // PHASE 1: Normalize itineraries into clean Journey objects
    // This is where ALL the logic happens - route matching, geometry clipping, etc.
    console.log('🔄 [fetchAndShowOtpItineraries] Normalizing itineraries into Journey objects...');
    const journeys = await normalizeItineraries(currentItins);
    window.journeys = journeys; // Store globally for rendering
    console.log('🔄 [fetchAndShowOtpItineraries] ✅ Normalized', journeys.length, 'journeys');
    
    // Log summary after normalization
    logOtpSummary('AFTER_NORMALIZE');
    
    // Enhanced OTP route debugging
    console.log('=== OTP ROUTE ANALYSIS (GraphQL) ===');
    currentItins.forEach((itin, idx) => {
      console.log(`\n--- Itinerary ${idx + 1} ---`);
      console.log(`Total Duration: ${Math.round(itin.duration/60)} minutes`);
      console.log(`Start Time: ${new Date(itin.startTime).toLocaleTimeString()}`);
      console.log(`End Time: ${new Date(itin.endTime).toLocaleTimeString()}`);
      itin.legs.forEach((leg, legIdx) => {
        if (leg.mode !== 'WALK') {
          console.log(`Leg ${legIdx}:`);
          console.log(`  Mode: ${leg.mode}`);
          console.log(`  Route: ${leg.route || 'N/A'}`);
          console.log(`  Route Short Name: ${leg.routeShortName || 'N/A'}`);
          console.log(`  Route Long Name: ${leg.routeLongName || 'N/A'}`);
          console.log(`  From: ${leg.from?.name} (${leg.from?.lat}, ${leg.from?.lon})`);
          console.log(`  To: ${leg.to?.name} (${leg.to?.lat}, ${leg.to?.lon})`);
          console.log(`  Duration: ${Math.round(leg.duration/60)} minutes`);
        } else {
          console.log(`Leg ${legIdx}: WALK ${Math.round(leg.duration/60)} minutes`);
        }
      });
    });
    console.log('=== END OTP ROUTE ANALYSIS ===');
    
    logOtpDebug('RENDER_CALL', { itineraries: currentItins.length });
    renderItinListVisual(currentItins);
    try {
      if (typeof window.metrofeedAnnounceKey === 'function') window.metrofeedAnnounceKey('sr_trip_options_loaded', { count: String(currentItins.length) });
      else if (typeof window.metrofeedAnnounce === 'function') window.metrofeedAnnounce(String(currentItins.length) + ' trip options loaded.');
    } catch (_) {}

  } catch (e) {
    logOtpDebug('FETCH_EXCEPTION', { name: e?.name, message: e?.message, stack: e?.stack?.split('\n')?.slice(0, 5)?.join(' | ') });
    console.error('OTP Error:', e);
    if (itinList) {
      const cfgUrl = (window.CITY_CONFIG && (window.CITY_CONFIG.otpApi || window.CITY_CONFIG.otpGtfsGraphql)) || '';
      const hint = cfgUrl ? ` Please check connectivity/CORS for <code>${cfgUrl}</code>.` : '';
      itinList.innerHTML = `<em style="color:#f55">Error connecting to OTP server.${hint}</em>`;
      try {
        if (typeof window.metrofeedAnnounceKey === 'function') window.metrofeedAnnounceKey('sr_otp_error_connecting');
        else if (typeof window.metrofeedAnnounce === 'function') window.metrofeedAnnounce('Error connecting to trip planner server.');
      } catch (_) {}
    }
  }
}

/**
 * Render itinerary list in the OTP modal
 * @param {Array} itins - Array of itinerary objects
 */
function renderItinListVisual(itins) {
  logOtpDebug('RENDER_LIST', { count: Array.isArray(itins) ? itins.length : -1, hasItinListEl: !!document.getElementById('itinList') });
  window.currentItins = itins; // Ensure global is always set!
  const itinList = document.getElementById('itinList');
  if (!itinList) {
    logOtpDebug('RENDER_SKIP', { reason: 'no #itinList' });
    return;
  }
  itinList.innerHTML = itins.map((itin, idx) => {
    const start = getPortlandTimeString(new Date(itin.startTime));
    const end = getPortlandTimeString(new Date(itin.endTime));
    const transfers = (() => {
      try {
        const transitLegs = (itin.legs || []).filter(l => l.mode !== 'WALK');
        return Math.max(0, transitLegs.length - 1);
      } catch (_) {
        return 0;
      }
    })();
    const segs = itin.legs.map(leg => {
      let icon = '';
      let segClass = '';
      let label = '';
      if (leg.mode === 'WALK' || leg.mode === 'FOOT') {
        icon = '🚶‍♂️';
        segClass = 'seg-walk';
        label = 'Walk';
      } else if (leg.mode === 'BUS') {
        icon = '🚌';
        segClass = 'seg-bus';
        // Format bus label using OTP route data
        if (leg.route) {
          console.log('[Itinerary] Processing bus leg with route:', leg.route);
          // Use route data from OTP GraphQL response
          const routeNumber = leg.routeShortName || leg.route;
          const routeName = leg.routeLongName || routeNumber;
          
          // Check if we have live bus info for this route
          let busNumbers = '';
          if (window.otpBusInfo && window.otpBusInfo[leg.route]) {
            const buses = window.otpBusInfo[leg.route];
            busNumbers = buses.map(b => b.vehicleID).join(', ');
            label = `Bus ${routeNumber} (${busNumbers}) - ${routeName}`;
          } else {
            label = `Bus ${routeNumber} - ${routeName}`;
          }
          console.log('[Itinerary] Created label:', label);
        } else {
          label = 'Bus';
        }
      } else if (leg.mode === 'TRAM') {
        icon = '🚋';
        segClass = 'seg-tram';
        label = leg.route ? `Tram ${leg.route}` : 'Tram';
      } else if (leg.mode === 'RAIL' || leg.mode === 'TRAIN') {
        icon = '🚈';
        segClass = 'seg-train';
        label = leg.route ? `Train ${leg.route}` : 'Train';
      } else if (leg.mode === 'STREETCAR') {
        icon = '🚊';
        segClass = 'seg-streetcar';
        label = leg.route ? `Streetcar ${leg.route}` : 'Streetcar';
      } else if (leg.mode === 'FERRY') {
        icon = '⛴️';
        segClass = 'seg-ferry';
        label = leg.route ? `Ferry ${leg.route}` : 'Ferry';
      } else if (leg.mode === 'SUBWAY' || leg.mode === 'METRO') {
        icon = '🚇';
        segClass = 'seg-subway';
        label = leg.route ? `Subway ${leg.route}` : 'Subway';
      } else if (leg.mode === 'CABLE_CAR' || leg.mode === 'GONDOLA' || leg.mode === 'FUNICULAR') {
        icon = '🚠';
        segClass = 'seg-cablecar';
        label = leg.route ? `${leg.mode.replace('_', ' ')} ${leg.route}` : leg.mode.replace('_', ' ');
      } else {
        // Unknown mode - log it for debugging
        console.warn(`[renderItinListVisual] Unknown leg mode: "${leg.mode}"`);
        icon = '❓';
        segClass = '';
        label = leg.mode;
      }
      let mins = Math.round((leg.duration || 0) / 60);
      return `<span class='${segClass}' title='${label}'>
        <span class='seg-icon'>${icon}</span>
        <span>${mins}m</span>
      </span>`;
    }).join('');
    // Overlay details for route info
    const details = itin.legs.map((leg, j) => {
      let modeTxt = (leg.mode === 'WALK' || leg.mode === 'FOOT') ? 'Walk' : leg.mode === 'BUS' ? 'Bus' : leg.mode === 'TRAIN' ? 'Train' : leg.mode === 'TRAM' ? 'Tram' : leg.mode === 'SUBWAY' || leg.mode === 'METRO' ? 'Subway' : leg.mode;
      let lineInfo = '';
      let unitInfo = '';
      let stopList = '';
      
      // Build route/line information
      if (leg.mode !== 'WALK' && leg.mode !== 'FOOT') {
        const routeNumber = leg.routeShortName || leg.route || '';
        const routeName = leg.routeLongName || routeNumber;
        
        // Get unit numbers (bus/tram numbers) from live data
        if (window.otpBusInfo && leg.route && window.otpBusInfo[leg.route]) {
          const buses = window.otpBusInfo[leg.route];
          const unitNumbers = buses.map(b => {
            // Clean vehicle ID (remove 'y' prefix if present)
            const vid = String(b.vehicleID || '').replace(/^[^0-9]+/, '');
            return vid;
          }).filter(v => v).join(', ');
          if (unitNumbers) {
            unitInfo = ` <span style="color:#4CAF50;">Unit${buses.length > 1 ? 's' : ''}: ${unitNumbers}</span>`;
          }
        }
        
        // Build line info based on mode
        if (leg.mode === 'BUS') {
          lineInfo = ` <b>Bus ${routeNumber}</b>${routeName && routeName !== routeNumber ? ` - ${routeName}` : ''}`;
        } else if (leg.mode === 'TRAM') {
          lineInfo = ` <b>Tram ${routeNumber}</b>${routeName && routeName !== routeNumber ? ` - ${routeName}` : ''}`;
        } else if (leg.mode === 'SUBWAY' || leg.mode === 'METRO') {
          lineInfo = ` <b>Subway ${routeNumber}</b>${routeName && routeName !== routeNumber ? ` - ${routeName}` : ''}`;
        } else if (leg.mode === 'RAIL' || leg.mode === 'TRAIN') {
          lineInfo = ` <b>Train ${routeNumber}</b>${routeName && routeName !== routeNumber ? ` - ${routeName}` : ''}`;
        } else if (leg.route) {
          lineInfo = ` <b>${leg.mode} ${routeNumber}</b>${routeName && routeName !== routeNumber ? ` - ${routeName}` : ''}`;
        }
      }
      
      // Build stop list from estimated calls
      if (leg.estimatedCalls && Array.isArray(leg.estimatedCalls) && leg.estimatedCalls.length > 0) {
        const stops = leg.estimatedCalls.map((call, idx) => {
          const stopName = call.quay?.name || 'Unknown Stop';
          const arrivalTime = call.expectedArrivalTime || call.aimedArrivalTime;
          const departureTime = call.expectedDepartureTime || call.aimedDepartureTime;
          const timeStr = arrivalTime || departureTime;
          
          let timeDisplay = '';
          if (timeStr) {
            try {
              const time = new Date(timeStr);
              timeDisplay = getPortlandTimeString(time);
            } catch (e) {
              // Ignore time parsing errors
            }
          }
          
          // Highlight start and end stops
          const isStart = idx === 0;
          const isEnd = idx === leg.estimatedCalls.length - 1;
          const stopStyle = isStart || isEnd ? 'font-weight:bold; color:#4CAF50;' : 'color:#ccc;';
          
          return `<div style="${stopStyle} font-size:0.9em; margin-left:15px; margin-top:2px;">
            ${isStart ? '📍' : isEnd ? '🎯' : '•'} ${stopName}${timeDisplay ? ` <span style="color:#ffc107;">(${timeDisplay})</span>` : ''}
          </div>`;
        }).join('');
        
        stopList = `<div style="margin-top:5px; max-height:200px; overflow-y:auto;">
          <div style="font-size:0.85em; color:#888; margin-bottom:3px;">Stops:</div>
          ${stops}
        </div>`;
      } else {
        // Fallback: show from/to places if no estimated calls
        if (leg.fromPlace && leg.toPlace) {
          stopList = `<div style="margin-top:5px; font-size:0.9em; color:#ccc;">
            <div style="margin-left:15px;">📍 ${leg.fromPlace.name || 'Start'}</div>
            <div style="margin-left:15px;">🎯 ${leg.toPlace.name || 'End'}</div>
          </div>`;
        }
      }
      
      return `<div style="margin-bottom:8px;">
        → <b>${modeTxt}${lineInfo}</b>${unitInfo}
        <span style="color:#ffc107;">${Math.round((leg.duration||0)/60)} min</span>
        ${stopList}
      </div>`;
    }).join('<hr style="border:0; border-top:1px solid #222; margin:8px 0">');
    const minsTotal = Math.round((itin.duration || 0) / 60);
    const transferPhrase = transfers === 1 ? '1 transfer' : `${transfers} transfers`;
    const srLabel = `${minsTotal} minute trip, ${transferPhrase}, starts at ${start}, arrives at ${end}.`;
    return `<div class="itinListOption ${window.selectedTripIndex === idx ? 'selected' : ''}" data-idx="${idx}" role="listitem">
      <button class="itin-dropdown-btn" onclick="event.stopPropagation();toggleDropdown(${idx})">&#9660;</button>
      <button type="button" style="display:block;width:100%;text-align:left;background:transparent;border:0;padding:0;margin:0;cursor:pointer;" aria-label="${escapeHtml(srLabel)}" onclick="showRoute(${idx})">
        <div class="itin-toptimes">Option ${idx+1}: ${start}–${end}</div>
        <div class="itin-segments">${segs}</div>
        <div class="itin-total">Total: ${Math.round(itin.duration/60)} min</div>
      </button>
      <div class="itin-details-overlay" data-idx="${idx}">
        ${details}
      </div>
    </div>`;
  }).join('');
  
  // Update selected trip styling
  document.querySelectorAll('.itinListOption').forEach((el, idx) => {
    if (window.selectedTripIndex === idx) {
      el.classList.add('selected');
    } else {
      el.classList.remove('selected');
    }
  });
}

/**
 * Journey Object Model - Clean normalized representation of an OTP itinerary
 * This is the "source of truth" after OTP response is processed
 */
class Journey {
  constructor(itin) {
    this.id = itin.id || null;
    this.startTime = itin.startTime;
    this.endTime = itin.endTime;
    this.duration = itin.duration;
    this.transfers = this._countTransfers(itin.legs);
    this.legs = [];
  }
  
  _countTransfers(legs) {
    const transitLegs = legs.filter(l => l.mode !== 'WALK');
    return Math.max(0, transitLegs.length - 1);
  }
}

/** OTP legs may use fromPlace/toPlace (GraphQL) or from/to (GTFS plan / compat); lat may be latitude. */
function mfOtpLegEndpoint(place, compact) {
  const src = place || compact;
  if (!src || typeof src !== "object") return null;
  const name = src.name != null ? String(src.name).trim() : "";
  const latRaw = src.latitude != null ? src.latitude : src.lat;
  const lonRaw = src.longitude != null ? src.longitude : src.lon;
  const lat = latRaw != null && latRaw !== "" ? Number(latRaw) : null;
  const lng = lonRaw != null && lonRaw !== "" ? Number(lonRaw) : null;
  if (!name && (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng))) return null;
  return { name, lat, lng };
}

// ----- Static route JSON (e.g. Cincinnati routeDataBase) — direction + overlay verification -----

function mfOtpGuessCityKey() {
  try {
    const seg = String(window.location?.pathname || "").split("/").filter(Boolean)[0];
    return seg ? seg.toLowerCase() : null;
  } catch (_) {
    return null;
  }
}

function mfOtpNormLabel(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Map OTP publicCode → MetroFeed route id (e.g. sorta_33) using window.ROUTES. */
function mfResolveBusRouteIdFromRoutesIndex(otpCode, otpLineName) {
  const codeRaw = String(otpCode || "").trim();
  if (!codeRaw) return null;
  const cityKey = mfOtpGuessCityKey();
  const routes =
    cityKey && window.ROUTES && window.ROUTES[cityKey] && Array.isArray(window.ROUTES[cityKey].busRoutes)
      ? window.ROUTES[cityKey].busRoutes
      : null;
  if (!routes) return null;

  const code = codeRaw;
  const normName = mfOtpNormLabel(otpLineName);

  const candidates = routes.filter((r) => {
    const id = String(r?.id || "");
    const label = String(r?.label || "");
    const idMatch = id === code || id.endsWith(`_${code}`) || id.includes(`_${code}`);
    const labelMatch =
      new RegExp(String.raw`(?:\]|\b)\s*${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b`, "i").test(label) ||
      label.includes(` ${code} `) ||
      label.includes(` ${code}-`) ||
      label.includes(` ${code}X`);
    return idMatch || labelMatch;
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;

  if (normName) {
    const scored = candidates
      .map((r) => {
        const label = String(r?.label || "");
        const afterDash = label.includes(" - ") ? label.split(" - ").slice(1).join(" - ") : label;
        const labelNorm = mfOtpNormLabel(afterDash);
        let score = 0;
        if (labelNorm === normName) score += 10;
        if (labelNorm && normName && (labelNorm.includes(normName) || normName.includes(labelNorm))) score += 6;
        const nameToks = normName.split(" ").filter((t) => t.length >= 4);
        const labelToks = new Set(labelNorm.split(" ").filter((t) => t.length >= 4));
        for (const t of nameToks) if (labelToks.has(t)) score += 1;
        return { id: r.id, score };
      })
      .sort((a, b) => b.score - a.score);
    if (scored[0] && scored[0].score > 0) return scored[0].id;
  }

  return candidates[0].id;
}

async function mfFetchStaticRouteJson(routeId, dir) {
  const base = window.CITY_CONFIG && window.CITY_CONFIG.routeDataBase ? String(window.CITY_CONFIG.routeDataBase) : null;
  if (!base) return null;
  const safeId = String(routeId).replace(/[/?#]+/g, "_");
  const baseUrl = base.endsWith("/") ? base : base + "/";
  const tries = [
    `route-${safeId}-dir${dir}.json`,
    `route-${encodeURIComponent(String(routeId))}-dir${dir}.json`,
    `route-${safeId}.json`,
    `route-${encodeURIComponent(String(routeId))}.json`
  ];
  for (let i = 0; i < tries.length; i++) {
    try {
      const res = await fetch(baseUrl + tries[i], { cache: "no-store" });
      if (!res.ok) continue;
      const j = await res.json();
      if (j && Array.isArray(j.stops)) return j;
    } catch (_) {}
  }
  return null;
}

function mfPrimaryShapeFromRouteData(rd) {
  if (!rd) return null;
  if (Array.isArray(rd.shapes) && rd.shapes[0] && rd.shapes[0].length > 1) return rd.shapes[0];
  if (Array.isArray(rd.shape) && rd.shape.length > 1) return rd.shape;
  return null;
}

function mfHaversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** routeShape / otpSegment coordinates are [lat, lon] (matches routeOverlay). */
function mfNearestDistPointToShapeM(routeShape, lat, lon) {
  if (!Array.isArray(routeShape) || routeShape.length < 2) return Infinity;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return Infinity;
  let bestD2 = Infinity;
  let projLat = la;
  let projLon = lo;
  for (let i = 0; i < routeShape.length - 1; i++) {
    const p0 = routeShape[i];
    const p1 = routeShape[i + 1];
    const y0 = Number(p0 && p0[0]);
    const x0 = Number(p0 && p0[1]);
    const y1 = Number(p1 && p1[0]);
    const x1 = Number(p1 && p1[1]);
    if (![y0, x0, y1, x1].every(Number.isFinite)) continue;
    const vx = x1 - x0;
    const vy = y1 - y0;
    const wx = lo - x0;
    const wy = la - y0;
    const vv = vx * vx + vy * vy;
    if (vv < 1e-12) continue;
    let t = (wx * vx + wy * vy) / vv;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = x0 + t * vx;
    const py = y0 + t * vy;
    const dx = lo - px;
    const dy = la - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      projLat = py;
      projLon = px;
    }
  }
  if (!Number.isFinite(bestD2) || bestD2 === Infinity) return Infinity;
  return mfHaversineM(la, lo, projLat, projLon);
}

function mfMeanDistOtpSegmentToShape(routeShape, otpSegment) {
  if (!Array.isArray(otpSegment) || otpSegment.length < 2 || !routeShape) return Infinity;
  let sum = 0;
  let n = 0;
  const stride = Math.max(1, Math.floor(otpSegment.length / 12));
  for (let i = 0; i < otpSegment.length; i += stride) {
    const p = otpSegment[i];
    const lat = Number(p && p[0]);
    const lon = Number(p && p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const d = mfNearestDistPointToShapeM(routeShape, lat, lon);
    if (Number.isFinite(d)) {
      sum += d;
      n++;
    }
  }
  return n ? sum / n : Infinity;
}

/**
 * Pick dir 0 vs 1 by mean distance from OTP ridden segment to each direction's primary polyline.
 * Returns null if inconclusive.
 */
function mfPickDirectionByOtpSegment(dir0Data, dir1Data, otpSegment) {
  if (!otpSegment || otpSegment.length < 2) return null;
  const s0 = mfPrimaryShapeFromRouteData(dir0Data);
  const s1 = mfPrimaryShapeFromRouteData(dir1Data);
  const d0 = s0 ? mfMeanDistOtpSegmentToShape(s0, otpSegment) : Infinity;
  const d1 = s1 ? mfMeanDistOtpSegmentToShape(s1, otpSegment) : Infinity;
  if (!Number.isFinite(d0) && !Number.isFinite(d1)) return null;
  const marginM = 35;
  if (d0 + marginM < d1) return 0;
  if (d1 + marginM < d0) return 1;
  return null;
}

class JourneyLeg {
  constructor(leg, index) {
    this.index = index;
    this.type = leg.mode === 'WALK' ? 'WALK' : 'TRANSIT';
    this.mode = leg.mode;
    this.duration = leg.duration;
    this.distance = leg.distance;
    
    // Geometry (already clipped and split into segments)
    this.geometry = null; // Full geometry [lat, lng][]
    this.solidSegment = null; // [lat, lng][] - the ridden portion
    this.dashedBefore = null; // [lat, lng][] - before boarding
    this.dashedAfter = null; // [lat, lng][] - after alighting
    
    // Transit-specific
    this.line = null; // { id, name, color }
    this.routeNumber = null; // Normalized route number for bus tracking
    this.direction = null; // Direction ID (0 or 1)
    this.serviceJourneyId = leg.tripId || null;
    this.routeVerified = false; // Whether route was verified by stop sequence match
    
    // Places (JourneyLeg does not expose raw leg.from — use boarding/alighting only)
    this.boardingPoint = mfOtpLegEndpoint(leg.fromPlace, leg.from);
    this.alightingPoint = mfOtpLegEndpoint(leg.toPlace, leg.to);
    
    // Stops (if available)
    this.stops = leg.estimatedCalls || null;
  }
}

/**
 * Normalize OTP itineraries into clean Journey objects
 * This is where ALL the logic happens - route matching, geometry clipping, etc.
 * After this, rendering is just "draw what's in the Journey object"
 * 
 * @param {Array} convertedItineraries - Raw OTP itineraries from GraphQL
 * @returns {Array<Journey>} Normalized Journey objects
 */
async function normalizeItineraries(convertedItineraries) {
  console.log('🔄 [normalizeItineraries] Starting normalization of', convertedItineraries.length, 'itineraries');
  
  const journeys = [];
  
  for (let itinIdx = 0; itinIdx < convertedItineraries.length; itinIdx++) {
    try {
      const itin = convertedItineraries[itinIdx];
      console.log(`🔄 [normalizeItineraries] Processing itinerary ${itinIdx + 1}`, {
        hasItin: !!itin,
        hasLegs: !!(itin && itin.legs),
        legsCount: itin?.legs?.length || 0
      });
      
      if (!itin) {
        console.warn(`⚠️ [normalizeItineraries] Itinerary ${itinIdx + 1} is null/undefined, skipping`);
        continue;
      }
      
      if (!itin.legs || !Array.isArray(itin.legs) || itin.legs.length === 0) {
        console.warn(`⚠️ [normalizeItineraries] Itinerary ${itinIdx + 1} has no legs, skipping`);
        continue;
      }
      
      const journey = new Journey(itin);
      journey.id = itinIdx;
      
      console.log(`🔄 [normalizeItineraries] Created Journey for itinerary ${itinIdx + 1}, processing ${itin.legs.length} legs`);
      
      // Process each leg
      for (let legIdx = 0; legIdx < itin.legs.length; legIdx++) {
      try {
        const leg = itin.legs[legIdx];
        console.log(`🔄 [normalizeItineraries] Processing leg ${legIdx} of itinerary ${itinIdx + 1} (${leg.mode})`);
        
        const journeyLeg = new JourneyLeg(leg, legIdx);
        
        // Extract and normalize route number (for transit legs only)
        if (journeyLeg.type === 'TRANSIT') {
          console.log(`🔄 [normalizeItineraries] Extracting route info for leg ${legIdx}...`);
          const routeInfo = await extractRouteInfo(leg, legIdx);
          journeyLeg.routeNumber = routeInfo.routeNumber;
          journeyLeg.direction = routeInfo.direction;
          journeyLeg.line = routeInfo.line;
          journeyLeg.directionCalculated = routeInfo.directionCalculated || false;
          journeyLeg.routeVerified = routeInfo.verified || false; // Track if route was verified by stops
          
          console.log(`🔄 [normalizeItineraries] Leg ${legIdx} (${leg.mode}): route=${journeyLeg.routeNumber}, direction=${journeyLeg.direction}, verified=${journeyLeg.routeVerified}`);
        }
        
        // Clip geometry once (for all legs)
        console.log(`🔄 [normalizeItineraries] Clipping geometry for leg ${legIdx}...`);
        await clipLegGeometry(journeyLeg, leg);
        console.log(`🔄 [normalizeItineraries] ✅ Completed leg ${legIdx}`);
        
        journey.legs.push(journeyLeg);
      } catch (error) {
        console.error(`❌ [normalizeItineraries] Error processing leg ${legIdx} of itinerary ${itinIdx + 1}:`, error);
        // Continue with next leg even if this one fails
        continue;
      }
      }
      
      journeys.push(journey);
      console.log(`🔄 [normalizeItineraries] ✅ Normalized itinerary ${itinIdx + 1}: ${journey.legs.length} legs, ${journey.transfers} transfers`);
    } catch (error) {
      console.error(`❌ [normalizeItineraries] Error processing itinerary ${itinIdx + 1}:`, error);
      // Continue with next itinerary even if this one fails
      continue;
    }
  }
  
  console.log('🔄 [normalizeItineraries] ✅ Normalization complete:', journeys.length, 'journeys');
  return journeys;
}

/**
 * Extract route information from an OTP leg
 * Handles all the route matching, direction calculation, etc.
 * @param {Object} leg - OTP leg object
 * @param {number} legIdx - Leg index
 * @returns {Object} { routeNumber, direction, line }
 */
async function extractRouteInfo(leg, legIdx) {
  let routeNumber = null;
  let direction = 0; // Default
  let verified = false; // Whether route was verified by stop sequence
  
  // Preserve original leg.line if available
  let line = leg.line ? {
    id: leg.line.publicCode || leg.route || null,
    name: leg.line.name || leg.routeLongName || leg.routeShortName || leg.route || null,
    publicCode: leg.line.publicCode || null,
    color: null // Will be assigned later
  } : {
    id: leg.route || null,
    name: leg.routeLongName || leg.routeShortName || leg.route || null,
    publicCode: null,
    color: null // Will be assigned later
  };
  
  // WALK/FOOT: Never try to match to route files, just use OTP geometry
  if (leg.mode === 'WALK' || leg.mode === 'FOOT') {
    console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Walking leg - no route matching`);
    addDebugLog(
      `Leg ${legIdx}: Route Extraction`,
      { mode: leg.mode, legIndex: legIdx },
      `Walking leg - skipping route matching (uses OTP geometry only)`
    );
    return { routeNumber: null, direction: 0, line, directionCalculated: false, verified: false };
  }
  
  // BUS: Primary key is line.publicCode (e.g., "75")
  if (leg.mode === 'BUS') {
    if (leg.line && leg.line.publicCode) {
      routeNumber = leg.line.publicCode;
      console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Using publicCode:`, routeNumber);
      
      addDebugLog(
        `Leg ${legIdx}: Route Extraction (BUS)`,
        {
          mode: leg.mode,
          publicCode: leg.line.publicCode,
          lineName: leg.line.name,
          stopCount: leg.estimatedCalls?.length || 0
        },
        `Identified as BUS route ${routeNumber} using publicCode from OTP`
      );
      
      // Verify by stop sequence if available
      if (leg.estimatedCalls && Array.isArray(leg.estimatedCalls) && leg.estimatedCalls.length > 0) {
        const verifyResult = await verifyRouteByStops(routeNumber, leg.estimatedCalls, leg.mode);
        verified = verifyResult.verified;
        if (!verified) {
          console.warn(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Route ${routeNumber} failed stop verification - ${verifyResult.reason}`);
        } else {
          console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Route ${routeNumber} verified - ${verifyResult.reason}`);
        }
      }
    } else {
      console.warn(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): No publicCode available`);
      addDebugLog(
        `Leg ${legIdx}: Route Extraction (BUS)`,
        { mode: leg.mode, line: leg.line },
        `⚠️ No publicCode available - cannot identify route`
      );
    }
  }
  // TRAM: Green Line branches - publicCode is single letter (B, C, D, E), map to "Green-X"
  else if (leg.mode === 'TRAM') {
    if (leg.line && leg.line.publicCode) {
      const branchCode = leg.line.publicCode;
      // Map single letter to Green Line branch (e.g., "D" -> "Green-D")
      if (/^[BCDE]$/.test(branchCode)) {
        routeNumber = `Green-${branchCode}`;
        console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Mapped publicCode "${branchCode}" to route:`, routeNumber);
      } else {
        routeNumber = branchCode;
        console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Using publicCode:`, routeNumber);
      }
      
      // Verify by stop sequence if available
      if (leg.estimatedCalls && Array.isArray(leg.estimatedCalls) && leg.estimatedCalls.length > 0) {
        const verifyResult = await verifyRouteByStops(routeNumber, leg.estimatedCalls);
        verified = verifyResult.verified;
        if (!verified) {
          console.warn(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Route ${routeNumber} failed stop verification - ${verifyResult.reason}`);
        } else {
          console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Route ${routeNumber} verified - ${verifyResult.reason}`);
        }
      }
    } else {
      console.warn(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): No publicCode available`);
    }
  }
  // METRO/SUBWAY: Primary key is line.name (e.g., "Red Line"), determine branch from stops
  else if (leg.mode === 'METRO' || leg.mode === 'SUBWAY') {
    if (leg.line && leg.line.name) {
      // Extract base route name (e.g., "Red Line" -> "Red")
      const lineName = leg.line.name;
      console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Using line.name:`, lineName);
      
      // Map to our route ID format
      routeNumber = mapSubwayRouteCode(null, lineName);
      
      addDebugLog(
        `Leg ${legIdx}: Route Extraction (${leg.mode})`,
        {
          mode: leg.mode,
          lineName: lineName,
          mappedRoute: routeNumber,
          stopCount: leg.estimatedCalls?.length || 0
        },
        `Mapped "${lineName}" to route ID: ${routeNumber}`
      );
      
      // Determine branch from stop sequence
      if (leg.estimatedCalls && Array.isArray(leg.estimatedCalls) && leg.estimatedCalls.length > 0) {
        // For Green Line: determine branch
        if (routeNumber === 'Green') {
          const branch = determineGreenLineBranch(leg.estimatedCalls);
          if (branch) {
            routeNumber = `Green-${branch}`;
            console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Determined branch: ${branch}`);
            addDebugLog(
              `Leg ${legIdx}: Branch Determination (Green Line)`,
              {
                stops: leg.estimatedCalls.map(c => c.quay?.name || c.name).slice(0, 5),
                totalStops: leg.estimatedCalls.length
              },
              `Determined branch: ${branch} based on stop sequence`
            );
          }
        }
        // For Red Line: determine branch (Ashmont vs Braintree)
        else if (routeNumber === 'Red') {
          const branch = determineRedLineBranch(leg.estimatedCalls);
          if (branch) {
            routeNumber = `Red-${branch}`;
            console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Determined branch: ${branch}`);
            addDebugLog(
              `Leg ${legIdx}: Branch Determination (Red Line)`,
              {
                stops: leg.estimatedCalls.map(c => c.quay?.name || c.name),
                totalStops: leg.estimatedCalls.length
              },
              `Determined branch: ${branch} (terminal: ${leg.estimatedCalls[leg.estimatedCalls.length - 1]?.quay?.name || 'unknown'})`
            );
          }
        }
        
        // Verify by stop sequence
        const verifyResult = await verifyRouteByStops(routeNumber, leg.estimatedCalls, leg.mode);
        verified = verifyResult.verified;
        if (!verified) {
          console.warn(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Route ${routeNumber} failed stop verification - ${verifyResult.reason}`);
        } else {
          console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Route ${routeNumber} verified - ${verifyResult.reason}`);
        }
      }
    } else {
      console.warn(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): No line.name available`);
      addDebugLog(
        `Leg ${legIdx}: Route Extraction (${leg.mode})`,
        { mode: leg.mode, line: leg.line },
        `⚠️ No line.name available - cannot identify route`
      );
    }
  }
  // RAIL/TRAIN/FERRY: Use publicCode if available, otherwise line.name
  // For commuter rail, map line names like "Fitchburg Line" to route IDs like "CR-Fitchburg"
  else if (leg.mode === 'RAIL' || leg.mode === 'TRAIN' || leg.mode === 'FERRY') {
    if (leg.line && leg.line.publicCode) {
      routeNumber = leg.line.publicCode;
      console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Using publicCode:`, routeNumber);
      
      // If publicCode doesn't start with "CR-", try to map it
      if (!routeNumber.startsWith('CR-') && leg.mode === 'RAIL') {
        routeNumber = mapCommuterRailRoute(routeNumber, leg.line?.name);
      }
    } else if (leg.line && leg.line.name) {
      // Map commuter rail line names to route IDs
      routeNumber = mapCommuterRailRoute(leg.line.name, leg.line.name);
      console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Mapped line.name "${leg.line.name}" to route:`, routeNumber);
    }
  }
  
  // Calculate direction for transit modes (if we have a route number)
  const transitModes = ['BUS', 'TRAM', 'RAIL', 'TRAIN', 'FERRY', 'SUBWAY', 'METRO'];
  let directionCalculated = false;
  if (transitModes.includes(leg.mode) && routeNumber) {
    const directionResult = await calculateDirection(leg, routeNumber, leg.line?.name || '');
    direction = directionResult.direction;
    directionCalculated = directionResult.calculated || false;
    console.log(`🔍 [extractRouteInfo]   ✅ Direction for ${leg.mode}:`, direction, directionCalculated ? '(calculated)' : '(defaulted)');
  }
  
  return { routeNumber, direction, line, directionCalculated, verified };
}

/**
 * Calculate direction for a transit leg
 * @param {Object} leg - OTP leg object
 * @param {string} routeNumber - Route number
 * @param {string} routeDescription - Route description
 * @returns {number} Direction ID (0 or 1)
 */
async function calculateDirection(leg, routeNumber, routeDescription) {
  let direction = 0; // Default fallback
  let calculated = false; // Track if direction was actually calculated (not just defaulted)
  
  // Helper function
  function normalizeString(str) {
    return (str || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/\s+/g, '');
  }
  
  // For Boston (lazy-loading): Try to use route data if available
  // For other cities: Use masterRoutes
  const isBoston = (typeof window.CITY_CONFIG !== 'undefined' && window.CITY_CONFIG.useLazyLoading) ||
                   (typeof CITY_CONFIG !== 'undefined' && CITY_CONFIG.useLazyLoading);
  
  if (routeNumber && leg.fromPlace && leg.toPlace) {
    console.log(`🔍 [calculateDirection] Processing ${leg.mode} route:`, routeNumber);
    
    // For Boston: Use OTP's stop sequence (estimatedCalls) to match direction
    // OTP gives us the exact stops in order - this is much more reliable than just from/to
    if (isBoston && window.routeLoader && leg.estimatedCalls && Array.isArray(leg.estimatedCalls) && leg.estimatedCalls.length > 0) {
      try {
        // Ensure routes index is loaded
        if (!window.routeLoader.isRoutesIndexLoaded()) {
          await window.routeLoader.loadRoutesIndex();
        }
        
        // Get OTP stop names in order (the actual sequence from the trip)
        const otpStopNames = leg.estimatedCalls.map(call => normalizeString(call.quay?.name || ''));
        
        // Load both directions
        // If routeNumber has a branch suffix (e.g., "Red-Ashmont"), try that first, then fall back to base route
        let dir0Data = null;
        let dir1Data = null;
        
        try {
          [dir0Data, dir1Data] = await Promise.all([
            window.routeLoader.loadRoute(routeNumber, 0).catch(() => null),
            window.routeLoader.loadRoute(routeNumber, 1).catch(() => null)
          ]);
        } catch (e) {
          // Ignore - will try fallback below
        }
        
        // If branch route doesn't exist or failed, try base route (e.g., "Red-Ashmont" -> "Red")
        if ((!dir0Data || !dir1Data) && routeNumber.includes('-')) {
          const baseRoute = routeNumber.split('-')[0];
          console.log(`🔍 [calculateDirection] Branch route ${routeNumber} not found, trying base route ${baseRoute}`);
          try {
            const [baseDir0, baseDir1] = await Promise.all([
              window.routeLoader.loadRoute(baseRoute, 0).catch(() => null),
              window.routeLoader.loadRoute(baseRoute, 1).catch(() => null)
            ]);
            if (baseDir0) dir0Data = baseDir0;
            if (baseDir1) dir1Data = baseDir1;
          } catch (e) {
            // Ignore
          }
        }
        
        if (dir0Data && dir1Data && dir0Data.stops && dir1Data.stops) {
          // Match OTP's stop sequence against our route data
          function matchStopSequence(otpStops, routeStops) {
            if (!routeStops || routeStops.length === 0) return 0;
            
            let matches = 0;
            let consecutiveMatches = 0;
            let maxConsecutive = 0;
            let lastMatchIndex = -1;
            
            // Check how many OTP stops appear in the route, and in what order
            for (let i = 0; i < otpStops.length; i++) {
              const otpStop = otpStops[i];
              const routeIndex = routeStops.findIndex(s => normalizeString(s.name) === otpStop);
              
              if (routeIndex >= 0) {
                matches++;
                // Check if this stop comes after the previous match (consecutive in order)
                if (lastMatchIndex < 0 || routeIndex > lastMatchIndex) {
                  consecutiveMatches++;
                  maxConsecutive = Math.max(maxConsecutive, consecutiveMatches);
                  lastMatchIndex = routeIndex;
                } else {
                  consecutiveMatches = 1;
                  lastMatchIndex = routeIndex;
                }
              }
            }
            
            // Score based on matches and sequence order (consecutive matches are very important)
            return matches * 2 + maxConsecutive * 10;
          }
          
          const dir0Score = matchStopSequence(otpStopNames, dir0Data.stops);
          const dir1Score = matchStopSequence(otpStopNames, dir1Data.stops);
          
          // Determine best direction
          if (dir1Score > dir0Score) {
            direction = 1;
            calculated = true;
            console.log(`🔍 [calculateDirection] ${leg.mode} ${routeNumber}: matched direction 1 using OTP stop sequence (dir0: ${dir0Score}, dir1: ${dir1Score}, ${otpStopNames.length} stops)`);
          } else if (dir0Score > dir1Score) {
            direction = 0;
            calculated = true;
            console.log(`🔍 [calculateDirection] ${leg.mode} ${routeNumber}: matched direction 0 using OTP stop sequence (dir0: ${dir0Score}, dir1: ${dir1Score}, ${otpStopNames.length} stops)`);
          } else {
            // Fallback to from/to matching if sequence doesn't clearly match
            const otpFrom = normalizeString(leg.fromPlace.name);
            const otpTo = normalizeString(leg.toPlace.name);
            const dir0First = normalizeString(dir0Data.stops[0]?.name);
            const dir0Last = normalizeString(dir0Data.stops[dir0Data.stops.length - 1]?.name);
            const dir1First = normalizeString(dir1Data.stops[0]?.name);
            const dir1Last = normalizeString(dir1Data.stops[dir1Data.stops.length - 1]?.name);
            
            // Simple terminal matching
            if ((otpFrom === dir0First || otpTo === dir0Last) && !(otpFrom === dir1First || otpTo === dir1Last)) {
              direction = 0;
              calculated = true;
              console.log(`🔍 [calculateDirection] ${leg.mode} ${routeNumber}: matched direction 0 via terminal stops (fallback)`);
            } else if ((otpFrom === dir1First || otpTo === dir1Last) && !(otpFrom === dir0First || otpTo === dir0Last)) {
              direction = 1;
              calculated = true;
              console.log(`🔍 [calculateDirection] ${leg.mode} ${routeNumber}: matched direction 1 via terminal stops (fallback)`);
            } else {
              direction = 0;
              calculated = false;
              console.log(`🔍 [calculateDirection] ${leg.mode} ${routeNumber}: couldn't determine direction, defaulting to 0`);
            }
          }
        } else {
          direction = 0;
          calculated = false;
          console.log(`🔍 [calculateDirection] ${leg.mode} ${routeNumber}: couldn't load route data, defaulting to 0`);
        }
      } catch (error) {
        direction = 0;
        calculated = false;
        console.warn(`🔍 [calculateDirection] ${leg.mode} ${routeNumber}: error:`, error);
      }
    } else if (isBoston && window.routeLoader && leg.fromPlace && leg.toPlace) {
      // Fallback: Use from/to stops if estimatedCalls not available
      try {
        if (!window.routeLoader.isRoutesIndexLoaded()) {
          await window.routeLoader.loadRoutesIndex();
        }
        
        const [dir0Data, dir1Data] = await Promise.all([
          window.routeLoader.loadRoute(routeNumber, 0).catch(() => null),
          window.routeLoader.loadRoute(routeNumber, 1).catch(() => null)
        ]);
        
        if (dir0Data && dir1Data && dir0Data.stops && dir1Data.stops) {
          const otpFrom = normalizeString(leg.fromPlace.name);
          const otpTo = normalizeString(leg.toPlace.name);
          const dir0First = normalizeString(dir0Data.stops[0]?.name);
          const dir0Last = normalizeString(dir0Data.stops[dir0Data.stops.length - 1]?.name);
          const dir1First = normalizeString(dir1Data.stops[0]?.name);
          const dir1Last = normalizeString(dir1Data.stops[dir1Data.stops.length - 1]?.name);
          
          // Simple terminal matching
          if ((otpFrom === dir0First || otpTo === dir0Last) && !(otpFrom === dir1First || otpTo === dir1Last)) {
            direction = 0;
            calculated = true;
            console.log(`🔍 [calculateDirection] ${leg.mode} ${routeNumber}: matched direction 0 via terminal stops`);
          } else if ((otpFrom === dir1First || otpTo === dir1Last) && !(otpFrom === dir0First || otpTo === dir0Last)) {
            direction = 1;
            calculated = true;
            console.log(`🔍 [calculateDirection] ${leg.mode} ${routeNumber}: matched direction 1 via terminal stops`);
          } else {
            direction = 0;
            calculated = false;
            console.log(`🔍 [calculateDirection] ${leg.mode} ${routeNumber}: couldn't determine direction, defaulting to 0`);
          }
        }
      } catch (error) {
        direction = 0;
        calculated = false;
        console.warn(`🔍 [calculateDirection] ${leg.mode} ${routeNumber}: error:`, error);
      }
    } else if (
      !isBoston &&
      typeof window.CITY_CONFIG !== "undefined" &&
      window.CITY_CONFIG.routeDataBase &&
      routeNumber &&
      leg.fromPlace &&
      leg.toPlace
    ) {
      // Cincinnati / static JSON: resolve BUS → sorta_XX and compare OTP stops to dir0/dir1 route files.
      try {
        let rid = String(routeNumber);
        if (leg.mode === "BUS") {
          const resolved = mfResolveBusRouteIdFromRoutesIndex(
            leg.line?.publicCode || routeNumber,
            leg.line?.name || routeDescription || ""
          );
          if (resolved) rid = resolved;
        }

        let dir0Data = await mfFetchStaticRouteJson(rid, 0);
        let dir1Data = await mfFetchStaticRouteJson(rid, 1);
        if ((!dir0Data || !dir1Data) && rid.includes("-")) {
          const baseRoute = rid.split("-")[0];
          if (!dir0Data) dir0Data = await mfFetchStaticRouteJson(baseRoute, 0);
          if (!dir1Data) dir1Data = await mfFetchStaticRouteJson(baseRoute, 1);
        }

        if (dir0Data && dir1Data && dir0Data.stops && dir1Data.stops) {
          function matchStopSequenceFuzzy(otpStops, routeStops) {
            if (!routeStops || routeStops.length === 0) return 0;
            let matches = 0;
            let consecutiveMatches = 0;
            let maxConsecutive = 0;
            let lastMatchIndex = -1;
            for (let i = 0; i < otpStops.length; i++) {
              const otpStop = otpStops[i];
              if (!otpStop) continue;
              const routeIndex = routeStops.findIndex((s) => {
                const rn = normalizeString(s.name);
                return rn === otpStop || (rn && otpStop && (rn.includes(otpStop) || otpStop.includes(rn)));
              });
              if (routeIndex >= 0) {
                matches++;
                if (lastMatchIndex < 0 || routeIndex > lastMatchIndex) {
                  consecutiveMatches++;
                  maxConsecutive = Math.max(maxConsecutive, consecutiveMatches);
                  lastMatchIndex = routeIndex;
                } else {
                  consecutiveMatches = 1;
                  lastMatchIndex = routeIndex;
                }
              }
            }
            return matches * 2 + maxConsecutive * 10;
          }

          function validateFromBeforeToDir(dirData) {
            const fromNm = String(leg.fromPlace.name || "");
            const toNm = String(leg.toPlace.name || "");
            const fn = (s) =>
              String(s || "")
                .toLowerCase()
                .replace(/&amp;/g, "&")
                .replace(/[^a-z0-9]+/g, "")
                .trim();
            const targetF = fn(fromNm);
            const targetT = fn(toNm);
            if (!targetF || !targetT) return false;
            let fromIx = -1;
            let toIx = -1;
            for (let i = 0; i < dirData.stops.length; i++) {
              const n = fn(dirData.stops[i] && dirData.stops[i].name);
              if (
                fromIx < 0 &&
                n &&
                (n === targetF || n.includes(targetF) || targetF.includes(n))
              ) {
                fromIx = i;
                break;
              }
            }
            for (let i = dirData.stops.length - 1; i >= 0; i--) {
              const n = fn(dirData.stops[i] && dirData.stops[i].name);
              if (n && (n === targetT || n.includes(targetT) || targetT.includes(n))) {
                toIx = i;
                break;
              }
            }
            if (fromIx < 0 || toIx < 0) return false;
            if (fromIx > toIx) return false;
            return true;
          }

          if (leg.estimatedCalls && Array.isArray(leg.estimatedCalls) && leg.estimatedCalls.length > 0) {
            const otpStopNames = leg.estimatedCalls.map((call) =>
              normalizeString(call.quay?.name || call.name || "")
            );
            const dir0Score = matchStopSequenceFuzzy(otpStopNames, dir0Data.stops);
            const dir1Score = matchStopSequenceFuzzy(otpStopNames, dir1Data.stops);
            if (dir1Score > dir0Score) {
              direction = 1;
              calculated = true;
              console.log(
                `[calculateDirection] static JSON: direction 1 (sequence dir0=${dir0Score} dir1=${dir1Score})`
              );
            } else if (dir0Score > dir1Score) {
              direction = 0;
              calculated = true;
              console.log(
                `[calculateDirection] static JSON: direction 0 (sequence dir0=${dir0Score} dir1=${dir1Score})`
              );
            }
          }

          if (!calculated) {
            const ok0 = validateFromBeforeToDir(dir0Data);
            const ok1 = validateFromBeforeToDir(dir1Data);
            if (ok0 && !ok1) {
              direction = 0;
              calculated = true;
              console.log(`[calculateDirection] static JSON: direction 0 (from/to stop order)`);
            } else if (!ok0 && ok1) {
              direction = 1;
              calculated = true;
              console.log(`[calculateDirection] static JSON: direction 1 (from/to stop order)`);
            }
          }
        }
        if (!calculated) {
          console.log(
            `[calculateDirection] ${leg.mode} ${routeNumber}: static routeDataBase — could not lock direction, default 0`
          );
        }
      } catch (error) {
        direction = 0;
        calculated = false;
        console.warn(`[calculateDirection] static JSON error:`, error);
      }
    } else {
      direction = 0;
      calculated = false;
      console.log(`🔍 [calculateDirection] ${leg.mode} ${routeNumber}: not Boston or routeLoader not available, defaulting to 0`);
    }
  }
  
  console.log('🔍 [calculateDirection] Final direction:', direction, calculated ? '(calculated)' : '(defaulted)');
  return { direction, calculated };
}

/**
 * Clip leg geometry into solid/dashed segments
 * This happens ONCE during normalization, not every render
 * @param {JourneyLeg} journeyLeg - Journey leg to populate
 * @param {Object} leg - OTP leg object with geometry
 */
async function clipLegGeometry(journeyLeg, leg) {
  const fromLat = journeyLeg.boardingPoint?.lat;
  const fromLon = journeyLeg.boardingPoint?.lng;
  const toLat = journeyLeg.alightingPoint?.lat;
  const toLon = journeyLeg.alightingPoint?.lng;
  
  if (!fromLat || !fromLon || !toLat || !toLon) {
    console.warn(`⚠️ [clipLegGeometry] Missing coordinates for leg ${journeyLeg.index}`);
    return;
  }
  
  let coords = [];
  
  // Use OTP pointsOnLink for both transit and walking legs
  if (leg.pointsOnLink?.points) {
    try {
      coords = decodePolyline(leg.pointsOnLink.points);
      console.log(`✂️ [clipLegGeometry] ${journeyLeg.type} leg ${journeyLeg.index}: decoded ${coords.length} points from OTP`);
    } catch (e) {
      console.warn(`⚠️ [clipLegGeometry] Failed to decode OTP geometry:`, e);
    }
  }
  
  // Fallback: straight line (only if OTP didn't provide geometry)
  if (!coords.length) {
    coords = [[fromLat, fromLon], [toLat, toLon]];
    console.log(`✂️ [clipLegGeometry] Leg ${journeyLeg.index}: using straight line fallback (no OTP geometry)`);
  }
  
  // Store full geometry
  journeyLeg.geometry = coords;
  
  // For transit: split into solid/dashed segments
  if (journeyLeg.type === 'TRANSIT' && coords.length > 10) {
    const startIdx = findNearestPointIndex(coords, fromLat, fromLon);
    const endIdx = findNearestPointIndex(coords, toLat, toLon);
    const actualStart = Math.min(startIdx, endIdx);
    const actualEnd = Math.max(startIdx, endIdx);
    
    // Ensure meaningful middle segment
    if ((actualEnd - actualStart) >= 2) {
      journeyLeg.dashedBefore = coords.slice(0, actualStart + 1);
      journeyLeg.solidSegment = coords.slice(actualStart, actualEnd + 1);
      journeyLeg.dashedAfter = coords.slice(actualEnd);
      console.log(`✂️ [clipLegGeometry] Transit leg ${journeyLeg.index}: split into ${journeyLeg.dashedBefore.length} + ${journeyLeg.solidSegment.length} + ${journeyLeg.dashedAfter.length} points`);
    } else {
      // Not enough points to split, use full geometry as solid
      journeyLeg.solidSegment = coords;
      console.log(`✂️ [clipLegGeometry] Transit leg ${journeyLeg.index}: using full geometry (couldn't split)`);
    }
  } else {
    // Walking or short transit: use full geometry as solid
    journeyLeg.solidSegment = coords;
  }
}

/**
 * Draw a Journey on the map
 * Simple renderer - just draws what's in the Journey object
 * @param {Journey} journey - Journey object to render
 */
/**
 * Get MBTA subway route color
 * @param {string} routeId - Route ID (e.g., "Orange", "Red", "Blue", "Green-D")
 * @returns {string} Hex color code
 */
function getSubwayRouteColor(routeId) {
  if (!routeId) return '#1E3A8A'; // Default blue
  
  const routeIdUpper = routeId.toUpperCase();
  
  // MBTA official colors
  if (routeIdUpper === 'RED' || routeIdUpper.startsWith('RED-')) {
    return '#DA291C'; // MBTA Red
  } else if (routeIdUpper === 'ORANGE' || routeIdUpper.startsWith('ORANGE-')) {
    return '#ED8B00'; // MBTA Orange
  } else if (routeIdUpper === 'BLUE' || routeIdUpper.startsWith('BLUE-')) {
    return '#003DA5'; // MBTA Blue
  } else if (routeIdUpper === 'GREEN' || routeIdUpper.startsWith('GREEN-')) {
    return '#00843D'; // MBTA Green
  }
  
  // Fallback to default
  return '#1E3A8A';
}

/**
 * Map subway route codes to route names (MBTA specific)
 * OTP returns codes like "200" for Red Line, but system expects "Red"
 */
function mapSubwayRouteCode(routeId, routeName) {
  // If it's already a name with branch suffix (e.g., "Red-Ashmont", "Green-D"), return as-is
  if (routeId && (routeId.startsWith('Red-') || routeId.startsWith('Green-') || 
      routeId === 'Red' || routeId === 'Orange' || routeId === 'Blue' || routeId === 'Green' ||
      ['Green-B', 'Green-C', 'Green-D', 'Green-E'].includes(routeId))) {
    return routeId;
  }
  
  // Map numeric codes to names
  const codeMap = {
    '200': 'Red',
    '201': 'Orange',
    '202': 'Blue',
    '203': 'Green',
    '204': 'Green-B',
    '205': 'Green-C',
    '206': 'Green-D',
    '207': 'Green-E'
  };
  
  if (codeMap[routeId]) {
    return codeMap[routeId];
  }
  
  // Try to extract from route name
  if (routeName) {
    const nameLower = routeName.toLowerCase();
    if (nameLower.includes('red line')) return 'Red';
    if (nameLower.includes('orange line')) return 'Orange';
    if (nameLower.includes('blue line')) return 'Blue';
    if (nameLower.includes('green line')) {
      if (nameLower.includes('green-b') || nameLower.includes('green b')) return 'Green-B';
      if (nameLower.includes('green-c') || nameLower.includes('green c')) return 'Green-C';
      if (nameLower.includes('green-d') || nameLower.includes('green d')) return 'Green-D';
      if (nameLower.includes('green-e') || nameLower.includes('green e')) return 'Green-E';
      return 'Green';
    }
  }
  
  // Fallback: return original
  return routeId;
}

/**
 * Map commuter rail route names to route IDs (MBTA specific)
 * OTP returns names like "Fitchburg Line" but system expects "CR-Fitchburg"
 * @param {string} routeId - Route ID or name from OTP
 * @param {string} routeName - Route name from OTP (for lookup)
 * @returns {string} Mapped route ID (e.g., "CR-Fitchburg")
 */
function mapCommuterRailRoute(routeId, routeName) {
  // If it already starts with "CR-", return as-is
  if (routeId && routeId.startsWith('CR-')) {
    return routeId;
  }
  
  // Try to look up from routesIndex if available
  const isBoston = (typeof window.CITY_CONFIG !== 'undefined' && window.CITY_CONFIG.useLazyLoading) ||
                   (typeof CITY_CONFIG !== 'undefined' && CITY_CONFIG.useLazyLoading);
  if (isBoston && window.routeLoader && window.routeLoader.isRoutesIndexLoaded()) {
    const routesIndex = window.routeLoader.getRoutesIndex();
    if (routesIndex && routesIndex.routes) {
      // Look for commuter rail routes that match
      const nameToMatch = (routeName || routeId || '').toLowerCase();
      const routeMatch = routesIndex.routes.find(r => {
        if (!r.route_id || !r.route_id.startsWith('CR-')) return false;
        
        // Check if route name matches
        const routeTitle = (r.route_title || '').toLowerCase();
        const routeLongName = (r.route_long_name || '').toLowerCase();
        const routeNameField = (r.route_name || '').toLowerCase();
        
        // Extract line name from "CR-Fitchburg" -> "Fitchburg"
        const crLineName = r.route_id.replace('CR-', '').toLowerCase();
        
        // Match patterns:
        // "Fitchburg Line" -> "CR-Fitchburg"
        // "Fitchburg" -> "CR-Fitchburg"
        return nameToMatch.includes(crLineName) || 
               nameToMatch.includes(r.route_id.toLowerCase()) ||
               routeTitle.includes(nameToMatch) ||
               routeLongName.includes(nameToMatch) ||
               routeNameField.includes(nameToMatch);
      });
      
      if (routeMatch) {
        console.log(`🔍 [mapCommuterRailRoute] Mapped "${routeId}" to "${routeMatch.route_id}"`);
        return routeMatch.route_id;
      }
    }
  }
  
  // Fallback: Try to extract from common patterns
  // "Fitchburg Line" -> "CR-Fitchburg"
  // "Fairmount Line" -> "CR-Fairmount"
  if (routeName || routeId) {
    const name = (routeName || routeId).toLowerCase();
    if (name.includes('line')) {
      // Extract line name: "Fitchburg Line" -> "Fitchburg"
      const lineName = name.replace(/\s*line\s*$/i, '').trim();
      if (lineName) {
        // Capitalize first letter: "fitchburg" -> "Fitchburg"
        const capitalized = lineName.charAt(0).toUpperCase() + lineName.slice(1);
        return `CR-${capitalized}`;
      }
    }
  }
  
  // Final fallback: return original
  return routeId;
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distance in meters
 */
function distanceBetweenCoords(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Verify route match by comparing OTP stop sequence to our route stops
 * Uses stable IDs when available, falls back to coordinates, then names
 * @param {string} routeNumber - Route number to verify
 * @param {Array} estimatedCalls - OTP estimated calls (stops) array
 * @returns {Object} { verified: boolean, reason: string }
 */
async function verifyRouteByStops(routeNumber, estimatedCalls) {
  if (!routeNumber || !estimatedCalls || !Array.isArray(estimatedCalls) || estimatedCalls.length === 0) {
    return { verified: false, reason: 'No stops available' };
  }
  
  const isBoston = (typeof window.CITY_CONFIG !== 'undefined' && window.CITY_CONFIG.useLazyLoading) ||
                   (typeof CITY_CONFIG !== 'undefined' && CITY_CONFIG.useLazyLoading);
  if (!isBoston || !window.routeLoader) {
    return { verified: true, reason: 'Cannot verify (not Boston or routeLoader unavailable)' };
  }
  
  try {
    // Ensure routes index is loaded
    if (!window.routeLoader.isRoutesIndexLoaded()) {
      await window.routeLoader.loadRoutesIndex();
    }
    
    // Extract OTP stop data with IDs, coordinates, and names
    const otpStops = estimatedCalls.map(call => ({
      id: call.quay?.id || null,
      name: call.quay?.name || call.name || '',
      lat: call.quay?.latitude || null,
      lon: call.quay?.longitude || null
    }));
    
    // Try both directions
    // If routeNumber has a branch suffix (e.g., "Red-Ashmont"), try that first, then fall back to base route
    let dir0Data = null;
    let dir1Data = null;
    
    try {
      [dir0Data, dir1Data] = await Promise.all([
        window.routeLoader.loadRoute(routeNumber, 0).catch(() => null),
        window.routeLoader.loadRoute(routeNumber, 1).catch(() => null)
      ]);
    } catch (e) {
      // Ignore - will try fallback below
    }
    
    // If branch route doesn't exist or failed, try base route (e.g., "Red-Ashmont" -> "Red")
    if ((!dir0Data || !dir1Data) && routeNumber.includes('-')) {
      const baseRoute = routeNumber.split('-')[0];
      console.log(`🔍 [verifyRouteByStops] Branch route ${routeNumber} not found, trying base route ${baseRoute}`);
      try {
        const [baseDir0, baseDir1] = await Promise.all([
          window.routeLoader.loadRoute(baseRoute, 0).catch(() => null),
          window.routeLoader.loadRoute(baseRoute, 1).catch(() => null)
        ]);
        if (baseDir0) dir0Data = baseDir0;
        if (baseDir1) dir1Data = baseDir1;
      } catch (e) {
        // Ignore
      }
    }
    
    // Adaptive thresholds based on stop count
    const stopCount = otpStops.length;
    let minMatchRatio, minConsecutive;
    
    if (stopCount <= 3) {
      // Very short legs: very forgiving (express patterns, short hops)
      minMatchRatio = 0.33; // At least 1 of 3 stops
      minConsecutive = 1;
    } else if (stopCount <= 5) {
      // Short legs: forgiving
      minMatchRatio = 0.4; // At least 2 of 5 stops
      minConsecutive = 2;
    } else if (stopCount <= 10) {
      // Medium legs: moderate
      minMatchRatio = 0.45; // At least 45% match
      minConsecutive = 3;
    } else {
      // Long legs: strict
      minMatchRatio = 0.5; // At least 50% match
      minConsecutive = 4;
    }
    
    // Check if OTP stops match either direction
    function checkStopMatch(otpStops, routeStops) {
      if (!routeStops || routeStops.length === 0) {
        return { match: false, reason: 'Route has no stops' };
      }
      
      let matches = 0;
      let idMatches = 0;
      let coordMatches = 0;
      let nameMatches = 0;
      let consecutiveMatches = 0;
      let maxConsecutive = 0;
      let lastMatchIndex = -1;
      let hasIds = false;
      let hasCoords = false;
      
      // Check if we have IDs or coordinates available
      const otpHasIds = otpStops.some(s => s.id);
      const otpHasCoords = otpStops.some(s => s.lat && s.lon);
      const routeHasIds = routeStops.some(s => s.id || s.stop_id);
      const routeHasCoords = routeStops.some(s => s.lat && s.lon);
      
      hasIds = otpHasIds && routeHasIds;
      hasCoords = otpHasCoords && routeHasCoords;
      
      // One-time debug output: Compare ID systems for first stop
      let idSystemDebugged = false;
      
      for (let i = 0; i < otpStops.length; i++) {
        const otpStop = otpStops[i];
        let routeIndex = -1;
        let matchType = 'none';
        
        // Priority 1: Match by ID (most reliable)
        if (hasIds && otpStop.id) {
          routeIndex = routeStops.findIndex(s => {
            const routeId = s.id || s.stop_id || s.quay_id;
            // Handle both string and number IDs
            // Strip OTP prefixes like "mbta-ma-us:" from quay.id
            if (routeId && otpStop.id) {
              const otpId = String(otpStop.id).replace(/^[^:]+:/, ''); // Remove prefix (e.g., "mbta-ma-us:2137" -> "2137")
              const routeIdStr = String(routeId);
              return otpId === routeIdStr || String(routeId) === String(otpStop.id) || routeId === otpStop.id;
            }
            return false;
          });
          if (routeIndex >= 0) {
            matchType = 'id';
            idMatches++;
          }
          
          // One-time debug: Compare ID systems for first stop
          if (!idSystemDebugged && i === 0) {
            idSystemDebugged = true;
            // Find closest route stop for comparison
            let closestStop = null;
            let closestDist = Infinity;
            routeStops.forEach(s => {
              if (s.lat && s.lon && otpStop.lat && otpStop.lon) {
                const dist = distanceBetweenCoords(otpStop.lat, otpStop.lon, s.lat, s.lon);
                if (dist < closestDist) {
                  closestDist = dist;
                  closestStop = s;
                }
              }
            });
            
            console.log(`🔍 [verifyRouteByStops] ID SYSTEM COMPARISON (Route ${routeNumber}):`);
            console.log(`🔍   OTP Stop: quay.id="${otpStop.id}", name="${otpStop.name}"`);
            if (closestStop) {
              const routeId = closestStop.id || closestStop.stop_id || closestStop.quay_id || 'N/A';
            console.log(`🔍   Route Stop: stop_id="${routeId}", name="${closestStop.name || 'N/A'}"`);
            console.log(`🔍   Distance: ${closestDist.toFixed(1)}m`);
            // Strip OTP prefix for comparison (e.g., "mbta-ma-us:2137" -> "2137")
            const otpIdStripped = otpStop.id ? String(otpStop.id).replace(/^[^:]+:/, '') : null;
            const routeIdStr = routeId ? String(routeId) : null;
            
            if (otpIdStripped && routeIdStr && otpIdStripped !== routeIdStr) {
              console.warn(`🔍   ⚠️ ID MISMATCH: OTP uses "${otpStop.id}" (stripped: "${otpIdStripped}") but route uses "${routeId}" - different ID systems!`);
            } else if (otpIdStripped && routeIdStr && otpIdStripped === routeIdStr) {
              console.log(`🔍   ✅ ID MATCH: Same ID system confirmed (OTP: "${otpStop.id}" -> "${otpIdStripped}", Route: "${routeId}")`);
            }
            } else {
              console.warn(`🔍   ⚠️ Could not find closest route stop for comparison`);
            }
          }
        }
        
        // Priority 2: Match by coordinates (mode-specific threshold)
        // Rail stations: larger threshold (multiple platforms, big entrances)
        // Bus stops: tighter threshold (avoid matching wrong stop on wrong street)
        const coordThreshold = routeNumber && (routeNumber === 'Red' || routeNumber === 'Orange' || routeNumber === 'Blue' || routeNumber.startsWith('Green') || routeNumber.startsWith('CR-'))
          ? 150  // Rail: 150 meters (stations can be spread out)
          : 50;  // Bus: 50 meters (tighter to avoid wrong matches)
        
        if (routeIndex < 0 && hasCoords && otpStop.lat && otpStop.lon) {
          routeIndex = routeStops.findIndex(s => {
            if (!s.lat || !s.lon) return false;
            const dist = distanceBetweenCoords(otpStop.lat, otpStop.lon, s.lat, s.lon);
            return dist < coordThreshold;
          });
          if (routeIndex >= 0) {
            matchType = 'coord';
            coordMatches++;
          }
        }
        
        // Priority 3: Match by name (fallback, least reliable)
        if (routeIndex < 0) {
          const otpNameNorm = (otpStop.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
          routeIndex = routeStops.findIndex(s => {
            const routeNameNorm = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
            return routeNameNorm && routeNameNorm === otpNameNorm;
          });
          if (routeIndex >= 0) {
            matchType = 'name';
            nameMatches++;
          }
        }
        
        if (routeIndex >= 0) {
          matches++;
          if (lastMatchIndex < 0 || routeIndex > lastMatchIndex) {
            consecutiveMatches++;
            maxConsecutive = Math.max(maxConsecutive, consecutiveMatches);
            lastMatchIndex = routeIndex;
          } else {
            consecutiveMatches = 1;
            lastMatchIndex = routeIndex;
          }
        }
      }
      
      const matchRatio = matches / otpStops.length;
      const passed = matchRatio >= minMatchRatio && maxConsecutive >= minConsecutive;
      
      let reason = '';
      if (!passed) {
        if (matchRatio < minMatchRatio) {
          reason = `Match ratio too low (${(matchRatio * 100).toFixed(1)}% < ${(minMatchRatio * 100).toFixed(0)}%)`;
        } else if (maxConsecutive < minConsecutive) {
          reason = `Insufficient consecutive matches (${maxConsecutive} < ${minConsecutive})`;
        }
      } else {
        const matchTypes = [];
        if (idMatches > 0) matchTypes.push(`${idMatches} by ID`);
        if (coordMatches > 0) matchTypes.push(`${coordMatches} by coordinates`);
        if (nameMatches > 0) matchTypes.push(`${nameMatches} by name`);
        reason = `Verified: ${matches}/${otpStops.length} stops matched (${matchTypes.join(', ')})`;
      }
      
      return { match: passed, reason, matchRatio, maxConsecutive, matches, total: otpStops.length };
    }
    
    const dir0Result = dir0Data && dir0Data.stops ? checkStopMatch(otpStops, dir0Data.stops) : { match: false, reason: 'Direction 0 data unavailable' };
    const dir1Result = dir1Data && dir1Data.stops ? checkStopMatch(otpStops, dir1Data.stops) : { match: false, reason: 'Direction 1 data unavailable' };
    
    const verified = dir0Result.match || dir1Result.match;
    const reason = verified 
      ? (dir0Result.match ? `dir0: ${dir0Result.reason}` : `dir1: ${dir1Result.reason}`)
      : `Both directions failed: dir0(${dir0Result.reason}), dir1(${dir1Result.reason})`;
    
    console.log(`🔍 [verifyRouteByStops] Route ${routeNumber} (${stopCount} stops): ${verified ? 'VERIFIED' : 'FAILED'} - ${reason}`);
    
    // Add debug log
    addDebugLog(
      `Route Verification: ${routeNumber}`,
      {
        routeNumber,
        stopCount: otpStops.length,
        thresholds: { minMatchRatio, minConsecutive },
        dir0Result: dir0Result.match ? { match: true, reason: dir0Result.reason, matchRatio: dir0Result.matchRatio, maxConsecutive: dir0Result.maxConsecutive } : { match: false, reason: dir0Result.reason },
        dir1Result: dir1Result.match ? { match: true, reason: dir1Result.reason, matchRatio: dir1Result.matchRatio, maxConsecutive: dir1Result.maxConsecutive } : { match: false, reason: dir1Result.reason },
        sampleStops: otpStops.slice(0, 3).map(s => ({ name: s.name, id: s.id }))
      },
      `${verified ? '✅ VERIFIED' : '❌ FAILED'}: ${reason}`
    );
    
    return { verified, reason };
  } catch (error) {
    console.warn(`🔍 [verifyRouteByStops] Error verifying route ${routeNumber}:`, error);
    return { verified: true, reason: `Error during verification: ${error.message}` }; // On error, assume it's correct
  }
}

/**
 * Determine Red Line branch from OTP stop sequence
 * @param {Array} estimatedCalls - OTP estimated calls (stops) array
 * @returns {string|null} Branch name ("Ashmont" or "Braintree") or null if can't determine
 */
function determineRedLineBranch(estimatedCalls) {
  if (!estimatedCalls || !Array.isArray(estimatedCalls)) return null;
  
  // Get all stop names from the sequence
  const stopNames = estimatedCalls.map(call => {
    const name = call.quay?.name || call.name || '';
    return name.toLowerCase();
  });
  const allStops = stopNames.join(' ');
  
  // Check for terminal stops
  if (allStops.includes('ashmont')) {
    return 'Ashmont';
  }
  if (allStops.includes('braintree')) {
    return 'Braintree';
  }
  
  // Check for branch-specific stops
  if (allStops.includes('fields corner') || allStops.includes('shawmut') || allStops.includes('savin hill')) {
    return 'Ashmont';
  }
  
  return null;
}

/**
 * Determine Green Line branch from OTP stop sequence
 * @param {Array} estimatedCalls - OTP estimated calls (stops) array
 * @returns {string|null} Branch letter (B, C, D, E) or null if can't determine
 */
function determineGreenLineBranch(estimatedCalls) {
  if (!estimatedCalls || !Array.isArray(estimatedCalls)) return null;
  
  // Get all stop names from the sequence
  // Handle both OTP format (call.quay?.name) and JourneyLeg format (call.name or call.quay?.name)
  const stopNames = estimatedCalls.map(call => {
    const name = call.quay?.name || call.name || '';
    return name.toLowerCase();
  });
  const allStops = stopNames.join(' ');
  
  // Green Line branch terminal stops (common patterns)
  // Green-B: Boston College
  // Green-C: Cleveland Circle
  // Green-D: Riverside
  // Green-E: Heath Street
  
  if (allStops.includes('boston college') || allStops.includes('babcock') || allStops.includes('packards corner')) {
    return 'B';
  }
  if (allStops.includes('cleveland circle') || allStops.includes('dean road') || allStops.includes('tappan street')) {
    return 'C';
  }
  if (allStops.includes('riverside') || allStops.includes('newton') || allStops.includes('waban')) {
    return 'D';
  }
  if (allStops.includes('heath street') || allStops.includes('brigham circle') || allStops.includes('northeastern')) {
    return 'E';
  }
  
  // If we can't determine, return null (will use "Green" and show branch selection)
  return null;
}

async function drawJourney(journey) {
  const map = window.map;
  if (!map) {
    console.error('[drawJourney] Map not available');
    return;
  }
  
  console.log('🎨 [drawJourney] Rendering journey:', journey.id, 'with', journey.legs.length, 'legs');
  
  // Clear previous lines
  if (window.routeLegLines && window.routeLegLines.length) {
    window.routeLegLines.forEach(lineId => {
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(lineId)) map.removeSource(lineId);
    });
    window.routeLegLines = [];
  }

  // Clear previous OTP role markers (legacy S/T/D) if any
  try {
    if (window.__mfOtpRoleMarkers && Array.isArray(window.__mfOtpRoleMarkers)) {
      window.__mfOtpRoleMarkers.forEach((m) => {
        try { if (m && typeof m.remove === 'function') m.remove(); } catch (_) {}
      });
    }
    window.__mfOtpRoleMarkers = [];
  } catch (_) {}
  
  let allCoords = [];
  const routeList = []; // Store routes for selector modal
  
  // OTP: stable color per trip leg so OTP lines match overlays.
  // Keyed by leg index (otpLeg#) so repeated route numbers still get distinct colors.
  window.__mfOtpLegColors = window.__mfOtpLegColors || Object.create(null);
  const otpPickLegColor = (legIndex) => {
    const k = String(legIndex);
    if (window.__mfOtpLegColors[k]) return window.__mfOtpLegColors[k];
    const pal = window.ROUTE_OVERLAY_COLOR_PALETTE;
    let c = null;
    if (Array.isArray(pal) && pal.length) {
      c = pal[legIndex % pal.length];
    }
    if (!c) {
      // Fallback to the old behavior if palette missing.
      c = legColors[legIndex % legColors.length];
    }
    window.__mfOtpLegColors[k] = c;
    return c;
  };

  // Walking: show intent-only connector (start→end), not turn-by-turn geometry.
  const WALK_CONNECTOR_COLOR = "#9aa0a6";
  const WALK_DASH = [1.2, 1.6];
  const walkEndpoints = (seg) => {
    try {
      if (!Array.isArray(seg) || seg.length < 2) return null;
      const a = seg[0];
      const b = seg[seg.length - 1];
      if (!Array.isArray(a) || !Array.isArray(b)) return null;
      return [a, b];
    } catch (_) {
      return null;
    }
  };

  // We no longer place separate S/T/D markers; origins/dest pins already exist.
  // Trip stop milestones (1,2,3…) are applied by decorating existing stop markers in route overlays.

  // Render each leg
  journey.legs.forEach((leg, legIdx) => {
    addDebugLog(
      `Leg ${legIdx}: Processing`,
      {
        type: leg.type,
        mode: leg.mode,
        routeNumber: leg.routeNumber,
        routeVerified: leg.routeVerified,
        hasSolidSegment: !!leg.solidSegment
      },
      `Processing leg ${legIdx}: ${leg.type} ${leg.mode || ''} ${leg.routeNumber || ''}`
    );
    
    const color = leg.type === 'WALK' ? WALK_COLOR : otpPickLegColor(legIdx);
    
    // Assign color to leg
    if (leg.line) {
      leg.line.color = color;
    }
    
    // Draw walking leg (intent-only dotted connector w/ faint glow)
    if (leg.type === 'WALK' && leg.solidSegment) {
      const ends = walkEndpoints(leg.solidSegment);
      if (ends) {
        const walkId = `routeLeg-${leg.index}-walk`;
        const walkGlowId = `${walkId}-glow`;
        addLine(map, walkGlowId, toMapLibreCoords(ends), {
          "line-color": WALK_CONNECTOR_COLOR,
          "line-width": 10,
          "line-opacity": 0.18,
          "line-blur": 1.8
        });
        addLine(map, walkId, toMapLibreCoords(ends), {
          "line-color": WALK_CONNECTOR_COLOR,
          "line-width": 4,
          "line-opacity": 0.75,
          "line-dasharray": WALK_DASH
        });
        window.routeLegLines = window.routeLegLines || [];
        window.routeLegLines.push(walkGlowId);
        window.routeLegLines.push(walkId);
        allCoords = allCoords.concat(ends);
      }
    }
    
    // Draw transit leg (simple solid line - no dashed segments)
    if (leg.type === 'TRANSIT' && leg.solidSegment && leg.solidSegment.length > 1) {
      addDebugLog(
        `Leg ${legIdx}: Drawing TRANSIT`,
        {
          routeNumber: leg.routeNumber,
          routeVerified: leg.routeVerified,
          mode: leg.mode,
          solidSegmentLength: leg.solidSegment.length
        },
        `Drawing TRANSIT leg ${legIdx}: ${leg.routeNumber || 'N/A'} (verified: ${leg.routeVerified})`
      );
      const transitId = `routeLeg-${leg.index}-transit`;
      const transitGlowId = `${transitId}-glow`;
      // Glow underlay
      addLine(map, transitGlowId, toMapLibreCoords(leg.solidSegment), {
        "line-color": color,
        "line-width": 14,
        "line-opacity": 0.35,
        "line-blur": 2.2
      });
      // Core line
      addLine(map, transitId, toMapLibreCoords(leg.solidSegment), {
        "line-color": color,
        "line-width": 6,
        "line-opacity": 0.95
      });
      window.routeLegLines.push(transitGlowId);
      window.routeLegLines.push(transitId);
      allCoords = allCoords.concat(leg.solidSegment);

      // Store route info for selector modal (map subway and commuter rail codes)
      const routeName = leg.line?.name || `Route ${leg.routeNumber}`;
      let mappedRouteId;

      if ((leg.mode === 'RAIL' || leg.mode === 'TRAIN') && leg.routeNumber) {
        if (leg.routeNumber.startsWith('CR-')) {
          mappedRouteId = leg.routeNumber;
        } else if (leg.routeNumber.includes('Line') || routeName.includes('Line')) {
          mappedRouteId = mapCommuterRailRoute(leg.routeNumber, routeName);
        } else {
          mappedRouteId = mapCommuterRailRoute(leg.routeNumber, routeName);
          if (mappedRouteId === leg.routeNumber && !mappedRouteId.startsWith('CR-')) {
            mappedRouteId = mapSubwayRouteCode(leg.routeNumber, routeName);
          }
        }
      } else {
        mappedRouteId = mapSubwayRouteCode(leg.routeNumber, routeName);
      }

      /**
       * OTP gives Cincinnati bus lines as bare publicCode (e.g. "33").
       * Our route files / overlays use agency-prefixed IDs (e.g. "sorta_33", "tank_12").
       * So: map OTP → routes_index ID before calling showRouteOverlay().
       */
      if (leg.mode === 'BUS') {
        const otpCode = leg.line?.publicCode || leg.routeNumber || mappedRouteId;
        const otpName = leg.line?.name || routeName;
        const resolved = mfResolveBusRouteIdFromRoutesIndex(otpCode, otpName);
        if (resolved) {
          mappedRouteId = resolved;
        }
      }

      const estimatedCalls = leg.estimatedCalls || leg.stops || null;
      if (estimatedCalls && Array.isArray(estimatedCalls) && estimatedCalls.length > 0) {
        if (mappedRouteId === 'Green') {
          const branch = determineGreenLineBranch(estimatedCalls);
          if (branch) {
            mappedRouteId = `Green-${branch}`;
            console.log(`🎨 [drawJourney] Mapped Green Line to branch ${branch} based on stops`);
          }
        } else if (mappedRouteId === 'Red') {
          const branch = determineRedLineBranch(estimatedCalls);
          if (branch) {
            mappedRouteId = `Red-${branch}`;
            console.log(`🎨 [drawJourney] Mapped Red Line to branch ${branch} based on stops`);
          }
        }
      }

      if (leg.routeNumber && (leg.routeNumber.startsWith('Red-') || leg.routeNumber.startsWith('Green-'))) {
        mappedRouteId = leg.routeNumber;
        console.log(`🎨 [drawJourney] Using branch route from extractRouteInfo: ${mappedRouteId}`);
        addDebugLog(
          `Leg ${legIdx}: Route Mapping`,
          {
            originalRouteId: leg.routeNumber,
            mappedRouteId: mappedRouteId,
            mode: leg.mode
          },
          `Using branch route ${mappedRouteId} from extractRouteInfo`
        );
      }

      const fromStop = (leg.boardingPoint && leg.boardingPoint.name) || '';
      const toStop = (leg.alightingPoint && leg.alightingPoint.name) || '';
      const fromStopLat =
        leg.boardingPoint && Number.isFinite(Number(leg.boardingPoint.lat)) ? Number(leg.boardingPoint.lat) : null;
      const fromStopLon =
        leg.boardingPoint && Number.isFinite(Number(leg.boardingPoint.lng)) ? Number(leg.boardingPoint.lng) : null;
      const toStopLat =
        leg.alightingPoint && Number.isFinite(Number(leg.alightingPoint.lat)) ? Number(leg.alightingPoint.lat) : null;
      const toStopLon =
        leg.alightingPoint && Number.isFinite(Number(leg.alightingPoint.lng)) ? Number(leg.alightingPoint.lng) : null;

      let routeColor = color;
      if (leg.mode === 'SUBWAY' || leg.mode === 'METRO' || leg.mode === 'TRAM') {
        routeColor = getSubwayRouteColor(mappedRouteId);
      }

      const shouldAddRoute = mappedRouteId !== null && mappedRouteId !== undefined;

      addDebugLog(
        `Leg ${legIdx}: Route List Check`,
        {
          routeId: mappedRouteId,
          routeVerified: leg.routeVerified,
          shouldAddRoute: shouldAddRoute,
          mode: leg.mode,
          type: leg.type
        },
        `Route ${mappedRouteId}: verified=${leg.routeVerified || false}, willAdd=${shouldAddRoute}${!shouldAddRoute ? ' (no route ID)' : leg.routeVerified === false ? ' (verification failed, but adding anyway)' : ''}`
      );

      if (shouldAddRoute) {
        routeList.push({
          routeId: mappedRouteId,
          originalRouteId: leg.routeNumber,
          directionId: leg.direction || 0,
          mode: leg.mode,
          color: routeColor || color,
          name: routeName,
          legIndex: legIdx,
          fromStop: fromStop,
          toStop: toStop,
          fromStopLat,
          fromStopLon,
          toStopLat,
          toStopLon,
          otpSegment: Array.isArray(leg.solidSegment) ? leg.solidSegment : null,
          directionCalculated: leg.directionCalculated || false,
          routeVerified: leg.routeVerified || false
        });

        addDebugLog(
          `Leg ${legIdx}: Added to Route List`,
          {
            routeId: mappedRouteId,
            originalRouteId: leg.routeNumber,
            direction: leg.direction || 0,
            color: routeColor,
            verified: leg.routeVerified
          },
          `✅ Added route ${mappedRouteId} (direction ${leg.direction || 0}) to selector modal`
        );
      } else {
        console.warn(`🎨 [drawJourney] Skipping route - no route ID available`);
        addDebugLog(
          `Leg ${legIdx}: Route Skipped`,
          {
            routeId: mappedRouteId,
            reason: 'No route ID available'
          },
          `❌ Skipped leg ${legIdx} - cannot identify route (mode: ${leg.mode})`
        );
      }
    }
  });

  // (Numbered stop milestones are applied after showRouteOverlay in applyOtpTripRouteOverlays.)

  // Fit map to bounds
  if (allCoords.length > 0) {
    const bounds = new maplibregl.LngLatBounds();
    allCoords.forEach(coord => bounds.extend([coord[1], coord[0]]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }
  
  // Store route list for modal
  window.otpRouteList = routeList;
  console.log('🎨 [drawJourney] ✅ Extracted', routeList.length, 'routes for selector');
  
  // Trip route overlays on map (await so orange chips exist before minimizeItineraryModal, etc.)
  if (routeList.length > 0) {
    await applyOtpTripRouteOverlays(routeList);
  }
  
  // Log summary after drawing
  console.log('🎨 [drawJourney] ✅ Journey drawn successfully');
}

/**
 * Show branch selection menu for route groups (Red, Green) in OTP selector
 * @param {string} routeGroupId - Route group ID (e.g., "Red", "Green")
 * @param {Object} route - Original route object from routeList
 * @param {HTMLElement} button - The button that was clicked
 * @param {HTMLElement} buttonsContainer - Container for buttons
 */
function showOtpBranchSelection(routeGroupId, route, button, buttonsContainer) {
  // Remove existing branch menu if present
  const existingMenu = document.getElementById('otpBranchSelectionMenu');
  if (existingMenu) {
    existingMenu.remove();
  }
  
  // Discover branches for this route group
  if (!window.discoverRouteBranches) {
    console.error('🎨 [showOtpBranchSelection] discoverRouteBranches not available');
    return;
  }
  
  const branches = window.discoverRouteBranches(routeGroupId);
  if (branches.length === 0) {
    console.log('🎨 [showOtpBranchSelection] No branches found for', routeGroupId);
    return;
  }
  
  // Create branch selection menu
  const menu = document.createElement('div');
  menu.id = 'otpBranchSelectionMenu';
  menu.style.cssText = `
    position: absolute;
    background: rgba(20, 20, 20, 0.98);
    border: 2px solid ${route.color};
    border-radius: 8px;
    padding: 12px;
    z-index: 10001;
    min-width: 200px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  const menuTitle = document.createElement('div');
  menuTitle.textContent = `Select ${routeGroupId} Line Branch:`;
  menuTitle.style.cssText = `
    color: #fff;
    font-weight: bold;
    margin-bottom: 8px;
    font-size: 12px;
    border-bottom: 1px solid #444;
    padding-bottom: 6px;
  `;
  menu.appendChild(menuTitle);
  
  // Add branch options
  branches.forEach(branch => {
    const branchDiv = document.createElement('div');
    branchDiv.style.cssText = 'margin-bottom: 8px;';
    
    const branchLabel = document.createElement('div');
    branchLabel.textContent = branch.label;
    branchLabel.style.cssText = `
      color: ${route.color};
      font-weight: 600;
      font-size: 11px;
      margin-bottom: 4px;
    `;
    branchDiv.appendChild(branchLabel);
    
    const branchButtons = document.createElement('div');
    branchButtons.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
    
    if (branch.dir0) {
      const dir0Btn = document.createElement('button');
      dir0Btn.textContent = `➡ ${branch.dir0}`;
      dir0Btn.style.cssText = `
        width: 100%;
        padding: 6px;
        background: ${route.color};
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 10px;
        text-align: left;
      `;
      dir0Btn.onclick = () => {
        menu.remove();
        // Use the same logic as regular route selection
        selectOtpBranchRoute(branch.routeId, 0, route, routeGroupId);
      };
      branchButtons.appendChild(dir0Btn);
    }
    
    if (branch.dir1) {
      const dir1Btn = document.createElement('button');
      dir1Btn.textContent = `⬅ ${branch.dir1}`;
      dir1Btn.style.cssText = `
        width: 100%;
        padding: 6px;
        background: ${route.color};
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 10px;
        text-align: left;
      `;
      dir1Btn.onclick = () => {
        menu.remove();
        selectOtpBranchRoute(branch.routeId, 1, route, routeGroupId);
      };
      branchButtons.appendChild(dir1Btn);
    }
    
    branchDiv.appendChild(branchButtons);
    menu.appendChild(branchDiv);
  });
  
  // Position menu near the button
  const buttonRect = button.getBoundingClientRect();
  menu.style.left = `${buttonRect.left}px`;
  menu.style.top = `${buttonRect.bottom + 8}px`;
  
  // Close menu when clicking outside
  const closeMenu = (e) => {
    if (!menu.contains(e.target) && e.target !== button) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 100);
  
  document.body.appendChild(menu);
}

/**
 * Select a branch route from OTP route selector
 * @param {string} branchRouteId - Branch route ID (e.g., "Green-B")
 * @param {number} directionId - Direction ID
 * @param {Object} originalRoute - Original route object from OTP routeList
 * @param {string} routeGroupId - Route group ID (e.g., "Red", "Green")
 */
function selectOtpBranchRoute(branchRouteId, directionId, originalRoute, routeGroupId) {
  console.log('🎨 [selectOtpBranchRoute] Selected branch:', branchRouteId, 'direction:', directionId);

  window.activeTripSelected = true;

  const legTag = originalRoute.legIndex !== undefined && originalRoute.legIndex !== null ? originalRoute.legIndex : 0;
  const overlayInstanceKey = `${branchRouteId}-${directionId}-otpLeg${legTag}`;

  if (typeof window.showRouteOverlay === 'function') {
    window.showRouteOverlay(branchRouteId, directionId, undefined, overlayInstanceKey, { forceRouteInfoPanel: true });
  } else {
    console.error('🎨 [selectOtpBranchRoute] showRouteOverlay not available');
    alert('Route overlay system not ready. Please refresh the page.');
  }
}

/**
 * Same initial direction logic as OTP route-selector buttons (sync only; BUS may refine async).
 */
function computeOtpFlippedDirectionSync(route) {
  // OTP already provides a consistent direction context for legs.
  // Flipping here causes wrong direction file fetches (dir0 vs dir1) in cities like Cincinnati.
  return route && (route.directionId === 1 || route.directionId === 0) ? route.directionId : 0;
}

/**
 * After overlay is shown, optionally refine BUS direction using route stop geometry (matches selector behavior).
 */
function verifyOtpBusOverlayDirection(route, mappedRouteId, overlayInstanceKey) {
  const needsFlip = !(route.mode === 'SUBWAY' || route.mode === 'METRO');
  if (!needsFlip || route.mode !== 'BUS' || !mappedRouteId) return;
  if (typeof window.showRouteOverlay !== 'function') return;

  // Prevent thrash: only validate once per otp leg overlay key.
  try {
    window.__mfOtpDirValidationDone = window.__mfOtpDirValidationDone || Object.create(null);
    if (overlayInstanceKey && window.__mfOtpDirValidationDone[String(overlayInstanceKey)]) return;
    if (overlayInstanceKey) window.__mfOtpDirValidationDone[String(overlayInstanceKey)] = true;
  } catch (_) {}

  const loadRouteStops = (rid, dir) => {
    if (window.routeLoader && typeof window.routeLoader.loadRoute === "function") {
      return window.routeLoader.loadRoute(rid, dir).catch(() => null);
    }
    return mfFetchStaticRouteJson(rid, dir);
  };

  function normStop(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/&amp;/g, '&')
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  }

  function findStopIndex(otpStopName, routeStops) {
    if (!otpStopName || !routeStops || !routeStops.length) return -1;
    const target = normStop(otpStopName);
    if (!target) return -1;
    // Exact-ish match first
    for (let i = 0; i < routeStops.length; i++) {
      const n = normStop(routeStops[i] && routeStops[i].name);
      if (n && (n === target || n.includes(target) || target.includes(n))) return i;
    }
    return -1;
  }

  function validateDirByStopOrder(dirData) {
    try {
      if (!dirData || !Array.isArray(dirData.stops) || !dirData.stops.length) return { ok: false };
      const fromIx = findStopIndex(route.fromStop, dirData.stops);
      const toIx = findStopIndex(route.toStop, dirData.stops);
      if (fromIx < 0 || toIx < 0) return { ok: false, fromIx, toIx };
      return { ok: fromIx <= toIx, fromIx, toIx };
    } catch (_) {
      return { ok: false };
    }
  }

  Promise.all([loadRouteStops(mappedRouteId, 0), loadRouteStops(mappedRouteId, 1)])
    .then(async ([dir0Data, dir1Data]) => {
      let d0 = dir0Data;
      let d1 = dir1Data;
      if ((!d0?.stops?.length || !d1?.stops?.length) && String(mappedRouteId).includes("-")) {
        const base = String(mappedRouteId).split("-")[0];
        if (!d0?.stops?.length) d0 = await mfFetchStaticRouteJson(base, 0);
        if (!d1?.stops?.length) d1 = await mfFetchStaticRouteJson(base, 1);
      }

      if (!d0?.stops?.length || !d1?.stops?.length) return;

      const intendedDir = route.directionId === 0 || route.directionId === 1 ? route.directionId : 0;
      const otherDir = intendedDir === 0 ? 1 : 0;

      const intendedData = intendedDir === 0 ? d0 : d1;
      const otherData = otherDir === 0 ? d0 : d1;

      const vInt = validateDirByStopOrder(intendedData);
      const vOther = validateDirByStopOrder(otherData);

      let flippedDirection = null;
      if (vInt.ok) {
        return;
      }
      if (vOther.ok) {
        flippedDirection = otherDir;
      } else {
        const bySeg = mfPickDirectionByOtpSegment(d0, d1, route.otpSegment);
        if (bySeg !== null && bySeg !== intendedDir) flippedDirection = bySeg;
        else return;
      }

      if (flippedDirection === null || flippedDirection === intendedDir) return;

      const legTag = route.legIndex !== undefined && route.legIndex !== null ? route.legIndex : 0;
      const newInstanceKey = `${mappedRouteId}-${flippedDirection}-otpLeg${legTag}`;
      if (window.activeRouteOverlays && window.activeRouteOverlays[newInstanceKey]) {
        return;
      }
      if (
        overlayInstanceKey &&
        overlayInstanceKey !== newInstanceKey &&
        window.activeRouteOverlays &&
        window.activeRouteOverlays[overlayInstanceKey]
      ) {
        window.activeRouteOverlays[overlayInstanceKey].remove();
        delete window.activeRouteOverlays[overlayInstanceKey];
        if (window.activeRouteOverlayDescriptors) {
          delete window.activeRouteOverlayDescriptors[overlayInstanceKey];
        }
      }
      window.showRouteOverlay(
        mappedRouteId,
        flippedDirection,
        undefined,
        newInstanceKey,
        {
          forceRouteInfoPanel: true,
          routeColor: route.color,
          otpFromStop: route.fromStop,
          otpToStop: route.toStop,
          otpSegment: route.otpSegment
        }
      );
    })
    .catch((err) => {
      console.warn(`[verifyOtpBusOverlayDirection] ${mappedRouteId}:`, err);
    });
}

/**
 * Itinerary → route list from drawJourney → map overlays + one orange circle per transit leg on the rail.
 * Bare Red/Green: overlay opens after branch pick; chip still lists the leg and opens the branch menu.
 */
async function applyOtpTripRouteOverlays(routeList) {
  try {
    window.__mfOtpApplyingRouteOverlays = true;
  } catch (_) {}

  try {
    const existingModal = document.getElementById('otpRouteSelectorModal');
    if (existingModal) {
      existingModal.remove();
    }

    if (!routeList || routeList.length === 0) return;

    const needsBranchPicker = typeof window.isRouteGroup === 'function'
      ? (r) => window.isRouteGroup(r.routeId)
      : () => false;
    const routesAuto = routeList.filter(r => !needsBranchPicker(r));

    window.activeTripSelected = true;

    if (typeof window.showRouteOverlay !== 'function') {
      console.error('[applyOtpTripRouteOverlays] showRouteOverlay not available');
      return;
    }

    const toApply = [];
    routesAuto.forEach((route, idx) => {
      const mappedRouteId = route.routeId;
      const flippedDirection = computeOtpFlippedDirectionSync(route);
      const legTag = route.legIndex !== undefined && route.legIndex !== null ? route.legIndex : idx;
      const overlayInstanceKey = `${mappedRouteId}-${flippedDirection}-otpLeg${legTag}`;
      toApply.push({ route, mappedRouteId, flippedDirection, overlayInstanceKey });
    });

    // Sequential trip milestones on the map: 1 board, 2 off, 3 board next leg…
    let tripStepNum = 1;
    for (const { route, mappedRouteId, flippedDirection, overlayInstanceKey } of toApply) {
      try {
        await window.showRouteOverlay(
          mappedRouteId,
          flippedDirection,
          undefined,
          overlayInstanceKey,
          { forceRouteInfoPanel: true, routeColor: route.color, otpFromStop: route.fromStop, otpToStop: route.toStop, otpSegment: route.otpSegment }
        );
      } catch (e) {
        console.warn('[applyOtpTripRouteOverlays] showRouteOverlay failed', mappedRouteId, flippedDirection, e);
      }
      // Decorate existing stop dots in trip order (no duplicate markers).
      try {
        if (window.metrofeedMarkOtpStopRole) {
          if (route.fromStop || (Number.isFinite(route.fromStopLat) && Number.isFinite(route.fromStopLon))) {
            window.metrofeedMarkOtpStopRole({
              overlayKey: overlayInstanceKey,
              role: String(tripStepNum++),
              stopName: route.fromStop || "",
              stopLat: route.fromStopLat,
              stopLon: route.fromStopLon,
              color: route.color
            });
          }
          if (route.toStop || (Number.isFinite(route.toStopLat) && Number.isFinite(route.toStopLon))) {
            window.metrofeedMarkOtpStopRole({
              overlayKey: overlayInstanceKey,
              role: String(tripStepNum++),
              stopName: route.toStop || "",
              stopLat: route.toStopLat,
              stopLon: route.toStopLon,
              color: route.color
            });
          }
        }
      } catch (_) {}
      verifyOtpBusOverlayDirection(route, mappedRouteId, overlayInstanceKey);
    }
  } finally {
    try {
      window.__mfOtpApplyingRouteOverlays = false;
    } catch (_) {}
  }
}

/**
 * Collapsed label for OTP chips — mirrors route-info-panel logic in routeOverlay.js
 */
function getOtpTripChipCollapsedLabel(mappedRouteId) {
  if (!mappedRouteId) return '?';
  let routeNumber = String(mappedRouteId);
  if (routeNumber.includes('-') && (routeNumber.startsWith('Red-') || routeNumber.startsWith('Green-'))) {
    routeNumber = routeNumber.split('-')[0];
  } else {
    const numericMatch = routeNumber.match(/\d+/);
    if (numericMatch) routeNumber = numericMatch[0];
  }
  return routeNumber;
}

/**
 * Stack OTP chips after existing route-info circles (same right rail).
 */
function getOtpTripChipStackLayout(hostEl) {
  const circleSize = 40;
  const circleSpacing = 10;
  const topOffset = typeof window.metrofeedGetRightRailTopOffset === 'function'
    ? window.metrofeedGetRightRailTopOffset()
    : 250;
  let maxIndex = -1;
  const overlayRoot = document.getElementById('mapRouteOverlayRoot');
  const roots = hostEl === document.body
    ? [document.body, overlayRoot, window.map && window.map.getContainer && window.map.getContainer()].filter(Boolean)
    : [hostEl];
  roots.forEach(root => {
    root.querySelectorAll('.route-info-panel, .otp-trip-route-chip').forEach(panel => {
      const ix = panel.getAttribute('data-collapse-index');
      if (ix !== null && ix !== '') maxIndex = Math.max(maxIndex, parseInt(ix, 10));
    });
  });
  return { circleSize, circleSpacing, topOffset, baseIndex: maxIndex + 1 };
}

/**
 * One stacked orange circle per transit leg from the itinerary (right rail; branch legs open picker on click).
 * @param {Array} routeList - from drawJourney: {routeId, directionId, mode, color, name, legIndex, ...}
 */
function showOtpRouteSelector(routeList) {
  // Deprecated: OTP trip chips are now the standard floating route chips created by showRouteOverlay().
  // Keep this function as a no-op to avoid accidental calls from stale code paths.
  return;

  // Remove existing modal if present
  const existingModal = document.getElementById('otpRouteSelectorModal');
  if (existingModal) {
    existingModal.remove();
  }

  if (!routeList || routeList.length === 0) return;

  const map = window.map;
  const mapContainer = map && typeof map.getContainer === 'function' ? map.getContainer() : null;
  const hostEl =
    map && typeof window.getRouteOverlayMount === 'function'
      ? window.getRouteOverlayMount(map)
      : mapContainer || document.body;

  const wrapper = document.createElement('div');
  wrapper.id = 'otpRouteSelectorModal';
  wrapper.setAttribute('data-otp-route-chips', 'true');
  // display:contents — no full-map box (that layer sat above route-info chips at z-index 1000 and hid them)
  if (hostEl !== document.body) {
    wrapper.style.cssText = 'display:contents;pointer-events:none;';
  } else {
    wrapper.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1002;overflow:visible;';
  }

  const layout = getOtpTripChipStackLayout(hostEl);

  const modal = wrapper;

  const buttonsContainer = document.createElement('div');
  buttonsContainer.id = 'otpRouteButtonsContainer';
  buttonsContainer.style.cssText = 'display:contents';

  const updateAllButtonStates = () => {
    buttonsContainer.querySelectorAll('button').forEach(btn => {
      if (btn._isLegOverlayActive && btn._updateButtonState) {
        const isActive = btn._isLegOverlayActive();
        const currentActive = btn.getAttribute('data-active') === 'true';
        if (isActive !== currentActive) {
          btn._updateButtonState(isActive);
        }
      }
    });
  };
  
  // Orange circles on the map right rail (same stack index scheme as .route-info-panel)
  console.log('🎨 [showOtpRouteSelector] Creating chips for routes:', routeList.map(r => ({ id: r.routeId, name: r.name, mode: r.mode })));
  routeList.forEach((route, idx) => {
    const mappedRouteId = route.routeId;
    const legTag = route.legIndex !== undefined && route.legIndex !== null ? route.legIndex : idx;
    const flippedDirection = computeOtpFlippedDirectionSync(route);
    const overlayInstanceKey = `${mappedRouteId}-${flippedDirection}-otpLeg${legTag}`;
    const legSuffix = `-otpLeg${legTag}`;

    const isLegOverlayActive = () => {
      if (!window.activeRouteOverlays) return false;
      return Object.keys(window.activeRouteOverlays).some(k => k.endsWith(legSuffix));
    };

    console.log(`🎨 [showOtpRouteSelector] Chip ${idx + 1}/${routeList.length}: "${mappedRouteId}", dir ${flippedDirection}`);

    const stackIndex = layout.baseIndex + idx;
    const { circleSize, circleSpacing, topOffset } = layout;
    const verticalPosition = topOffset + stackIndex * (circleSize + circleSpacing);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'otp-trip-route-chip';
    chip.title = route.name || `Route ${mappedRouteId}`;
    chip.setAttribute('data-collapse-index', String(stackIndex));
    chip.setAttribute('data-collapsed', 'true');
    const useViewportOverlay = hostEl !== document.body;
    const posMode = useViewportOverlay ? 'absolute' : 'fixed';
    const leftVal = useViewportOverlay ? `calc(100% - ${circleSize + 10}px)` : 'auto';
    const rightVal = useViewportOverlay ? 'auto' : '20px';
    chip.style.cssText = `
      pointer-events: auto;
      position: ${posMode};
      left: ${leftVal};
      right: ${rightVal};
      top: ${verticalPosition}px;
      width: ${circleSize}px;
      height: ${circleSize}px;
      min-width: ${circleSize}px;
      border-radius: 50%;
      border: 3px solid #fff;
      background: #FF6B35;
      color: #fff;
      font-weight: bold;
      font-size: 0.8rem;
      line-height: 1.1;
      cursor: pointer;
      padding: 2px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.2s, transform 0.2s, box-shadow 0.2s;
      z-index: 1100;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    chip.textContent = getOtpTripChipCollapsedLabel(mappedRouteId);

    const updateButtonState = (active) => {
      if (active) {
        chip.style.opacity = '1';
        chip.style.boxShadow = '0 0 0 3px rgba(255,255,255,0.95), 0 4px 12px rgba(0,0,0,0.5)';
        chip.setAttribute('data-active', 'true');
      } else {
        chip.style.opacity = '0.88';
        chip.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
        chip.setAttribute('data-active', 'false');
      }
    };

    chip.onmouseenter = () => {
      if (chip.getAttribute('data-active') !== 'true') {
        chip.style.transform = 'scale(1.06)';
        chip.style.opacity = '1';
      }
    };
    chip.onmouseleave = () => {
      chip.style.transform = 'scale(1)';
      updateButtonState(isLegOverlayActive());
    };

    updateButtonState(isLegOverlayActive());

    const checkInterval = setInterval(() => {
      const nowActive = isLegOverlayActive();
      if (nowActive !== (chip.getAttribute('data-active') === 'true')) {
        updateButtonState(nowActive);
      }
    }, 300);

    chip._checkInterval = checkInterval;
    chip._updateButtonState = updateButtonState;
    chip._isLegOverlayActive = isLegOverlayActive;

    const cleanup = () => {
      if (chip._checkInterval) clearInterval(chip._checkInterval);
    };
    if (!modal._cleanupFunctions) modal._cleanupFunctions = [];
    modal._cleanupFunctions.push(cleanup);

    chip.onclick = (e) => {
      e.stopPropagation();
      if (window.isRouteGroup && window.isRouteGroup(mappedRouteId)) {
        showOtpBranchSelection(mappedRouteId, route, chip, buttonsContainer);
        return;
      }
      window.activeTripSelected = true;
      if (typeof window.showRouteOverlay !== 'function') {
        alert('Route overlay system not ready. Please refresh the page.');
        return;
      }
      const activeKey = window.activeRouteOverlays
        ? Object.keys(window.activeRouteOverlays).find(k => k.endsWith(legSuffix))
        : null;
      if (activeKey && window.activeRouteOverlayDescriptors && window.activeRouteOverlayDescriptors[activeKey]) {
        const d = window.activeRouteOverlayDescriptors[activeKey];
        window.showRouteOverlay(d.originalRouteId, d.directionId, undefined, activeKey).then(() => {
          setTimeout(updateAllButtonStates, 120);
        }).catch(() => setTimeout(updateAllButtonStates, 120));
        return;
      }
      window.showRouteOverlay(mappedRouteId, flippedDirection, undefined, overlayInstanceKey, { forceRouteInfoPanel: true }).then(() => {
        setTimeout(updateAllButtonStates, 120);
      }).catch(() => setTimeout(updateAllButtonStates, 120));
    };

    buttonsContainer.appendChild(chip);
    console.log(`🎨 [showOtpRouteSelector] ✅ Chip ${idx + 1} appended (routeId="${mappedRouteId}")`);
  });
  console.log('🎨 [showOtpRouteSelector] Total chips:', buttonsContainer.children.length);
  modal.appendChild(buttonsContainer);

  const originalRemove = modal.remove.bind(modal);
  modal.remove = function() {
    if (this._cleanupFunctions) {
      this._cleanupFunctions.forEach(fn => fn());
    }
    originalRemove();
  };

  hostEl.appendChild(modal);
  
  console.log('🎨 [showOtpRouteSelector] Mounted', routeList.length, 'trip chip(s) on map rail');
}

/**
 * Show route visualization for a selected itinerary
 * NOW: Just gets the Journey and calls drawJourney - no logic!
 * @param {number} idx - Index of the itinerary to display
 */
async function showRoute(idx) {
  console.log('🎨 [showRoute] Called with idx:', idx);
  
  // ⚠️ CRITICAL: Clear stale route tracking data FIRST
  window.routesToTrack = [];
  window.currentLegColorMapping = {};
  console.log('🎨 [showRoute] ✅ Cleared stale routesToTrack and legColorMapping');
  
  // ⚠️ IMPORTANT: Set OTP trip as active (prevents "all buses" mode)
  window.activeTripSelected = true;
  console.log('🎨 [showRoute] ✅ Set activeTripSelected = true (prevents all buses mode)');
  
  // Clear existing route selector modal
  const existingModal = document.getElementById('otpRouteSelectorModal');
  if (existingModal) {
    existingModal.remove();
  }
  
  // Get the normalized Journey object
  if (!window.journeys || !window.journeys[idx]) {
    console.error('[showRoute] Journey not found. Normalizing...');
    if (window.currentItins && window.currentItins[idx]) {
      // Fallback: normalize on the fly if needed
      const journeys = await normalizeItineraries([window.currentItins[idx]]);
      if (journeys[0]) {
        window.journeys = window.journeys || [];
        window.journeys[idx] = journeys[0];
      } else {
        alert("Trip data not found. Please try again.");
        return;
      }
    } else {
      alert("Trip data not found. Please try again.");
      return;
    }
  }
  
  const journey = window.journeys[idx];
  
  // Log which journey we're drawing
  console.log('🎨 [showRoute] Drawing Journey', idx, ':');
  console.log('🎨 [showRoute]   Legs:', journey.legs.length);
  journey.legs.forEach((leg, legIdx) => {
    if (leg.mode !== 'WALK') {
      console.log(`🎨 [showRoute]   Leg ${legIdx}: ${leg.mode} - Route ${leg.routeNumber || 'N/A'} (dir ${leg.direction || 0})`);
    }
  });
  
  // Store selected index
  window.selectedTripIndex = idx;

  // Screen reader: announce selection change (duration, transfers, timing)
  try {
    const itin = window.currentItins && window.currentItins[idx] ? window.currentItins[idx] : null;
    if (itin) {
      const minsTotal = Math.round((itin.duration || 0) / 60);
      const transitLegs = (itin.legs || []).filter(l => l.mode !== 'WALK' && l.mode !== 'FOOT');
      const transfers = Math.max(0, transitLegs.length - 1);
      const start = getPortlandTimeString(new Date(itin.startTime));
      const end = getPortlandTimeString(new Date(itin.endTime));
      let transferPhrase = '';
      try {
        if (typeof window.mfT === 'function') {
          transferPhrase = (transfers === 1)
            ? window.mfT('sr_transfer_singular')
            : window.mfT('sr_transfer_plural', { count: String(transfers) });
        } else {
          transferPhrase = transfers === 1 ? '1 transfer' : `${transfers} transfers`;
        }
      } catch (_) {
        transferPhrase = transfers === 1 ? '1 transfer' : `${transfers} transfers`;
      }

      if (typeof window.metrofeedAnnounceKey === 'function') {
        window.metrofeedAnnounceKey('sr_route_selected', {
          mins: String(minsTotal),
          transfers: transferPhrase,
          start: String(start),
          end: String(end)
        });
      } else if (typeof window.metrofeedAnnounce === 'function') {
        window.metrofeedAnnounce(`Route selected: ${minsTotal} minute trip, ${transferPhrase}, starts at ${start}, arrives at ${end}.`);
      }
    } else {
      if (typeof window.metrofeedAnnounceKey === 'function') window.metrofeedAnnounceKey('sr_route_selected_simple');
      else if (typeof window.metrofeedAnnounce === 'function') window.metrofeedAnnounce('Route selected.');
    }
  } catch (_) {}
  
  // Clear previous bus tracking
  if (window.otpBusTrackingInterval) {
    clearInterval(window.otpBusTrackingInterval);
    window.otpBusTrackingInterval = null;
  }
  
  // ⚠️ DON'T clear activeTripSelected here - we want to keep OTP mode active!
  // window.activeTripSelected = false; // REMOVED - keep OTP mode active
  
  // Clear all bus markers and route overlays
  if (typeof window.fetchAndDisplayBuses === 'function') {
    window.fetchAndDisplayBuses([]);
  }
  
  // Clear all route overlays
  if (typeof window.clearAllRouteOverlays === 'function') {
    window.clearAllRouteOverlays();
  }
  
  // Clear previous map elements
  const map = window.map;
  if (map) {
    if (window.routeLegLines && window.routeLegLines.length) {
      window.routeLegLines.forEach(lineId => {
        if (map.getLayer(lineId)) map.removeLayer(lineId);
        if (map.getSource(lineId)) map.removeSource(lineId);
      });
      window.routeLegLines = [];
    }
    
    if (window.extendedRouteLines && window.extendedRouteLines.length) {
      window.extendedRouteLines.forEach(lineId => {
        if (map.getLayer(lineId)) map.removeLayer(lineId);
        if (map.getSource(lineId)) map.removeSource(lineId);
      });
      window.extendedRouteLines = [];
    }
  }
  
  await drawJourney(journey);

  try {
    if (typeof window.metrofeedSyncTripGuideDockVisibility === 'function') {
      window.metrofeedSyncTripGuideDockVisibility();
    }
  } catch (_) {}
  
  // Minimize modal if available
  if (typeof window.minimizeItineraryModal === 'function') {
    window.minimizeItineraryModal();
  }
  
  // Log summary after route is drawn
  logOtpSummary('AFTER_SHOW_ROUTE', idx);
}

/**
 * Comprehensive OTP summary log - shows key state at different stages
 * @param {string} stage - 'AFTER_NORMALIZE' or 'AFTER_SHOW_ROUTE'
 * @param {number} selectedIdx - Selected itinerary index (for AFTER_SHOW_ROUTE)
 */
function logOtpSummary(stage, selectedIdx = null) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 OTP SUMMARY LOG -', stage);
  console.log('='.repeat(80));
  
  // Show normalized journeys
  if (window.journeys && window.journeys.length > 0) {
    console.log(`\n✅ Normalized Journeys: ${window.journeys.length}`);
    window.journeys.forEach((journey, idx) => {
      console.log(`\n  Journey ${idx + 1} (${selectedIdx === idx ? '⭐ SELECTED' : ''}):`);
      console.log(`    Duration: ${Math.round(journey.duration / 60)} min`);
      console.log(`    Legs: ${journey.legs.length}`);
      journey.legs.forEach((leg, legIdx) => {
        if (leg.mode !== 'WALK') {
          console.log(`      Leg ${legIdx}: ${leg.mode} - Route ${leg.routeNumber || 'N/A'} (dir ${leg.direction || 0})`);
          console.log(`        From: ${leg.fromPlace?.name || 'N/A'}`);
          console.log(`        To: ${leg.toPlace?.name || 'N/A'}`);
          console.log(`        Geometry: ${leg.solidSegment ? `${leg.solidSegment.length} points` : 'NONE'}`);
        } else {
          console.log(`      Leg ${legIdx}: WALK (${Math.round(leg.duration / 60)} min)`);
        }
      });
    });
  } else {
    console.log('❌ No normalized journeys found');
  }
  
  // Show routes being tracked
  if (window.routesToTrack && window.routesToTrack.length > 0) {
    console.log(`\n🚌 Routes Being Tracked: ${window.routesToTrack.length}`);
    window.routesToTrack.forEach((route, idx) => {
      console.log(`  ${idx + 1}. Route ${route.route_id} (dir ${route.direction_id}) - ${route.mode}`);
    });
  } else {
    console.log('\n❌ No routes being tracked');
  }
  
  // Show leg color mapping
  if (window.currentLegColorMapping && Object.keys(window.currentLegColorMapping).length > 0) {
    console.log(`\n🎨 Leg Color Mapping: ${Object.keys(window.currentLegColorMapping).length} legs`);
    Object.entries(window.currentLegColorMapping).forEach(([key, info]) => {
      console.log(`  ${key}: ${info.color} - Route ${info.route} (dir ${info.direction})`);
    });
  } else {
    console.log('\n❌ No leg color mapping found');
  }
  
  // Show current itineraries (raw)
  if (window.currentItins && window.currentItins.length > 0) {
    console.log(`\n📋 Raw Itineraries: ${window.currentItins.length}`);
    window.currentItins.forEach((itin, idx) => {
      const transitLegs = (itin.legs || []).filter(l => l.mode !== 'WALK');
      console.log(`  Itinerary ${idx + 1}: ${transitLegs.length} transit legs, ${Math.round(itin.duration / 60)} min`);
    });
  }
  
  // Show active trip state
  console.log(`\n🔧 State:`);
  console.log(`  activeTripSelected: ${window.activeTripSelected || false}`);
  console.log(`  selectedTripIndex: ${window.selectedTripIndex !== undefined ? window.selectedTripIndex : 'N/A'}`);
  console.log(`  routeLegLines: ${window.routeLegLines ? window.routeLegLines.length : 0} lines`);
  console.log(`  extendedRouteLines: ${window.extendedRouteLines ? window.extendedRouteLines.length : 0} lines`);
  
  console.log('='.repeat(80) + '\n');
}

// Export functions and variables to window for global access
window.fetchAndShowOtpItineraries = fetchAndShowOtpItineraries;
// Export functions and variables to window for global access
window.fetchAndShowOtpItineraries = fetchAndShowOtpItineraries;
window.renderItinListVisual = renderItinListVisual;
window.decodePolyline = decodePolyline;
window.showRoute = showRoute;
window.logOtpDebug = logOtpDebug;

// Export state variables (for backward compatibility)
// Note: currentItins is also set on window.currentItins in fetchAndShowOtpItineraries
// Only define if not already defined to avoid redefinition errors
if (!window.hasOwnProperty('currentItins') || !Object.getOwnPropertyDescriptor(window, 'currentItins')) {
  Object.defineProperty(window, 'currentItins', {
    get: () => currentItins,
    set: (value) => { currentItins = value; },
    configurable: true
  });
}

// PHASE 3: Schema debug helper (dev-only)
window.debugOtpSchema = async function() {
  console.log('=== OTP SCHEMA DEBUG (Dev Only) ===');
  
  try {
    // Introspect Trip query arguments
    const tripQuery = `
      query {
        __type(name: "Trip") {
          fields {
            name
            args {
              name
              type {
                name
                kind
              }
            }
          }
        }
      }
    `;
    
    const tripRes = await fetch(OTP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: tripQuery })
    });
    
    const tripData = await tripRes.json();
    const tripField = tripData.data?.__type?.fields?.find(f => f.name === 'trip');
    
    if (tripField) {
      console.log('📋 Trip query arguments:');
      tripField.args.forEach(arg => {
        console.log(`  - ${arg.name}: ${arg.type.name || arg.type.kind}`);
      });
    }
    
    // Introspect Place type fields
    const placeQuery = `
      query {
        __type(name: "Place") {
          fields {
            name
            type {
              name
              kind
            }
          }
        }
      }
    `;
    
    const placeRes = await fetch(OTP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: placeQuery })
    });
    
    const placeData = await placeRes.json();
    
    if (placeData.data?.__type?.fields) {
      console.log('📋 Place type fields:');
      placeData.data.__type.fields.forEach(field => {
        console.log(`  - ${field.name}: ${field.type.name || field.type.kind}`);
      });
    }
    
    console.log('=== END SCHEMA DEBUG ===');
  } catch (error) {
    console.error('Schema debug error:', error);
  }
};

// Make it available in console for devs
if (typeof window !== 'undefined') {
  console.log('🔧 Dev helper available: window.debugOtpSchema()');
}

// --- Find Me: OTP GTFS GraphQL stopsByRadius (walking distance on the street network) ---

/**
 * @param {string} gtfsId e.g. "mbta-ma-us:Green-D"
 * @returns {string|null} MetroFeed route_id e.g. "Green-D"
 */
function otpGtfsRouteIdFromGtfsId(gtfsId) {
  if (!gtfsId || typeof gtfsId !== 'string') return null;
  const idx = gtfsId.indexOf(':');
  return idx >= 0 ? gtfsId.slice(idx + 1) : gtfsId;
}

/**
 * Lower is better. Deprioritizes shuttles so street stops with many shuttle routes still prefer rapid transit nearby.
 * @param {{ gtfsId?: string, longName?: string, shortName?: string, mode?: string }} route
 */
function findMeOtpRouteTier(route) {
  const gid = route.gtfsId || '';
  const longName = (route.longName || '').toLowerCase();
  const shortName = (route.shortName || '').toLowerCase();
  if (/shuttle/i.test(gid) || longName.includes('shuttle') || shortName.includes('shuttle')) {
    return 120;
  }
  const mode = (route.mode || '').toUpperCase();
  if (mode === 'SUBWAY' || mode === 'RAIL') return 0;
  if (mode === 'TRAM') return 2;
  if (mode === 'FERRY') return 15;
  if (mode === 'BUS') return 45;
  return 35;
}

/**
 * Pick a route near the user using OTP's stopsByRadius (walk distance in meters along OSM paths).
 * @param {number} userLat
 * @param {number} userLon
 * @returns {Promise<{ route_id: string, walkDistanceM: number, stopName: string, stopGtfsId: string, otpRouteGtfsId: string }|null>}
 */
async function resolveFindMeRouteViaOtp(userLat, userLon) {
  if (typeof window !== 'undefined' && window.OTP_FINDME_USE_STOPS_RADIUS === false) {
    return null;
  }
  const lat = Number(userLat);
  const lon = Number(userLon);
  if (!isFinite(lat) || !isFinite(lon)) {
    return null;
  }

  const endpoint = getOtpGtfsGraphqlEndpoint();
  const radius =
    typeof window !== 'undefined' && window.OTP_FINDME_RADIUS_M != null
      ? Math.max(50, Math.round(Number(window.OTP_FINDME_RADIUS_M)))
      : 700;
  const firstN =
    typeof window !== 'undefined' && window.OTP_FINDME_STOPS_FIRST != null
      ? Math.min(80, Math.max(5, Math.round(Number(window.OTP_FINDME_STOPS_FIRST))))
      : 40;

  const query = `
    query FindMeStops($lat: Float!, $lon: Float!, $r: Int!, $n: Int!) {
      stopsByRadius(lat: $lat, lon: $lon, radius: $r, first: $n) {
        edges {
          node {
            distance
            stop {
              name
              gtfsId
              routes { gtfsId shortName longName mode }
            }
          }
        }
      }
    }
  `;

  logOtpDebug('FINDME_STOPS_RADIUS', { endpoint, radius, firstN, lat, lon });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { lat, lon, r: radius, n: firstN }
    })
  });

  const json = await res.json();
  if (json.errors && json.errors.length) {
    console.warn('[Find Me] stopsByRadius GraphQL errors:', json.errors);
    return null;
  }

  const edges = json.data && json.data.stopsByRadius && json.data.stopsByRadius.edges;
  if (!edges || !edges.length) {
    logOtpDebug('FINDME_EMPTY', { edges: 0 });
    return null;
  }

  let bestScore = Infinity;
  /** @type {{ walkM: number, stopName: string, stopGtfsId: string, route: object, route_id: string }|null} */
  let best = null;

  for (let i = 0; i < edges.length; i++) {
    const node = edges[i] && edges[i].node;
    if (!node || node.distance == null || !node.stop) continue;
    const walkM = Number(node.distance);
    if (!isFinite(walkM)) continue;
    const routes = node.stop.routes;
    if (!routes || !routes.length) continue;

    for (let j = 0; j < routes.length; j++) {
      const r = routes[j];
      const route_id = otpGtfsRouteIdFromGtfsId(r.gtfsId);
      if (!route_id) continue;
      const tier = findMeOtpRouteTier(r);
      const score = walkM + tier;
      if (score < bestScore) {
        bestScore = score;
        best = {
          walkM,
          stopName: node.stop.name || '',
          stopGtfsId: node.stop.gtfsId || '',
          route: r,
          route_id
        };
      }
    }
  }

  if (!best) {
    logOtpDebug('FINDME_NO_ROUTES', { edges: edges.length });
    return null;
  }

  logOtpDebug('FINDME_PICK', {
    route_id: best.route_id,
    walkM: best.walkM,
    stop: best.stopName,
    mode: best.route.mode
  });

  return {
    route_id: best.route_id,
    walkDistanceM: best.walkM,
    stopName: best.stopName,
    stopGtfsId: best.stopGtfsId,
    otpRouteGtfsId: best.route.gtfsId || ''
  };
}

if (typeof window !== 'undefined') {
  window.resolveFindMeRouteViaOtp = resolveFindMeRouteViaOtp;
  if (typeof window.OTP_FINDME_USE_STOPS_RADIUS === 'undefined') {
    window.OTP_FINDME_USE_STOPS_RADIUS = true;
  }
}

