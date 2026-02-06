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
    this.routeVerified = false; // Whether route was verified by stop sequence match
    
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
    return { routeNumber: null, direction: 0, line, directionCalculated: false, verified: false };
  }
  
  // BUS: Primary key is line.publicCode (e.g., "75")
  if (leg.mode === 'BUS') {
    if (leg.line && leg.line.publicCode) {
      routeNumber = leg.line.publicCode;
      console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Using publicCode:`, routeNumber);
      
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
      
      // Determine branch from stop sequence
      if (leg.estimatedCalls && Array.isArray(leg.estimatedCalls) && leg.estimatedCalls.length > 0) {
        // For Green Line: determine branch
        if (routeNumber === 'Green') {
          const branch = determineGreenLineBranch(leg.estimatedCalls);
          if (branch) {
            routeNumber = `Green-${branch}`;
            console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Determined branch: ${branch}`);
          }
        }
        // For Red Line: determine branch (Ashmont vs Braintree)
        else if (routeNumber === 'Red') {
          const branch = determineRedLineBranch(leg.estimatedCalls);
          if (branch) {
            routeNumber = `Red-${branch}`;
            console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Determined branch: ${branch}`);
          }
        }
        
        // Verify by stop sequence
        const verifyResult = await verifyRouteByStops(routeNumber, leg.estimatedCalls);
        verified = verifyResult.verified;
        if (!verified) {
          console.warn(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Route ${routeNumber} failed stop verification - ${verifyResult.reason}`);
        } else {
          console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Route ${routeNumber} verified - ${verifyResult.reason}`);
        }
      }
    } else {
      console.warn(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): No line.name available`);
    }
  }
  // RAIL/TRAIN/FERRY: Use publicCode if available, otherwise line.name
  else if (leg.mode === 'RAIL' || leg.mode === 'TRAIN' || leg.mode === 'FERRY') {
    if (leg.line && leg.line.publicCode) {
      routeNumber = leg.line.publicCode;
      console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Using publicCode:`, routeNumber);
    } else if (leg.line && leg.line.name) {
      routeNumber = leg.line.name;
      console.log(`🔍 [extractRouteInfo] Leg ${legIdx} (${leg.mode}): Using line.name:`, routeNumber);
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
    } else {
      // Not Boston or routeLoader not available - default to 0
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
      
      // Store route info for selector modal (map subway codes)
      const routeName = leg.line?.name || `Route ${leg.routeNumber}`;
      let mappedRouteId = mapSubwayRouteCode(leg.routeNumber, routeName);
      
      // If routeNumber already has a branch suffix (from extractRouteInfo), preserve it
      // Otherwise, try to determine branch from stops if we have a base route
      const estimatedCalls = leg.estimatedCalls || leg.stops || null;
      if (estimatedCalls && Array.isArray(estimatedCalls) && estimatedCalls.length > 0) {
        // If OTP returned "Green" (not a specific branch), try to determine which branch from stops
        if (mappedRouteId === 'Green') {
          const branch = determineGreenLineBranch(estimatedCalls);
          if (branch) {
            mappedRouteId = `Green-${branch}`;
            console.log(`🎨 [drawJourney] Mapped Green Line to branch ${branch} based on stops`);
          }
        }
        // If OTP returned "Red" (not a specific branch), try to determine which branch from stops
        else if (mappedRouteId === 'Red') {
          const branch = determineRedLineBranch(estimatedCalls);
          if (branch) {
            mappedRouteId = `Red-${branch}`;
            console.log(`🎨 [drawJourney] Mapped Red Line to branch ${branch} based on stops`);
          }
        }
      }
      
      // If leg.routeNumber already has a branch suffix, use it (extractRouteInfo may have determined it)
      if (leg.routeNumber && (leg.routeNumber.startsWith('Red-') || leg.routeNumber.startsWith('Green-'))) {
        mappedRouteId = leg.routeNumber;
        console.log(`🎨 [drawJourney] Using branch route from extractRouteInfo: ${mappedRouteId}`);
      }
      
      // Get from/to stops from the leg for better direction matching
      const fromStop = leg.from?.name || '';
      const toStop = leg.to?.name || '';
      
      // Determine route color: Use MBTA subway colors if subway/tram, otherwise use leg color
      let routeColor = color; // Default to leg color
      if (leg.mode === 'SUBWAY' || leg.mode === 'METRO' || leg.mode === 'TRAM') {
        routeColor = getSubwayRouteColor(mappedRouteId);
      }
      
      // Only add to route list if route is verified (or if we can't verify, assume it's correct)
      // This prevents wrong route overlays
      const shouldAddRoute = leg.routeVerified !== false; // Add if verified=true or undefined (can't verify)
      
      if (shouldAddRoute) {
        routeList.push({
          routeId: mappedRouteId, // Use mapped ID (e.g., "Red" instead of "200", or "Green-B" instead of "Green")
          originalRouteId: leg.routeNumber, // Keep original for reference
          directionId: leg.direction || 0,
          mode: leg.mode,
          color: routeColor, // Use MBTA subway color if subway/tram, otherwise leg color
          name: routeName,
          legIndex: legIdx,
          fromStop: fromStop, // Store for direction matching
          toStop: toStop,      // Store for direction matching
          directionCalculated: leg.directionCalculated || false, // Track if direction was calculated
          routeVerified: leg.routeVerified || false // Track if route was verified
        });
      } else {
        console.warn(`🎨 [drawJourney] Skipping route ${mappedRouteId} - failed verification`);
      }
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
  
  // Determine if direction needs flipping (same logic as regular routes)
  const needsFlip = !(originalRoute.mode === 'SUBWAY' || originalRoute.mode === 'METRO');
  const flippedDirection = needsFlip 
    ? (directionId === 0 ? 1 : 0)
    : directionId;
  
  // ⚠️ CRITICAL: Clear ALL bus markers and overlays first
  if (typeof window.fetchAndDisplayBuses === 'function') {
    window.fetchAndDisplayBuses([]);
  }
  
  if (typeof window.clearAllRouteOverlays === 'function') {
    window.clearAllRouteOverlays();
  }
  
  if (window.activeRouteOverlays) {
    window.activeRouteOverlays = {};
  }
  
  window.activeTripSelected = true;
  
  // Show route overlay using existing system
  if (typeof window.showRouteOverlay === 'function') {
    window.showRouteOverlay(branchRouteId, flippedDirection);
  } else {
    console.error('🎨 [selectOtpBranchRoute] showRouteOverlay not available');
    alert('Route overlay system not ready. Please refresh the page.');
  }
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
  
  // Track collapsed state
  let isCollapsed = false;
  
  // Create modal container (centered by default)
  const modal = document.createElement('div');
  modal.id = 'otpRouteSelectorModal';
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(20, 20, 20, 0.95);
    border: 3px solid #555;
    border-radius: 12px;
    padding: 16px;
    z-index: 10000;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    transition: all 0.3s ease;
  `;
  
  // Title with collapse button
  const titleBar = document.createElement('div');
  titleBar.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 2px solid #444;
  `;
  
  const title = document.createElement('div');
  title.textContent = 'Routes in Trip';
  title.style.cssText = `
    color: #fff;
    font-size: 16px;
    font-weight: bold;
  `;
  titleBar.appendChild(title);
  
  // Collapse button
  const collapseBtn = document.createElement('button');
  collapseBtn.textContent = '◄';
  collapseBtn.style.cssText = `
    background: transparent;
    border: 1px solid #666;
    color: #fff;
    font-size: 14px;
    width: 28px;
    height: 28px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  `;
  collapseBtn.onmouseenter = () => {
    collapseBtn.style.background = '#333';
    collapseBtn.style.borderColor = '#888';
  };
  collapseBtn.onmouseleave = () => {
    collapseBtn.style.background = 'transparent';
    collapseBtn.style.borderColor = '#666';
  };
  
  // Collapse/expand functionality
  collapseBtn.onclick = () => {
    isCollapsed = !isCollapsed;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    
    if (isCollapsed) {
      // Collapse to right side - vertical strip
      if (isMobile) {
        modal.style.cssText = `
          position: fixed;
          bottom: 20px;
          right: 20px;
          transform: none;
          background: rgba(20, 20, 20, 0.95);
          border: 3px solid #555;
          border-radius: 12px;
          padding: 10px 8px;
          z-index: 10000;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          transition: all 0.3s ease;
        `;
      } else {
        modal.style.cssText = `
          position: fixed;
          top: 50%;
          right: 20px;
          transform: translateY(-50%);
          background: rgba(20, 20, 20, 0.95);
          border: 3px solid #555;
          border-radius: 12px;
          padding: 12px 8px;
          z-index: 10000;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          transition: all 0.3s ease;
        `;
      }
      title.style.display = 'none';
      buttonsContainer.style.flexDirection = 'column';
      buttonsContainer.style.gap = '10px';
      buttonsContainer.style.justifyContent = 'flex-start';
      collapseBtn.textContent = '►';
      // Keep button sizes the same when collapsed
    } else {
      // Expand to center
      if (isMobile) {
        modal.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(20, 20, 20, 0.95);
          border: 3px solid #555;
          border-radius: 12px;
          padding: 12px;
          z-index: 10000;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          transition: all 0.3s ease;
          max-width: 90vw;
        `;
      } else {
        modal.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(20, 20, 20, 0.95);
          border: 3px solid #555;
          border-radius: 12px;
          padding: 16px;
          z-index: 10000;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          transition: all 0.3s ease;
        `;
      }
      title.style.display = 'block';
      buttonsContainer.style.flexDirection = 'row';
      buttonsContainer.style.gap = '12px';
      buttonsContainer.style.flexWrap = 'wrap';
      buttonsContainer.style.justifyContent = 'center';
      collapseBtn.textContent = '◄';
    }
  };
  
  titleBar.appendChild(collapseBtn);
  modal.appendChild(titleBar);
  
  // Route buttons container (border box)
  const buttonsContainer = document.createElement('div');
  buttonsContainer.id = 'otpRouteButtonsContainer';
  buttonsContainer.style.cssText = `
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: center;
    border: 2px solid #444;
    border-radius: 8px;
    padding: 12px;
    background: rgba(10, 10, 10, 0.5);
  `;
  
  // Create square button for each route (keep in order - descending = first to last leg)
  console.log('🎨 [showOtpRouteSelector] Creating buttons for routes:', routeList.map(r => ({ id: r.routeId, name: r.name, mode: r.mode })));
  routeList.forEach((route, idx) => {
    // Route ID is already mapped in drawJourney()
    const mappedRouteId = route.routeId;
    console.log(`🎨 [showOtpRouteSelector] Creating button ${idx + 1}/${routeList.length}: routeId="${mappedRouteId}", name="${route.name}", color="${route.color}"`);
    
    const button = document.createElement('button');
    button.title = route.name || `Route ${mappedRouteId}`; // Tooltip for collapsed state
    
    // Square button styling
    const buttonSize = 60; // Square size
    button.style.cssText = `
      background: ${route.color};
      color: #fff;
      border: 3px solid ${route.color};
      border-radius: 8px;
      width: ${buttonSize}px;
      height: ${buttonSize}px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      position: relative;
      padding: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      word-wrap: break-word;
      overflow: hidden;
    `;
    
    // Route number/label (centered in square)
    const routeLabel = document.createElement('div');
    routeLabel.textContent = mappedRouteId || '?';
    routeLabel.style.cssText = `
      font-size: 14px;
      font-weight: bold;
      line-height: 1.2;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    `;
    button.appendChild(routeLabel);
    
    // Route name (smaller, below number if space allows)
    if (route.name && route.name.length < 15) {
      const routeName = document.createElement('div');
      routeName.textContent = route.name;
      routeName.style.cssText = `
        font-size: 9px;
        margin-top: 2px;
        opacity: 0.9;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        line-height: 1.1;
        max-height: 20px;
        overflow: hidden;
      `;
      button.appendChild(routeName);
    }
    
    // Hover effects for square buttons
    button.onmouseenter = () => {
      button.style.transform = 'scale(1.1)';
      button.style.boxShadow = `0 4px 12px ${route.color}`;
      button.style.zIndex = '10001';
    };
    button.onmouseleave = () => {
      button.style.transform = 'scale(1)';
      if (!isActive) {
        button.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.4)';
      }
      button.style.zIndex = 'auto';
    };
    
    // ⚠️ FLIP DIRECTION: OTP directions are backward for BUS/TRAM/RAIL, but NOT for SUBWAY/METRO
    // Buses/rail need flipping, but subways are already correct
    const needsFlip = !(route.mode === 'SUBWAY' || route.mode === 'METRO');
    
    // For buses: Try to verify direction by loading route data and matching stops
    // This provides a better filter than just blindly flipping
    let flippedDirection = route.directionId;
    
    if (needsFlip && route.mode === 'BUS' && mappedRouteId && window.routeLoader) {
      // Try to verify the direction by checking route data
      // Load both directions and see which one matches better
      Promise.all([
        window.routeLoader.loadRoute(mappedRouteId, 0).catch(() => null),
        window.routeLoader.loadRoute(mappedRouteId, 1).catch(() => null)
      ]).then(([dir0Data, dir1Data]) => {
        if (dir0Data && dir1Data && dir0Data.stops && dir1Data.stops) {
          // Get OTP leg stops
          const otpFrom = (route.fromStop || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
          const otpTo = (route.toStop || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
          
          // Get route terminal stops
          const dir0First = (dir0Data.stops[0]?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
          const dir0Last = (dir0Data.stops[dir0Data.stops.length - 1]?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
          const dir1First = (dir1Data.stops[0]?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
          const dir1Last = (dir1Data.stops[dir1Data.stops.length - 1]?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
          
          // Improved scoring system for direction matching
          function calculateDirectionScore(otpFrom, otpTo, routeStops) {
            if (!routeStops || routeStops.length === 0) return 0;
            
            let score = 0;
            const firstStop = normalizeStopName(routeStops[0]?.name);
            const lastStop = normalizeStopName(routeStops[routeStops.length - 1]?.name);
            
            // Exact terminal matches get highest weight
            if (otpFrom && otpFrom === firstStop) score += 5;
            if (otpTo && otpTo === lastStop) score += 5;
            
            // Partial terminal matches (substring) get medium weight
            if (otpFrom && (otpFrom.includes(firstStop) || firstStop.includes(otpFrom)) && otpFrom !== firstStop) score += 3;
            if (otpTo && (otpTo.includes(lastStop) || lastStop.includes(otpTo)) && otpTo !== lastStop) score += 3;
            
            // Check if OTP stops appear in route sequence (with position weighting)
            const otpFromNorm = normalizeStopName(otpFrom);
            const otpToNorm = normalizeStopName(otpTo);
            
            routeStops.forEach((stop, idx) => {
              const stopName = normalizeStopName(stop.name);
              if (stopName === otpFromNorm || stopName === otpToNorm) {
                // Give more weight to matches near terminals (first/last 3 stops)
                const isNearTerminal = idx < 3 || idx > routeStops.length - 4;
                score += isNearTerminal ? 2 : 1;
              }
            });
            
            return score;
          }
          
          function normalizeStopName(name) {
            return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
          }
          
          // Calculate scores for each direction
          const dir0Score = calculateDirectionScore(route.fromStop, route.toStop, dir0Data.stops);
          const dir1Score = calculateDirectionScore(route.fromStop, route.toStop, dir1Data.stops);
          
          // Determine best direction (higher score wins, tie goes to original direction)
          const bestDirection = dir1Score > dir0Score ? 1 : (dir0Score > dir1Score ? 0 : route.directionId);
          const shouldFlip = route.directionId !== bestDirection;
          
          if (shouldFlip) {
            flippedDirection = route.directionId === 0 ? 1 : 0;
            console.log(`🎨 [OtpRouteSelector] Route ${mappedRouteId}: OTP direction ${route.directionId} → Flipped to ${flippedDirection} (dir0: ${dir0Score}, dir1: ${dir1Score}, from: "${route.fromStop}", to: "${route.toStop}")`);
          } else {
            flippedDirection = route.directionId;
            console.log(`🎨 [OtpRouteSelector] Route ${mappedRouteId}: OTP direction ${route.directionId} is correct (dir0: ${dir0Score}, dir1: ${dir1Score}, from: "${route.fromStop}", to: "${route.toStop}")`);
          }
          
          // Update the overlay if it's already displayed
          const overlayKey = `${mappedRouteId}-${flippedDirection}`;
          if (window.activeRouteOverlays && window.activeRouteOverlays[overlayKey]) {
            // Direction was verified, overlay is already correct
          } else {
            // If overlay exists with wrong direction, update it
            const oldKey = `${mappedRouteId}-${route.directionId === 0 ? 1 : 0}`;
            if (window.activeRouteOverlays && window.activeRouteOverlays[oldKey]) {
              window.activeRouteOverlays[oldKey].remove();
              delete window.activeRouteOverlays[oldKey];
              if (typeof window.showRouteOverlay === 'function') {
                window.showRouteOverlay(mappedRouteId, flippedDirection);
              }
            }
          }
        }
      }).catch(err => {
        console.warn(`🎨 [OtpRouteSelector] Could not verify direction for route ${mappedRouteId}, using default flip logic:`, err);
        // Fallback to default flip logic
        flippedDirection = needsFlip ? (route.directionId === 0 ? 1 : 0) : route.directionId;
      });
      
      // Use default flip logic initially (will be corrected by Promise above if route data loads)
      // BUT: Only flip if we're confident the direction needs flipping
      // If direction was calculated correctly in calculateDirection, don't flip
      flippedDirection = needsFlip ? (route.directionId === 0 ? 1 : 0) : route.directionId;
    } else if (needsFlip) {
      // Default: Flip for buses/rail
      // However, if the direction was calculated correctly in calculateDirection (not defaulted),
      // we should trust it and NOT flip it
      if (route.directionCalculated) {
        // Direction was calculated, trust it
        flippedDirection = route.directionId;
        console.log(`🎨 [OtpRouteSelector] Route ${mappedRouteId}: Direction was calculated (${route.directionId}), not flipping`);
      } else {
        // Direction was defaulted, flip it
        flippedDirection = route.directionId === 0 ? 1 : 0;
        console.log(`🎨 [OtpRouteSelector] Route ${mappedRouteId}: Direction was defaulted (${route.directionId}), flipping to ${flippedDirection}`);
      }
    } else {
      // Don't flip for subways/metro
      flippedDirection = route.directionId;
    }
    
    // Track active state (use flipped direction for key since we flip when showing)
    let isActive = false;
    const overlayKey = `${mappedRouteId}-${flippedDirection}`;
    
    // Check if route is already active
    if (window.activeRouteOverlays && window.activeRouteOverlays[overlayKey]) {
      isActive = true;
      button.style.border = '3px solid #fff';
      button.style.boxShadow = `0 0 12px ${route.color}, 0 0 6px #fff`;
    }
    
    // Click handler - toggle route overlay or show branch selection for route groups
    button.onclick = () => {
      console.log('🎨 [OtpRouteSelector] Clicked route:', mappedRouteId, '(original:', route.routeId, ')');
      
      // Check if this is a route group (Red, Green)
      if (window.isRouteGroup && window.isRouteGroup(mappedRouteId)) {
        // Show branch selection menu
        showOtpBranchSelection(mappedRouteId, route, button, buttonsContainer);
        return;
      }
      
      // Regular route - show overlay directly
      console.log('🎨 [OtpRouteSelector] Mode:', route.mode, 'OTP direction:', route.directionId, needsFlip ? `→ Flipped to: ${flippedDirection}` : `(no flip needed: ${flippedDirection})`);
      
      // ⚠️ CRITICAL: Clear ALL bus markers and overlays first
      // Clear home.html bus markers (but keep OTP mode active)
      if (typeof window.fetchAndDisplayBuses === 'function') {
        window.fetchAndDisplayBuses([]);
      }
      
      // Clear ALL route overlays (removes their bus markers too)
      if (typeof window.clearAllRouteOverlays === 'function') {
        window.clearAllRouteOverlays();
      }
      
      // Also manually clear activeRouteOverlays
      if (window.activeRouteOverlays) {
        window.activeRouteOverlays = {};
      }
      
      // ⚠️ IMPORTANT: Keep OTP trip active (prevents "all buses" mode)
      // Don't clear activeTripSelected - we want route overlays to manage buses
      window.activeTripSelected = true;
      
      // Show route overlay using existing system (use mapped route ID, flipped direction)
      if (typeof window.showRouteOverlay === 'function') {
        window.showRouteOverlay(mappedRouteId, flippedDirection);
        
        // Update button state after a short delay (to let overlay system update)
        setTimeout(() => {
          const nowActive = window.activeRouteOverlays && window.activeRouteOverlays[overlayKey];
          if (nowActive) {
            button.style.border = '3px solid #fff';
            button.style.boxShadow = `0 0 12px ${route.color}, 0 0 6px #fff`;
            isActive = true;
          } else {
            button.style.border = `3px solid ${route.color}`;
            button.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.4)';
            isActive = false;
          }
        }, 100);
      } else {
        console.error('🎨 [OtpRouteSelector] showRouteOverlay not available');
        alert('Route overlay system not ready. Please refresh the page.');
      }
    };
    
    buttonsContainer.appendChild(button);
    console.log(`🎨 [showOtpRouteSelector] ✅ Button ${idx + 1} appended to container (routeId="${mappedRouteId}")`);
  });
  
  console.log('🎨 [showOtpRouteSelector] Total buttons in container:', buttonsContainer.children.length);
  modal.appendChild(buttonsContainer);
  console.log('🎨 [showOtpRouteSelector] ✅ buttonsContainer appended to modal');
  
  // Mobile responsiveness
  const mediaQuery = window.matchMedia('(max-width: 768px)');
  function handleMobileView(e) {
    if (e.matches) {
      // Mobile: smaller squares, adjust layout
      if (!isCollapsed) {
        modal.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(20, 20, 20, 0.95);
          border: 3px solid #555;
          border-radius: 12px;
          padding: 12px;
          z-index: 10000;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          transition: all 0.3s ease;
          max-width: 90vw;
        `;
        buttonsContainer.style.gap = '8px';
        // Make buttons slightly smaller on mobile
        document.querySelectorAll('#otpRouteButtonsContainer button').forEach(btn => {
          btn.style.width = '50px';
          btn.style.height = '50px';
          btn.style.fontSize = '10px';
        });
      } else {
        // Collapsed on mobile: bottom right
        modal.style.cssText = `
          position: fixed;
          bottom: 20px;
          right: 20px;
          transform: none;
          background: rgba(20, 20, 20, 0.95);
          border: 3px solid #555;
          border-radius: 12px;
          padding: 10px 8px;
          z-index: 10000;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          transition: all 0.3s ease;
        `;
      }
    } else {
      // Desktop: restore original sizes
      if (!isCollapsed) {
        document.querySelectorAll('#otpRouteButtonsContainer button').forEach(btn => {
          btn.style.width = '60px';
          btn.style.height = '60px';
          btn.style.fontSize = '11px';
        });
      }
    }
  }
  handleMobileView(mediaQuery);
  mediaQuery.addEventListener('change', handleMobileView);
  
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

