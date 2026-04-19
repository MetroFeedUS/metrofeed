/**
 * MetroFeed Route Overlay — Cincinnati build
 *
 * - Draws route polylines/stops and live bus markers (JSON vehicle proxy + trips.json ETAs).
 * - City behavior: window.CITY_CONFIG (city-config.js) — gtfsRtProxyUrls, realtimeTripsUrl, etc.
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

(function () {
  // Allow safe devtools hot-injection / double-load without "already declared" SyntaxErrors.
  // If this script is already loaded on the page, skip re-executing it.
  try {
    if (typeof window !== 'undefined' && window.__METROFEED_ROUTE_OVERLAY_LOADED__) {
      return;
    }
    if (typeof window !== 'undefined') window.__METROFEED_ROUTE_OVERLAY_LOADED__ = true;
  } catch (_) {}

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

function metrofeedAngleDeltaDeg(a, b) {
  // Smallest signed diff between headings a and b (degrees)
  let d = ((Number(a) - Number(b)) % 360 + 540) % 360 - 180;
  if (!Number.isFinite(d)) d = 0;
  return d;
}

function inferDirectionFromBearing(routeShape, bearingDeg) {
  // Infer directionId (0 or 1) by comparing vehicle bearing to the route's overall heading.
  // Direction 0 ~ from first point → last point. Direction 1 is opposite.
  if (!Array.isArray(routeShape) || routeShape.length < 2) return null;
  const b = Number(bearingDeg);
  if (!Number.isFinite(b)) return null;

  // Find a robust coarse heading using endpoints with some separation.
  const p0 = routeShape[0];
  const p1 = routeShape[Math.max(1, Math.floor(routeShape.length * 0.15))];
  const pn = routeShape[routeShape.length - 1];
  const pn1 = routeShape[Math.max(0, routeShape.length - 1 - Math.max(1, Math.floor(routeShape.length * 0.15)))];

  // shape points are [lat, lon] in your JSON
  const latA = Number(p0 && p0[0]);
  const lonA = Number(p0 && p0[1]);
  const latB = Number(p1 && p1[0]);
  const lonB = Number(p1 && p1[1]);
  const latC = Number(pn1 && pn1[0]);
  const lonC = Number(pn1 && pn1[1]);
  const latD = Number(pn && pn[0]);
  const lonD = Number(pn && pn[1]);
  if (![latA, lonA, latB, lonB, latC, lonC, latD, lonD].every(Number.isFinite)) return null;

  const headingDeg = (lat1, lon1, lat2, lon2) => {
    const toRad = (x) => (x * Math.PI) / 180;
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    let brng = (Math.atan2(y, x) * 180) / Math.PI;
    brng = (brng + 360) % 360;
    return brng;
  };

  // Average a "start heading" and "end heading" for stability
  const hStart = headingDeg(latA, lonA, latB, lonB);
  const hEnd = headingDeg(latC, lonC, latD, lonD);
  const h0 = ((hStart + hEnd) / 2) % 360;
  const h1 = (h0 + 180) % 360;

  const d0 = Math.abs(metrofeedAngleDeltaDeg(b, h0));
  const d1 = Math.abs(metrofeedAngleDeltaDeg(b, h1));
  return d0 <= d1 ? 0 : 1;
}

function metrofeedMaybeFlipInferredDirection(dir) {
  if (dir !== 0 && dir !== 1) return dir;
  const flip = !!(window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtFlipInferredDirection);
  return flip ? (dir === 0 ? 1 : 0) : dir;
}

function metrofeedBearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  brng = (brng + 360) % 360;
  return brng;
}

/**
 * Bearing of the route polyline at/near a stop. Uses the closest shape point and its neighbor.
 * shape coordinates are [lat, lon].
 */
