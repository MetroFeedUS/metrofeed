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
 * Show route visualization for a selected itinerary
 * @param {number} idx - Index of the itinerary to display
 */
async function showRoute(idx) {
  console.log('[showRoute] Called with idx:', idx);
  if (!window.currentItins || !window.currentItins[idx]) {
    console.error('[showRoute] Trip data not found.');
    alert("Trip data not found. Please try again.");
    return;
  }
  
  // Get map from window (set by home.html)
  const map = window.map;
  if (!map) {
    console.error('[showRoute] Map not available');
    return;
  }
  
  // Store the selected trip index globally
  window.selectedTripIndex = idx;
  
  // Clear previous bus tracking
  if (window.otpBusTrackingInterval) {
    clearInterval(window.otpBusTrackingInterval);
    window.otpBusTrackingInterval = null;
  }
  window.routesToTrack = []; // Clear old routes
  window.activeTripSelected = false; // Reset trip selection flag
  
  // Clear all bus markers
  if (typeof window.fetchAndDisplayBuses === 'function') {
    // Clear buses by calling with empty routes
    window.fetchAndDisplayBuses([]);
  }
  
  // Remove previous lines
  if (window.routeLine) {
    map.removeLayer(window.routeLine);
    window.routeLine = null;
  }
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
  
  // Clear extended routes
  if (window.extendedRouteLines && window.extendedRouteLines.length) {
    window.extendedRouteLines.forEach(lineId => {
      if (map.getLayer(lineId)) {
        map.removeLayer(lineId);
      }
      if (map.getSource(lineId)) {
        map.removeSource(lineId);
      }
    });
    window.extendedRouteLines = [];
  }
  if (window.routeStopMarkers && window.routeStopMarkers.length) {
    window.routeStopMarkers.forEach(marker => map.removeLayer(marker));
  }
  window.routeStopMarkers = [];

  console.log('[showRoute] Trip:', window.currentItins[idx]);

  let allCoords = [];
  let addedStops = new Set();
  let routesToTrack = []; // Collect routes for bus tracking
  let legColorMapping = {}; // Store color mapping for each leg
  let legIndex = 0; // Track leg index for color assignment
  
  // Use for...of loop to support await
  for (const leg of window.currentItins[idx].legs) {
    let color;
    let legKey;
    let routeNumber = null; // Initialize routeNumber for all legs
    
    if (leg.mode === 'WALK') {
      color = WALK_COLOR;
      legKey = `walk-${legIndex}`;
    } else {
      // Assign unique color to each transit leg
      color = legColors[legIndex % legColors.length];
      
      // Extract route description from GraphQL data
      let routeDescription = '';
      routeNumber = leg.route; // Set routeNumber for transit legs (from line.publicCode)
      
      // Use GraphQL line data directly
      if (leg.line && leg.line.name) {
        routeDescription = leg.line.name;
      } else if (leg.routeLongName) {
        routeDescription = leg.routeLongName;
      } else if (leg.routeShortName) {
        routeDescription = leg.routeShortName;
      } else if (leg.route) {
        routeDescription = leg.route; // Fallback to route code
      }
      
      // Try to find the actual route number using the description
      if (routeDescription) {
        // First try to decode using our mapping function (if available)
        if (typeof window.mapOtpRouteToTrimet === 'function') {
          const decodedRouteNumber = window.mapOtpRouteToTrimet(routeDescription);
          if (decodedRouteNumber) {
            routeNumber = decodedRouteNumber;
            console.log('[showRoute] Decoded route number:', routeNumber, 'for description:', routeDescription);
          }
        }
        
        // Fallback to masterRoutes search (if available)
        if (!routeNumber && typeof window.findRouteByDescription === 'function') {
          const foundRoute = window.findRouteByDescription(routeDescription);
          if (foundRoute) {
            routeNumber = foundRoute.route_id;
            console.log('[showRoute] Found route number via masterRoutes:', routeNumber, 'for description:', routeDescription);
          }
        }
      }
      
      // Calculate direction BEFORE creating the mapping
      let direction = 0; // Default fallback
      
      // OTP provides direction in different ways:
      // 1. leg.headsign - contains the direction description
      // 2. leg.direction - might contain direction info
      // 3. We need to match this with mastermap direction_name
      
      // Enhanced direction matching logic with comprehensive debugging
      function normalizeString(str) {
        return (str || '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .replace(/\s+/g, '');
      }
      
      // Only try direction matching if masterRoutes is available
      if (leg.headsign && typeof window.masterRoutes !== 'undefined' && window.masterRoutes) {
        console.log('🔍 [DIRECTION DEBUG] ==========================================');
        console.log('🔍 [DIRECTION DEBUG] Processing leg for route:', routeNumber);
        console.log('🔍 [DIRECTION DEBUG] OTP headsign:', leg.headsign);
        console.log('🔍 [DIRECTION DEBUG] OTP from stop:', leg.from?.name);
        console.log('🔍 [DIRECTION DEBUG] OTP to stop:', leg.to?.name);
        
        const normHeadsign = normalizeString(leg.headsign);
        console.log('🔍 [DIRECTION DEBUG] Normalized headsign:', normHeadsign);
        
        const masterRoute = window.masterRoutes.find(r => r.route_number === routeNumber);
        if (masterRoute) {
          const dir0Route = window.masterRoutes.find(r => r.route_number === routeNumber && r.direction_id === 0);
          const dir1Route = window.masterRoutes.find(r => r.route_number === routeNumber && r.direction_id === 1);
          
          console.log('🔍 [DIRECTION DEBUG] Found master routes:');
          console.log('🔍 [DIRECTION DEBUG]   Direction 0:', dir0Route ? {
            direction_name: dir0Route.direction_name,
            direction_name_raw: dir0Route.direction_name,
            first_stop: dir0Route.stops?.[0]?.name,
            last_stop: dir0Route.stops?.[dir0Route.stops?.length - 1]?.name,
            route_title: dir0Route.route_title
          } : 'NOT FOUND');
          console.log('🔍 [DIRECTION DEBUG]   Direction 1:', dir1Route ? {
            direction_name: dir1Route.direction_name,
            direction_name_raw: dir1Route.direction_name,
            first_stop: dir1Route.stops?.[0]?.name,
            last_stop: dir1Route.stops?.[dir1Route.stops?.length - 1]?.name,
            route_title: dir1Route.route_title
          } : 'NOT FOUND');
          
          let matched = false;
          
          // SIMPLE HEADSIGN MATCHING
          console.log('🔍 [DIRECTION DEBUG] --- SIMPLE HEADSIGN MATCHING ---');
          
          // Simple function to check if a destination is mentioned
          function containsDestination(headsign, directionName) {
            const headLower = headsign.toLowerCase();
            const dirLower = directionName.toLowerCase();
            
            // Common destination keywords
            const destinations = ['gresham', 'gateway', 'beaverton', 'hillsboro', 'city', 'downtown', 'center', 'tc', 'transit'];
            
            for (const dest of destinations) {
              if (headLower.includes(dest) && dirLower.includes(dest)) {
                return true;
              }
            }
            return false;
          }
          
          console.log('🔍 [DIRECTION DEBUG] OTP headsign:', leg.headsign);
          console.log('🔍 [DIRECTION DEBUG] Looking for destination match...');
          
          // Check Direction 0
          if (dir0Route && dir0Route.direction_name) {
            const dir0Match = containsDestination(leg.headsign, dir0Route.direction_name);
            console.log('🔍 [DIRECTION DEBUG] Direction 0:', dir0Route.direction_name);
            console.log('🔍 [DIRECTION DEBUG] Direction 0 match?', dir0Match);
            
            if (dir0Match) {
              direction = 0;
              matched = true;
              console.log('✅ [DIRECTION DEBUG] SUCCESS: Direction 0 matches!');
            }
          }
          
          // Check Direction 1
          if (!matched && dir1Route && dir1Route.direction_name) {
            const dir1Match = containsDestination(leg.headsign, dir1Route.direction_name);
            console.log('🔍 [DIRECTION DEBUG] Direction 1:', dir1Route.direction_name);
            console.log('🔍 [DIRECTION DEBUG] Direction 1 match?', dir1Match);
            
            if (dir1Match) {
              direction = 1;
              matched = true;
              console.log('✅ [DIRECTION DEBUG] SUCCESS: Direction 1 matches!');
            }
          }
          
          if (!matched) {
            console.log('❌ [DIRECTION DEBUG] No destination match found');
          }
          
          // Fallback: try to infer by comparing from/to stop names
          if (!matched && dir0Route && dir1Route) {
            console.log('🔍 [DIRECTION DEBUG] --- TRYING STOP NAME FALLBACK ---');
            
            const otpFrom = normalizeString(leg.from?.name);
            const otpTo = normalizeString(leg.to?.name);
            const dir0From = normalizeString(dir0Route.stops?.[0]?.name);
            const dir0To = normalizeString(dir0Route.stops?.[dir0Route.stops.length - 1]?.name);
            const dir1From = normalizeString(dir1Route.stops?.[0]?.name);
            const dir1To = normalizeString(dir1Route.stops?.[dir1Route.stops.length - 1]?.name);
            
            console.log('🔍 [DIRECTION DEBUG] Stop comparisons:');
            console.log('🔍 [DIRECTION DEBUG]   OTP From:', otpFrom, '| OTP To:', otpTo);
            console.log('🔍 [DIRECTION DEBUG]   Dir0 From:', dir0From, '| Dir0 To:', dir0To);
            console.log('🔍 [DIRECTION DEBUG]   Dir1 From:', dir1From, '| Dir1 To:', dir1To);
            
            const fromMatch0 = otpFrom && dir0From && otpFrom === dir0From;
            const toMatch0 = otpTo && dir0To && otpTo === dir0To;
            const fromMatch1 = otpFrom && dir1From && otpFrom === dir1From;
            const toMatch1 = otpTo && dir1To && otpTo === dir1To;
            
            console.log('🔍 [DIRECTION DEBUG] Stop matches:');
            console.log('🔍 [DIRECTION DEBUG]   Dir0 From match?', fromMatch0);
            console.log('🔍 [DIRECTION DEBUG]   Dir0 To match?', toMatch0);
            console.log('🔍 [DIRECTION DEBUG]   Dir1 From match?', fromMatch1);
            console.log('🔍 [DIRECTION DEBUG]   Dir1 To match?', toMatch1);
            
            if (fromMatch0 || toMatch0) {
              direction = 0;
              matched = true;
              console.log('✅ [DIRECTION DEBUG] SUCCESS: Fallback matched stops to direction 0');
              console.log('✅ [DIRECTION DEBUG] Match type:', fromMatch0 ? 'FROM stop' : 'TO stop');
            } else if (fromMatch1 || toMatch1) {
              direction = 1;
              matched = true;
              console.log('✅ [DIRECTION DEBUG] SUCCESS: Fallback matched stops to direction 1');
              console.log('✅ [DIRECTION DEBUG] Match type:', fromMatch1 ? 'FROM stop' : 'TO stop');
            } else {
              console.log('❌ [DIRECTION DEBUG] FAILED: Stop name fallback');
            }
          }
          
          // Additional fallback: try to extract direction from route title if direction_name is corrupted
          if (!matched) {
            console.log('🔍 [DIRECTION DEBUG] --- TRYING ROUTE TITLE FALLBACK ---');
            
            // Check if direction_name looks corrupted (too long, no spaces, etc.)
            const isCorrupted = (name) => name && (name.length > 50 || !name.includes(' ') || name.includes('montgomerypkoryeon'));
            
            if (dir0Route && isCorrupted(dir0Route.direction_name)) {
              console.log('🔍 [DIRECTION DEBUG] Direction 0 name appears corrupted, trying route title');
              const routeTitle = dir0Route.route_title || '';
              console.log('🔍 [DIRECTION DEBUG] Route title:', routeTitle);
              
              // Try to extract direction info from route title
              const titleLower = routeTitle.toLowerCase();
              if (titleLower.includes('gateway') || titleLower.includes('tc')) {
                direction = 0;
                matched = true;
                console.log('✅ [DIRECTION DEBUG] SUCCESS: Matched route title to direction 0 (Gateway)');
              }
            }
            
            if (!matched && dir1Route && isCorrupted(dir1Route.direction_name)) {
              console.log('🔍 [DIRECTION DEBUG] Direction 1 name appears corrupted, trying route title');
              const routeTitle = dir1Route.route_title || '';
              console.log('🔍 [DIRECTION DEBUG] Route title:', routeTitle);
              
              const titleLower = routeTitle.toLowerCase();
              if (titleLower.includes('gateway') || titleLower.includes('tc')) {
                direction = 1;
                matched = true;
                console.log('✅ [DIRECTION DEBUG] SUCCESS: Matched route title to direction 1 (Gateway)');
              }
            }
          }
          
          if (!matched) {
            direction = 0; // fallback
            console.log('⚠️ [DIRECTION DEBUG] WARNING: Could not match headsign or stops to direction, using default 0');
          }
          
          console.log('🔍 [DIRECTION DEBUG] FINAL RESULT: Direction =', direction);
          console.log('🔍 [DIRECTION DEBUG] ==========================================');
        } else {
          console.log('❌ [DIRECTION DEBUG] ERROR: No master route found for route number:', routeNumber);
          console.log('🔍 [DIRECTION DEBUG] ==========================================');
        }
      } else {
        console.log('🔍 [DIRECTION DEBUG] No headsign available or masterRoutes not available');
        console.log('🔍 [DIRECTION DEBUG] ==========================================');
      }
      
      // NOW create the legKey and mapping with the calculated direction
      legKey = `${leg.mode}-${routeNumber}-${direction}`;
      
      // Store color mapping for bus matching
      legColorMapping[legKey] = {
        color: color,
        route: routeNumber,
        direction: direction, // Use the calculated direction
        mode: leg.mode,
        description: routeDescription
      };
      
      // Also store direction on leg object for route loading
      leg.direction = direction;
      leg.route = routeNumber; // Ensure route is set
      
      console.log('[showRoute] Created leg mapping:', legKey, 'for route:', routeNumber, 'description:', routeDescription, 'direction:', direction);
    }
    
    // --- Geometry-first leg rendering ---
    // Goal:
    // - WALK: solid gray, uses OTP steps if available (fallback OSRM, then straight line)
    // - TRANSIT: dashed prefix/suffix and solid middle, using pointsOnLink.points and snapping split indices to from/to.
    let coords = [];
    const fromLat = leg.fromPlace?.latitude;
    const fromLon = leg.fromPlace?.longitude;
    const toLat = leg.toPlace?.latitude;
    const toLon = leg.toPlace?.longitude;

    // ----------------------------
    // 1) Transit geometry from OTP pointsOnLink
    // ----------------------------
    if (leg.mode !== "WALK") {
      const otpPts = leg.pointsOnLink?.points;
      if (otpPts) {
        try {
          coords = decodePolyline(otpPts); // returns [lat, lon]
          console.log(`[showRoute] ✅ Using OTP pointsOnLink for ${leg.mode} leg ${legIndex}, ${coords.length} points`);
          if (!Array.isArray(coords) || coords.length < 2) coords = [];
        } catch (e) {
          console.warn("[showRoute] Failed to decode OTP pointsOnLink.points:", e);
          coords = [];
        }
      }
    }

    // ----------------------------
    // 2) Walking geometry (best effort)
    //    - Use OSRM for walking paths (follows actual streets)
    // ----------------------------
    if (leg.mode === "WALK") {
      // Use OSRM for walking paths (follows actual streets, not straight lines)
      if (!coords.length && fromLat && fromLon && toLat && toLon) {
        try {
          console.log(`[showRoute] Fetching OSRM walking path from (${fromLat}, ${fromLon}) to (${toLat}, ${toLon})`);
          const osrmUrl = `https://router.project-osrm.org/route/v1/walking/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;
          const r = await fetch(osrmUrl);
          if (r.ok) {
            const data = await r.json();
            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
              const geometry = data.routes[0].geometry?.coordinates;
              if (geometry && geometry.length > 1) {
                coords = geometry.map(c => [c[1], c[0]]); // [lat, lon]
                const distance = data.routes[0].distance || 0;
                console.log(`[showRoute] ✅ Using OSRM for walking leg ${legIndex}, ${coords.length} points, ${Math.round(distance)}m distance`);
                console.log(`[showRoute] OSRM path follows streets (not straight line)`);
              } else {
                console.warn(`[showRoute] OSRM returned no geometry`);
              }
            } else {
              console.warn(`[showRoute] OSRM returned error: ${data.code}`);
            }
          } else {
            console.warn(`[showRoute] OSRM request failed: ${r.status}`);
          }
        } catch (e) {
          console.warn("[showRoute] OSRM walking fallback failed:", e);
        }
      } else if (!coords.length) {
        console.warn(`[showRoute] Cannot fetch walking path - missing coordinates`);
      }
    }

    // ----------------------------
    // 3) Last resort: straight line
    // ----------------------------
    if (!coords.length && fromLat && fromLon && toLat && toLon) {
      coords = [[fromLat, fromLon], [toLat, toLon]];
      console.warn(`[showRoute] ⚠️ Using straight line fallback for ${leg.mode} leg ${legIndex}`);
    }

    // ----------------------------
    // 4) Draw it:
    //    WALK = solid gray
    //    TRANSIT = dashed ends + solid middle (same color)
    // ----------------------------
    if (coords.length > 1) {
      const baseId = `routeLeg-${legIndex}`;
      window.routeLegLines = window.routeLegLines || [];

      if (leg.mode === "WALK") {
        // ✅ WALK = SOLID GRAY
        const walkId = `${baseId}-walk`;
        addLine(map, walkId, toMapLibreCoords(coords), {
          "line-color": "#777",
          "line-width": 4,
          "line-opacity": 0.85
        });
        window.routeLegLines.push(walkId);

      } else {
        // ✅ TRANSIT = dashed prefix, solid middle, dashed suffix (same color)
        // Find split indices by snapping to nearest geometry point to from/to coordinates
        let startIdx = 0;
        let endIdx = coords.length - 1;

        if (fromLat && fromLon && toLat && toLon && coords.length > 10) {
          const a = findNearestPointIndex(coords, fromLat, fromLon);
          const b = findNearestPointIndex(coords, toLat, toLon);
          startIdx = Math.min(a, b);
          endIdx = Math.max(a, b);
        }

        // ensure mid has meaningful length
        if ((endIdx - startIdx) < 2) {
          startIdx = 0;
          endIdx = coords.length - 1;
        }

        const pre = coords.slice(0, startIdx + 1);
        const mid = coords.slice(startIdx, endIdx + 1);
        const post = coords.slice(endIdx);

        const dash = [5, 3]; // more pronounced dashed ends

        if (pre.length > 1) {
          const preId = `${baseId}-pre`;
          addLine(map, preId, toMapLibreCoords(pre), {
            "line-color": color,
            "line-width": 6,      // increased from 5 for more visibility
            "line-opacity": 0.8,  // increased from 0.65 for more visibility
            "line-dasharray": dash
          });
          window.routeLegLines.push(preId);
        }

        if (mid.length > 1) {
          const midId = `${baseId}-mid`;
          addLine(map, midId, toMapLibreCoords(mid), {
            "line-color": color,
            "line-width": 6,      // slightly thicker for the "selected segment"
            "line-opacity": 0.95
          });
          window.routeLegLines.push(midId);
        }

        if (post.length > 1) {
          const postId = `${baseId}-post`;
          addLine(map, postId, toMapLibreCoords(post), {
            "line-color": color,
            "line-width": 6,      // increased from 5 for more visibility
            "line-opacity": 0.8,  // increased from 0.65 for more visibility
            "line-dasharray": dash
          });
          window.routeLegLines.push(postId);
        }
      }

      allCoords = allCoords.concat(coords);
    }
    
    legIndex++;
    
    // Collect route information for bus tracking (skip WALK legs)
    if (leg.mode !== 'WALK' && routeNumber) {
      console.log('🚌 [showRoute] ==========================================');
      console.log('🚌 [showRoute] Processing transit leg for bus tracking');
      console.log('🚌 [showRoute] Leg mode:', leg.mode);
      console.log('🚌 [showRoute] Route number (raw):', leg.route);
      console.log('🚌 [showRoute] Route number (processed):', routeNumber);
      console.log('🚌 [showRoute] Leg key:', legKey);
      console.log('🚌 [showRoute] Leg color mapping:', legColorMapping);
      
      // Retrieve the direction that was already calculated in the first block
      // This ensures both legs use the same fixed direction matching logic
      let direction = 0; // Default fallback
      if (legKey && legColorMapping[legKey]) {
        direction = legColorMapping[legKey].direction;
        console.log('🚌 [showRoute] ✅ Found direction in legColorMapping:', direction);
      } else {
        console.warn('🚌 [showRoute] ⚠️ WARNING: Could not find direction in legColorMapping');
        console.warn('🚌 [showRoute] LegKey:', legKey);
        console.warn('🚌 [showRoute] Available legKeys:', Object.keys(legColorMapping));
        console.warn('🚌 [showRoute] Using default direction: 0');
      }
      
      const routeToTrack = {
        route_id: routeNumber, // Use the processed route number, not leg.route
        direction_id: direction, // Use the direction from legColorMapping (already calculated in first block)
        mode: leg.mode
      };
      
      console.log('🚌 [showRoute] Adding route to track:', routeToTrack);
      routesToTrack.push(routeToTrack);
      console.log('🚌 [showRoute] Total routes to track so far:', routesToTrack.length);
      console.log('🚌 [showRoute] ==========================================');
    }
  }
  
  if (window.routeLegLines && window.routeLegLines.length) {
    const bounds = new maplibregl.LngLatBounds();
    allCoords.forEach(coord => bounds.extend([coord[1], coord[0]]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }
  
  // Store leg color mapping globally for bus matching
  window.currentLegColorMapping = legColorMapping;
  console.log('[showRoute] Leg color mapping:', legColorMapping);
  
  // Draw extended routes from mastermap (if function available)
  if (typeof window.drawExtendedRoutes === 'function') {
    window.drawExtendedRoutes(legColorMapping);
  }
  
  // Store routesToTrack globally for bus tracking
  window.routesToTrack = routesToTrack;
  console.log('🚌 [showRoute] ==========================================');
  console.log('🚌 [showRoute] FINAL: Routes to track:', JSON.stringify(routesToTrack, null, 2));
  console.log('🚌 [showRoute] Total routes:', routesToTrack.length);
  console.log('🚌 [showRoute] ==========================================');
  
  // Start tracking buses for the routes in this trip
  if (routesToTrack.length > 0) {
    console.log('🚌 [showRoute] Starting bus tracking for', routesToTrack.length, 'routes');
    
    // Stop closest route tracking when OTP tracking starts
    if (window.closestRouteInterval) {
      console.log('[showRoute] Stopping closest route tracking for OTP');
      clearInterval(window.closestRouteInterval);
      window.closestRouteInterval = null;
    }
    
    // Use window.fetchAndDisplayBuses if available
    if (typeof window.fetchAndDisplayBuses === 'function') {
      window.fetchAndDisplayBuses(routesToTrack);
      // Set up continuous tracking for this trip
      if (window.otpBusTrackingInterval) {
        clearInterval(window.otpBusTrackingInterval);
      }
      window.otpBusTrackingInterval = setInterval(() => {
        window.fetchAndDisplayBuses(routesToTrack);
      }, 15000);
    }
  } else {
    // If no routes to track, resume closest route tracking
    if (window.closestRoute && typeof window.fetchAndDisplayBuses === 'function') {
      // Show buses for closest route
      window.fetchAndDisplayBuses();
    }
  }
  
  // Mark that a trip has been selected
  activeTripSelected = true;
  window.activeTripSelected = true; // Also set on window for home.html access
  
  // Minimize the modal instead of hiding it (if function available)
  if (typeof window.minimizeItineraryModal === 'function') {
    window.minimizeItineraryModal();
  }
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

