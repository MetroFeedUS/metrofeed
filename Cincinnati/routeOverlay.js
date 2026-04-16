/**
 * MetroFeed Route Overlay Module (clean version)
 *
 * FOR NEW DEVS (handoff)
 * ----------------------
 * - Draws route polylines/stops and (when enabled) live bus markers on a MapLibre map.
 * - Boston MBTA: GTFS-RT + V3 fetch/parse lives IN THIS FILE (bundled on purpose). One script upload
 *   avoids production missing a second file, which previously left window.attachRouteToMap undefined.
 * - City behavior comes from window.CITY_CONFIG (see city-config.js) — e.g. busApiType, gtfsRtUrl.
 * - Instruction manual: DEVELOPER.md (same folder as this file)
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

// ===============================
// Cincinnati helpers (UI + GTFS-RT)
// ===============================
function pickContrastingTextColor(hex) {
  if (!hex) return "#ffffff";
  let h = String(hex).trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((x) => Number.isNaN(x))) return "#ffffff";
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.55 ? "#0d0d0d" : "#ffffff";
}

function metrofeedFormatVehicleLabel(vehicleIDRaw, routeId) {
  const rid = routeId != null ? String(routeId) : "";
  const raw = vehicleIDRaw != null ? String(vehicleIDRaw) : "";
  const numeric = raw.replace(/\D+/g, "");
  const idPart = numeric || raw || "?";
  if (rid.startsWith("sorta_")) return "Metro " + idPart;
  if (rid.startsWith("tank_")) return "TANK " + idPart;
  return idPart;
}

function metrofeedFormatRouteBadge(routeId) {
  const rid = routeId != null ? String(routeId) : "";
  if (rid.startsWith("sorta_")) return rid.slice(6);
  if (rid.startsWith("tank_")) return rid.slice(5);
  return rid;
}

function buildRouteFloatingChipLabel(routeId) {
  const rid = String(routeId || "");
  if (rid.startsWith("sorta_")) return { label: "Metro " + rid.slice(6), isAgencyStyle: true };
  if (rid.startsWith("tank_")) return { label: "TANK " + rid.slice(5), isAgencyStyle: true };
  const m = rid.match(/\d+/);
  return { label: m ? m[0] : rid, isAgencyStyle: false };
}

function parseVehiclesJsonToGtfsLike(json) {
  const items =
    (Array.isArray(json) && json) ||
    (Array.isArray(json?.vehicles) && json.vehicles) ||
    (Array.isArray(json?.data) && json.data) ||
    [];
  if (!Array.isArray(items)) return [];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const v = items[i];
    if (!v) continue;
    const vehId =
      v.vehicleID ?? v.vehicleId ?? v.vehicle_id ??
      v.id ?? v?.vehicle?.id ?? v?.vehicle?.vehicle_id ?? v?.vehicle?.vehicleID ??
      null;
    const route =
      v.routeNumber ?? v.route_number ?? v.routeId ?? v.route_id ??
      v?.trip?.route_id ?? v?.trip?.routeId ?? v?.trip?.routeID ??
      v?.trip?.route_short_name ??
      null;
    const dir =
      v.direction ?? v.direction_id ?? v.directionId ??
      v?.trip?.direction_id ?? v?.trip?.directionId ??
      null;
    const lat =
      v.latitude ?? v.lat ?? v?.position?.latitude ?? v?.position?.lat ??
      null;
    const lon =
      v.longitude ?? v.lon ?? v.lng ?? v?.position?.longitude ?? v?.position?.lon ?? v?.position?.lng ??
      null;
    if (lat == null || lon == null) continue;
    out.push({
      vehicleID: vehId != null ? String(vehId) : "",
      routeNumber: route != null ? String(route) : "",
      direction: dir != null && dir !== "" ? Number(dir) : null,
      latitude: Number(lat),
      longitude: Number(lon),
      bearing: v.bearing ?? v?.position?.bearing ?? null,
      speed: v.speed ?? v?.position?.speed ?? null,
      blockID: v.blockID ?? v.blockId ?? v.block_id ?? v.label ?? (vehId != null ? String(vehId) : ""),
      occupancy: v.occupancy ?? v.occupancy_status ?? null
    });
  }
  return out;
}



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

/*
 * GTFS-RT VehiclePositions (protobuf) → plain vehicle objects for the map.
 * This is a hand-written protobuf walk (varints, length-delimited fields), not generated code.
 * If MBTA changes field numbers, logs here are the first place to look; spec: GTFS-RT VehiclePosition.
 */
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