function metrofeedLocalShapeBearingAtLatLon(shape, lat, lon) {
  if (!Array.isArray(shape) || shape.length < 2) return null;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;

  let bestIdx = -1;
  let bestD = Infinity;
  for (let i = 0; i < shape.length; i++) {
    const p = shape[i];
    const pla = Number(p && p[0]);
    const plo = Number(p && p[1]);
    if (!Number.isFinite(pla) || !Number.isFinite(plo)) continue;
    const dLat = pla - la;
    const dLon = plo - lo;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  const i0 = Math.max(0, Math.min(shape.length - 1, bestIdx));
  const i1 = i0 === shape.length - 1 ? i0 - 1 : i0 + 1;
  if (i1 < 0 || i1 >= shape.length) return null;
  const p0 = shape[i0];
  const p1 = shape[i1];
  const lat1 = Number(p0 && p0[0]);
  const lon1 = Number(p0 && p0[1]);
  const lat2 = Number(p1 && p1[0]);
  const lon2 = Number(p1 && p1[1]);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  return metrofeedBearingDeg(lat1, lon1, lat2, lon2);
}

function metrofeedBuildDirectionalStopElement(directionId, shape, stopLat, stopLon) {
  const wrap = document.createElement('div');
  wrap.style.width = '30px';
  wrap.style.height = '30px';
  wrap.style.position = 'relative';
  wrap.style.pointerEvents = 'auto';
  wrap.style.cursor = 'pointer';

  const pin = document.createElement('div');
  pin.style.cssText = [
    'position:absolute',
    'left:4px',
    'top:4px',
    'width:22px',
    'height:22px',
    'border-radius:999px',
    'background:#1E90FF',
    'border:2px solid #ffffff',
    'box-shadow:0 2px 6px rgba(0,0,0,0.45)'
  ].join(';');

  const inner = document.createElement('div');
  inner.style.cssText = [
    'position:absolute',
    'left:50%',
    'top:50%',
    'width:9px',
    'height:9px',
    'transform:translate(-50%,-50%)',
    'border-radius:999px',
    'background:#ffffff'
  ].join(';');
  pin.appendChild(inner);

  // Fin with white outline so it stays visible on dark maps.
  const finOutline = document.createElement('div');
  finOutline.style.position = 'absolute';
  finOutline.style.left = '50%';
  finOutline.style.top = '50%';
  finOutline.style.width = '0';
  finOutline.style.height = '0';
  finOutline.style.borderTop = '9px solid transparent';
  finOutline.style.borderBottom = '9px solid transparent';
  finOutline.style.borderLeft = '16px solid #ffffff';
  finOutline.style.opacity = '0.95';
  finOutline.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.45))';

  const fin = document.createElement('div');
  fin.style.position = 'absolute';
  fin.style.left = '50%';
  fin.style.top = '50%';
  fin.style.width = '0';
  fin.style.height = '0';
  fin.style.borderTop = '7px solid transparent';
  fin.style.borderBottom = '7px solid transparent';
  fin.style.borderLeft = '13px solid #1E90FF';
  fin.style.opacity = '0.98';

  const base = metrofeedLocalShapeBearingAtLatLon(shape, stopLat, stopLon);
  // Default points east if we can't compute.
  let deg = Number.isFinite(base) ? base : 90;
  // The fin triangle points "east" (90°) by default, so rotate relative.
  // And for dir1, flip 180°. If Cincinnati flip is enabled, swap dir0/dir1 sense for stop arrows too.
  const flipSense = !!(window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtFlipInferredDirection);
  const dirIsOne = Number(directionId) === 1;
  const shouldFlip = flipSense ? !dirIsOne : dirIsOne;
  const dirFlip = shouldFlip ? 180 : 0;
  const rotate = (deg - 90 + dirFlip + 360) % 360;
  const t = `translate(4px, -50%) rotate(${rotate}deg)`;
  finOutline.style.transform = t;
  fin.style.transform = t;
  finOutline.style.transformOrigin = '0 50%';
  fin.style.transformOrigin = '0 50%';

  wrap.appendChild(finOutline);
  wrap.appendChild(fin);
  wrap.appendChild(pin);
  return wrap;
}

/**
 * Rider-facing bus label for map + popups.
 * Prefer GTFS-RT-style public label (vehicle.label) when the proxy sends it; else fall back to vehicle id.
 * @param {string|{vehicleID?:string,displayNumber?:string}} vehicleIDRawOrBus - legacy string id, or bus object from parseVehiclesJsonToGtfsLike
 * @param {string} routeId
 */
function metrofeedFormatVehicleLabel(vehicleIDRawOrBus, routeId) {
  const rid = routeId != null ? String(routeId) : "";
  let raw = "";
  if (vehicleIDRawOrBus && typeof vehicleIDRawOrBus === "object") {
    const d = vehicleIDRawOrBus.displayNumber;
    raw =
      d != null && String(d).trim() !== ""
        ? String(d).trim()
        : vehicleIDRawOrBus.vehicleID != null
          ? String(vehicleIDRawOrBus.vehicleID)
          : "";
  } else {
    raw = vehicleIDRawOrBus != null ? String(vehicleIDRawOrBus) : "";
  }
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
    // Public bus number (go-metro site / apps) is usually GTFS vehicle.label, not vehicle.descriptor.id.
    const displayNumberRaw =
      v.label ??
      v.vehicle_label ??
      v.vehicleLabel ??
      v.display_id ??
      v.displayId ??
      v.display_number ??
      v.displayNumber ??
      v.fleet_number ??
      v.fleetNumber ??
      v.license_plate ??
      v.licensePlate ??
      v?.vehicle?.label ??
      v?.vehicle?.license_plate ??
      null;
    const displayNumber =
      displayNumberRaw != null && String(displayNumberRaw).trim() !== ""
        ? String(displayNumberRaw).trim()
        : null;

    out.push({
      vehicleID: vehId != null ? String(vehId) : "",
      displayNumber,
      routeNumber: route != null ? String(route) : "",
      direction: dir != null && dir !== "" ? Number(dir) : null,
      latitude: Number(lat),
      longitude: Number(lon),
      bearing: v.bearing ?? v?.position?.bearing ?? null,
      speed: v.speed ?? v?.position?.speed ?? null,
      blockID: v.blockID ?? v.blockId ?? v.block_id ?? displayNumber ?? v.label ?? (vehId != null ? String(vehId) : ""),
      occupancy: v.occupancy ?? v.occupancy_status ?? null,
      tripId:
        v.trip_id != null && String(v.trip_id) !== ""
          ? String(v.trip_id)
          : v.tripId != null && String(v.tripId) !== ""
            ? String(v.tripId)
            : v?.trip?.trip_id != null && String(v.trip.trip_id) !== ""
              ? String(v.trip.trip_id)
              : null,
      /** When the vehicle proxy embeds GTFS-style stop times (same as TripUpdate.stop_time_update), use these first. */
      stop_updates:
        Array.isArray(v.stop_updates) ? v.stop_updates
        : Array.isArray(v.stopUpdates) ? v.stopUpdates
        : null
    });
  }
  return out;
}

