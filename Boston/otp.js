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
            line {
              publicCode
              name
            }
            serviceJourney {
              id
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
  window.currentLegColorMapping = null;
  
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
          const normalizedMode = leg.mode === 'bus' ? 'BUS' : (leg.mode === 'walk' || leg.mode === 'foot') ? 'WALK' : leg.mode.toUpperCase();
          
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
          
          return convertedLeg;
        })
      };
      return itinerary;
    });

    // Store converted itineraries globally
    currentItins = convertedItineraries;
    window.currentItins = convertedItineraries; // Also set on window for compatibility
    console.log('Converted itineraries:', currentItins);
    
    // Enhanced OTP route debugging
    console.log('=== OTP ROUTE ANALYSIS (GraphQL) ===');
    convertedItineraries.forEach((itin, idx) => {
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
    
    renderItinListVisual(convertedItineraries);

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
      } else {
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
      let modeTxt = (leg.mode === 'WALK' || leg.mode === 'FOOT') ? 'Walk' : leg.mode === 'BUS' ? 'Bus' : leg.mode === 'TRAIN' ? 'Train' : leg.mode;
      let lineInfo = '';
      if (leg.mode === 'BUS' && leg.route) {
        // Use route data from OTP GraphQL response
        const routeNumber = leg.routeShortName || leg.route;
        const routeName = leg.routeLongName || routeNumber;
        
        // Check if we have live bus info for this route
        let busNumbers = '';
        if (window.otpBusInfo && window.otpBusInfo[leg.route]) {
          const buses = window.otpBusInfo[leg.route];
          busNumbers = buses.map(b => b.vehicleID).join(', ');
          lineInfo = ` <b>Bus ${routeNumber} (${busNumbers}) - ${routeName}</b>`;
        } else {
          lineInfo = ` <b>Bus ${routeNumber} - ${routeName}</b>`;
        }
      } else if (leg.route) {
        lineInfo = ` <b>${leg.route}</b>`;
      }
      // PHASE 1: Fix references to non-existent fields
      // leg.startTime and leg.endTime don't exist - use itinerary times or omit
      // leg.intermediateStops doesn't exist - omit
      // leg.info doesn't exist - omit
      let fromTime = ''; // Not available at leg level
      let toTime = ''; // Not available at leg level
      let stopTimes = ''; // intermediateStops not in schema
      // Note: Times are at tripPattern level, not leg level
      
      return `<div>
        → <b>${modeTxt}${lineInfo}</b>
        <span style="color:#ffc107;">${Math.round((leg.duration||0)/60)} min</span><br>
        <span style="font-size:0.96em; color:#aaa;">
          ${fromTime ? `Depart: <b>${fromTime}</b>` : ''}${fromTime && toTime ? ' | ' : ''}${toTime ? `Arrive: <b>${toTime}</b>` : ''}
        </span>
        ${stopTimes}
      </div>`;
    }).join('<hr style="border:0; border-top:1px solid #222; margin:5px 0 4px 0">');
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

// Export functions and variables to window for global access
window.fetchAndShowOtpItineraries = fetchAndShowOtpItineraries;
window.renderItinListVisual = renderItinListVisual;
window.decodePolyline = decodePolyline;

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