/** Half-width of GPS dot (px). Used with anchor "bottom" + offset so dot center sits on lat/lng. */
const MBTA_BUS_MARKER_DOT_RADIUS_PX = 6;

/**
 * Live bus marker geometry: pill label (detached above) + circular dot on the coordinate.
 * Colors stay driven by routeColor (unchanged); used by route overlay and home.html createBusMarker via window.
 */
function buildMbtaBusMarkerElement(routeColor, routeNum, displayVehicleID) {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.alignItems = "center";
  wrap.style.pointerEvents = "auto";
  const d = MBTA_BUS_MARKER_DOT_RADIUS_PX * 2;
  wrap.innerHTML = `
    <div style="margin-bottom:6px;background:${routeColor};color:#fff;padding:3px 8px;border-radius:8px;font-weight:bold;font-size:11px;box-shadow:0 2px 4px rgba(0,0,0,0.3);border:2px solid #fff;white-space:nowrap;">
      <span style="background:#fff;color:${routeColor};padding:1px 3px;border-radius:2px;font-size:9px;margin-right:4px;">${String(routeNum)}</span>${String(displayVehicleID)}
    </div>
    <div style="width:${d}px;height:${d}px;border-radius:50%;background:${routeColor};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.35);flex-shrink:0;"></div>
  `;
  return wrap;
}

function mbtaBusMarkerMapOptions() {
  return { anchor: "bottom", offset: [0, -MBTA_BUS_MARKER_DOT_RADIUS_PX] };
}

window.buildMbtaBusMarkerElement = buildMbtaBusMarkerElement;
window.mbtaBusMarkerMapOptions = mbtaBusMarkerMapOptions;

/**
 * Bottom "Next Arrivals" panel (#etaPanel): set false to keep it a ghost — still updated in the DOM
 * (stop popups / bus cards use window.currentRouteETAs, not this panel). Set true to show again.
 */
const ETA_BOTTOM_PANEL_VISIBLE = false;

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
  if (ETA_BOTTOM_PANEL_VISIBLE) {
    panel.style.display = 'block';
    panel.removeAttribute('aria-hidden');
  } else {
    // Ghost: no layout on screen, no pointer capture; content stays for devtools / optional future toggle
    panel.style.display = 'none';
    panel.setAttribute('aria-hidden', 'true');
  }
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