/** Merge multiple { trips: [...] } payloads; later URLs overwrite same trip_id (e.g. full trip_updates over partial trips). */
function metrofeedMergeRealtimeTripJsonParts(jsonParts) {
  const byId = new Map();
  for (let p = 0; p < jsonParts.length; p++) {
    const part = jsonParts[p];
    const trips = Array.isArray(part && part.trips) ? part.trips : [];
    for (let i = 0; i < trips.length; i++) {
      const t = trips[i];
      const id = t.trip_id != null ? String(t.trip_id) : "";
      if (id) byId.set(id, t);
    }
  }
  return Array.from(byId.values());
}

/**
 * VPS realtime trips.json (e.g. Cincinnati): { trips: [{ agency, trip_id, route_id, stop_updates: [{ stop_id, arrival, departure }] }] }
 * - tripUpdatesByTripId: **all** trips for the overlay agency (not only the open route), keyed by trip_id, so vehicle trip_ids resolve to real stop_updates.
 * - updatesByStopId: only trips matching this route (for stop-marker ETAs on the sheet).
 */
function parseRealtimeTripsJsonToTripUpdates(json, feedRouteId, routeData) {
  const updatesByStopId = Object.create(null);
  const tripUpdatesByTripId = Object.create(null);
  const trips = Array.isArray(json && json.trips) ? json.trips : [];
  const nowSec = Math.floor(Date.now() / 1000);

  const feed = String(feedRouteId || "");
  const agencyWant = feed.startsWith("sorta_") ? "sorta" : feed.startsWith("tank_") ? "tank" : null;
  const feedRouteNum =
    feed.startsWith("sorta_") ? feed.slice(6) : feed.startsWith("tank_") ? feed.slice(5) : feed;
  const dataRouteNum =
    routeData && routeData.route_number != null ? String(routeData.route_number) : null;
  const normNum = (s) => {
    const d = String(s || "").replace(/[^0-9A-Za-z]/g, "");
    return d.replace(/^0+(?=\d)/, "") || d;
  };

  const tripMatchesRoute = (trip) => {
    if (agencyWant && trip.agency && String(trip.agency).toLowerCase() !== agencyWant) return false;
    const tr = trip.route_id != null ? String(trip.route_id) : "";
    if (!tr) return false;
    if (tr === feedRouteNum) return true;
    if (dataRouteNum && tr === dataRouteNum) return true;
    const a = normNum(tr);
    const b = normNum(feedRouteNum);
    if (a && b && a === b) return true;
    return false;
  };

  const tripMatchesAgencyOnly = (trip) => {
    if (!agencyWant) return true;
    const a = trip.agency != null ? String(trip.agency).toLowerCase() : "";
    if (!a) return true;
    return a === agencyWant;
  };

  for (let i = 0; i < trips.length; i++) {
    const trip = trips[i];
    if (!tripMatchesAgencyOnly(trip)) continue;
    const tid = trip.trip_id != null ? String(trip.trip_id) : "";
    if (tid) tripUpdatesByTripId[tid] = trip;

    if (!tripMatchesRoute(trip)) continue;
    const stops = Array.isArray(trip.stop_updates) ? trip.stop_updates : [];
    for (let j = 0; j < stops.length; j++) {
      const su = stops[j];
      const sid = su.stop_id != null ? String(su.stop_id) : "";
      if (!sid) continue;
      const tSec =
        su.arrival != null ? Number(su.arrival) : su.departure != null ? Number(su.departure) : null;
      if (!Number.isFinite(tSec)) continue;
      if (tSec < nowSec - 120) continue;
      if (!updatesByStopId[sid]) updatesByStopId[sid] = [];
      updatesByStopId[sid].push({
        time: tSec,
        routeId: feedRouteId,
        directionId: null,
        delay: null
      });
    }
  }

  const keys = Object.keys(updatesByStopId);
  for (let k = 0; k < keys.length; k++) {
    const sid = keys[k];
    const arr = updatesByStopId[sid];
    arr.sort((a, b) => a.time - b.time);
    const seen = new Set();
    updatesByStopId[sid] = arr
      .filter((u) => {
        if (seen.has(u.time)) return false;
        seen.add(u.time);
        return true;
      })
      .slice(0, 4);
  }

  return { updatesByStopId, tripUpdatesByTripId };
}

/** How many stops on a live trip appear on the static route sheet (branch / direction alignment). */
function metrofeedTripStopOverlapCount(trip, stopIdSet) {
  if (!trip || !Array.isArray(trip.stop_updates) || !stopIdSet || !stopIdSet.size) return 0;
  let hits = 0;
  for (let i = 0; i < trip.stop_updates.length; i++) {
    const sid = trip.stop_updates[i].stop_id != null ? String(trip.stop_updates[i].stop_id) : "";
    if (sid && stopIdSet.has(sid)) hits++;
  }
  return hits;
}

/**
 * Format occupancy status to friendly text
 * @param {string} occupancy - Raw occupancy status from feed (if present)
 * @returns {string} Friendly occupancy text
 */
function formatOccupancy(occupancy) {
  if (!occupancy || occupancy === 'Unknown') return 'Unknown';
  
  const occupancyMap = {
    EMPTY: 'Empty',
    MANY_SEATS_AVAILABLE: 'Many Seats Available',
    FEW_SEATS_AVAILABLE: 'Few Seats Available',
    STANDING_ROOM_ONLY: 'Standing Room Only',
    CRUSHED_STANDING_ROOM_ONLY: 'Crushed Standing Room Only',
    FULL: 'Full',
    NOT_ACCEPTING_PASSENGERS: 'Not Accepting Passengers'
  };
  
  return occupancyMap[occupancy] || occupancy;
}

