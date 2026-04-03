/**
 * MBTA realtime helpers: GTFS-RT protobuf decode + V3 JSON API.
 * Load before routeOverlay.js. Exposes window.MBTARealtime and window.mbtaAdapter.
 */
"use strict";

// === GTFS-RT Parser Functions (for MBTA) ===
function parseVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let byte;
  do {
    if (pos >= buf.length) throw new Error('Buffer overflow');
    byte = buf[pos++];
    result |= (byte & 0x7F) << shift;
    shift += 7;
  } while (byte & 0x80);
  return { value: result, pos };
}

function readString(buf, pos, length) {
  const bytes = buf.slice(pos, pos + length);
  return new TextDecoder('utf-8').decode(bytes);
}

function readFloat(buf, pos) {
  const view = new DataView(buf.buffer, buf.byteOffset + pos, 4);
  return view.getFloat32(0, true);
}

function skipField(buf, pos, wireType) {
  if (wireType === 0) {
    const { pos: newPos } = parseVarint(buf, pos);
    return newPos;
  } else if (wireType === 1) {
    return pos + 8;
  } else if (wireType === 2) {
    const { value: length, pos: lengthPos } = parseVarint(buf, pos);
    return lengthPos + length;
  } else if (wireType === 5) {
    return pos + 4;
  }
  return pos;
}

// Parse MBTA GTFS-RT TripUpdates feed (minimal decoder)
// Returns { updatesByStopId, updatesByTripId }
function parseMBTAGTFSTripUpdates(buffer) {
  const uint8Buffer = new Uint8Array(buffer);
  let pos = 0;
  const updatesByStopId = Object.create(null);
  const updatesByTripId = Object.create(null);

  const parseTripDescriptor = (buf, start, end) => {
    let p = start;
    const out = { tripId: null, routeId: null, directionId: null, startDate: null, startTime: null };
    while (p < end) {
      const tag = buf[p++];
      if (!tag) break;
      const fieldNum = tag >> 3;
      const wireType = tag & 0x07;
      if (wireType === 2) {
        const { value: len, pos: lenPos } = parseVarint(buf, p);
        const s = lenPos;
        const e = s + len;
        if (fieldNum === 1) out.tripId = readString(buf, s, len);
        else if (fieldNum === 2) out.startTime = readString(buf, s, len);
        else if (fieldNum === 3) out.startDate = readString(buf, s, len);
        else if (fieldNum === 5) out.routeId = readString(buf, s, len);
        p = e;
      } else if (wireType === 0) {
        const { value, pos: newPos } = parseVarint(buf, p);
        if (fieldNum === 6) out.directionId = value;
        p = newPos;
      } else {
        p = skipField(buf, p, wireType);
      }
    }
    return out;
  };

  const parseStopTimeEvent = (buf, start, end) => {
    let p = start;
    const out = { time: null, delay: null };
    while (p < end) {
      const tag = buf[p++];
      if (!tag) break;
      const fieldNum = tag >> 3;
      const wireType = tag & 0x07;
      if (wireType === 0) {
        const { value, pos: newPos } = parseVarint(buf, p);
        if (fieldNum === 1) out.delay = value;
        if (fieldNum === 2) out.time = value;
        p = newPos;
      } else {
        p = skipField(buf, p, wireType);
      }
    }
    return out;
  };

  const parseStopTimeUpdate = (buf, start, end) => {
    let p = start;
    const out = { stopId: null, stopSequence: null, arrival: null, departure: null };
    while (p < end) {
      const tag = buf[p++];
      if (!tag) break;
      const fieldNum = tag >> 3;
      const wireType = tag & 0x07;
      if (wireType === 0) {
        const { value, pos: newPos } = parseVarint(buf, p);
        if (fieldNum === 1) out.stopSequence = value;
        p = newPos;
      } else if (wireType === 2) {
        const { value: len, pos: lenPos } = parseVarint(buf, p);
        const s = lenPos;
        const e = s + len;
        if (fieldNum === 4) out.stopId = readString(buf, s, len);
        else if (fieldNum === 2) out.arrival = parseStopTimeEvent(buf, s, e);
        else if (fieldNum === 3) out.departure = parseStopTimeEvent(buf, s, e);
        p = e;
      } else {
        p = skipField(buf, p, wireType);
      }
    }
    return out;
  };

  const parseTripUpdate = (buf, start, end) => {
    let p = start;
    const out = { trip: null, stopTimeUpdates: [] };
    while (p < end) {
      const tag = buf[p++];
      if (!tag) break;
      const fieldNum = tag >> 3;
      const wireType = tag & 0x07;
      if (wireType === 2) {
        const { value: len, pos: lenPos } = parseVarint(buf, p);
        const s = lenPos;
        const e = s + len;
        if (fieldNum === 1) out.trip = parseTripDescriptor(buf, s, e);
        else if (fieldNum === 3) out.stopTimeUpdates.push(parseStopTimeUpdate(buf, s, e));
        p = e;
      } else {
        p = skipField(buf, p, wireType);
      }
    }
    return out;
  };

  const parseFeedEntity = (buf, start, end) => {
    let p = start;
    let tripUpdate = null;
    while (p < end) {
      const tag = buf[p++];
      if (!tag) break;
      const fieldNum = tag >> 3;
      const wireType = tag & 0x07;
      if (fieldNum === 3 && wireType === 2) {
        const { value: len, pos: lenPos } = parseVarint(buf, p);
        const s = lenPos;
        const e = s + len;
        tripUpdate = parseTripUpdate(buf, s, e);
        p = e;
      } else {
        p = skipField(buf, p, wireType);
      }
    }
    return tripUpdate;
  };

  // FeedMessage: field 1 header (skip), field 2 entity (repeated)
  while (pos < uint8Buffer.length) {
    const tag = uint8Buffer[pos++];
    if (!tag) break;
    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;
    if (fieldNum === 1) {
      pos = skipField(uint8Buffer, pos, wireType);
      continue;
    }
    if (fieldNum !== 2 || wireType !== 2) {
      pos = skipField(uint8Buffer, pos, wireType);
      continue;
    }
    const { value: entityLen, pos: lenPos } = parseVarint(uint8Buffer, pos);
    const entityStart = lenPos;
    const entityEnd = entityStart + entityLen;
    if (entityEnd > uint8Buffer.length) break;

    const tu = parseFeedEntity(uint8Buffer, entityStart, entityEnd);
    if (!tu || !tu.trip || !tu.trip.tripId) {
      pos = entityEnd;
      continue;
    }

    updatesByTripId[tu.trip.tripId] = tu;

    tu.stopTimeUpdates.forEach(stu => {
      if (!stu || !stu.stopId) return;
      if (!updatesByStopId[stu.stopId]) updatesByStopId[stu.stopId] = [];
      const time = (stu.arrival && stu.arrival.time) || (stu.departure && stu.departure.time) || null;
      const delay = (stu.arrival && stu.arrival.delay) || (stu.departure && stu.departure.delay) || null;
      if (!time && time !== 0) return;
      updatesByStopId[stu.stopId].push({
        tripId: tu.trip.tripId,
        routeId: tu.trip.routeId || null,
        directionId: tu.trip.directionId,
        time: time,
        delay: delay
      });
    });

    pos = entityEnd;
  }

  // Sort stop updates by time ascending
  Object.keys(updatesByStopId).forEach(stopId => {
    updatesByStopId[stopId].sort((a, b) => (a.time || 0) - (b.time || 0));
  });

  return { updatesByStopId, updatesByTripId };
}