function routeOverlayPanelHost(map) {
  if (typeof window.getRouteOverlayMount === "function" && map) {
    return window.getRouteOverlayMount(map);
  }
  return map && map.getContainer ? map.getContainer() : document.body;
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
    // Unique MapLibre source/layer + route-info DOM id (supports multiple OTP legs for same route+dir)
    const mapLayerKey = String(options.overlayKey || `${routeId}-${directionId}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const etaOverlayKey = options.overlayKey || `${routeId}-${directionId}`;

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
      const routeSourceId = `route-line-${mapLayerKey}-${shapeIndex}`;
      const routeLayerId  = `route-layer-${mapLayerKey}-${shapeIndex}`;

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
          const overlayKey = etaOverlayKey;
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
      
      const overlayKeyForStops = etaOverlayKey;
      overlayElements.stopPopupRefreshers.push({
        overlayKey: overlayKeyForStops,
        update: updatePopupContent
      });

      stopMarker.setPopup(popup);
      stopMarker.addTo(map);

      overlayElements.markers.push(stopMarker);
    });

    // ---------- Route info panel (mainOverlay only) ----------
    // OTP trip legs use .otp-trip-route-chip on the rail instead (see otp.js).
    if (mode === "mainOverlay" && options.routePageUrl && !options.skipRouteInfoPanel) {
      const panelId = `route-info-${mapLayerKey}`;
      const existing = document.getElementById(panelId);
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

      const routeInfoPanel = document.createElement("div");
      routeInfoPanel.id = panelId;
      routeInfoPanel.className = "route-info-panel";
      
      // Start collapsed as a circle (default) or Metro/TANK pill (Cincinnati)
      // Find the next available position (highest existing index + 1)
      const allPanels = Array.from(routeOverlayPanelHost(map).querySelectorAll('.route-info-panel, .otp-trip-route-chip'));
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
      const chipSpec = buildRouteFloatingChipLabel(routeId);
      const isPill = !!chipSpec.isAgencyStyle;
      const circleSize = isPill ? 32 : 40;
      const collapsedWidth = isPill ? 94 : circleSize;
      const circleSpacing = 10; // Space between circles
      const topOffset = 250; // Start from top to avoid overlapping with other UI elements
      const verticalPosition = topOffset + (panelIndex * (circleSize + circleSpacing));
      
      // Set initial collapsed state (circle in corner)
      routeInfoPanel.setAttribute('data-collapsed', 'true');
      routeInfoPanel.setAttribute('data-collapse-index', panelIndex.toString());
      
      routeInfoPanel.style.cssText = `
        position:absolute;
        left:calc(100% - ${collapsedWidth + 10}px);
        top:${verticalPosition}px;
        width:${collapsedWidth}px;
        height:${circleSize}px;
        min-width:${collapsedWidth}px;
        max-width:${collapsedWidth}px;
        min-height:${circleSize}px;
        max-height:${circleSize}px;
        padding:0;
        border-radius:${isPill ? "999px" : "50%"};
        border:3px solid #fff;
        background:${String(routeId || "").startsWith("tank_") ? "#8B5CF6" : (String(routeId || "").startsWith("sorta_") ? "#1E90FF" : "#FF6B35")};
        color:${pickContrastingTextColor(String(routeId || "").startsWith("tank_") ? "#8B5CF6" : (String(routeId || "").startsWith("sorta_") ? "#1E90FF" : "#FF6B35"))};
        z-index:1100;
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
        z-index:1101;
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
          const allPanels = Array.from(routeOverlayPanelHost(map).querySelectorAll('.route-info-panel, .otp-trip-route-chip'));
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
          const chipSpec = buildRouteFloatingChipLabel(routeId);
          const isPill = !!chipSpec.isAgencyStyle;
          const circleSize = isPill ? 32 : 40;
          const collapsedWidth = isPill ? 94 : circleSize;
          const circleSpacing = 10; // Space between circles
          const topOffset = 250; // Start from top to avoid overlapping with other UI elements
          const verticalPosition = topOffset + (panelIndex * (circleSize + circleSpacing));
          
          // Mark this panel as collapsed and store its position index
          routeInfoPanel.setAttribute('data-collapsed', 'true');
          routeInfoPanel.setAttribute('data-collapse-index', panelIndex.toString());
          
          routeInfoPanel.style.left = `calc(100% - ${collapsedWidth + 10}px)`; // Position from right edge with margin
          routeInfoPanel.style.top = `${verticalPosition}px`;
          routeInfoPanel.style.transform = "none"; // Remove centering transform
          routeInfoPanel.style.width = `${collapsedWidth}px`;
          routeInfoPanel.style.height = `${circleSize}px`;
          routeInfoPanel.style.minWidth = `${collapsedWidth}px`;
          routeInfoPanel.style.maxWidth = `${collapsedWidth}px`;
          routeInfoPanel.style.minHeight = `${circleSize}px`;
          routeInfoPanel.style.maxHeight = `${circleSize}px`;
          routeInfoPanel.style.padding = "0";
          routeInfoPanel.style.borderRadius = isPill ? "999px" : "50%";
          routeInfoPanel.style.border = "3px solid #fff"; // White border
          const chipBg = String(routeId || "").startsWith("tank_") ? "#8B5CF6" : (String(routeId || "").startsWith("sorta_") ? "#1E90FF" : "#FF6B35");
          routeInfoPanel.style.background = chipBg;
          routeInfoPanel.style.display = "flex";
          routeInfoPanel.style.alignItems = "center";
          routeInfoPanel.style.justifyContent = "center";
          routeInfoPanel.style.cursor = "pointer"; // Make it clear it's clickable
          routeInfoPanel.style.zIndex = "1100";
          // Hide collapse button and close button
          collapseBtn.style.display = "none";
          closeBtn.style.display = "none";
          routeInfoPanel.querySelector(".route-info-content").style.display = "none";
          // Show collapsed route number (circle)
          const collapsedName = routeInfoPanel.querySelector(".route-name-collapsed");
          if (collapsedName) {
            collapsedName.style.display = "block";
            collapsedName.style.color = pickContrastingTextColor(chipBg);
            collapsedName.style.fontWeight = "bold";
            collapsedName.style.fontSize = isPill ? "0.68rem" : "1rem";
            collapsedName.style.lineHeight = isPill ? "1.15" : "1";
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
          routeInfoPanel.style.zIndex = "1200";
          
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
      
      // Collapsed route number (circle/pill display)
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
      const chipSpec = buildRouteFloatingChipLabel(routeId);
      const isPill = !!chipSpec.isAgencyStyle;
      collapsedName.textContent = chipSpec.label;
      collapsedName.style.cssText = `
        display:none;
        position:relative;
        color:${pickContrastingTextColor(routeInfoPanel.style.background || "#FF6B35")};
        font-weight:bold;
        font-size:${isPill ? "0.68rem" : "1rem"};
        pointer-events:none;
        text-align:center;
        line-height:${isPill ? "1.15" : "1"};
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
      collapsedName.style.color = pickContrastingTextColor(routeInfoPanel.style.background || "#FF6B35");
      collapsedName.style.fontWeight = "bold";
      collapsedName.style.fontSize = isPill ? "0.68rem" : "1rem";
      collapsedName.style.lineHeight = isPill ? "1.15" : "1";
      collapsedName.style.pointerEvents = "none"; // Don't block clicks on the circle

      routeOverlayPanelHost(map).appendChild(routeInfoPanel);
      overlayElements.controls.push(routeInfoPanel);
    }

    /*
     * Bus tracking (mainOverlay only)
     * -------------------------------
     * Polls live vehicle data based on CITY_CONFIG.busApiType:
     *   - mbta-gtfs-rt: GTFS-RT VehiclePositions (primary) + MBTA V3 for enrichment / fallback paths
     *   - trimet / tarc / custom: other branches below in fetchAndDisplayBuses
     * URLs and flags come from options or window.CITY_CONFIG (gtfsRtUrl, disableGtfsRt, etc.).
     * MBTA protobuf decode + V3 HTTP live in the top of this same file — this block orchestrates fetch → filter → markers.
     */
    if (trackBuses && mode === "mainOverlay") {
      const busMarkers = {}; // Store bus markers separately
      let busesFetchInFlight = false;
      let busesFetchSeq = 0;
      let lastEmergencyGtfsRtFallbackAt = 0;
      
      // Get API configuration from options or global CITY_CONFIG
      const busApiType = options.busApiType || (window.CITY_CONFIG && window.CITY_CONFIG.busApiType) || 'trimet';
      const gtfsRtUrl = options.gtfsRtUrl || (window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtUrl) || null;
      const gtfsRtUrls = options.gtfsRtUrls || (window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtUrls) || null;
      const gtfsRtProxyUrls = options.gtfsRtProxyUrls || (window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtProxyUrls) || null;
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
              
              const busElement = buildMbtaBusMarkerElement(routeColor, metrofeedFormatRouteBadge(routeId), displayVehicleID);
              const busMarker = new maplibregl.Marker({
                element: busElement,
                ...mbtaBusMarkerMapOptions()
              }).setLngLat([bus.longitude, bus.latitude]);
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
          
          if (busApiType === 'gtfs-rt' && !disableGtfsRt) {
            const resolvedProxyUrls = Array.isArray(gtfsRtProxyUrls) && gtfsRtProxyUrls.length ? gtfsRtProxyUrls.filter(Boolean) : [];
            const resolvedUrls = Array.isArray(gtfsRtUrls) && gtfsRtUrls.length ? gtfsRtUrls.filter(Boolean) : (gtfsRtUrl ? [gtfsRtUrl] : []);
            const urlsToFetch = resolvedProxyUrls.length ? resolvedProxyUrls : resolvedUrls;
            if (!urlsToFetch.length) {
              console.warn('[attachRouteToMap] gtfs-rt mode but no URLs configured.', { gtfsRtProxyUrls, gtfsRtUrls, gtfsRtUrl });
            } else {
              console.log('[attachRouteToMap] Fetching GTFS-RT feed(s):', urlsToFetch);
              const feedResults = await Promise.all(urlsToFetch.map(async (url) => {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`GTFS-RT HTTP ${res.status}: ${res.statusText} (${url})`);
                const contentType = (res.headers.get('content-type') || '').toLowerCase();
                const looksJson = url.toLowerCase().includes('.json') || contentType.includes('application/json') || contentType.includes('+json');
                if (looksJson) {
                  const j = await res.json();
                  return parseVehiclesJsonToGtfsLike(j);
                }
                const buffer = await res.arrayBuffer();
                return await parseMBTAGTFSRT(buffer);
              }));
              allBuses = feedResults.flat();
              console.log('[attachRouteToMap] Parsed', allBuses.length, 'vehicles from GTFS-RT');
            }
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
            // Cincinnati proxy feeds may omit direction_id; treat unknown direction as "matches" so buses show up.
            const directionMatch = (v.direction == null || v.direction === '') ? true : (Number(v.direction) === Number(directionId));
            
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
            
            const displayVehicleID = metrofeedFormatVehicleLabel(bus.vehicleID, routeId);
            
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
            
            const busElement = buildMbtaBusMarkerElement(routeColor, metrofeedFormatRouteBadge(routeId), displayVehicleID);
            const busMarker = new maplibregl.Marker({
              element: busElement,
              ...mbtaBusMarkerMapOptions()
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

/**
 * Main map route overlays (home/premium): colors from this list in order as routes open.
 * First open → [0], second → [1], … Reuses freed slots when you close a route.
 * Mello Yello / late-80s NASCAR billboard vibe — replace hexes anytime.
 */
window.ROUTE_OVERLAY_COLOR_PALETTE = [
  "#FFE135",
  "#6B2C91",
  "#FF3EB5",
  "#00C853",
  "#FF6D00",
  "#00B8D4",
  "#E53935",
  "#FFEA00",
  "#651FFF",
  "#76FF03",
  "#FF9100",
  "#2979FF"
];

/**
 * Smallest palette index not already used by an entry in window.activeRouteOverlayDescriptors.
 */
window.pickNextRouteOverlayColorSlot = function pickNextRouteOverlayColorSlot() {
  const pal = window.ROUTE_OVERLAY_COLOR_PALETTE;
  if (!pal || pal.length === 0) return 0;
  const desc = window.activeRouteOverlayDescriptors || {};
  const used = new Set();
  Object.keys(desc).forEach((k) => {
    const ci = desc[k] && desc[k].colorIndex;
    if (Number.isInteger(ci)) used.add(((ci % pal.length) + pal.length) % pal.length);
  });
  for (let i = 0; i < pal.length; i++) {
    if (!used.has(i)) return i;
  }
  return Object.keys(desc).length % pal.length;
};

// Expose globally for both route pages and main map
window.attachRouteToMap = attachRouteToMap;

