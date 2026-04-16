// === HYBRID ROUTE MAPPING SYSTEM ===
// Combines direct OTP ID usage with intelligent fallbacks and validation

// Cache for route validation and mapping results
const hybridRouteCache = new Map();

// Function to validate route exists in TriMet system
async function validateRouteInSystem(routeId, apiKey) {
  const cacheKey = `validate_${routeId}`;
  
  if (hybridRouteCache.has(cacheKey)) {
    return hybridRouteCache.get(cacheKey);
  }
  
  try {
    // Method 1: Check masterRoutes (fastest)
    if (typeof masterRoutes !== 'undefined' && masterRoutes && masterRoutes.length > 0) {
      const exists = masterRoutes.some(route => route.route_id === routeId);
      if (exists) {
        hybridRouteCache.set(cacheKey, { exists: true, source: 'masterRoutes' });
        return { exists: true, source: 'masterRoutes' };
      }
    }
    
    // Method 2: Check TriMet API (slower but more reliable)
    const res = await fetch(`https://developer.trimet.org/ws/v2/vehicles?appID=${apiKey}&json=true`);
    const data = await res.json();
    const allBuses = data.resultSet.vehicle || [];
    
    const routeExists = allBuses.some(bus => bus.routeNumber === routeId);
    const result = { exists: routeExists, source: 'api' };
    hybridRouteCache.set(cacheKey, result);
    return result;
    
  } catch (error) {
    console.error('[validateRouteInSystem] Error validating route:', routeId, error);
    const result = { exists: false, source: 'error' };
    hybridRouteCache.set(cacheKey, result);
    return result;
  }
}

// Function to extract route number from various OTP fields
function extractRouteNumber(otpLeg) {
  // Priority 1: Direct route ID
  if (otpLeg.route && !isNaN(otpLeg.route)) {
    return { number: otpLeg.route, source: 'direct_route_id' };
  }
  
  // Priority 2: Route short name
  if (otpLeg.routeShortName && !isNaN(otpLeg.routeShortName)) {
    return { number: otpLeg.routeShortName, source: 'route_short_name' };
  }
  
  // Priority 3: Extract from route long name
  if (otpLeg.routeLongName) {
    const numberMatch = otpLeg.routeLongName.match(/(\d+)/);
    if (numberMatch) {
      return { number: numberMatch[1], source: 'extracted_from_long_name' };
    }
  }
  
  return { number: null, source: 'no_number_found' };
}

// Function to map special route names
function mapSpecialRoute(routeName) {
  const specialMappings = {
    'Blue': '100',
    'Red': '200',
    'Green': '290',
    'Yellow': '290',
    'Orange': '290',
    'FX2': 'FX2',
    'Blue Eastside Bus': '287',
    'Blue Westside Bus': '288',
    'Orange Bus': '291',
    'Red Bus': '292',
    'Yellow Bus': '293'
  };
  
  for (const [name, routeId] of Object.entries(specialMappings)) {
    if (routeName && routeName.includes(name)) {
      return { routeId: routeId, source: 'special_mapping' };
    }
  }
  
  return { routeId: null, source: 'no_special_mapping' };
}

// Main hybrid route mapping function
async function mapOtpRouteHybrid(otpLeg, apiKey) {
  console.log('[mapOtpRouteHybrid] Processing OTP leg:', otpLeg);
  
  // Handle walking legs
  if (otpLeg.mode === 'WALK') {
    return { 
      routeId: 'WALK', 
      isValid: true, 
      confidence: 'high', 
      source: 'walking',
      details: 'Walking leg'
    };
  }
  
  // Step 1: Try direct route number extraction
  const extracted = extractRouteNumber(otpLeg);
  if (extracted.number) {
    console.log('[mapOtpRouteHybrid] Extracted route number:', extracted.number, 'from', extracted.source);
    
    const validation = await validateRouteInSystem(extracted.number, apiKey);
    if (validation.exists) {
      return {
        routeId: extracted.number,
        isValid: true,
        confidence: 'high',
        source: extracted.source,
        details: `Validated via ${validation.source}`
      };
    } else {
      console.warn('[mapOtpRouteHybrid] Extracted route number not found in system:', extracted.number);
    }
  }
  
  // Step 2: Try special route mapping
  if (otpLeg.routeLongName) {
    const specialMapping = mapSpecialRoute(otpLeg.routeLongName);
    if (specialMapping.routeId) {
      console.log('[mapOtpRouteHybrid] Special mapping found:', specialMapping.routeId, 'from', specialMapping.source);
      
      const validation = await validateRouteInSystem(specialMapping.routeId, apiKey);
      if (validation.exists) {
        return {
          routeId: specialMapping.routeId,
          isValid: true,
          confidence: 'medium',
          source: specialMapping.source,
          details: `Validated via ${validation.source}`
        };
      } else {
        console.warn('[mapOtpRouteHybrid] Special mapped route not found in system:', specialMapping.routeId);
      }
    }
  }
  
  // Step 3: Try street name mapping (lower confidence)
  if (otpLeg.routeLongName) {
    const streetMappings = {
      'Burnside': '20', 'Stark': '15', 'Sandy': '12', 'Barbur': '12',
      'Macadam': '35', 'Greeley': '35', 'Division': '20', 'Hawthorne': '14',
      'Belmont': '15', 'Morrison': '15', 'Washington': '15', 'Powell': '9',
      'Foster': '9', 'Woodstock': '9', 'Holgate': '9', 'Johnson Creek': '9',
      'Cesar Chavez': '9', '82nd': '72', '122nd': '73', '162nd': '74',
      '52nd': '71', '39th': '70', '28th': '70', '21st': '70', '15th': '70',
      '12th': '70', '9th': '70', '6th': '70', '3rd': '70', '1st': '70',
      'MLK': '6', 'Grand': '6', 'Interstate': '6', 'Lombard': '6',
      'Killingsworth': '6', 'Rosa Parks': '6', 'Columbia': '6', 'Vancouver': '6',
      'Williams': '6', 'Mississippi': '6', 'Alberta': '6', 'Fremont': '6',
      'Beaumont': '6', 'Prescott': '6', 'Klickitat': '6', 'Knott': '6',
      'Ainsworth': '6', 'Skidmore': '6', 'Going': '6', 'Tillamook': '6',
      'Russell': '6', 'Shaver': '6'
    };
    
    for (const [streetName, routeId] of Object.entries(streetMappings)) {
      if (otpLeg.routeLongName.toLowerCase().includes(streetName.toLowerCase())) {
        const validation = await validateRouteInSystem(routeId, apiKey);
        if (validation.exists) {
          return {
            routeId: routeId,
            isValid: true,
            confidence: 'low',
            source: 'street_mapping',
            details: `Street "${streetName}" mapped to route ${routeId}, validated via ${validation.source}`
          };
        }
      }
    }
  }
  
  // No mapping found
  console.warn('[mapOtpRouteHybrid] No valid mapping found for:', otpLeg);
  return {
    routeId: null,
    isValid: false,
    confidence: 'none',
    source: 'no_mapping',
    details: 'No mapping strategy succeeded'
  };
}