// === MBTA V3 API Functions ===

/**
 * Fetch MBTA V3 predictions (ETAs) for a route and direction
 * Builds stopETAs and vehicleInfo lookups for per-stop ETAs and occupancy
 * @param {string} routeId - Route ID (e.g., "7", "15")
 * @param {number} directionId - Direction ID (0 or 1)
 * @returns {Promise<{predictions: Array, stopETAs: Object, vehicleInfo: Object}>}
 */
async function fetchMBTAV3Predictions(routeId, directionId) {
  try {
    const routeParam = encodeURIComponent(String(routeId));
    const url = `https://maps.metrofeedus.com/api/mbta/v3/predictions?filter[route]=${routeParam}&filter[direction_id]=${directionId}&include=stop,vehicle`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    
    if (!response.ok) {
      throw new Error(`V3 predictions HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Parse JSON:API format
    const stopsMap = {};
    const vehicleInfo = {}; // { vehicleId: { occupancy_status, label, updated_at } }
    
    // Build stop lookup and vehicle info from included items
    const stopIdByName = {}; // Reverse lookup: stopName -> stopId (for fallback matching)
    if (data.included) {
      data.included.forEach(item => {
        if (item.type === 'stop' && item.attributes) {
          stopsMap[item.id] = item.attributes.name || item.id;
          // Build reverse lookup by normalized name
          // Normalize: lowercase, trim, collapse multiple spaces
          let normalizedName = (item.attributes.name || '').toLowerCase().trim().replace(/\s+/g, ' ');
          if (normalizedName) {
            stopIdByName[normalizedName] = item.id;
          }
        }
        if (item.type === 'vehicle' && item.attributes) {
          vehicleInfo[item.id] = {
            occupancy_status: item.attributes.occupancy_status || 'Unknown',
            label: item.attributes.label || item.id,
            updated_at: item.attributes.updated_at || null
          };
        }
      });
    }
    
    // Build stopETAs lookup: stopETAs[stopId] = [predictions...] (sorted soonest-first)
    const stopETAs = {};
    const now = new Date();
    const graceSeconds = 15; // Allow predictions up to 15 seconds in the past
    
    if (data.data && Array.isArray(data.data)) {
      data.data.forEach(pred => {
        if (!pred.attributes) return;
        
        // Get ETA: arrival_time if present, else departure_time
        const eta = pred.attributes.arrival_time || pred.attributes.departure_time;
        if (!eta) return; // Skip predictions with no ETA
        
        const etaDate = new Date(eta);
        // Only keep future predictions (with grace period)
        if (etaDate < (now - graceSeconds * 1000)) return;
        
        const stopId = pred.relationships?.stop?.data?.id;
        const vehicleId = pred.relationships?.vehicle?.data?.id;
        
        if (!stopId) return;
        
        // Initialize array for this stop if needed
        if (!stopETAs[stopId]) {
          stopETAs[stopId] = [];
        }
        
        stopETAs[stopId].push({
          eta: eta,
          etaDate: etaDate,
          vehicleId: vehicleId || null,
          occupancy: vehicleId ? (vehicleInfo[vehicleId]?.occupancy_status || 'Unknown') : 'Unknown'
        });
      });
    }
    
    // Sort each stop's predictions by ETA (soonest first)
    Object.keys(stopETAs).forEach(stopId => {
      stopETAs[stopId].sort((a, b) => a.etaDate - b.etaDate);
    });
    
    // Legacy predictions array for bulk display (keep for compatibility)
    const predictions = [];
    Object.keys(stopETAs).forEach(stopId => {
      stopETAs[stopId].forEach(pred => {
        predictions.push({
          stopId: stopId,
          stopName: stopsMap[stopId] || stopId || 'Unknown Stop',
          eta: pred.eta,
          occupancy: pred.occupancy,
          vehicleId: pred.vehicleId
        });
      });
    });
    predictions.sort((a, b) => new Date(a.eta) - new Date(b.eta));
    
    // Build vehicleETAs lookup: vehicleETAs[vehicleId] = [predictions...] (sorted soonest-first)
    const vehicleETAs = {};
    if (data.data && Array.isArray(data.data)) {
      console.log('[fetchMBTAV3Predictions] Building vehicleETAs lookup from', data.data.length, 'predictions');
      
      data.data.forEach(pred => {
        if (!pred.attributes) return;
        
        const eta = pred.attributes.arrival_time || pred.attributes.departure_time;
        if (!eta) return;
        
        const etaDate = new Date(eta);
        if (etaDate < (now - graceSeconds * 1000)) return;
        
        const stopId = pred.relationships?.stop?.data?.id;
        const vehicleId = pred.relationships?.vehicle?.data?.id;
        
        if (!stopId || !vehicleId) return;
        
        if (!vehicleETAs[vehicleId]) {
          vehicleETAs[vehicleId] = [];
        }
        
        vehicleETAs[vehicleId].push({
          stopId: stopId,
          stopName: stopsMap[stopId] || stopId || 'Unknown Stop',
          eta: eta,
          etaDate: etaDate
        });
      });
      
      console.log('[fetchMBTAV3Predictions] Built vehicleETAs with', Object.keys(vehicleETAs).length, 'vehicles');
      console.log('[fetchMBTAV3Predictions] Sample vehicle IDs:', Object.keys(vehicleETAs).slice(0, 10));
    }
    
    // Sort each vehicle's predictions by ETA (soonest first)
    Object.keys(vehicleETAs).forEach(vehicleId => {
      vehicleETAs[vehicleId].sort((a, b) => a.etaDate - b.etaDate);
    });
    
    return { predictions, stopETAs, vehicleInfo, stopIdByName, vehicleETAs };
  } catch (error) {
    console.warn('[MBTA V3] Error fetching predictions:', error);
    throw error;
  }
}

/**
 * Fetch MBTA V3 vehicles for bus markers (primary source for V3-only mode)
 * @param {string} routeId - Route ID
 * @param {number} directionId - Direction ID (optional, for filtering)
 * @returns {Promise<Array>} Array of vehicles in GTFS-RT format
 */
async function fetchMBTAV3Vehicles(routeId, directionId = null) {
  const routeParam = encodeURIComponent(String(routeId));
  const url = `https://maps.metrofeedus.com/api/mbta/v3/vehicles?filter[route]=${routeParam}`;
  const debugV3 = true;
  const makeReqId = () => `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;

  const attemptFetch = async (timeoutMs) => {
    const reqId = makeReqId();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      if (debugV3) {
        console.log('[MBTA V3] Fetch start', { reqId, routeId, directionId, timeoutMs, url });
      }
      const response = await fetch(url, { signal: controller.signal });
      const elapsedMs = Date.now() - startedAt;
      if (debugV3) {
        let cache = null;
        try { cache = response.headers.get('cache-control'); } catch (_) {}
        console.log('[MBTA V3] Response headers', {
          reqId,
          status: response.status,
          statusText: response.statusText,
          elapsedMs,
          contentType: response.headers.get('content-type'),
          cacheControl: cache
        });
      }
      return { response, elapsedMs, reqId };
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    // Fail fast: if proxy hangs, don't block UI.
    // No retries by design (GTFS-RT emergency fallback can handle outages).
    const responseInfo = await attemptFetch(5000);

    const response = responseInfo.response;
    const reqId = responseInfo.reqId;
    
    if (!response.ok) {
      throw new Error(`V3 vehicles HTTP ${response.status}: ${response.statusText}`);
    }
    
    const jsonStart = Date.now();
    let data;
    try {
      data = await response.json();
    } catch (jsonErr) {
      // Try to capture some body text to see what we got (HTML error page, gateway timeout, etc.)
      let preview = '';
      try {
        const text = await response.text();
        preview = String(text || '').slice(0, 400);
      } catch (_) {}
      console.warn('[MBTA V3] JSON parse failed', { reqId, routeId, directionId, preview }, jsonErr);
      throw jsonErr;
    }
    if (debugV3) {
      console.log('[MBTA V3] JSON parsed', { reqId, routeId, directionId, elapsedMs: Date.now() - jsonStart });
      const keys = data && typeof data === 'object' ? Object.keys(data).slice(0, 20) : [];
      console.log('[MBTA V3] JSON shape', {
        reqId,
        topKeys: keys,
        dataCount: Array.isArray(data?.data) ? data.data.length : null
      });
    }
    const vehicles = [];
    
    if (data.data && Array.isArray(data.data)) {
      data.data.forEach(vehicle => {
        if (!vehicle.attributes) return;
        
        // Filter by direction if specified
        if (directionId !== null && vehicle.attributes.direction_id != directionId) {
          return;
        }
        
        // Use route relationship if available, otherwise fallback to routeId
        const routeNumber = vehicle.relationships?.route?.data?.id || routeId;
        
        vehicles.push({
          vehicleID: vehicle.id,
          routeNumber: routeNumber,
          direction: vehicle.attributes.direction_id,
          latitude: vehicle.attributes.latitude,
          longitude: vehicle.attributes.longitude,
          speed: vehicle.attributes.speed || null,
          bearing: vehicle.attributes.bearing || null,
          blockID: vehicle.attributes.label || vehicle.id,
          occupancy: vehicle.attributes.occupancy_status || null
        });
      });
    }
    
    console.log('[MBTA V3] Vehicles parsed', { reqId, routeId, directionId, count: vehicles.length });
    return vehicles;
  } catch (error) {
    console.warn('[MBTA V3] Error fetching vehicles:', error);
    throw error;
  }
}

/**
 * Fetch MBTA V3 vehicles as fallback when GTFS-RT has vehicles but none match route+direction
 * @param {string} routeId - Route ID
 * @returns {Promise<Array>} Array of vehicles in GTFS-RT format
 */
async function fetchMBTAV3VehiclesFallback(routeId) {
  return fetchMBTAV3Vehicles(routeId, null);
}
// Parse MBTA GTFS-RT VehiclePositions feed
async function parseMBTAGTFSRT(buffer) {
  console.log('[parseMBTAGTFSRT] ===== PARSER CALLED =====');
  console.log('[parseMBTAGTFSRT] Buffer size:', buffer.byteLength, 'bytes');
  
  const uint8Buffer = new Uint8Array(buffer);
  const vehicles = [];
  let pos = 0;
  
  console.log('[parseMBTAGTFSRT] First 20 bytes:', Array.from(uint8Buffer.slice(0, 20)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
  
  // Parse FeedMessage
  let entityCount = 0;
  let headerFound = false;
  let entitiesFound = 0;
  let vehiclesSkipped = 0;
  let schemaSanityChecked = false;
  
  while (pos < uint8Buffer.length) {
    if (pos >= uint8Buffer.length) break;
    
    const tag = uint8Buffer[pos++];
    if (!tag) break;
    
    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;
    
    // ===== 5. SCHEMA SANITY CHECK (ONE-TIME) =====
    if (!schemaSanityChecked) {
      schemaSanityChecked = true;
      console.log(`[parseMBTAGTFSRT] ===== FeedMessage Schema Sanity Check =====`);
      console.log(`[parseMBTAGTFSRT] First field: fieldNumber=${fieldNum}, wireType=${wireType}`);
      if (fieldNum === 1 && wireType === 2) {
        console.log(`[parseMBTAGTFSRT] ✅ Header is field 1, wireType 2 (CORRECT)`);
      } else {
        console.error(`[parseMBTAGTFSRT] ❌ FeedMessage schema mismatch: Expected field 1 wireType 2, got field ${fieldNum} wireType ${wireType}`);
      }
      // Reset pos to check first field again
      pos = 0;
      continue;
    }
    
    if (fieldNum === 1) {
      // Skip header
      headerFound = true;
      pos = skipField(uint8Buffer, pos, wireType);
    } else if (fieldNum === 2) {
      // Entity
      entitiesFound++;
      if (wireType === 2) {
        // ===== 5. SCHEMA SANITY CHECK FOR ENTITIES =====
        if (entitiesFound === 1) {
          console.log(`[parseMBTAGTFSRT] ✅ Entity list is field 2, wireType 2 (CORRECT)`);
        }
        const { value: entityLength, pos: lengthPos } = parseVarint(uint8Buffer, pos);
        const entityStart = lengthPos;
        const entityEnd = entityStart + entityLength;
        
        if (entityEnd > uint8Buffer.length) {
          console.warn('[parseMBTAGTFSRT] Entity extends beyond buffer, stopping');
          break;
        }
        
        let entityPos = entityStart;
        let entityId = null;
        
        while (entityPos < entityEnd) {
          const entityTag = uint8Buffer[entityPos++];
          if (!entityTag) break;
          
          const entityFieldNum = entityTag >> 3;
          const entityWireType = entityTag & 0x07;
          
          if (entityFieldNum === 1) {
            // entity.id
            if (entityWireType === 2) {
              const { value: strLen, pos: strLenPos } = parseVarint(uint8Buffer, entityPos);
              entityId = readString(uint8Buffer, strLenPos, strLen);
              entityPos = strLenPos + strLen;
            }
          } else if (entityFieldNum === 4) {
            // entity.vehicle
            if (entityWireType === 2) {
              const { value: vehicleLength, pos: vehicleLenPos } = parseVarint(uint8Buffer, entityPos);
              const vehicleStart = vehicleLenPos;
              const vehicleEnd = vehicleStart + vehicleLength;
              
              // ===== 1. VEHICLE MESSAGE BOUNDARY LOGGING =====
              if (entitiesFound <= 3) {
                const first16Bytes = Array.from(uint8Buffer.slice(vehicleStart, Math.min(vehicleStart + 16, vehicleEnd)))
                  .map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
                console.log(`[parseMBTAGTFSRT] ===== VehiclePosition Message #${entitiesFound} =====`);
                console.log(`[parseMBTAGTFSRT] vehicleMsgStartOffset: ${vehicleStart}`);
                console.log(`[parseMBTAGTFSRT] vehicleMsgEndOffset: ${vehicleEnd}`);
                console.log(`[parseMBTAGTFSRT] Message length: ${vehicleLength} bytes`);
                console.log(`[parseMBTAGTFSRT] First 16 bytes (hex): ${first16Bytes}`);
              }
              
              let vehiclePos = vehicleStart;
              let vehicleId = null;
              let routeId = null;
              let directionId = null;
              let lat = null;
              let lon = null;
              let bearing = null;
              let speed = null;
              
              // Debug: track what fields we find
              let foundFields = [];
              
              // Track if we've seen the first field
              let firstFieldSeen = false;
              
              while (vehiclePos < vehicleEnd) {
                // ===== 4. CURSOR BOUNDARY ASSERTION =====
                if (vehiclePos > vehicleEnd) {
                  console.error(`[parseMBTAGTFSRT] ❌ Cursor exceeded vehicle message boundary — parser is desynced.`);
                  console.error(`[parseMBTAGTFSRT] startOffset=${vehicleStart}, endOffset=${vehicleEnd}, cursor=${vehiclePos}`);
                  break;
                }
                
                const vehicleTag = uint8Buffer[vehiclePos];
                const vehicleTagOffset = vehiclePos;
                vehiclePos++;
                
                if (!vehicleTag) break;
                
                const vehicleFieldNum = vehicleTag >> 3;
                const vehicleWireType = vehicleTag & 0x07;
                
                // ===== 1. FIRST FIELD LOGGING =====
                if (!firstFieldSeen && entitiesFound <= 3) {
                  firstFieldSeen = true;
                  console.log(`[parseMBTAGTFSRT] First field key read:`);
                  console.log(`[parseMBTAGTFSRT]   raw key byte: 0x${vehicleTag.toString(16).padStart(2, '0')}`);
                  console.log(`[parseMBTAGTFSRT]   decoded fieldNumber: ${vehicleFieldNum}`);
                  console.log(`[parseMBTAGTFSRT]   decoded wireType: ${vehicleWireType}`);
                  console.log(`[parseMBTAGTFSRT]   cursor offset after reading key: ${vehiclePos}`);
                }
                
                // ===== 3. UNKNOWN FIELD SKIPPING WITH LOGGING =====
                const skipStartPos = vehiclePos;
                
                if (vehicleFieldNum === 1) {
                  // vehicle.trip
                  foundFields.push('vehicle.trip(f1) found');
                  if (vehicleWireType === 2) {
                    // ===== LENGTH-DELIMITED FIELD INSTRUMENTATION: TRIP =====
                    const cursorBeforeVarint = vehiclePos;
                    const { value: tripLength, pos: tripLenPos } = parseVarint(uint8Buffer, vehiclePos);
                    const tripStart = tripLenPos;
                    const tripEnd = tripStart + tripLength;
                    
                    // BEFORE consuming bytes, log everything
                    if (entitiesFound <= 3) {
                      const first12Bytes = Array.from(uint8Buffer.slice(tripStart, Math.min(tripStart + 12, tripEnd)))
                        .map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
                      console.log(`[parseMBTAGTFSRT] ===== TRIP FIELD (f1, wt2) =====`);
                      console.log(`[parseMBTAGTFSRT] tripLength (varint value): ${tripLength}`);
                      console.log(`[parseMBTAGTFSRT] cursorBeforeVarint: ${cursorBeforeVarint}`);
                      console.log(`[parseMBTAGTFSRT] tripLenPos (after varint): ${tripLenPos}`);
                      console.log(`[parseMBTAGTFSRT] tripStart: ${tripStart}`);
                      console.log(`[parseMBTAGTFSRT] tripEnd: ${tripEnd}`);
                      console.log(`[parseMBTAGTFSRT] vehicleMsgEndOffset: ${vehicleEnd}`);
                      console.log(`[parseMBTAGTFSRT] First 12 bytes of trip payload (hex): ${first12Bytes}`);
                    }
                    
                    foundFields.push(`trip.length=${tripLength}`);
                    
                    let tripPos = tripStart;
                    while (tripPos < tripEnd) {
                      const tripTag = uint8Buffer[tripPos++];
                      if (!tripTag) break;
                      
                      const tripFieldNum = tripTag >> 3;
                      const tripWireType = tripTag & 0x07;
                      
                      if (tripFieldNum === 1 && tripWireType === 2) {
                        // trip.trip_id (skip it, we don't need it)
                        const { value: tripIdLen, pos: tripIdLenPos } = parseVarint(uint8Buffer, tripPos);
                        tripPos = tripIdLenPos + tripIdLen;
                      } else if (tripFieldNum === 2 && tripWireType === 2) {
                        // Skip field 2 - it's not route_id (it appears to be a time field)
                        // MBTA uses field 5 for route_id
                        const { value: routeIdLen, pos: routeIdLenPos } = parseVarint(uint8Buffer, tripPos);
                        tripPos = routeIdLenPos + routeIdLen;
                      } else if (tripFieldNum === 3 && tripWireType === 2) {
                        // Skip field 3 - MBTA doesn't use this for route_id (it's often a date like '20260122')
                        // MBTA uses field 5 for route_id
                        const { value: routeIdLen, pos: routeIdLenPos } = parseVarint(uint8Buffer, tripPos);
                        tripPos = routeIdLenPos + routeIdLen;
                      } else if (tripFieldNum === 5 && tripWireType === 2) {
                        // trip.route_id (field 5 - MBTA uses this, hex shows "Green-D" here)
                        // This is the ONLY field we use for route_id
                        const { value: routeIdLen, pos: routeIdLenPos } = parseVarint(uint8Buffer, tripPos);
                        routeId = readString(uint8Buffer, routeIdLenPos, routeIdLen);
                        foundFields.push(`trip.route_id(f5)=${routeId}`);
                        tripPos = routeIdLenPos + routeIdLen;
                      } else if (tripFieldNum === 6 && tripWireType === 0) {
                        // trip.direction_id (field 6 in GTFS-RT)
                        const { value: dirValue, pos: dirPos } = parseVarint(uint8Buffer, tripPos);
                        directionId = dirValue;
                        foundFields.push(`trip.direction_id(f6)=${directionId}`);
                        tripPos = dirPos;
                      } else {
                        tripPos = skipField(uint8Buffer, tripPos, tripWireType);
                      }
                    }
                    
                    // AFTER consuming trip payload, verify cursor position
                    const cursorAfterTrip = tripPos;
                    vehiclePos = tripEnd;
                    
                    if (entitiesFound <= 3) {
                      console.log(`[parseMBTAGTFSRT] cursorAfterTrip (tripPos): ${cursorAfterTrip}`);
                      console.log(`[parseMBTAGTFSRT] tripEnd (expected): ${tripEnd}`);
                      if (cursorAfterTrip !== tripEnd) {
                        console.error(`[parseMBTAGTFSRT] ❌ ERROR: cursorAfterTrip (${cursorAfterTrip}) !== tripEnd (${tripEnd}) - CURSOR MISALIGNMENT!`);
                        console.error(`[parseMBTAGTFSRT] Difference: ${cursorAfterTrip - tripEnd} bytes`);
                        // Stop parsing this vehicle
                        break;
                      } else {
                        console.log(`[parseMBTAGTFSRT] ✅ cursorAfterTrip === tripEnd (${tripEnd})`);
                      }
                      console.log(`[parseMBTAGTFSRT] vehiclePos set to: ${vehiclePos}`);
                      console.log(`[parseMBTAGTFSRT] Next 8 bytes after trip: ${Array.from(uint8Buffer.slice(vehiclePos, Math.min(vehiclePos + 8, vehicleEnd))).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
                    }
                  } else {
                    // ===== 3. UNKNOWN FIELD SKIPPING =====
                    const skipBefore = vehiclePos;
                    if (vehicleWireType === 2) {
                      // For wt2 (length-delimited), log the length varint value and start/end offsets
                      const { value: skipLength, pos: skipLenPos } = parseVarint(uint8Buffer, vehiclePos);
                      const skipStart = skipLenPos;
                      const skipEnd = skipStart + skipLength;
                      vehiclePos = skipEnd;
                      if (entitiesFound <= 3) {
                        console.log(`[parseMBTAGTFSRT] Skipped unknown wt2 field: f${vehicleFieldNum}, lengthVarint=${skipLength}, start=${skipStart}, end=${skipEnd}, newCursor=${vehiclePos}`);
                      }
                    } else {
                      vehiclePos = skipField(uint8Buffer, vehiclePos, vehicleWireType);
                      const bytesSkipped = vehiclePos - skipBefore;
                      if (entitiesFound <= 3) {
                        console.log(`[parseMBTAGTFSRT] Skipped field: f${vehicleFieldNum}, wt${vehicleWireType}, bytes=${bytesSkipped}, newCursor=${vehiclePos}`);
                      }
                    }
                  }
                } else if (vehicleFieldNum === 2) {
                  // vehicle.position (CORRECT: field 2 is Position, not VehicleDescriptor)
                  foundFields.push('vehicle.position(f2) found');
                  if (vehicleWireType === 2) {
                    // ===== LENGTH-DELIMITED FIELD INSTRUMENTATION: POSITION =====
                    const cursorBeforeVarint = vehiclePos;
                    const { value: posLength, pos: posLenPos } = parseVarint(uint8Buffer, vehiclePos);
                    const posStart = posLenPos;
                    const posEnd = posStart + posLength;
                    
                    // BEFORE consuming bytes, log everything
                    if (entitiesFound <= 3) {
                      const first12Bytes = Array.from(uint8Buffer.slice(posStart, Math.min(posStart + 12, posEnd)))
                        .map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
                      console.log(`[parseMBTAGTFSRT] ===== POSITION FIELD (f2, wt2) =====`);
                      console.log(`[parseMBTAGTFSRT] posLength (varint value): ${posLength}`);
                      console.log(`[parseMBTAGTFSRT] cursorBeforeVarint: ${cursorBeforeVarint}`);
                      console.log(`[parseMBTAGTFSRT] posLenPos (after varint): ${posLenPos}`);
                      console.log(`[parseMBTAGTFSRT] posStart: ${posStart}`);
                      console.log(`[parseMBTAGTFSRT] posEnd: ${posEnd}`);
                      console.log(`[parseMBTAGTFSRT] vehicleMsgEndOffset: ${vehicleEnd}`);
                      console.log(`[parseMBTAGTFSRT] First 12 bytes of position payload (hex): ${first12Bytes}`);
                    }
                    
                    foundFields.push(`position.length=${posLength}`);
                    
                    let posPos = posStart;
                    let positionFieldsFound = [];
                    while (posPos < posEnd) {
                      const posTag = uint8Buffer[posPos++];
                      if (!posTag) break;
                      
                      const posFieldNum = posTag >> 3;
                      const posWireType = posTag & 0x07;
                      positionFieldsFound.push(`f${posFieldNum}:wt${posWireType}`);
                      
                      if (posFieldNum === 1 && posWireType === 5) {
                        // position.latitude (float)
                        lat = readFloat(uint8Buffer, posPos);
                        foundFields.push(`position.lat(f1)=${lat}`);
                        posPos += 4;
                      } else if (posFieldNum === 2 && posWireType === 5) {
                        // position.longitude (float)
                        lon = readFloat(uint8Buffer, posPos);
                        foundFields.push(`position.lon(f2)=${lon}`);
                        posPos += 4;
                      } else if (posFieldNum === 3 && posWireType === 5) {
                        // position.bearing (float)
                        bearing = readFloat(uint8Buffer, posPos);
                        foundFields.push(`position.bearing(f3)=${bearing}`);
                        posPos += 4;
                      } else if (posFieldNum === 4 && posWireType === 5) {
                        // position.speed (float)
                        speed = readFloat(uint8Buffer, posPos);
                        foundFields.push(`position.speed(f4)=${speed}`);
                        posPos += 4;
                      } else {
                        posPos = skipField(uint8Buffer, posPos, posWireType);
                      }
                    }
                    
                    // AFTER consuming position payload, verify cursor position
                    const cursorAfterPosition = posPos;
                    vehiclePos = posEnd;
                    
                    if (entitiesFound <= 3) {
                      console.log(`[parseMBTAGTFSRT] cursorAfterPosition (posPos): ${cursorAfterPosition}`);
                      console.log(`[parseMBTAGTFSRT] posEnd (expected): ${posEnd}`);
                      if (cursorAfterPosition !== posEnd) {
                        console.error(`[parseMBTAGTFSRT] ❌ ERROR: cursorAfterPosition (${cursorAfterPosition}) !== posEnd (${posEnd}) - CURSOR MISALIGNMENT!`);
                        console.error(`[parseMBTAGTFSRT] Difference: ${cursorAfterPosition - posEnd} bytes`);
                        break;
                      } else {
                        console.log(`[parseMBTAGTFSRT] ✅ cursorAfterPosition === posEnd (${posEnd})`);
                      }
                      console.log(`[parseMBTAGTFSRT] vehiclePos set to: ${vehiclePos}`);
                      console.log(`[parseMBTAGTFSRT] position.fields:[${positionFieldsFound.join(',')}]`);
                      console.log(`[parseMBTAGTFSRT] Next 8 bytes after position: ${Array.from(uint8Buffer.slice(vehiclePos, Math.min(vehiclePos + 8, vehicleEnd))).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
                    }
                  } else {
                    // Skip non-wt2 position field
                    const skipBefore = vehiclePos;
                    vehiclePos = skipField(uint8Buffer, vehiclePos, vehicleWireType);
                    if (entitiesFound <= 3) {
                      console.log(`[parseMBTAGTFSRT] Skipped field: f${vehicleFieldNum}, wt${vehicleWireType}, bytes=${vehiclePos - skipBefore}`);
                    }
                  }
                } else if (vehicleFieldNum === 3) {
                  // vehicle.current_stop_sequence (varint)
                  if (vehicleWireType === 0) {
                    const { value: stopSeq, pos: stopSeqPos } = parseVarint(uint8Buffer, vehiclePos);
                    foundFields.push(`current_stop_sequence(f3)=${stopSeq}`);
                    vehiclePos = stopSeqPos;
                  } else {
                    // Skip non-varint field 3
                    const skipBefore = vehiclePos;
                    vehiclePos = skipField(uint8Buffer, vehiclePos, vehicleWireType);
                    if (entitiesFound <= 3) {
                      console.log(`[parseMBTAGTFSRT] Skipped field: f${vehicleFieldNum}, wt${vehicleWireType}, bytes=${vehiclePos - skipBefore}`);
                    }
                  }
                } else if (vehicleFieldNum === 8) {
                  // vehicle.vehicle (VehicleDescriptor) - CORRECT: field 8 is VehicleDescriptor
                  foundFields.push('vehicle.vehicle(f8) found');
                  if (vehicleWireType === 2) {
                    // ===== LENGTH-DELIMITED FIELD INSTRUMENTATION: VEHICLE DESCRIPTOR =====
                    const cursorBeforeVarint = vehiclePos;
                    const { value: vehDescLength, pos: vehDescLenPos } = parseVarint(uint8Buffer, vehiclePos);
                    const vehDescStart = vehDescLenPos;
                    const vehDescEnd = vehDescStart + vehDescLength;
                    
                    // BEFORE consuming bytes, log everything
                    if (entitiesFound <= 3) {
                      const first12Bytes = Array.from(uint8Buffer.slice(vehDescStart, Math.min(vehDescStart + 12, vehDescEnd)))
                        .map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
                      console.log(`[parseMBTAGTFSRT] ===== VEHICLE DESCRIPTOR FIELD (f8, wt2) =====`);
                      console.log(`[parseMBTAGTFSRT] vehDescLength (varint value): ${vehDescLength}`);
                      console.log(`[parseMBTAGTFSRT] cursorBeforeVarint: ${cursorBeforeVarint}`);
                      console.log(`[parseMBTAGTFSRT] vehDescLenPos (after varint): ${vehDescLenPos}`);
                      console.log(`[parseMBTAGTFSRT] vehDescStart: ${vehDescStart}`);
                      console.log(`[parseMBTAGTFSRT] vehDescEnd: ${vehDescEnd}`);
                      console.log(`[parseMBTAGTFSRT] vehicleMsgEndOffset: ${vehicleEnd}`);
                      console.log(`[parseMBTAGTFSRT] First 12 bytes of vehicle descriptor payload (hex): ${first12Bytes}`);
                    }
                    
                    foundFields.push(`vehicle.length=${vehDescLength}`);
                    
                    let vehDescPos = vehDescStart;
                    let vehDescFieldsSeen = [];
                    while (vehDescPos < vehDescEnd) {
                      const vehDescTag = uint8Buffer[vehDescPos];
                      const vehDescTagOffset = vehDescPos;
                      vehDescPos++;
                      if (!vehDescTag) break;
                      
                      const vehDescFieldNum = vehDescTag >> 3;
                      const vehDescWireType = vehDescTag & 0x07;
                      vehDescFieldsSeen.push(`f${vehDescFieldNum}:wt${vehDescWireType}`);
                      
                      if (entitiesFound <= 3) {
                        console.log(`[parseMBTAGTFSRT] vehicle.vehicle field: f${vehDescFieldNum}, wt${vehDescWireType}, at offset=${vehDescTagOffset}`);
                      }
                      
                      if (vehDescFieldNum === 1 && vehDescWireType === 2) {
                        // vehicle.vehicle.id (string)
                        const { value: vehIdLen, pos: vehIdLenPos } = parseVarint(uint8Buffer, vehDescPos);
                        vehicleId = readString(uint8Buffer, vehIdLenPos, vehIdLen);
                        foundFields.push(`vehicle.id(f1)=${vehicleId}`);
                        vehDescPos = vehIdLenPos + vehIdLen;
                      } else if (vehDescFieldNum === 2 && vehDescWireType === 2) {
                        // vehicle.vehicle.label (string) - skip it
                        const { value: labelLen, pos: labelLenPos } = parseVarint(uint8Buffer, vehDescPos);
                        vehDescPos = labelLenPos + labelLen;
                      } else if (vehDescFieldNum === 3 && vehDescWireType === 2) {
                        // vehicle.vehicle.license_plate (string) - skip it
                        const { value: plateLen, pos: plateLenPos } = parseVarint(uint8Buffer, vehDescPos);
                        vehDescPos = plateLenPos + plateLen;
                      } else {
                        const skipBefore = vehDescPos;
                        vehDescPos = skipField(uint8Buffer, vehDescPos, vehDescWireType);
                        if (entitiesFound <= 3) {
                          console.log(`[parseMBTAGTFSRT] Skipped vehicle.vehicle field: f${vehDescFieldNum}, wt${vehDescWireType}, bytes=${vehDescPos - skipBefore}`);
                        }
                      }
                    }
                    
                    // AFTER consuming vehicle descriptor payload, verify cursor position
                    const cursorAfterVehDesc = vehDescPos;
                    vehiclePos = vehDescEnd;
                    
                    if (entitiesFound <= 3) {
                      console.log(`[parseMBTAGTFSRT] cursorAfterVehDesc (vehDescPos): ${cursorAfterVehDesc}`);
                      console.log(`[parseMBTAGTFSRT] vehDescEnd (expected): ${vehDescEnd}`);
                      if (cursorAfterVehDesc !== vehDescEnd) {
                        console.error(`[parseMBTAGTFSRT] ❌ ERROR: cursorAfterVehDesc (${cursorAfterVehDesc}) !== vehDescEnd (${vehDescEnd}) - CURSOR MISALIGNMENT!`);
                        console.error(`[parseMBTAGTFSRT] Difference: ${cursorAfterVehDesc - vehDescEnd} bytes`);
                        break;
                      } else {
                        console.log(`[parseMBTAGTFSRT] ✅ cursorAfterVehDesc === vehDescEnd (${vehDescEnd})`);
                      }
                      console.log(`[parseMBTAGTFSRT] vehiclePos set to: ${vehiclePos}`);
                      console.log(`[parseMBTAGTFSRT] fieldsSeen=[${vehDescFieldsSeen.join(', ')}]`);
                      console.log(`[parseMBTAGTFSRT] Next 8 bytes after vehicle.vehicle: ${Array.from(uint8Buffer.slice(vehiclePos, Math.min(vehiclePos + 8, vehicleEnd))).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
                    }
                  } else {
                    // Skip non-wt2 vehicle descriptor
                    const skipBefore = vehiclePos;
                    vehiclePos = skipField(uint8Buffer, vehiclePos, vehicleWireType);
                    if (entitiesFound <= 3) {
                      console.log(`[parseMBTAGTFSRT] Skipped field: f${vehicleFieldNum}, wt${vehicleWireType}, bytes=${vehiclePos - skipBefore}`);
                    }
                  }
                } else {
                  // ===== 3. UNKNOWN FIELD SKIPPING =====
                  const skipBefore = vehiclePos;
                  vehiclePos = skipField(uint8Buffer, vehiclePos, vehicleWireType);
                  const bytesSkipped = vehiclePos - skipBefore;
                  if (entitiesFound <= 3) {
                    console.log(`[parseMBTAGTFSRT] Skipped field: f${vehicleFieldNum}, wt${vehicleWireType}, bytes=${bytesSkipped}, newCursor=${vehiclePos}`);
                  }
                }
              }
              
              // Only add vehicle if we have required fields
              if (vehicleId && routeId !== null && lat !== null && lon !== null) {
                vehicles.push({
                  vehicleID: vehicleId,
                  routeNumber: routeId,
                  direction: directionId !== null ? directionId : 0,
                  latitude: lat,
                  longitude: lon,
                  bearing: bearing,
                  speed: speed ? (speed * 2.237) : null, // Convert m/s to mph
                  blockID: entityId || vehicleId // Use entity ID as block ID if available
                });
                
                // Log first few vehicles for debugging
                if (vehicles.length <= 3) {
                  console.log(`[parseMBTAGTFSRT] Vehicle ${vehicles.length}:`, {
                    vehicleID: vehicleId,
                    routeNumber: routeId,
                    direction: directionId,
                    lat: lat,
                    lon: lon
                  });
                }
              } else {
                vehiclesSkipped++;
                // Log why vehicle was skipped (only first few to avoid spam)
                if (vehiclesSkipped <= 5) {
                  console.warn('[parseMBTAGTFSRT] ⚠️ Skipped vehicle (missing data):', {
                    entityId: entityId || 'MISSING',
                    vehicleId: vehicleId || 'MISSING',
                    routeId: routeId !== null ? routeId : 'MISSING',
                    lat: lat !== null ? lat : 'MISSING',
                    lon: lon !== null ? lon : 'MISSING',
                    directionId: directionId !== null ? directionId : 'MISSING'
                  });
                  if (foundFields.length > 0) {
                    console.warn('[parseMBTAGTFSRT] Found fields:', foundFields.join(', '));
                  } else {
                    console.warn('[parseMBTAGTFSRT] ⚠️ NO FIELDS FOUND - parser may not be entering vehicle blocks');
                  }
                }
              }
            }
          } else {
            entityPos = skipField(uint8Buffer, entityPos, entityWireType);
          }
        }
        // After parsing entity, advance pos to entityEnd to continue to next entity
        pos = entityEnd;
      } else {
        pos = skipField(uint8Buffer, pos, wireType);
      }
    } else {
      pos = skipField(uint8Buffer, pos, wireType);
    }
  }
  
  console.log(`[parseMBTAGTFSRT] ===== PARSE COMPLETE =====`);
  console.log(`[parseMBTAGTFSRT] Header found: ${headerFound}`);
  console.log(`[parseMBTAGTFSRT] Entities found: ${entitiesFound}`);
  console.log(`[parseMBTAGTFSRT] Vehicles parsed: ${vehicles.length}`);
  console.log(`[parseMBTAGTFSRT] Vehicles skipped: ${vehiclesSkipped}`);
  
  if (vehicles.length === 0 && buffer.byteLength > 100) {
    console.error('[parseMBTAGTFSRT] ❌ Large buffer but no vehicles parsed!');
    console.error('[parseMBTAGTFSRT] Header found:', headerFound);
    console.error('[parseMBTAGTFSRT] Entities found:', entitiesFound);
    console.error('[parseMBTAGTFSRT] Vehicles skipped:', vehiclesSkipped);
    if (entitiesFound > 0 && vehicles.length === 0) {
      console.error('[parseMBTAGTFSRT] ⚠️ Entities were found but no vehicles extracted!');
      console.error('[parseMBTAGTFSRT] This suggests vehicle field parsing is failing.');
    }
  }
  
  return vehicles;
}

window.MBTARealtime = {
  parseVarint,
  readString,
  readFloat,
  skipField,
  parseMBTAGTFSTripUpdates,
  fetchMBTAV3Predictions,
  fetchMBTAV3Vehicles,
  fetchMBTAV3VehiclesFallback,
  parseMBTAGTFSRT
};

window.mbtaAdapter = {
  fetchPredictions: fetchMBTAV3Predictions,
  fetchVehicles: fetchMBTAV3Vehicles,
  fetchVehiclesFallback: fetchMBTAV3VehiclesFallback,
  parseVehiclePositions: parseMBTAGTFSRT,
  parseTripUpdates: parseMBTAGTFSTripUpdates
};
