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
    
    // Render path for ALL legs (including walking)
    // For transit legs: Load actual route shape data (FULL route, not clipped)
    // For walking legs: Get actual walking path using OSRM
    let coords = [];
    let routeShapeInfo = null; // Store info about where to split for solid/dashed later
    
    console.log(`[showRoute] Processing ${leg.mode} leg ${legIndex}:`, {
      mode: leg.mode,
      route: leg.route,
      direction: leg.direction,
      hasFromPlace: !!(leg.fromPlace && leg.fromPlace.latitude),
      hasToPlace: !!(leg.toPlace && leg.toPlace.latitude)
    });
    
    if (leg.mode !== 'WALK' && leg.route && leg.direction !== undefined) {
      // Transit leg: Load actual route shape (FULL route)
      console.log(`[showRoute] Loading route shape for ${leg.mode} leg ${legIndex}, route ${leg.route}, direction ${leg.direction}`);
      
      try {
        // Use window.getRouteData if available
        if (typeof window.getRouteData !== 'function') {
          throw new Error('getRouteData function not available');
        }
        
        console.log(`[showRoute] Calling getRouteData(${leg.route}, ${leg.direction})`);
        const routeData = await window.getRouteData(leg.route, leg.direction);
        console.log(`[showRoute] Route data loaded:`, {
          hasShape: !!(routeData && routeData.shape),
          shapeLength: routeData?.shape?.length || 0,
          hasStops: !!(routeData && routeData.stops),
          stopsLength: routeData?.stops?.length || 0
        });
        
        if (routeData && routeData.shape && Array.isArray(routeData.shape) && routeData.shape.length > 0) {
          // Use the FULL route shape (not clipped)
          coords = routeData.shape;
          console.log(`[showRoute] ✅ Using FULL route shape for route ${leg.route}, ${coords.length} points`);
          
          // Find start and end stops in the route for later solid/dashed styling
          const fromLat = leg.fromPlace?.latitude;
          const fromLon = leg.fromPlace?.longitude;
          const toLat = leg.toPlace?.latitude;
          const toLon = leg.toPlace?.longitude;
          
          if (fromLat && fromLon && toLat && toLon && routeData.stops && Array.isArray(routeData.stops)) {
            // Find closest stops to fromPlace and toPlace
            let startStopIdx = -1;
            let endStopIdx = -1;
            let minStartDist = Infinity;
            let minEndDist = Infinity;
            
            routeData.stops.forEach((stop, idx) => {
              if (stop.lat && stop.lon) {
                const distToStart = Math.sqrt(
                  Math.pow(stop.lat - fromLat, 2) + Math.pow(stop.lon - fromLon, 2)
                );
                const distToEnd = Math.sqrt(
                  Math.pow(stop.lat - toLat, 2) + Math.pow(stop.lon - toLon, 2)
                );
                
                if (distToStart < minStartDist) {
                  minStartDist = distToStart;
                  startStopIdx = idx;
                }
                if (distToEnd < minEndDist) {
                  minEndDist = distToEnd;
                  endStopIdx = idx;
                }
              }
            });
            
            // Find shape points closest to start and end stops (for solid/dashed split later)
            if (startStopIdx >= 0 && endStopIdx >= 0 && startStopIdx !== endStopIdx) {
              const actualStart = Math.min(startStopIdx, endStopIdx);
              const actualEnd = Math.max(startStopIdx, endStopIdx);
              
              const startStop = routeData.stops[actualStart];
              const endStop = routeData.stops[actualEnd];
              
              let startShapeIdx = 0;
              let endShapeIdx = routeData.shape.length - 1;
              let minStartShapeDist = Infinity;
              let minEndShapeDist = Infinity;
              
              routeData.shape.forEach((shapePoint, idx) => {
                if (shapePoint && shapePoint.length === 2) {
                  const distToStart = Math.sqrt(
                    Math.pow(shapePoint[0] - startStop.lat, 2) + Math.pow(shapePoint[1] - startStop.lon, 2)
                  );
                  const distToEnd = Math.sqrt(
                    Math.pow(shapePoint[0] - endStop.lat, 2) + Math.pow(shapePoint[1] - endStop.lon, 2)
                  );
                  
                  if (distToStart < minStartShapeDist) {
                    minStartShapeDist = distToStart;
                    startShapeIdx = idx;
                  }
                  if (distToEnd < minEndShapeDist) {
                    minEndShapeDist = distToEnd;
                    endShapeIdx = idx;
                  }
                }
              });
              
              // Store split points for solid/dashed styling (we'll use this later)
              routeShapeInfo = {
                startShapeIdx: Math.min(startShapeIdx, endShapeIdx),
                endShapeIdx: Math.max(startShapeIdx, endShapeIdx),
                startStopIdx: actualStart,
                endStopIdx: actualEnd
              };
              console.log(`[showRoute] Found stop indices: ${actualStart} to ${actualEnd}, shape indices: ${routeShapeInfo.startShapeIdx} to ${routeShapeInfo.endShapeIdx}`);
            }
          }
        } else {
          console.warn(`[showRoute] ❌ Route ${leg.route} has no shape data, falling back to straight line`);
          // Fallback to straight line
          if (leg.fromPlace && leg.toPlace && leg.fromPlace.latitude && leg.fromPlace.longitude && leg.toPlace.latitude && leg.toPlace.longitude) {
            coords = [
              [leg.fromPlace.latitude, leg.fromPlace.longitude],
              [leg.toPlace.latitude, leg.toPlace.longitude]
            ];
          }
        }
      } catch (error) {
        console.error(`[showRoute] ❌ Error loading route shape for ${leg.route}:`, error);
        console.error(`[showRoute] Error details:`, error.message, error.stack);
        // Fallback to straight line
        if (leg.fromPlace && leg.toPlace && leg.fromPlace.latitude && leg.fromPlace.longitude && leg.toPlace.latitude && leg.toPlace.longitude) {
          coords = [
            [leg.fromPlace.latitude, leg.fromPlace.longitude],
            [leg.toPlace.latitude, leg.toPlace.longitude]
          ];
        }
      }
    } else if (leg.mode === 'WALK' && leg.fromPlace && leg.toPlace) {
      // Walking leg: Get actual walking path using OSRM (free routing service)
      const fromLat = leg.fromPlace.latitude;
      const fromLon = leg.fromPlace.longitude;
      const toLat = leg.toPlace.latitude;
      const toLon = leg.toPlace.longitude;
      
      if (fromLat && fromLon && toLat && toLon) {
        try {
          // Use OSRM (Open Source Routing Machine) for walking directions
          // OSRM demo server: http://router.project-osrm.org
          const osrmUrl = `https://router.project-osrm.org/route/v1/walking/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;
          
          const response = await fetch(osrmUrl);
          if (response.ok) {
            const data = await response.json();
            if (data.code === 'Ok' && data.routes && data.routes.length > 0 && data.routes[0].geometry) {
              // OSRM returns coordinates in [lng, lat] format
              const geometry = data.routes[0].geometry.coordinates;
              // Convert to [lat, lng] format to match our system
              coords = geometry.map(coord => [coord[1], coord[0]]);
              console.log(`[showRoute] Using OSRM walking path for leg ${legIndex}, ${coords.length} points`);
            } else {
              throw new Error('OSRM returned no route');
            }
          } else {
            throw new Error(`OSRM request failed: ${response.status}`);
          }
        } catch (error) {
          console.warn(`[showRoute] Error getting walking path from OSRM:`, error, 'Falling back to straight line');
          // Fallback to straight line
          coords = [
            [fromLat, fromLon],
            [toLat, toLon]
          ];
        }
      } else {
        console.warn(`[showRoute] No coordinates available for walking leg ${legIndex}`);
      }
    } else {
      // No route and not walking: Use straight line
      if (leg.fromPlace && leg.toPlace && leg.fromPlace.latitude && leg.fromPlace.longitude && leg.toPlace.latitude && leg.toPlace.longitude) {
        coords = [
          [leg.fromPlace.latitude, leg.fromPlace.longitude],
          [leg.toPlace.latitude, leg.toPlace.longitude]
        ];
        console.log(`[showRoute] Using fromPlace/toPlace coordinates for ${leg.mode} leg ${legIndex}`);
      } else {
        console.warn(`[showRoute] No coordinates available for ${leg.mode} leg ${legIndex}`);
      }
    }
    
    // Render path for all legs with geometry (walking and transit)
    if (coords.length) {
      console.log(`[showRoute] Rendering ${leg.mode} leg ${legIndex} with ${coords.length} coordinates`);
      if (coords.length === 2) {
        console.warn(`[showRoute] ⚠️ Only 2 coordinates (straight line fallback) for ${leg.mode} leg ${legIndex}`);
      }
      
      // Convert coordinates to [lng, lat] format for MapLibre GL JS
      const lineCoords = coords.map(coord => [coord[1], coord[0]]);
      
      // Adjust line style based on mode
      const lineWidth = leg.mode === 'WALK' ? 3 : 4; // Slightly thinner for walking
      const lineOpacity = leg.mode === 'WALK' ? 0.6 : 0.7;
      const dashArray = leg.mode === 'WALK' ? [5, 5] : null; // Dashed for walking
      
      // Create a unique source and layer ID for this line
      const lineId = `routeLeg-${legIndex}`;
      
      map.addSource(lineId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {
            mode: leg.mode,
            legIndex: legIndex
          },
          geometry: {
            type: 'LineString',
            coordinates: lineCoords
          }
        }
      });
      
      const layerPaint = {
        'line-color': color,
        'line-width': lineWidth,
        'line-opacity': lineOpacity
      };
      
      // Add dash array for walking segments
      if (dashArray) {
        layerPaint['line-dasharray'] = dashArray;
      }
      
      map.addLayer({
        id: lineId,
        type: 'line',
        source: lineId,
        paint: layerPaint
      });
      
      // Store the layer ID for removal
      if (!window.routeLegLines) {
        window.routeLegLines = [];
      }
      window.routeLegLines.push(lineId);
      allCoords = allCoords.concat(coords);
    }
    
    legIndex++;
    
    // Collect route information for bus tracking (skip WALK legs)
    if (leg.mode !== 'WALK' && routeNumber) {
      console.log('[showRoute] Found transit leg:', leg, 'with processed route number:', routeNumber);
      
      // Retrieve the direction that was already calculated in the first block
      // This ensures both legs use the same fixed direction matching logic
      let direction = 0; // Default fallback
      if (legKey && legColorMapping[legKey]) {
        direction = legColorMapping[legKey].direction;
        console.log('[showRoute] ✅ Reusing direction from legColorMapping for leg:', legIndex, 'route:', routeNumber, 'direction:', direction, 'legKey:', legKey);
      } else {
        console.warn('[showRoute] ⚠️ WARNING: Could not find direction in legColorMapping for legKey:', legKey, '- route:', routeNumber, '- Using default 0');
        console.warn('[showRoute] Available legKeys:', Object.keys(legColorMapping));
      }
      
      routesToTrack.push({
        route_id: routeNumber, // Use the processed route number, not leg.route
        direction_id: direction, // Use the direction from legColorMapping (already calculated in first block)
        mode: leg.mode
      });
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
  
  // Start tracking buses for the routes in this trip
  if (routesToTrack.length > 0) {
    console.log('[showRoute] Tracking buses for routes:', routesToTrack);
    
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