// Function to process entire itinerary with hybrid mapping
async function processItineraryHybrid(itinerary, apiKey) {
  console.log('[processItineraryHybrid] Processing itinerary with', itinerary.legs.length, 'legs');
  
  const mappedLegs = [];
  const summary = {
    totalLegs: itinerary.legs.length,
    validMappings: 0,
    invalidMappings: 0,
    confidenceBreakdown: { high: 0, medium: 0, low: 0, none: 0 }
  };
  
  for (let i = 0; i < itinerary.legs.length; i++) {
    const leg = itinerary.legs[i];
    const mapping = await mapOtpRouteHybrid(leg, apiKey);
    
    mappedLegs.push({
      originalLeg: leg,
      mapping: mapping,
      legIndex: i
    });
    
    // Update summary
    if (mapping.isValid) {
      summary.validMappings++;
      summary.confidenceBreakdown[mapping.confidence]++;
    } else {
      summary.invalidMappings++;
    }
    
    console.log(`[processItineraryHybrid] Leg ${i}: ${leg.mode} -> ${mapping.routeId} (confidence: ${mapping.confidence}, source: ${mapping.source})`);
  }
  
  console.log('[processItineraryHybrid] Mapping summary:', summary);
  return { mappedLegs, summary };
}

// Function to get routes for bus tracking with confidence levels
function getRoutesForTrackingWithConfidence(mappedLegs) {
  const routesToTrack = [];
  const confidenceGroups = { high: [], medium: [], low: [] };
  
  mappedLegs.forEach(mappedLeg => {
    if (mappedLeg.mapping.isValid && mappedLeg.mapping.routeId !== 'WALK') {
      const routeInfo = {
        route_id: mappedLeg.mapping.routeId,
        direction_id: mappedLeg.originalLeg.direction || 0,
        mode: mappedLeg.originalLeg.mode,
        confidence: mappedLeg.mapping.confidence,
        source: mappedLeg.mapping.source,
        details: mappedLeg.mapping.details,
        legIndex: mappedLeg.legIndex
      };
      
      routesToTrack.push(routeInfo);
      
      // Group by confidence
      if (mappedLeg.mapping.confidence in confidenceGroups) {
        confidenceGroups[mappedLeg.mapping.confidence].push(routeInfo);
      }
    }
  });
  
  console.log('[getRoutesForTrackingWithConfidence] Routes to track:', routesToTrack);
  console.log('[getRoutesForTrackingWithConfidence] Confidence breakdown:', confidenceGroups);
  
  return { routesToTrack, confidenceGroups };
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mapOtpRouteHybrid,
    processItineraryHybrid,
    getRoutesForTrackingWithConfidence,
    validateRouteInSystem,
    extractRouteNumber,
    mapSpecialRoute
  };
} else {
  window.mapOtpRouteHybrid = mapOtpRouteHybrid;
  window.processItineraryHybrid = processItineraryHybrid;
  window.getRoutesForTrackingWithConfidence = getRoutesForTrackingWithConfidence;
  window.validateRouteInSystem = validateRouteInSystem;
  window.extractRouteNumber = extractRouteNumber;
  window.mapSpecialRoute = mapSpecialRoute;
} 