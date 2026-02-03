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
  
  // PHASE 2: Handle departure time
  let dateTimeArg = null;
  if (departureType === 'departure' && departureTime) {
    try {
      const depDate = new Date(departureTime);
      if (!isNaN(depDate.getTime())) {
        // Convert to ISO string for OTP
        dateTimeArg = depDate.toISOString();
        console.log('[OTP] Using departure time:', dateTimeArg);
      } else {
        console.warn('[OTP] Invalid departure time, using "now"');
      }
    } catch (e) {
      console.warn('[OTP] Error parsing departure time:', e);
    }
  }
  
  // PHASE 1: Schema-locked GraphQL query
  // Removed numTripPatterns - will limit client-side if needed
  // All fields verified against Transmodel v3 schema
  // Note: If dateTime argument doesn't exist, try 'date' or 'time' - schema debug will show correct name
  const graphqlQuery = `
    query TripPlan($fromLat: Float!, $fromLon: Float!, $toLat: Float!, $toLon: Float!${dateTimeArg ? ', $dateTime: DateTime' : ''}) {
      trip(
        from: { coordinates: { latitude: $fromLat, longitude: $fromLon } }
        to: { coordinates: { latitude: $toLat, longitude: $toLon } }
        ${dateTimeArg ? 'dateTime: $dateTime' : ''}
      ) {
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
  
  const variables = {
    fromLat: fromLat,
    fromLon: fromLon,
    toLat: toLat,
    toLon: toLon
  };
  
  if (dateTimeArg) {
    variables.dateTime = dateTimeArg;
  }
  
  console.log('[fetchAndShowOtpItineraries] GraphQL query variables:', variables);
  
  // Clear previous state for multiple trips
  window.otpBusInfo = {};
  currentItins = null;
  activeTripSelected = false;
  window.activeTripSelected = false; // Also clear on window
  window.currentLegColorMapping = null;
  window.routesToTrack = []; // Clear routes to track
  
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
  itinList.innerHTML = "<em style='color: #1E90FF;'>Loading trip options...</em>";
  showOtpModal();

  try {
    // POST GraphQL request
    const res = await fetch(OTP_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: variables
      })
    });
    
    if (!res.ok) throw new Error("OTP server error: " + res.status);
    const response = await res.json();

    console.log('Full OTP GraphQL response:', response); // Debug the full response

    // Check for GraphQL errors
    if (response.errors) {
      console.error('GraphQL errors:', response.errors);
      // PHASE 2: If dateTime argument doesn't exist, retry without it
      if (dateTimeArg && response.errors.some(e => e.message.includes('dateTime') || e.message.includes('UnknownArgument'))) {
        console.warn('[OTP] dateTime argument not supported, retrying without it');
        // Retry without dateTime
        const retryQuery = graphqlQuery.replace(/\$dateTime: DateTime/g, '').replace(/dateTime: \$dateTime/g, '');
        const retryVariables = { fromLat, fromLon, toLat, toLon };
        const retryRes = await fetch(OTP_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: retryQuery, variables: retryVariables })
        });
        const retryResponse = await retryRes.json();
        if (retryResponse.errors) {
          itinList.innerHTML = `<em style='color: #f55;'>Error: ${retryResponse.errors.map(e => e.message).join(', ')}</em>`;
          return;
        }
        // Use retry response
        response.data = retryResponse.data;
      } else {
        itinList.innerHTML = `<em style='color: #f55;'>Error: ${response.errors.map(e => e.message).join(', ')}</em>`;
        return;
      }
    }

    // OTP 2.9 GraphQL returns { data: { trip: { tripPatterns: [...] } } }
    if (!response.data || !response.data.trip || !response.data.trip.tripPatterns || !response.data.trip.tripPatterns.length) {
      itinList.innerHTML = "<em style='color: #f55;'>No trips found for this route.</em>";
      return;
    }

    // Work directly with GraphQL response structure
    // PHASE 1: Limit client-side if numTripPatterns doesn't exist in schema
    const tripPatterns = response.data.trip.tripPatterns;
    const numItineraries = 4; // Default limit
    const limitedPatterns = tripPatterns.slice(0, numItineraries);
    
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
    
    // Sort by duration (shortest first)
    convertedItineraries.sort((a, b) => a.duration - b.duration);
    
    // Filter to max transfers
    const filtered = convertedItineraries.filter(it => countTransfers(it) <= MAX_TRANSFERS);
    
    // Use filtered if available, otherwise fall back to all (so user isn't stuck)
    currentItins = filtered.length ? filtered : convertedItineraries;
    window.currentItins = currentItins; // Also set on window for compatibility
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
    
    renderItinListVisual(currentItins);

  } catch (e) {
    console.error('OTP Error:', e);
    itinList.innerHTML = `<em style="color:#f55">Error connecting to OTP server. Please check if the OTP server is running on https://otp.metrofeedus.com</em>`;
  }
}