/** GTFS-RT OccupancyStatus enum when the proxy sends a number. */
function metrofeedNormalizeOccupancyRaw(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const byNum = {
      0: 'EMPTY',
      1: 'MANY_SEATS_AVAILABLE',
      2: 'FEW_SEATS_AVAILABLE',
      3: 'STANDING_ROOM_ONLY',
      4: 'CRUSHED_STANDING_ROOM_ONLY',
      5: 'FULL',
      6: 'NOT_ACCEPTING_PASSENGERS'
    };
    const k = byNum[raw];
    if (k) return k;
  }
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return metrofeedNormalizeOccupancyRaw(n);
  }
  return s.toUpperCase().replace(/\s+/g, '_');
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

function metrofeedStopUpdateTimeSec(su) {
  if (!su) return null;
  if (su.arrival != null && Number.isFinite(Number(su.arrival))) return Number(su.arrival);
  if (su.departure != null && Number.isFinite(Number(su.departure))) return Number(su.departure);
  return null;
}

/**
 * Next stop + ETA strictly from TripUpdate-style stop_updates (Unix arrival/departure).
 * Uses the first stop with a predicted time at/after now − 90s — no guessing when data is missing.
 */
function metrofeedNextStopFromRealtimeTrip(trip, stopIdToName) {
  if (!trip || !Array.isArray(trip.stop_updates) || !trip.stop_updates.length) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const stops = trip.stop_updates;

  for (let i = 0; i < stops.length; i++) {
    const tSec = metrofeedStopUpdateTimeSec(stops[i]);
    if (!Number.isFinite(tSec)) continue;
    if (tSec < nowSec - 90) continue;
    const sid = stops[i].stop_id != null ? String(stops[i].stop_id) : "";
    const name =
      sid && stopIdToName && stopIdToName[sid] ? stopIdToName[sid] : sid || "Next stop";
    return {
      stopName: name,
      eta: formatETA(new Date(tSec * 1000)),
      stopId: sid,
      timeSec: tSec
    };
  }
  return null;
}

/** Half-width of GPS dot (px). Used with anchor "bottom" + offset so dot center sits on lat/lng. */
// Use var + window backing so routeOverlay.js can be hot-loaded safely in devtools.
// (Top-level const would throw "already been declared" if the script is injected twice.)
var MBTA_BUS_MARKER_DOT_RADIUS_PX =
  (typeof window !== 'undefined' && window.MBTA_BUS_MARKER_DOT_RADIUS_PX)
    ? window.MBTA_BUS_MARKER_DOT_RADIUS_PX
    : 6;
