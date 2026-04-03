/**
 * MBTA realtime helpers (Phase 1 extract).
 * Loaded before routeOverlay.js — protobuf helpers, TripUpdates parser, V3 predictions/vehicles.
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

window.MBTARealtime = {
  parseVarint,
  readString,
  readFloat,
  skipField,
  parseMBTAGTFSTripUpdates,
  fetchMBTAV3Predictions,
  fetchMBTAV3Vehicles,
  fetchMBTAV3VehiclesFallback
};