/**
 * Render itinerary list in the OTP modal
 * @param {Array} itins - Array of itinerary objects
 */
function renderItinListVisual(itins) {
  window.currentItins = itins; // Ensure global is always set!
  const itinList = document.getElementById('itinList');
  itinList.innerHTML = itins.map((itin, idx) => {
    const start = getPortlandTimeString(new Date(itin.startTime));
    const end = getPortlandTimeString(new Date(itin.endTime));
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
    return `<div class="itinListOption ${window.selectedTripIndex === idx ? 'selected' : ''}" data-idx="${idx}">
      <button class="itin-dropdown-btn" onclick="event.stopPropagation();toggleDropdown(${idx})">&#9660;</button>
      <div onclick="showRoute(${idx})">
        <div class="itin-toptimes">Option ${idx+1}: ${start}–${end}</div>
        <div class="itin-segments">${segs}</div>
        <div class="itin-total">Total: ${Math.round(itin.duration/60)} min</div>
      </div>
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
    
    // Places
    this.boardingPoint = leg.fromPlace ? {
      name: leg.fromPlace.name,
      lat: leg.fromPlace.latitude,
      lng: leg.fromPlace.longitude
    } : null;
    this.alightingPoint = leg.toPlace ? {
      name: leg.toPlace.name,
      lat: leg.toPlace.latitude,
      lng: leg.toPlace.longitude
    } : null;
    
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
    const itin = convertedItineraries[itinIdx];
    const journey = new Journey(itin);
    journey.id = itinIdx;
    
    console.log(`🔄 [normalizeItineraries] Processing itinerary ${itinIdx + 1}`);
    
    // Process each leg
    for (let legIdx = 0; legIdx < itin.legs.length; legIdx++) {
      const leg = itin.legs[legIdx];
      const journeyLeg = new JourneyLeg(leg, legIdx);
      
      // Extract and normalize route number (for transit legs only)
      if (journeyLeg.type === 'TRANSIT') {
        const routeInfo = await extractRouteInfo(leg, legIdx);
        journeyLeg.routeNumber = routeInfo.routeNumber;
        journeyLeg.direction = routeInfo.direction;
        journeyLeg.line = routeInfo.line;
        
        console.log(`🔄 [normalizeItineraries] Leg ${legIdx} (${leg.mode}): route=${journeyLeg.routeNumber}, direction=${journeyLeg.direction}`);
      }
      
      // Clip geometry once (for all legs)
      await clipLegGeometry(journeyLeg, leg);
      
      journey.legs.push(journeyLeg);
    }
    
    journeys.push(journey);
    console.log(`🔄 [normalizeItineraries] ✅ Normalized itinerary ${itinIdx + 1}: ${journey.legs.length} legs, ${journey.transfers} transfers`);
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
  
  // Preserve original leg.line if available (contains publicCode, name, etc.)
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
  
  // ⚠️ PRIORITY 1: Use OTP's publicCode directly (most reliable for Boston)
  if (leg.line && leg.line.publicCode) {
    routeNumber = leg.line.publicCode;
    console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}):`);
    console.log(`🔍 [extractRouteInfo]   ✅ Using OTP publicCode:`, routeNumber);
  }
  // ⚠️ PRIORITY 2: Use leg.route if publicCode not available
  else if (leg.route) {
    routeNumber = leg.route;
    console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}):`);
    console.log(`🔍 [extractRouteInfo]   ✅ Using leg.route:`, routeNumber);
  }
  
  // Extract route description for logging/fallback
  let routeDescription = '';
  if (leg.line && leg.line.name) {
    routeDescription = leg.line.name;
  } else if (leg.routeLongName) {
    routeDescription = leg.routeLongName;
  } else if (leg.routeShortName) {
    routeDescription = leg.routeShortName;
  } else if (leg.route) {
    routeDescription = leg.route;
  }
  
  if (!routeNumber) {
    console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}):`);
    console.log(`🔍 [extractRouteInfo]   Raw route:`, leg.route);
    console.log(`🔍 [extractRouteInfo]   Description:`, routeDescription);
  }
  
  // ⚠️ PRIORITY 3: Try to decode route number using mapping function (LAST RESORT)
  // Only use this if we don't have a route number yet
  if (!routeNumber && routeDescription && typeof window.mapOtpRouteToTrimet === 'function') {
    const decodedRouteNumber = window.mapOtpRouteToTrimet(routeDescription);
    if (decodedRouteNumber) {
      routeNumber = decodedRouteNumber;
      console.log(`🔍 [extractRouteInfo]   ⚠️ Decoded route via mapOtpRouteToTrimet:`, routeNumber);
    }
  }
  
  // ⚠️ PRIORITY 4: Fallback to masterRoutes search (if available)
  if (!routeNumber && typeof window.findRouteByDescription === 'function') {
    const foundRoute = window.findRouteByDescription(routeDescription);
    if (foundRoute) {
      routeNumber = foundRoute.route_id;
      console.log(`🔍 [extractRouteInfo]   ⚠️ Found via masterRoutes:`, routeNumber);
    }
  }
  
  // Calculate direction (only for bus-trackable modes)
  const busTrackableModes = ['BUS', 'TRAM', 'RAIL', 'TRAIN', 'FERRY'];
  if (busTrackableModes.includes(leg.mode) && routeNumber) {
    direction = await calculateDirection(leg, routeNumber, routeDescription);
    console.log(`🔍 [extractRouteInfo]   ✅ Direction:`, direction);
  }
  
  return { routeNumber, direction, line };
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
  
  // Helper function
  function normalizeString(str) {
    return (str || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/\s+/g, '');
  }
  
  // Only try direction matching if masterRoutes is available
  if (leg.headsign && typeof window.masterRoutes !== 'undefined' && window.masterRoutes && routeNumber) {
    console.log('🔍 [calculateDirection] Processing route:', routeNumber);
    
    const dir0Route = window.masterRoutes.find(r => r.route_number === routeNumber && r.direction_id === 0);
    const dir1Route = window.masterRoutes.find(r => r.route_number === routeNumber && r.direction_id === 1);
    
    if (dir0Route && dir1Route) {
      let matched = false;
      
      // Simple destination matching
      function containsDestination(headsign, directionName) {
        const headLower = headsign.toLowerCase();
        const dirLower = directionName.toLowerCase();
        const destinations = ['gresham', 'gateway', 'beaverton', 'hillsboro', 'city', 'downtown', 'center', 'tc', 'transit'];
        for (const dest of destinations) {
          if (headLower.includes(dest) && dirLower.includes(dest)) {
            return true;
          }
        }
        return false;
      }
      
      // Check Direction 0
      if (dir0Route.direction_name && containsDestination(leg.headsign, dir0Route.direction_name)) {
        direction = 0;
        matched = true;
        console.log('🔍 [calculateDirection] ✅ Matched direction 0 via headsign');
      }
      
      // Check Direction 1
      if (!matched && dir1Route.direction_name && containsDestination(leg.headsign, dir1Route.direction_name)) {
        direction = 1;
        matched = true;
        console.log('🔍 [calculateDirection] ✅ Matched direction 1 via headsign');
      }
      
      // Fallback: stop name matching
      if (!matched) {
        const otpFrom = normalizeString(leg.from?.name);
        const otpTo = normalizeString(leg.to?.name);
        const dir0From = normalizeString(dir0Route.stops?.[0]?.name);
        const dir0To = normalizeString(dir0Route.stops?.[dir0Route.stops.length - 1]?.name);
        const dir1From = normalizeString(dir1Route.stops?.[0]?.name);
        const dir1To = normalizeString(dir1Route.stops?.[dir1Route.stops.length - 1]?.name);
        
        if ((otpFrom && otpFrom === dir0From) || (otpTo && otpTo === dir0To)) {
          direction = 0;
          matched = true;
          console.log('🔍 [calculateDirection] ✅ Matched direction 0 via stop names');
        } else if ((otpFrom && otpFrom === dir1From) || (otpTo && otpTo === dir1To)) {
          direction = 1;
          matched = true;
          console.log('🔍 [calculateDirection] ✅ Matched direction 1 via stop names');
        }
      }
    }
  }
  
  console.log('🔍 [calculateDirection] Final direction:', direction);
  return direction;
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
  
  // For transit: use OTP pointsOnLink
  if (journeyLeg.type === 'TRANSIT' && leg.pointsOnLink?.points) {
    try {
      coords = decodePolyline(leg.pointsOnLink.points);
      console.log(`✂️ [clipLegGeometry] Transit leg ${journeyLeg.index}: decoded ${coords.length} points from OTP`);
    } catch (e) {
      console.warn(`⚠️ [clipLegGeometry] Failed to decode OTP geometry:`, e);
    }
  }
  
  // For walking: use OSRM
  if (journeyLeg.type === 'WALK' && !coords.length) {
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/walking/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;
      const r = await fetch(osrmUrl);
      if (r.ok) {
        const data = await r.json();
        if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
          coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]); // [lat, lng]
          console.log(`✂️ [clipLegGeometry] Walking leg ${journeyLeg.index}: got ${coords.length} points from OSRM`);
        }
      }
    } catch (e) {
      console.warn(`⚠️ [clipLegGeometry] OSRM failed:`, e);
    }
  }
  
  // Fallback: straight line
  if (!coords.length) {
    coords = [[fromLat, fromLon], [toLat, toLon]];
    console.log(`✂️ [clipLegGeometry] Leg ${journeyLeg.index}: using straight line fallback`);
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
function drawJourney(journey) {
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
  
  let allCoords = [];
  const routeList = []; // Store routes for selector modal
  
  // Render each leg
  journey.legs.forEach((leg, legIdx) => {
    const color = leg.type === 'WALK' ? WALK_COLOR : legColors[legIdx % legColors.length];
    
    // Assign color to leg
    if (leg.line) {
      leg.line.color = color;
    }
    
    // Draw walking leg (solid gray)
    if (leg.type === 'WALK' && leg.solidSegment) {
      const walkId = `routeLeg-${leg.index}-walk`;
      addLine(map, walkId, toMapLibreCoords(leg.solidSegment), {
        "line-color": "#777",
        "line-width": 4,
        "line-opacity": 0.85
      });
      window.routeLegLines = window.routeLegLines || [];
      window.routeLegLines.push(walkId);
      allCoords = allCoords.concat(leg.solidSegment);
    }
    
    // Draw transit leg (simple solid line - no dashed segments)
    if (leg.type === 'TRANSIT' && leg.solidSegment && leg.solidSegment.length > 1) {
      const transitId = `routeLeg-${leg.index}-transit`;
      addLine(map, transitId, toMapLibreCoords(leg.solidSegment), {
        "line-color": color,
        "line-width": 6,
        "line-opacity": 0.95
      });
      window.routeLegLines.push(transitId);
      allCoords = allCoords.concat(leg.solidSegment);
      
      // Store route info for selector modal
      routeList.push({
        routeId: leg.routeNumber,
        directionId: leg.direction || 0,
        mode: leg.mode,
        color: color,
        name: leg.line?.name || `Route ${leg.routeNumber}`,
        legIndex: legIdx
      });
    }
  });
  
  // Fit map to bounds
  if (allCoords.length > 0) {
    const bounds = new maplibregl.LngLatBounds();
    allCoords.forEach(coord => bounds.extend([coord[1], coord[0]]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }
  
  // Store route list for modal
  window.otpRouteList = routeList;
  console.log('🎨 [drawJourney] ✅ Extracted', routeList.length, 'routes for selector');
  
  // Show route selector modal
  if (routeList.length > 0) {
    showOtpRouteSelector(routeList);
  }
  
  // Log summary after drawing
  console.log('🎨 [drawJourney] ✅ Journey drawn successfully');
}

/**
 * Show route selector modal with color-coordinated buttons
 * @param {Array} routeList - Array of route objects with {routeId, directionId, mode, color, name}
 */
function showOtpRouteSelector(routeList) {
  // Remove existing modal if present
  const existingModal = document.getElementById('otpRouteSelectorModal');
  if (existingModal) {
    existingModal.remove();
  }
  
  // Create modal container
  const modal = document.createElement('div');
  modal.id = 'otpRouteSelectorModal';
  modal.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    background: rgba(20, 20, 20, 0.95);
    border: 2px solid #444;
    border-radius: 8px;
    padding: 12px;
    z-index: 10000;
    min-width: 200px;
    max-width: 280px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  // Title
  const title = document.createElement('div');
  title.textContent = 'Routes in Trip';
  title.style.cssText = `
    color: #fff;
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 10px;
    border-bottom: 1px solid #444;
    padding-bottom: 8px;
  `;
  modal.appendChild(title);
  
  // Route buttons container
  const buttonsContainer = document.createElement('div');
  buttonsContainer.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
  `;
  
  // Create button for each route
  routeList.forEach((route, idx) => {
    const button = document.createElement('button');
    button.textContent = route.name || `Route ${route.routeId}`;
    button.style.cssText = `
      background: ${route.color};
      color: #fff;
      border: 2px solid ${route.color};
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
      transition: all 0.2s;
      position: relative;
      padding-left: 40px;
    `;
    
    // Color indicator dot
    const dot = document.createElement('span');
    dot.style.cssText = `
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      width: 12px;
      height: 12px;
      background: ${route.color};
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 0 2px ${route.color};
    `;
    button.appendChild(dot);
    
    // Hover effects
    button.onmouseenter = () => {
      button.style.opacity = '0.85';
      button.style.transform = 'scale(1.02)';
    };
    button.onmouseleave = () => {
      button.style.opacity = '1';
      button.style.transform = 'scale(1)';
    };
    
    // Track active state
    let isActive = false;
    const overlayKey = `${route.routeId}-${route.directionId}`;
    
    // Check if route is already active
    if (window.activeRouteOverlays && window.activeRouteOverlays[overlayKey]) {
      isActive = true;
      button.style.border = '2px solid #fff';
      button.style.boxShadow = `0 0 8px ${route.color}`;
    }
    
    // Click handler - toggle route overlay
    button.onclick = () => {
      console.log('🎨 [OtpRouteSelector] Clicked route:', route.routeId, 'direction:', route.directionId);
      
      // Toggle route overlay using existing system
      if (typeof window.showRouteOverlay === 'function') {
        window.showRouteOverlay(route.routeId, route.directionId);
        
        // Update button state after a short delay (to let overlay system update)
        setTimeout(() => {
          const nowActive = window.activeRouteOverlays && window.activeRouteOverlays[overlayKey];
          if (nowActive) {
            button.style.border = '2px solid #fff';
            button.style.boxShadow = `0 0 8px ${route.color}`;
            isActive = true;
          } else {
            button.style.border = `2px solid ${route.color}`;
            button.style.boxShadow = 'none';
            isActive = false;
          }
        }, 100);
      } else {
        console.error('🎨 [OtpRouteSelector] showRouteOverlay not available');
        alert('Route overlay system not ready. Please refresh the page.');
      }
    };
    
    buttonsContainer.appendChild(button);
  });
  
  modal.appendChild(buttonsContainer);
  
  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = `
    position: absolute;
    top: 8px;
    right: 8px;
    background: transparent;
    border: none;
    color: #999;
    font-size: 18px;
    cursor: pointer;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  `;
  closeBtn.onmouseenter = () => {
    closeBtn.style.background = '#333';
    closeBtn.style.color = '#fff';
  };
  closeBtn.onmouseleave = () => {
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = '#999';
  };
  closeBtn.onclick = () => {
    modal.remove();
  };
  modal.appendChild(closeBtn);
  
  // Append to body
  document.body.appendChild(modal);
  
  console.log('🎨 [showOtpRouteSelector] Modal created with', routeList.length, 'routes');
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
  
  // Clear previous bus tracking
  if (window.otpBusTrackingInterval) {
    clearInterval(window.otpBusTrackingInterval);
    window.otpBusTrackingInterval = null;
  }
  window.activeTripSelected = false;
  
  // Clear all bus markers
  if (typeof window.fetchAndDisplayBuses === 'function') {
    window.fetchAndDisplayBuses([]);
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
  
  // Just draw the journey - that's it!
  drawJourney(journey);
  
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
window.renderItinListVisual = renderItinListVisual;
window.decodePolyline = decodePolyline;
window.showRoute = showRoute;

// Export state variables (for backward compatibility)
// Note: currentItins is also set on window.currentItins in fetchAndShowOtpItineraries
Object.defineProperty(window, 'currentItins', {
  get: () => currentItins,
  set: (value) => { currentItins = value; }
});

// Export functions and variables to window for global access
window.fetchAndShowOtpItineraries = fetchAndShowOtpItineraries;
window.renderItinListVisual = renderItinListVisual;
window.decodePolyline = decodePolyline;
window.showRoute = showRoute;

// Export state variables (for backward compatibility)
// Note: currentItins is also set on window.currentItins in fetchAndShowOtpItineraries
Object.defineProperty(window, 'currentItins', {
  get: () => currentItins,
  set: (value) => { currentItins = value; }
});

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