try { if (typeof window !== 'undefined') window.MBTA_BUS_MARKER_DOT_RADIUS_PX = MBTA_BUS_MARKER_DOT_RADIUS_PX; } catch (_) {}

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
  const fg = pickContrastingTextColor(routeColor);
  // Route badge: invert background so the route number is readable even on bright/yellow routeColor.
  const badgeBg = fg;
  const badgeFg = routeColor;
  wrap.innerHTML = `
    <div style="margin-bottom:6px;background:${routeColor};color:${fg};padding:3px 8px;border-radius:8px;font-weight:bold;font-size:11px;box-shadow:0 2px 4px rgba(0,0,0,0.3);border:2px solid rgba(255,255,255,0.95);white-space:nowrap;">
      <span style="background:${badgeBg};color:${badgeFg};padding:1px 3px;border-radius:2px;font-size:9px;margin-right:4px;">${String(routeNum)}</span>${String(displayVehicleID)}
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
/** Used by home.html createBusMarker when present; same rules as metrofeedFormatVehicleLabel(bus, routeNumber). */
try {
  window.metrofeedFormatVehicleMainLabel = function (bus, routeNumber) {
    return metrofeedFormatVehicleLabel(bus, routeNumber);
  };
} catch (_) {}

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
    stopPopupRefreshers: [], // { overlayKey, fn } refresh stop popup when realtime trips load
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
    
    // Get current weekday in the route's timezone (NOT the browser timezone)
    const dayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: agencyTimezone, weekday: "long" });
    const tzWeekdayName = dayFormatter.format(now); // e.g. "Thursday"
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const currentDayTz = Math.max(0, dayNames.indexOf(tzWeekdayName)); // 0..6 (fallback to 0 if unknown)
    
    // Determine which schedule bucket to use
    let scheduleBucket = "weekday";
    if (currentDayTz === 0) scheduleBucket = "sunday";
    else if (currentDayTz === 6) scheduleBucket = "saturday";
    
    console.log(`[attachRouteToMap] 📅 Today is ${tzWeekdayName} (tz day ${currentDayTz}) - Using schedule bucket: "${scheduleBucket}"`);
    
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
    
    // Cincinnati unified builder emits `routeData.schedule.{weekday|saturday|sunday}.stops[stop_id]`.
    // Boston-era `weeklyTimes` is still supported for compatibility.
    const schedule = routeData.schedule || null;
    const weeklyTimes = routeData.weeklyTimes || {};
    
    const availableBuckets = [
      ...new Set([
        ...Object.keys(schedule || {}),
        ...Object.keys(weeklyTimes || {})
      ])
    ];
    console.log(`[attachRouteToMap] 📋 Available schedule buckets in route data: ${availableBuckets.length > 0 ? availableBuckets.join(', ') : 'none (using legacy format)'}`);
    
    const hasBucket =
      (schedule && schedule[scheduleBucket] && schedule[scheduleBucket].stops) ||
      (weeklyTimes && weeklyTimes[scheduleBucket]);
    if (!hasBucket && availableBuckets.length > 0) {
      console.warn(`[attachRouteToMap] ⚠️ Schedule bucket "${scheduleBucket}" not found in route data. Available: ${availableBuckets.join(', ')}. Falling back to weekday.`);
      scheduleBucket = "weekday";
    }

    stops.forEach((stop) => {
      const lat = stop.lat;
      const lon = stop.lon;

      if (typeof lat !== "number" || typeof lon !== "number") return;

      // Get times for this stop from weeklyTimes
      const stopId = String(stop.stop_id || "");
      let timesArray = [];
      let timesSource = 'none';
      
      // 1) New unified builder schedule block
      if (schedule && schedule[scheduleBucket] && schedule[scheduleBucket].stops && schedule[scheduleBucket].stops[stopId]) {
        timesArray = schedule[scheduleBucket].stops[stopId];
        timesSource = `schedule.${scheduleBucket}`;
      } else if (schedule && schedule.weekday && schedule.weekday.stops && schedule.weekday.stops[stopId]) {
        timesArray = schedule.weekday.stops[stopId];
        timesSource = 'schedule.weekday (fallback)';
      }
      // 2) Legacy `weeklyTimes` block
      else if (weeklyTimes[scheduleBucket] && weeklyTimes[scheduleBucket][stopId]) {
        timesArray = weeklyTimes[scheduleBucket][stopId];
        timesSource = `weeklyTimes.${scheduleBucket}`;
      } else if (weeklyTimes.weekday && weeklyTimes.weekday[stopId]) {
        timesArray = weeklyTimes.weekday[stopId];
        timesSource = 'weeklyTimes.weekday (fallback)';
      }
      // 3) Legacy per-stop times array (compat)
      else if (Array.isArray(stop.times)) {
        // Legacy fallback to stop.times
        timesArray = stop.times;
        timesSource = 'legacy stop.times';
      }

      // Debug helper: confirm stop_id → times mapping (enable by setting window.DEBUG_STOP_TIMES = true)
      try {
        if (window.DEBUG_STOP_TIMES) {
          const nm = String(stop && stop.name ? stop.name : '');
          if (!window.__mfStopTimesDebugSeen) window.__mfStopTimesDebugSeen = {};
          const key = `${String(routeId)}|${String(directionId)}|${String(stopId)}|${nm}`;
          if (!window.__mfStopTimesDebugSeen[key]) {
            window.__mfStopTimesDebugSeen[key] = true;
            console.log('[StopTimesDebug] stop popup source', {
              routeId,
              directionId,
              stopName: nm,
              stopId,
              timesSource,
              sampleTimes: Array.isArray(timesArray) ? timesArray.slice(0, 12) : []
            });
          }
        }
      } catch (_) {}
      
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
      const useDirectionalStops = !!(window.CITY_CONFIG && window.CITY_CONFIG.directionalStopMarkers);
      const stopElement = useDirectionalStops
        ? metrofeedBuildDirectionalStopElement(directionId, primaryShape, lat, lon)
        : document.createElement("div");
      if (!useDirectionalStops) {
        stopElement.style.width          = "12px";
        stopElement.style.height         = "12px";
        stopElement.style.backgroundColor= "#1E90FF";
        stopElement.style.borderRadius   = "50%";
        stopElement.style.border         = "2px solid #fff";
        stopElement.style.opacity        = "0.9";
        stopElement.style.cursor         = "pointer";
      }
      stopElement.addEventListener('click', () => {
        try {
          if (!window.DEBUG_STOP_TIMES) return;
          console.log('[StopTimesDebug] click', {
            routeId,
            directionId,
            stopName: stop && stop.name ? String(stop.name) : '',
            stopId,
            timesSource,
            sampleTimes: Array.isArray(timesArray) ? timesArray.slice(0, 12) : []
          });
        } catch (_) {}
      });

      const stopMarker = new maplibregl.Marker({ element: stopElement })
        .setLngLat([lon, lat]);

      // ETA display (realtime trips.json → TripUpdates-shaped data)
      const getETADisplay = () => {
        try {
          const overlayKey = etaOverlayKey;
          const tu = (window.currentRouteTripUpdates && window.currentRouteTripUpdates.overlayKey === overlayKey)
            ? window.currentRouteTripUpdates
            : null;
          const stopIdKey = String(stop.stop_id || stopId);
          const tuLabel = (tu && tu.etaLabel) ? tu.etaLabel : "Live";
          const tuListRaw = tu && tu.updatesByStopId && tu.updatesByStopId[stopIdKey] ? tu.updatesByStopId[stopIdKey] : [];
          const tuList = tuListRaw
            .filter(u => !u.routeId || String(u.routeId) === String(routeId))
            .filter(u => u.directionId === null || u.directionId === undefined || u.directionId == directionId)
            .slice(0, 2)
            .map(u => {
              const t = formatETA(new Date((u.time || 0) * 1000));
              const delay = (u.delay || u.delay === 0) ? `${u.delay >= 0 ? '+' : ''}${u.delay}s` : '';
              return `<div style="display:flex;justify-content:space-between;gap:10px;"><span style="color:#bbb;">${tuLabel}</span><span style="color:#1E90FF;font-weight:bold;">${t}</span><span style="color:#888;font-size:12px;">${delay}</span></div>`;
            });

          if (tuList.length === 0) return '';

          return `
            <hr style="border:none;border-top:1px solid #1E90FF;margin:6px 0;">
            <div style="font-size:12px;color:#fff;margin-bottom:4px;"><strong>Next arrivals</strong></div>
            <div style="display:flex;flex-direction:column;gap:4px;">
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
      const chipBg = routeColor || (String(routeId || "").startsWith("tank_") ? "#8B5CF6" : (String(routeId || "").startsWith("sorta_") ? "#1E90FF" : "#FF6B35"));
      const chipFg = pickContrastingTextColor(chipBg);
      const circleSize = isPill ? 28 : 34;
      const circleSpacing = 10; // Space between circles
      const topOffset = typeof window.metrofeedGetRightRailTopOffset === 'function'
        ? window.metrofeedGetRightRailTopOffset()
        : 250; // Fallback
      const verticalPosition = topOffset + (panelIndex * (circleSize + circleSpacing));
      
      // Set initial collapsed state (circle in corner)
      routeInfoPanel.setAttribute('data-collapsed', 'true');
      routeInfoPanel.setAttribute('data-collapse-index', panelIndex.toString());
      
      routeInfoPanel.style.cssText = `
        position:absolute;
        right:10px;
        top:${verticalPosition}px;
        width:${isPill ? "auto" : (circleSize + "px")};
        height:${circleSize}px;
        min-width:${isPill ? "0" : (circleSize + "px")};
        max-width:unset;
        min-height:${circleSize}px;
        max-height:${circleSize}px;
        padding:${isPill ? "0 8px" : "0"};
        border-radius:${isPill ? "999px" : "50%"};
        border:2px solid rgba(255,255,255,0.95);
        background:${chipBg};
        color:${chipFg};
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
      // Keep collapse/close button readable on bright route colors (e.g. yellow)
      collapseBtn.style.color = chipFg;
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
          const chipBg = routeColor || (String(routeId || "").startsWith("tank_") ? "#8B5CF6" : (String(routeId || "").startsWith("sorta_") ? "#1E90FF" : "#FF6B35"));
          const chipFg = pickContrastingTextColor(chipBg);
          const circleSize = isPill ? 28 : 34;
          const circleSpacing = 10; // Space between circles
          const topOffset = typeof window.metrofeedGetRightRailTopOffset === 'function'
            ? window.metrofeedGetRightRailTopOffset()
            : 250; // Fallback
          const verticalPosition = topOffset + (panelIndex * (circleSize + circleSpacing));
          
          // Mark this panel as collapsed and store its position index
          routeInfoPanel.setAttribute('data-collapsed', 'true');
          routeInfoPanel.setAttribute('data-collapse-index', panelIndex.toString());
          
          routeInfoPanel.style.left = "auto";
          routeInfoPanel.style.right = "10px";
          routeInfoPanel.style.top = `${verticalPosition}px`;
          routeInfoPanel.style.transform = "none"; // Remove centering transform
          routeInfoPanel.style.width = isPill ? "auto" : `${circleSize}px`;
          routeInfoPanel.style.height = `${circleSize}px`;
          routeInfoPanel.style.minWidth = isPill ? "0" : `${circleSize}px`;
          routeInfoPanel.style.maxWidth = "unset";
          routeInfoPanel.style.minHeight = `${circleSize}px`;
          routeInfoPanel.style.maxHeight = `${circleSize}px`;
          routeInfoPanel.style.padding = isPill ? "0 8px" : "0";
          routeInfoPanel.style.borderRadius = isPill ? "999px" : "50%";
          routeInfoPanel.style.border = "2px solid rgba(255,255,255,0.95)";
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
            collapsedName.style.color = chipFg;
            collapsedName.style.fontWeight = "bold";
            collapsedName.style.fontSize = isPill ? "0.62rem" : "0.95rem";
            collapsedName.style.lineHeight = "1";
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
      // Keep close button readable on bright route colors (e.g. yellow)
      closeBtn.style.color = chipFg;
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
      // Reuse chipSpec/isPill from the collapsed panel styling above (same scope).
      collapsedName.textContent = chipSpec.label;
      collapsedName.style.cssText = `
        display:none;
        position:relative;
        color:${chipFg};
        font-weight:bold;
        font-size:${isPill ? "0.62rem" : "0.95rem"};
        pointer-events:none;
        text-align:center;
        line-height:1;
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
      collapsedName.style.color = chipFg;
      collapsedName.style.fontWeight = "bold";
      collapsedName.style.fontSize = isPill ? "0.62rem" : "0.95rem";
      collapsedName.style.lineHeight = "1";
      collapsedName.style.pointerEvents = "none"; // Don't block clicks on the circle

      routeOverlayPanelHost(map).appendChild(routeInfoPanel);
      overlayElements.controls.push(routeInfoPanel);
    }

    /*
     * Bus tracking (mainOverlay only)
     * Cincinnati: JSON vehicle proxy (gtfsRtProxyUrls) + optional trips.json for ETAs.
     */
    if (trackBuses && mode === "mainOverlay") {
      const busMarkers = {}; // Store bus markers separately
      let busesFetchInFlight = false;
      let busesFetchSeq = 0;
      /** Latest trips.json trip_id → trip (same route); used to drop vehicles on other Route N branches. */
      let tripIndexForPatternFilter = null;

      const busApiType = options.busApiType || (window.CITY_CONFIG && window.CITY_CONFIG.busApiType) || "gtfs-rt";
      const gtfsRtUrl = options.gtfsRtUrl || (window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtUrl) || null;
      const gtfsRtUrls = options.gtfsRtUrls || (window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtUrls) || null;
      const gtfsRtProxyUrls = options.gtfsRtProxyUrls || (window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtProxyUrls) || null;
      const realtimeTripsUrl =
        options.realtimeTripsUrl || (window.CITY_CONFIG && window.CITY_CONFIG.realtimeTripsUrl) || null;
      const disableGtfsRt = options.disableGtfsRt ?? (window.CITY_CONFIG && window.CITY_CONFIG.disableGtfsRt) ?? false;

      const stopIdToName = Object.create(null);
      (routeData.stops || []).forEach((s) => {
        const id = s.stop_id != null ? String(s.stop_id) : "";
        if (id && s.name) stopIdToName[id] = s.name;
      });
      
      async function fetchAndDisplayBuses() {
        if (busesFetchInFlight) {
          // Avoid overlapping vehicle fetches when upstream is slow
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
                console.warn(
                  "[attachRouteToMap] Non-JSON vehicle feed is not supported in Cincinnati routeOverlay; use a .json proxy URL.",
                  url
                );
                return [];
              }));
              allBuses = feedResults.flat();
              console.log('[attachRouteToMap] Parsed', allBuses.length, 'vehicles from GTFS-RT');
            }
          }

          // Filter buses for this route and direction
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
          
          let routeBuses = allBuses.filter((v) => {
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
            // Cincinnati proxy feeds may omit direction_id — infer from bearing when strict.
            const strictDir = !!(window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtStrictVehicleDirection);
            const excludeUnknownBearing = !!(
              window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtExcludeVehicleIfBearingUnknown
            );
            let directionMatch = true;
            if (v.direction == null || v.direction === "") {
              if (strictDir) {
                const inferredRaw = inferDirectionFromBearing(
                  routeData && routeData.shape ? routeData.shape : null,
                  v.bearing
                );
                const inferred = metrofeedMaybeFlipInferredDirection(inferredRaw);
                if (inferred == null) {
                  directionMatch = !excludeUnknownBearing;
                } else {
                  directionMatch = Number(inferred) === Number(directionId);
                }
              } else {
                directionMatch = true;
              }
            } else {
              directionMatch = Number(v.direction) === Number(directionId);
            }

            if (routeMatch && directionMatch) {
              console.log(
                `[attachRouteToMap] ✅ Matched bus: route "${v.routeNumber}" == "${routeNum}"${routeDataRouteId ? ` (route_id: "${routeDataRouteId}")` : ""}, direction ${v.direction} == ${directionId}`
              );
            }

            return routeMatch && directionMatch;
          });

          const filterOverlap = !!(
            window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtFilterVehiclesByTripStopOverlap
          );
          const overlapMin = Math.max(
            1,
            Number(window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtTripStopOverlapMin) || 2
          );
          if (filterOverlap && tripIndexForPatternFilter && (routeData.stops || []).length) {
            const stopIdSet = new Set();
            (routeData.stops || []).forEach((s) => {
              const id = s.stop_id != null ? String(s.stop_id) : "";
              if (id) stopIdSet.add(id);
            });
            const beforeCt = routeBuses.length;
            routeBuses = routeBuses.filter((v) => {
              if (!v.tripId) return true;
              const trip = tripIndexForPatternFilter[String(v.tripId)];
              if (!trip) return true;
              return metrofeedTripStopOverlapCount(trip, stopIdSet) >= overlapMin;
            });
            if (beforeCt !== routeBuses.length) {
              console.log("[attachRouteToMap] Trip/stop overlap filter:", beforeCt, "->", routeBuses.length);
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
          
          const vehiclesForMarkers = routeBuses;

          vehiclesForMarkers.forEach((bus) => {
            if (!bus.latitude || !bus.longitude) return;
            const blockId = bus.blockID || bus.vehicleID || '';
            if (!blockId) return;

            const displayVehicleID = metrofeedFormatVehicleLabel(bus, routeId);

            const getNextStopFromETAs = () => {
              const tu = window.currentRouteTripUpdates;
              if (!tu || tu.overlayKey !== etaOverlayKey || !tu.stopIdToName) return null;
              if (Array.isArray(bus.stop_updates) && bus.stop_updates.length) {
                return metrofeedNextStopFromRealtimeTrip(
                  { stop_updates: bus.stop_updates },
                  tu.stopIdToName
                );
              }
              if (!bus.tripId || !tu.tripUpdatesByTripId) return null;
              const trip = tu.tripUpdatesByTripId[String(bus.tripId)];
              if (!trip) return null;
              return metrofeedNextStopFromRealtimeTrip(trip, tu.stopIdToName);
            };

            const getOccupancyTextLive = () => {
              const tu = window.currentRouteTripUpdates;
              let occRaw = bus.occupancy ?? bus.occupancy_status;
              if (
                (!occRaw || occRaw === "") &&
                tu &&
                tu.overlayKey === etaOverlayKey &&
                bus.tripId &&
                tu.tripUpdatesByTripId
              ) {
                const tr = tu.tripUpdatesByTripId[String(bus.tripId)];
                if (tr) {
                  occRaw =
                    tr.occupancy ??
                    tr.occupancy_status ??
                    tr?.vehicle?.occupancy ??
                    tr?.vehicle?.occupancy_status ??
                    null;
                }
              }
              const occ = metrofeedNormalizeOccupancyRaw(occRaw);
              if (!occ) return "Not reported";
              return formatOccupancy(occ);
            };
            
            const busElement = buildMbtaBusMarkerElement(routeColor, metrofeedFormatRouteBadge(routeId), displayVehicleID);
            const busMarker = new maplibregl.Marker({
              element: busElement,
              ...mbtaBusMarkerMapOptions()
            });
            busMarker.setLngLat([bus.longitude, bus.latitude]);
            
            const popupContent = document.createElement('div');
            
            const refreshBusPopup = () => {
              let dirLabel = "";
              if (bus.direction === 1) dirLabel = "Inbound";
              else if (bus.direction === 0) dirLabel = "Outbound";
              else {
                const inferred = metrofeedMaybeFlipInferredDirection(
                  inferDirectionFromBearing(primaryShape, bus.bearing)
                );
                if (inferred === 0) dirLabel = "Outbound (GPS)";
                else if (inferred === 1) dirLabel = "Inbound (GPS)";
                else dirLabel = "Unknown";
              }
              const nextStopETA = getNextStopFromETAs();
              const tuLive = window.currentRouteTripUpdates;
              const hasRealtimeTrips =
                tuLive &&
                tuLive.overlayKey === etaOverlayKey &&
                tuLive.etaSource === "realtime-trips";
              let nextStopHTML = "";
              if (nextStopETA) {
                nextStopHTML = `<div style='margin-bottom:4px;'><strong>Next Stop:</strong> ${nextStopETA.stopName}</div><div style='margin-bottom:4px; color:#4CAF50;'><strong>ETA:</strong> ${nextStopETA.eta}</div>`;
              } else if (hasRealtimeTrips) {
                nextStopHTML =
                  '<div style="margin-bottom:4px; color:#888;"><strong>Next Stop:</strong> —</div><div style="margin-bottom:4px; color:#888;"><strong>ETA:</strong> —</div>';
              } else {
                nextStopHTML =
                  '<div style="margin-bottom:4px; color:#888;"><strong>Next Stop:</strong> Loading…</div>';
              }
              popupContent.innerHTML = `
              <div style='border:1px solid ${routeColor}; border-radius:8px; padding:10px; background:#222; color:#fff; min-width:180px;'>
                <div style='text-align:center; margin-bottom:6px;'>
                  <div style='background:${routeColor};color:#fff;padding:3px 8px;border-radius:6px;font-weight:bold;font-size:12px;'>🚌 Bus ${displayVehicleID}</div>
                </div>
                <div style='margin-bottom:4px;'><strong>Route:</strong> ${routeNum}</div>
                <div style='margin-bottom:4px;'><strong>Direction:</strong> ${dirLabel}</div>
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
          
          console.log(`[attachRouteToMap] Displayed ${vehiclesForMarkers.length} buses for route ${routeNum} direction ${directionId}`);
          
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
      
      const busInterval = setInterval(fetchAndDisplayBuses, 30000);
      overlayElements.intervals.push(busInterval);

      // gtfs-rt + VPS trips.json (+ optional gtfsRtTripUpdatesUrl) → TripUpdates-shaped data for stop + bus ETAs
      let realtimeTripsInterval = null;
      const gtfsRtTripUpdatesUrl =
        options.gtfsRtTripUpdatesUrl ||
        (window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtTripUpdatesUrl) ||
        null;
      const realtimeTripUrls = [...new Set([realtimeTripsUrl, gtfsRtTripUpdatesUrl].filter(Boolean))];
      if (busApiType === "gtfs-rt" && realtimeTripUrls.length) {
        const overlayKey = options.overlayKey || `${routeId}-${directionId}`;
        const fetchRealtimeTripsJson = async () => {
          try {
            const jsonParts = [];
            for (let ui = 0; ui < realtimeTripUrls.length; ui++) {
              const u = realtimeTripUrls[ui];
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 20000);
              const res = await fetch(u, { signal: controller.signal });
              clearTimeout(timeout);
              if (!res.ok) throw new Error(`realtime trips HTTP ${res.status}: ${res.statusText} (${u})`);
              jsonParts.push(await res.json());
            }
            const mergedTrips = metrofeedMergeRealtimeTripJsonParts(jsonParts);
            const parsed = parseRealtimeTripsJsonToTripUpdates({ trips: mergedTrips }, routeId, routeData);
            tripIndexForPatternFilter = parsed.tripUpdatesByTripId;
            window.currentRouteTripUpdates = {
              overlayKey,
              routeId: String(routeId),
              directionId,
              updatesByStopId: parsed.updatesByStopId,
              tripUpdatesByTripId: parsed.tripUpdatesByTripId,
              stopIdToName,
              etaLabel: "Live",
              etaSource: "realtime-trips",
              fetchedAt: new Date()
            };
            overlayElements.stopPopupRefreshers.forEach(({ overlayKey: ok, update }) => {
              if (ok === overlayKey) {
                try {
                  update();
                } catch (e) {}
              }
            });
            overlayElements.busPopupRefreshers.forEach((fn) => {
              try {
                fn();
              } catch (e) {}
            });
            // Re-run vehicle pass so trip/stop overlap filter can drop other Route N branches.
            setTimeout(() => {
              try {
                fetchAndDisplayBuses();
              } catch (e2) {}
            }, 150);
          } catch (e) {
            console.warn("[realtimeTrips] Unavailable:", e);
          }
        };
        fetchRealtimeTripsJson();
        realtimeTripsInterval = setInterval(fetchRealtimeTripsJson, 30000);
        overlayElements.intervals.push(realtimeTripsInterval);
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
      const thisOverlayKey = options.overlayKey || `${routeId}-${directionId}`;
      if (window.currentRouteTripUpdates && window.currentRouteTripUpdates.overlayKey === thisOverlayKey) {
        window.currentRouteTripUpdates = null;
      }
      
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

})();
