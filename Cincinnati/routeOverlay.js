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

/**
 * Infer GTFS direction_id (0 vs 1) for this overlay when the vehicle feed omits direction.
 * Uses the nearest segment of the route polyline (primaryShape) + GPS bearing vs segment tangent.
 * direction 0 aligns with shape order (vertex i → i+1); direction 1 is reversed.
 */
function inferDirectionFromPolylineAndBearing(routeShape, lat, lon, bearingDeg) {
  if (!Array.isArray(routeShape) || routeShape.length < 2) return null;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;

  let bestSeg = -1;
  let bestD2 = Infinity;
  let bestT = 0;
  let bestAx = 0;
  let bestAy = 0;
  let bestBx = 0;
  let bestBy = 0;

  for (let i = 0; i < routeShape.length - 1; i++) {
    const p0 = routeShape[i];
    const p1 = routeShape[i + 1];
    const y0 = Number(p0 && p0[0]);
    const x0 = Number(p0 && p0[1]);
    const y1 = Number(p1 && p1[0]);
    const x1 = Number(p1 && p1[1]);
    if (![y0, x0, y1, x1].every(Number.isFinite)) continue;

    const vx = x1 - x0;
    const vy = y1 - y0;
    const wx = lo - x0;
    const wy = la - y0;
    const vv = vx * vx + vy * vy;
    if (vv < 1e-12) continue;
    let t = (wx * vx + wy * vy) / vv;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = x0 + t * vx;
    const py = y0 + t * vy;
    const dx = lo - px;
    const dy = la - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestSeg = i;
      bestT = t;
      bestAx = x0;
      bestAy = y0;
      bestBx = x1;
      bestBy = y1;
    }
  }
  if (bestSeg < 0) return null;

  const hSeg = metrofeedBearingDeg(bestAy, bestAx, bestBy, bestBx);
  const b = Number(bearingDeg);
  if (Number.isFinite(b)) {
    const dFwd = Math.abs(metrofeedAngleDeltaDeg(b, hSeg));
    const dRev = Math.abs(metrofeedAngleDeltaDeg(b, (hSeg + 180) % 360));
    return dFwd <= dRev ? 0 : 1;
  }

  // No bearing: use position along polyline (weak, but better than nothing).
  let cum = 0;
  for (let i = 0; i < bestSeg; i++) {
    const p0 = routeShape[i];
    const p1 = routeShape[i + 1];
    const y0 = Number(p0 && p0[0]);
    const x0 = Number(p0 && p0[1]);
    const y1 = Number(p1 && p1[0]);
    const x1 = Number(p1 && p1[1]);
    if (![y0, x0, y1, x1].every(Number.isFinite)) continue;
    cum += Math.hypot(x1 - x0, y1 - y0);
  }
  {
    const vx = bestBx - bestAx;
    const vy = bestBy - bestAy;
    cum += Math.hypot(vx, vy) * bestT;
  }
  let total = 0;
  for (let i = 0; i < routeShape.length - 1; i++) {
    const p0 = routeShape[i];
    const p1 = routeShape[i + 1];
    const y0 = Number(p0 && p0[0]);
    const x0 = Number(p0 && p0[1]);
    const y1 = Number(p1 && p1[0]);
    const x1 = Number(p1 && p1[1]);
    if (![y0, x0, y1, x1].every(Number.isFinite)) continue;
    total += Math.hypot(x1 - x0, y1 - y0);
  }
  if (!Number.isFinite(total) || total < 1e-6) return null;
  const p = cum / total;
  if (Math.abs(p - 0.5) < 0.08) return null;
  return p < 0.5 ? 0 : 1;
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

/** Great-circle distance in meters (WGS84 sphere). */
function metrofeedHaversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = (x) => (x * Math.PI) / 180;
  const phi1 = toR(lat1);
  const phi2 = toR(lat2);
  const dphi = toR(lat2 - lat1);
  const dlambda = toR(lon2 - lon1);
  const s =
    Math.sin(dphi / 2) * Math.sin(dphi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) * Math.sin(dlambda / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Geographic bearing (deg clockwise from north, 0..360) of the nearest polyline segment
 * in vertex order. shape coords are [lat, lon].
 */
function metrofeedNearestSegmentBearingDeg(routeShape, lat, lon) {
  if (!Array.isArray(routeShape) || routeShape.length < 2) return null;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;

  let bestD2 = Infinity;
  let bestAx = 0;
  let bestAy = 0;
  let bestBx = 0;
  let bestBy = 0;

  for (let i = 0; i < routeShape.length - 1; i++) {
    const p0 = routeShape[i];
    const p1 = routeShape[i + 1];
    const y0 = Number(p0 && p0[0]);
    const x0 = Number(p0 && p0[1]);
    const y1 = Number(p1 && p1[0]);
    const x1 = Number(p1 && p1[1]);
    if (![y0, x0, y1, x1].every(Number.isFinite)) continue;

    const vx = x1 - x0;
    const vy = y1 - y0;
    const wx = lo - x0;
    const wy = la - y0;
    const vv = vx * vx + vy * vy;
    if (vv < 1e-12) continue;
    let t = (wx * vx + wy * vy) / vv;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = x0 + t * vx;
    const py = y0 + t * vy;
    const dx = lo - px;
    const dy = la - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestAx = x0;
      bestAy = y0;
      bestBx = x1;
      bestBy = y1;
    }
  }
  if (!Number.isFinite(bestD2) || bestD2 === Infinity) return null;
  return metrofeedBearingDeg(bestAy, bestAx, bestBy, bestBx);
}

/**
 * Nearest polyline segment: forward bearing + distance (m) to the closest point on that segment.
 * shape coords are [lat, lon]. Returns null if no usable segment.
 */
function metrofeedNearestSegmentInfo(routeShape, lat, lon) {
  if (!Array.isArray(routeShape) || routeShape.length < 2) return null;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;

  let bestD2 = Infinity;
  let bestAx = 0;
  let bestAy = 0;
  let bestBx = 0;
  let bestBy = 0;
  let bestPx = 0;
  let bestPy = 0;

  for (let i = 0; i < routeShape.length - 1; i++) {
    const p0 = routeShape[i];
    const p1 = routeShape[i + 1];
    const y0 = Number(p0 && p0[0]);
    const x0 = Number(p0 && p0[1]);
    const y1 = Number(p1 && p1[0]);
    const x1 = Number(p1 && p1[1]);
    if (![y0, x0, y1, x1].every(Number.isFinite)) continue;

    const vx = x1 - x0;
    const vy = y1 - y0;
    const wx = lo - x0;
    const wy = la - y0;
    const vv = vx * vx + vy * vy;
    if (vv < 1e-12) continue;
    let t = (wx * vx + wy * vy) / vv;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = x0 + t * vx;
    const py = y0 + t * vy;
    const dx = lo - px;
    const dy = la - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestAx = x0;
      bestAy = y0;
      bestBx = x1;
      bestBy = y1;
      bestPx = px;
      bestPy = py;
    }
  }
  if (!Number.isFinite(bestD2) || bestD2 === Infinity) return null;
  const bearingFwd = metrofeedBearingDeg(bestAy, bestAx, bestBy, bestBx);
  const distanceM = metrofeedHaversineM(la, lo, bestPy, bestPx);
  return { bearingFwd, distanceM };
}

function metrofeedSegmentProjectionInfo(routeShape, segIdx, lat, lon) {
  if (!Array.isArray(routeShape) || routeShape.length < 2) return null;
  const i = Number(segIdx);
  if (!Number.isFinite(i) || i < 0 || i >= routeShape.length - 1) return null;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  const p0 = routeShape[i];
  const p1 = routeShape[i + 1];
  const y0 = Number(p0 && p0[0]);
  const x0 = Number(p0 && p0[1]);
  const y1 = Number(p1 && p1[0]);
  const x1 = Number(p1 && p1[1]);
  if (![y0, x0, y1, x1].every(Number.isFinite)) return null;

  const vx = x1 - x0;
  const vy = y1 - y0;
  const wx = lo - x0;
  const wy = la - y0;
  const vv = vx * vx + vy * vy;
  if (vv < 1e-12) return null;
  let t = (wx * vx + wy * vy) / vv;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const px = x0 + t * vx;
  const py = y0 + t * vy;
  const distanceM = metrofeedHaversineM(la, lo, py, px);
  const bearingFwd = metrofeedBearingDeg(y0, x0, y1, x1);
  return { segIdx: i, t, px, py, distanceM, bearingFwd };
}

function metrofeedNearestSegmentCandidate(routeShape, lat, lon) {
  if (!Array.isArray(routeShape) || routeShape.length < 2) return null;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;

  let best = null;
  for (let i = 0; i < routeShape.length - 1; i++) {
    const info = metrofeedSegmentProjectionInfo(routeShape, i, la, lo);
    if (!info) continue;
    if (!best || info.distanceM < best.distanceM) best = info;
  }
  return best;
}

function metrofeedShapeBearingLookahead(shape, segIdx, forward, lookaheadSegs) {
  if (!Array.isArray(shape) || shape.length < 2) return null;
  const i = Number(segIdx);
  if (!Number.isFinite(i)) return null;
  const k = Math.max(0, Number(lookaheadSegs) || 0);
  const last = shape.length - 1;

  if (forward) {
    const s = Math.max(0, Math.min(last - 1, i));
    const e = Math.max(1, Math.min(last, s + 1 + k));
    const p0 = shape[s];
    const p1 = shape[e];
    const lat1 = Number(p0 && p0[0]);
    const lon1 = Number(p0 && p0[1]);
    const lat2 = Number(p1 && p1[0]);
    const lon2 = Number(p1 && p1[1]);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
    return metrofeedBearingDeg(lat1, lon1, lat2, lon2);
  }

  // Reverse: start from the segment end, look backward
  const s = Math.max(1, Math.min(last, i + 1));
  const e = Math.max(0, Math.min(last - 1, s - 1 - k));
  const p0 = shape[s];
  const p1 = shape[e];
  const lat1 = Number(p0 && p0[0]);
  const lon1 = Number(p0 && p0[1]);
  const lat2 = Number(p1 && p1[0]);
  const lon2 = Number(p1 && p1[1]);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  return metrofeedBearingDeg(lat1, lon1, lat2, lon2);
}

/**
 * Lock a vehicle to a route segment (hysteresis) and return a heading that is parallel to that segment.
 * This keeps the marker aligned on loops/curves and prevents nearest-segment ping-pong.
 */
function metrofeedSnapHeadingParallelLocked({
  shapes,
  lat,
  lon,
  rawHeading,
  directionId,
  maxSnapMeters,
  lookaheadSegs,
  hysteresisRatio,
  state
}) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  const maxM = Math.max(10, Number(maxSnapMeters) || 60);
  const lookK = Math.max(0, Number(lookaheadSegs) || 3);
  const hyst = Math.max(0, Number(hysteresisRatio) || 0.25);
  const forward = Number(directionId) !== 1;

  if (!Array.isArray(shapes) || shapes.length === 0) return null;

  // Best current nearest segment across all shapes
  let best = null;
  for (let si = 0; si < shapes.length; si++) {
    const cand = metrofeedNearestSegmentCandidate(shapes[si], la, lo);
    if (!cand) continue;
    const withIdx = { ...cand, shapeIdx: si };
    if (!best || withIdx.distanceM < best.distanceM) best = withIdx;
  }
  if (!best) return null;

  // Distance-gate
  if (!(best.distanceM <= maxM)) {
    if (state) state.lockedSeg = null;
    return null;
  }

  // Consider staying on locked segment if it is "close enough" (hysteresis)
  let chosen = best;
  try {
    const locked = state && state.lockedSeg ? state.lockedSeg : null;
    if (
      locked &&
      Number.isFinite(locked.shapeIdx) &&
      Number.isFinite(locked.segIdx) &&
      shapes[locked.shapeIdx]
    ) {
      const lockedInfo = metrofeedSegmentProjectionInfo(
        shapes[locked.shapeIdx],
        locked.segIdx,
        la,
        lo
      );
      if (lockedInfo && lockedInfo.distanceM <= maxM) {
        if (lockedInfo.distanceM <= best.distanceM * (1 + hyst)) {
          chosen = { ...lockedInfo, shapeIdx: locked.shapeIdx };
        }
      }
    }
  } catch (_) {}

  // Update lock
  if (state) state.lockedSeg = { shapeIdx: chosen.shapeIdx, segIdx: chosen.segIdx };

  // Compute the tangent bearing using a short lookahead window so curves feel smooth.
  const shape = shapes[chosen.shapeIdx];
  let tangent = metrofeedShapeBearingLookahead(shape, chosen.segIdx, forward, lookK);
  tangent = metrofeedNormalizeHeadingDeg(tangent);
  if (tangent == null) return null;

  // If rawHeading exists, choose the closer of forward/reverse tangents (safety if directionId mismatched)
  const rh = metrofeedNormalizeHeadingDeg(rawHeading);
  if (rh != null) {
    const rev = (tangent + 180) % 360;
    const dF = Math.abs(metrofeedAngleDeltaDeg(rh, tangent));
    const dR = Math.abs(metrofeedAngleDeltaDeg(rh, rev));
    return dF <= dR ? tangent : rev;
  }
  return tangent;
}

/**
 * Choose a snapped heading along the route tangent near this bus.
 * - Finds the nearest segment among all shapes, gets its forward bearing and distance.
 * - If too far from the route, returns null (caller can fall back to raw).
 * - If rawHeading is present, choose forward vs reverse tangent that best matches rawHeading.
 * - Else, use directionId (0 = forward, 1 = reverse).
 */
function metrofeedSnapHeadingToRoute({
  shapes,
  lat,
  lon,
  rawHeading,
  directionId,
  maxSnapMeters
}) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  const maxM = Math.max(10, Number(maxSnapMeters) || 60);

  let best = null;
  if (Array.isArray(shapes)) {
    for (let i = 0; i < shapes.length; i++) {
      const info = metrofeedNearestSegmentInfo(shapes[i], la, lo);
      if (!info) continue;
      if (!best || info.distanceM < best.distanceM) best = info;
    }
  }
  if (!best) return null;
  if (!(best.distanceM <= maxM)) return null;

  const fwd = metrofeedNormalizeHeadingDeg(best.bearingFwd);
  if (fwd == null) return null;
  const rev = (fwd + 180) % 360;

  const rh = metrofeedNormalizeHeadingDeg(rawHeading);
  if (rh != null) {
    const dF = Math.abs(metrofeedAngleDeltaDeg(rh, fwd));
    const dR = Math.abs(metrofeedAngleDeltaDeg(rh, rev));
    return dF <= dR ? fwd : rev;
  }
  return Number(directionId) === 1 ? rev : fwd;
}

function metrofeedNormalizeHeadingDeg(x) {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return ((n % 360) + 360) % 360;
}

/** Circular exponential smoothing: prev + alpha * shortest delta toward next. */
function metrofeedEmaAngleDeg(prev, next, alpha) {
  const n = metrofeedNormalizeHeadingDeg(next);
  if (n == null) return prev != null ? metrofeedNormalizeHeadingDeg(prev) : null;
  const p = metrofeedNormalizeHeadingDeg(prev);
  if (p == null) return n;
  const d = metrofeedAngleDeltaDeg(p, n);
  return metrofeedNormalizeHeadingDeg(p + alpha * d);
}

/**
 * Heading for bus marker: feed bearing → short movement vector → route tangent.
 * @param {{ latitude:number, longitude:number, bearing?:number|null, speed?:number|null }} bus
 * @param {{ lastLat?:number, lastLon?:number, lastTime?:number }} state
 * @param {number[][]|null} routeShape [lat,lon][]
 */
function metrofeedBusMarkerHeadingDeg(bus, state, routeShape) {
  const lat = Number(bus && bus.latitude);
  const lon = Number(bus && bus.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const br = bus && bus.bearing;
  if (br !== null && br !== undefined && String(br).trim() !== "") {
    const bRaw = Number(br);
    if (Number.isFinite(bRaw)) {
      return metrofeedNormalizeHeadingDeg(bRaw);
    }
  }

  const now = Date.now();
  const la0 = state && Number.isFinite(state.lastLat) ? state.lastLat : null;
  const lo0 = state && Number.isFinite(state.lastLon) ? state.lastLon : null;
  const t0 = state && Number.isFinite(state.lastTime) ? state.lastTime : null;
  if (la0 != null && lo0 != null && t0 != null) {
    const dt = (now - t0) / 1000;
    const dist = metrofeedHaversineM(la0, lo0, lat, lon);
    if (dt > 0.5 && dt < 120 && dist > 4) {
      return metrofeedNormalizeHeadingDeg(metrofeedBearingDeg(la0, lo0, lat, lon));
    }
  }

  if (Array.isArray(routeShape) && routeShape.length >= 2) {
    return metrofeedNearestSegmentBearingDeg(routeShape, lat, lon);
  }
  return null;
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
      bearing:
        v.bearing ??
        v.heading ??
        v?.position?.bearing ??
        v?.position?.heading ??
        null,
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
    if (!sid) continue;
    if (stopIdSet.has(sid)) {
      hits++;
      continue;
    }
    // Normalize common prefixes so `sorta_XXXX` matches `XXXX` (and same for TANK).
    const stripped =
      sid.startsWith("sorta_") ? sid.slice(6)
      : sid.startsWith("tank_") ? sid.slice(5)
      : sid.includes("_") ? sid.slice(sid.indexOf("_") + 1)
      : "";
    if (stripped && stopIdSet.has(stripped)) hits++;
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

/** @deprecated Legacy dot half-width; compass uses MF_BUS_COMPASS_DIAM_PX. Kept for hot-load / overrides. */
var MBTA_BUS_MARKER_DOT_RADIUS_PX =
  (typeof window !== 'undefined' && window.MBTA_BUS_MARKER_DOT_RADIUS_PX)
    ? window.MBTA_BUS_MARKER_DOT_RADIUS_PX
    : 6;
try { if (typeof window !== 'undefined') window.MBTA_BUS_MARKER_DOT_RADIUS_PX = MBTA_BUS_MARKER_DOT_RADIUS_PX; } catch (_) {}

/** Base diameter before the on-map +10% size bump (see metrofeedBusMarkerDiamPx). */
var MF_BUS_COMPASS_DIAM_PX =
  (typeof window !== 'undefined' && window.MF_BUS_COMPASS_DIAM_PX)
    ? window.MF_BUS_COMPASS_DIAM_PX
    : 16;
try { if (typeof window !== 'undefined') window.MF_BUS_COMPASS_DIAM_PX = MF_BUS_COMPASS_DIAM_PX; } catch (_) {}

function metrofeedBusMarkerDiamPx() {
  // Scale live vehicle marker size up by ~30% vs prior baseline.
  return Math.max(12, Math.round(MF_BUS_COMPASS_DIAM_PX * 1.43));
}

/**
 * Live bus marker: pill label + route-color dot.
 * If heading is known: replace dot with a single "paper plane" arrow (clean + obvious).
 * If heading is unknown: show the dot (no implied direction).
 */
function buildMbtaBusMarkerElement(routeColor, routeNum, displayVehicleID, headingDeg) {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.alignItems = "center";
  wrap.style.pointerEvents = "auto";
  const dc = metrofeedBusMarkerDiamPx();
  const fg = pickContrastingTextColor(routeColor);
  const arrowColor = pickContrastingTextColor(routeColor);
  const badgeBg = fg;
  const badgeFg = routeColor;

  const label = document.createElement("div");
  label.style.cssText = `margin-bottom:6px;background:${routeColor};color:${fg};padding:3px 8px;border-radius:8px;font-weight:bold;font-size:11px;box-shadow:0 2px 4px rgba(0,0,0,0.3);border:2px solid rgba(255,255,255,0.95);white-space:nowrap;`;
  label.innerHTML = `<span style="background:${badgeBg};color:${badgeFg};padding:1px 3px;border-radius:2px;font-size:9px;margin-right:4px;">${String(routeNum)}</span>${String(displayVehicleID)}`;

  const dialWrap = document.createElement("div");
  dialWrap.style.cssText = `position:relative;width:${dc}px;height:${dc}px;flex-shrink:0;`;

  const normH = metrofeedNormalizeHeadingDeg(headingDeg);
  const showPlane = normH != null;

  if (showPlane) {
    // A single, obvious directional icon (bus silhouette) — no dot, no extra decorations.
    // We render inline SVG so we can recolor to the route and rotate to direction of travel.
    const planeSize = Math.max(14, Math.round(dc * 1.2)); // +20% for legibility
    const planeWrap = document.createElement("div");
    planeWrap.setAttribute("aria-hidden", "true");
    // bus.svg heading alignment:
    // - Heading is 0°=north. SVG artwork has its own "forward" direction.
    // - We apply a baseline -90° (east-facing art) plus an optional per-city offset knob.
    const svgOffsetDeg =
      window.CITY_CONFIG && Number.isFinite(Number(window.CITY_CONFIG.busSvgHeadingOffsetDeg))
        ? Number(window.CITY_CONFIG.busSvgHeadingOffsetDeg)
        : 0;
    const busRot = (normH - 90 + svgOffsetDeg + 3600) % 360;
    planeWrap.style.cssText = [
      "position:absolute",
      "left:50%",
      "top:50%",
      "transform:translate(-50%,-50%) rotate(" + busRot + "deg)",
      "transform-origin:50% 50%",
      "width:" + planeSize + "px",
      "height:" + planeSize + "px",
      "pointer-events:none"
    ].join(";");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(planeSize));
    svg.setAttribute("height", String(planeSize));
    svg.setAttribute("viewBox", "0 0 512 512");
    svg.style.display = "block";

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    // bus.svg path (single combined path) — keep as a literal for reliable recoloring.
    path.setAttribute(
      "d",
      "m376.03 310.75a22.875 22.875 0 0 0 -22.85 22.85 22.845 22.845 0 0 0 45.69 0 22.873 22.873 0 0 0 -22.84-22.85zm0 34.14a11.29 11.29 0 1 1 11.28-11.29 11.29 11.29 0 0 1 -11.28 11.29zm-240.06-34.14a22.873 22.873 0 0 0 -22.84 22.85 22.845 22.845 0 0 0 45.69 0 22.875 22.875 0 0 0 -22.85-22.85zm0 34.14a11.29 11.29 0 1 1 11.29-11.29 11.288 11.288 0 0 1 -11.29 11.29zm372.02-171.81c-.74-8.83-8.18-25.52-31.06-25.52h-413.78c-16.7 0-25.97 7.26-29.19 10.38-8.56 8.32-16.17 34.3-22.62 77.23-4.9 32.62-7.35 63.45-7.35 66.88v18.29c0 13.54 11.19 27.93 31.93 27.93h72.93a31.027 31.027 0 0 1 -2.99-8 30.568 30.568 0 0 1 -.73-6.67 30.845 30.845 0 1 1 61.69 0 30.568 30.568 0 0 1 -.73 6.67 31.027 31.027 0 0 1 -2.99 8h185.8a31.027 31.027 0 0 1 -2.99-8 30.568 30.568 0 0 1 -.73-6.67 30.845 30.845 0 1 1 61.69 0 30.568 30.568 0 0 1 -.73 6.67 31.027 31.027 0 0 1 -2.99 8h80.93c17.66 0 23.93-12.89 23.93-23.93v-150.93c0-.11-.01-.22-.02-.33zm-473.31 128.93c-.83 8.19-5.43 14.95-22.69 16.31v-16.27c0-.55.03-1.43.1-2.6a129.791 129.791 0 0 1 16.53-3.37 5.417 5.417 0 0 1 6.06 5.93zm-1.35-55.98c-2.75 23.58-3.7 36.93-20.22 40.7 2.53-27.17 9.25-82.03 18.99-109.15 13.98 3.85 5.7 30.2 1.23 68.45zm108.66-19.96c0 50.56-49.42 64.86-70.55 68.67a7.991 7.991 0 0 1 -9.39-7.89v-103.12a8 8 0 0 1 8-8h63.94a8 8 0 0 1 8 8zm98.77 34.51h-66.71a8.006 8.006 0 0 1 -8.01-8v-67a8.006 8.006 0 0 1 8.01-8h66.71zm78.71 0h-70.71v-83h70.71zm78.71 0h-70.71v-83h70.71zm82.71-8a8 8 0 0 1 -8 8h-66.71v-83h66.71a8 8 0 0 1 8 8zm19.12 62.35h-6.75a11.169 11.169 0 0 1 -11.17-11.17v-6.6a21.906 21.906 0 0 1 17.92-21.54z"
    );
    path.setAttribute("fill", routeColor);
    // Thin contrasting stroke makes it readable on bright routes without adding clutter.
    path.setAttribute("stroke", arrowColor);
    path.setAttribute("stroke-width", "14");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-linecap", "round");

    svg.appendChild(path);
    svg.style.filter = "drop-shadow(0 2px 3px rgba(0,0,0,0.45))";

    planeWrap.appendChild(svg);
    dialWrap.appendChild(planeWrap);
  } else {
    const dot = document.createElement("div");
    dot.style.cssText = [
      "box-sizing:border-box",
      `width:${dc}px`,
      `height:${dc}px`,
      "border-radius:50%",
      `background:${routeColor}`,
      "border:2px solid #fff",
      "box-shadow:0 1px 3px rgba(0,0,0,0.4)",
      "position:relative"
    ].join(";");
    dialWrap.appendChild(dot);
  }

  wrap.appendChild(label);
  wrap.appendChild(dialWrap);
  return wrap;
}

function mbtaBusMarkerMapOptions() {
  const dc = metrofeedBusMarkerDiamPx();
  return { anchor: "bottom", offset: [0, -dc / 2] };
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

// -----------------------------------------------------------------------------
// Shared vehicle feed manager (optional).
// Fetch/parse vehicles.json once and fan-out to all overlays.
// Reversible: set CITY_CONFIG.useSharedVehicleCache = false to use legacy per-overlay polling.
// -----------------------------------------------------------------------------
function metrofeedGetSharedVehicleFeedManager() {
  try {
    if (window.__mfVehicleFeedManager) return window.__mfVehicleFeedManager;
  } catch (_) {}

  const mgr = {
    feeds: Object.create(null),
    /** Ensure a feed is started for this URL set. */
    ensureFeed(urls, pollMs) {
      const key = JSON.stringify((urls || []).filter(Boolean).sort());
      if (!key || key === "[]") return null;
      if (this.feeds[key]) return this.feeds[key];
      const feed = {
        key,
        urls: JSON.parse(key),
        pollMs: Math.max(5000, Number(pollMs) || 12000),
        inFlight: false,
        lastFetchedAt: 0,
        lastVehicles: [],
        lastError: null,
        subscribers: new Set(),
        intervalId: null
      };
      const fetchOnce = async () => {
        if (feed.inFlight) return;
        feed.inFlight = true;
        try {
          const parts = await Promise.all(
            feed.urls.map(async (url) => {
              const res = await fetch(url, { cache: "no-store" });
              if (!res.ok) throw new Error(`vehicles HTTP ${res.status}: ${res.statusText} (${url})`);
              const j = await res.json();
              return parseVehiclesJsonToGtfsLike(j);
            })
          );
          feed.lastVehicles = parts.flat();
          feed.lastFetchedAt = Date.now();
          feed.lastError = null;
          feed.subscribers.forEach((fn) => {
            try {
              fn(feed.lastVehicles, { fetchedAt: feed.lastFetchedAt, key: feed.key });
            } catch (_) {}
          });
        } catch (e) {
          feed.lastError = e;
        } finally {
          feed.inFlight = false;
        }
      };
      feed.fetchOnce = fetchOnce;
      // Start immediately, then interval.
      fetchOnce();
      feed.intervalId = setInterval(fetchOnce, feed.pollMs);
      this.feeds[key] = feed;
      return feed;
    },
    subscribe(urls, pollMs, cb) {
      const feed = this.ensureFeed(urls, pollMs);
      if (!feed) return () => {};
      feed.subscribers.add(cb);
      // Immediate replay from cache (if any) so overlays render instantly on switch/open.
      if (Array.isArray(feed.lastVehicles) && feed.lastVehicles.length) {
        try {
          cb(feed.lastVehicles, { fetchedAt: feed.lastFetchedAt, key: feed.key, fromCache: true });
        } catch (_) {}
      }
      return () => {
        try {
          feed.subscribers.delete(cb);
        } catch (_) {}
      };
    },
    getLatest(urls) {
      const key = JSON.stringify((urls || []).filter(Boolean).sort());
      const feed = key && this.feeds[key] ? this.feeds[key] : null;
      return feed ? feed.lastVehicles : [];
    }
  };

  try {
    window.__mfVehicleFeedManager = mgr;
  } catch (_) {}
  return mgr;
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
  if (!map || (typeof map.addSource !== "function" && typeof map.addLayer !== "function" && typeof map.on !== "function")) {
    console.error("[attachRouteToMap] Invalid MapLibre map instance.", {
      hasMap: !!map,
      addSource: map && typeof map.addSource,
      addLayer: map && typeof map.addLayer,
      on: map && typeof map.on
    });
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

  const oppositeRouteData = options.oppositeRouteData || null;
  const hasOppositeShapes =
    oppositeRouteData &&
    ((Array.isArray(oppositeRouteData.shapes) && oppositeRouteData.shapes.length > 0) ||
      (Array.isArray(oppositeRouteData.shape) && oppositeRouteData.shape.length > 0));
  const oppositeShapes = hasOppositeShapes
    ? Array.isArray(oppositeRouteData.shapes) && oppositeRouteData.shapes.length > 0
      ? oppositeRouteData.shapes
      : [oppositeRouteData.shape]
    : [];

  // Canonical shape for direction inference:
  // We want `busDir` to be stable so toggling overlay direction swaps dimming reliably.
  // Use dir0 shape order as canonical whenever the opposite direction data is available.
  const canonicalDirShape =
    Number(directionId) === 1 && hasOppositeShapes && oppositeShapes[0] && Array.isArray(oppositeShapes[0])
      ? oppositeShapes[0]
      : primaryShape;

  // ==== Tracking created objects for cleanup =================================
  const overlayElements = {
    sources:  [],
    layers:   [],
    markers:  [],
    controls: [],
    intervals: [], // For bus tracking intervals
    unsubscribers: [], // cleanup hooks (shared vehicle feed subscriptions, observers, etc.)
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
    // Determine if OTP is active (for context layer styling)
    const isOtpActive = window.routeLegLines && window.routeLegLines.length > 0;

    // Place route overlay layers before OTP segments (only if OTP active)
    let beforeId = undefined;
    if (isOtpActive) {
      for (const otpLayerId of window.routeLegLines) {
        if (map.getLayer(otpLayerId)) {
          beforeId = otpLayerId;
          break;
        }
      }
    }

    const lineOpacity = isOtpActive ? 0.25 : 0.9;
    const lineWidth = isOtpActive ? 3 : 4;

    // Opposite-direction context: dashed underlay (drawn BEFORE selected solid lines)
    if (hasOppositeShapes && oppositeShapes.length) {
      oppositeShapes.forEach((shape, shapeIndex) => {
        if (!Array.isArray(shape) || shape.length < 2) return;
        const routeSourceId = `route-line-opp-${mapLayerKey}-${shapeIndex}`;
        const routeLayerId = `route-layer-opp-${mapLayerKey}-${shapeIndex}`;

        if (map.getLayer(routeLayerId)) map.removeLayer(routeLayerId);
        if (map.getSource(routeSourceId)) map.removeSource(routeSourceId);

        map.addSource(routeSourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: shape.map((coord) => [coord[1], coord[0]])
            }
          }
        });
        overlayElements.sources.push(routeSourceId);

        map.addLayer(
          {
            id: routeLayerId,
            type: "line",
            source: routeSourceId,
            paint: {
              "line-color": routeColor,
              "line-width": Math.max(2, lineWidth - 1),
              "line-opacity": isOtpActive ? 0.12 : 0.35,
              "line-dasharray": [2, 2]
            }
          },
          beforeId
        );
        overlayElements.layers.push(routeLayerId);
      });
    }

    // ---------- Render all shapes (for trunk-and-branch routes) ----------
    // All shapes in shapes[] are rendered; opacity/width depends on OTP state
    shapes.forEach((shape, shapeIndex) => {
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

      map.addLayer(
        {
          id: routeLayerId,
          type: "line",
          source: routeSourceId,
          paint: {
            "line-color": routeColor,
            "line-width": lineWidth,
            "line-opacity": lineOpacity
          }
        },
        beforeId
      );
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
      if (hasOppositeShapes) {
        oppositeShapes.forEach((shape) => {
          if (!Array.isArray(shape)) return;
          shape.forEach((coord) => bounds.extend([coord[1], coord[0]]));
        });
      }
      
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
      try { stopElement.classList.add('mf-stop-marker'); } catch (_) {}
      if (!useDirectionalStops) {
        const stopFill = routeColor || "#1E90FF";
        const stopRing = pickContrastingTextColor(stopFill);
        stopElement.style.width           = "12px";
        stopElement.style.height          = "12px";
        stopElement.style.backgroundColor = stopFill;
        stopElement.style.borderRadius    = "50%";
        stopElement.style.border          = `2px solid ${stopRing}`;
        stopElement.style.opacity         = "0.9";
        stopElement.style.cursor          = "pointer";
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

    // Opposite-direction-only stops: hollow + faded (no schedule UI; other-direction context)
    if (hasOppositeShapes && oppositeRouteData && Array.isArray(oppositeRouteData.stops) && oppositeRouteData.stops.length) {
      const selectedStopIds = new Set(
        stops
          .map((s) => (s && s.stop_id !== undefined && s.stop_id !== null ? String(s.stop_id) : ""))
          .filter((id) => id)
      );
      oppositeRouteData.stops.forEach((stop) => {
        const lat = stop.lat;
        const lon = stop.lon;
        if (typeof lat !== "number" || typeof lon !== "number") return;
        const stopId = String(stop.stop_id || "");
        if (!stopId || selectedStopIds.has(stopId)) return;

        const el = document.createElement("div");
        el.style.width = "12px";
        el.style.height = "12px";
        el.style.borderRadius = "50%";
        el.style.backgroundColor = "transparent";
        el.style.border = `2px solid ${routeColor || "#888"}`;
        el.style.opacity = "0.45";
        el.style.cursor = "pointer";

        const marker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]);
        const name = stop.name || `Stop ${stop.stop_id}`;
        const popupHtml = `
          <div style="border:1px solid #888;border-radius:8px;padding:10px;background:#222;color:#ccc;min-width:180px;">
            <strong style="color:#aaa;">${name}</strong>
            <div style="margin-top:8px;font-size:12px;color:#888;">Other direction — switch direction in Bus Routes to see times for this stop.</div>
          </div>
        `;
        marker.setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(popupHtml));
        marker.addTo(map);
        overlayElements.markers.push(marker);
      });
    }

    // ---------- Route info panel (mainOverlay only) ----------
    // OTP trip legs use .otp-trip-route-chip on the rail instead (see otp.js).
    if (mode === "mainOverlay" && options.routePageUrl && !options.skipRouteInfoPanel) {
      const panelId = `route-info-${mapLayerKey}`;
      const existing = document.getElementById(panelId);
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

      const routeInfoPanel = document.createElement("div");
      routeInfoPanel.id = panelId;
      routeInfoPanel.className = "route-info-panel";
      try { routeInfoPanel.setAttribute('data-route-id', String(routeId)); } catch (_) {}
      
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
      const pillWidth = 66; // Standardized collapsed pill width (text shrinks to fit)
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
        width:${isPill ? (pillWidth + "px") : (circleSize + "px")};
        height:${circleSize}px;
        min-width:${isPill ? (pillWidth + "px") : (circleSize + "px")};
        max-width:unset;
        min-height:${circleSize}px;
        max-height:${circleSize}px;
        padding:${isPill ? "0" : "0"};
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
        font-size:${isPill ? "12px" : "0.95rem"};
        pointer-events:none; /* panel handles clicks */
        text-align:center;
        line-height:1;
        margin:0;
        padding:0;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
        max-width:${isPill ? (pillWidth - 10) + "px" : "unset"};
      `;
      
      routeInfoPanel.appendChild(closeBtn);
      routeInfoPanel.appendChild(contentDiv);
      routeInfoPanel.appendChild(collapsedName);

      // Alert icon (shown/hidden by home.html when alerts exist for this route)
      // Use the existing SVG, but tint it red via CSS filter (no background bubble).
      const alertBadge = document.createElement('img');
      alertBadge.className = 'mf-chip-alert-icon';
      alertBadge.src = '008-danger.svg';
      alertBadge.alt = '';
      alertBadge.setAttribute('aria-hidden', 'true');
      alertBadge.style.cssText = [
        'display:none',
        'position:absolute',
        'left:-6px',
        'top:-6px',
        'width:18px',
        'height:18px',
        'object-fit:contain',
        // Approximate #ef4444 (red-500). Keeps the icon readable on any chip color.
        'filter:invert(23%) sepia(93%) saturate(5900%) hue-rotate(353deg) brightness(104%) contrast(116%) drop-shadow(0 0 1px rgba(0,0,0,0.35))',
        'pointer-events:none'
      ].join(';');
      routeInfoPanel.appendChild(alertBadge);
      
      // Initially hide content and collapse button, show collapsed name (circle state)
      closeBtn.style.display = "none";
      contentDiv.style.display = "none";
      collapsedName.style.display = "block";
      collapsedName.style.color = chipFg;
      collapsedName.style.fontWeight = "bold";
      collapsedName.style.fontSize = isPill ? "12px" : "0.95rem";
      collapsedName.style.lineHeight = "1";
      collapsedName.style.pointerEvents = "none"; // Don't block clicks on the circle

      // Standardize pill size: auto-shrink label text to fit fixed pillWidth.
      const metrofeedShrinkTextToFit = (el, maxW, startPx, minPx) => {
        try {
          if (!el) return;
          const maxWidth = Number(maxW);
          let fs = Math.max(1, Number(startPx) || 12);
          const min = Math.max(1, Number(minPx) || 9);
          el.style.maxWidth = `${maxWidth}px`;
          el.style.fontSize = `${fs}px`;
          for (let i = 0; i < 12; i++) {
            if (el.scrollWidth <= maxWidth + 1) break;
            fs -= 1;
            if (fs < min) break;
            el.style.fontSize = `${fs}px`;
          }
        } catch (_) {}
      };
      if (isPill) {
        requestAnimationFrame(() => metrofeedShrinkTextToFit(collapsedName, pillWidth - 10, 12, 9));
      }

      // Chip action sheet (Center / Switch / Close). Dismiss on outside click or ESC.
      const openChipActionSheet = () => {
        // Remove any existing sheet
        const existing = document.getElementById('mf-chip-sheet');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

        const backdrop = document.createElement('div');
        backdrop.id = 'mf-chip-sheet';
        backdrop.style.cssText = [
          'position:absolute',
          'left:0',
          'top:0',
          'right:0',
          'bottom:0',
          'background:rgba(0,0,0,0.25)',
          'z-index:5000'
        ].join(';');

        const sheet = document.createElement('div');
        sheet.style.cssText = [
          'position:absolute',
          'right:10px',
          `top:${verticalPosition}px`,
          'transform:translateY(-10px)',
          'min-width:180px',
          'max-width:220px',
          'background:rgba(20,20,20,0.97)',
          `border:1px solid ${chipBg}`,
          'border-radius:10px',
          'box-shadow:0 10px 26px rgba(0,0,0,0.55)',
          'padding:10px',
          'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
        ].join(';');

        const title = document.createElement('div');
        title.textContent = chipSpec.label;
        title.style.cssText = `color:${chipFg};font-weight:800;margin:0 0 8px 0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;

        const mkBtn = (label, bg, fg, onClick) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = label;
          b.style.cssText = [
            'width:100%',
            'margin:6px 0 0 0',
            'padding:10px 12px',
            'border-radius:8px',
            'border:none',
            'cursor:pointer',
            'font-weight:800',
            'font-size:13px',
            `background:${bg}`,
            `color:${fg}`
          ].join(';');
          b.onclick = (e) => {
            e.stopPropagation();
            try { onClick && onClick(); } catch (_) {}
          };
          return b;
        };

        const dismiss = () => {
          try { document.removeEventListener('keydown', onKeyDown, true); } catch (_) {}
          if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        };
        const onKeyDown = (ev) => {
          if (ev && (ev.key === 'Escape' || ev.key === 'Esc')) {
            ev.preventDefault();
            dismiss();
          }
        };

        const centerRoute = () => {
          try {
            const b = new maplibregl.LngLatBounds();
            // Include all shapes for this overlay
            (shapes || []).forEach((shape) => {
              if (!Array.isArray(shape)) return;
              shape.forEach((coord) => {
                if (!coord || coord.length < 2) return;
                b.extend([coord[1], coord[0]]);
              });
            });
            if (b.isEmpty && typeof b.isEmpty === 'function' && b.isEmpty()) return;
            map.fitBounds(b, { padding: 80, maxZoom: 14, duration: 600 });
          } catch (_) {}
          dismiss();
        };

        const switchDir = () => {
          dismiss();
          // Replace-direction behavior (no clutter): delegate to home.html showRouteOverlay if present.
          if (typeof window.showRouteOverlay === 'function') {
            window.showRouteOverlay(String(routeId), Number(directionId) === 0 ? 1 : 0);
            return;
          }
          // Fallback: just close if no switch handler exists.
          try { closeBtn.onclick({ stopPropagation() {} }); } catch (_) {}
        };

        const closeRoute = () => {
          dismiss();
          try { closeBtn.onclick({ stopPropagation() {} }); } catch (_) {}
        };

        const viewAlerts = () => {
          dismiss();
          try {
            if (typeof window.openAlertsForRoute === 'function') {
              window.openAlertsForRoute(String(routeId));
            } else if (typeof window.showMBTAAlertsModal === 'function') {
              window.showMBTAAlertsModal();
            }
          } catch (_) {}
        };

        sheet.appendChild(title);
        sheet.appendChild(mkBtn('Center on map', chipBg, chipFg, centerRoute));
        try {
          const hasAlerts =
            window._mfRoutesWithAlerts &&
            (window._mfRoutesWithAlerts.has
              ? window._mfRoutesWithAlerts.has(String(routeId))
              : false);
          if (hasAlerts) {
            sheet.appendChild(mkBtn('View alerts', '#ef4444', '#fff', viewAlerts));
          }
        } catch (_) {}
        sheet.appendChild(mkBtn('Switch directions', '#2563EB', '#fff', switchDir));
        sheet.appendChild(mkBtn('Close', '#B91C1C', '#fff', closeRoute));

        backdrop.onclick = (e) => {
          if (e && e.target === backdrop) dismiss();
        };
        document.addEventListener('keydown', onKeyDown, true);

        backdrop.appendChild(sheet);
        routeOverlayPanelHost(map).appendChild(backdrop);
      };

      routeInfoPanel.addEventListener('click', function (e) {
        // Always open action sheet (collapsed chips).
        e.stopPropagation();
        openChipActionSheet();
      });

      routeOverlayPanelHost(map).appendChild(routeInfoPanel);
      overlayElements.controls.push(routeInfoPanel);
    }

    /*
     * Bus tracking (mainOverlay only)
     * Cincinnati: JSON vehicle proxy (gtfsRtProxyUrls) + optional trips.json for ETAs.
     */
    if (trackBuses && mode === "mainOverlay") {
      const busMarkers = {}; // Store bus markers separately
      /** @type {Record<string, { lastLat?: number, lastLon?: number, lastTime?: number, smoothedHeading?: number|null }>} */
      const vehicleHeadingState = Object.create(null);
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
      const useSharedVehicleCache = !(
        window.CITY_CONFIG && window.CITY_CONFIG.useSharedVehicleCache === false
      );
      const sharedPollMs =
        window.CITY_CONFIG && Number.isFinite(Number(window.CITY_CONFIG.sharedVehiclePollMs))
          ? Number(window.CITY_CONFIG.sharedVehiclePollMs)
          : 12000;

      const stopIdToName = Object.create(null);
      (routeData.stops || []).forEach((s) => {
        const id = s.stop_id != null ? String(s.stop_id) : "";
        if (id && s.name) stopIdToName[id] = s.name;
      });

      const resolvedProxyUrls =
        Array.isArray(gtfsRtProxyUrls) && gtfsRtProxyUrls.length ? gtfsRtProxyUrls.filter(Boolean) : [];
      const resolvedUrls =
        Array.isArray(gtfsRtUrls) && gtfsRtUrls.length ? gtfsRtUrls.filter(Boolean) : (gtfsRtUrl ? [gtfsRtUrl] : []);
      const urlsToFetchShared = resolvedProxyUrls.length ? resolvedProxyUrls : resolvedUrls;
      
      async function fetchAndDisplayBuses(allBusesOverride) {
        const hasOverride = Array.isArray(allBusesOverride);
        if (busesFetchInFlight && !hasOverride) {
          // Avoid overlapping vehicle fetches when upstream is slow
          console.log('[attachRouteToMap] Bus fetch skipped (in-flight)', { routeId, directionId, busesFetchSeq });
          return;
        }
        busesFetchSeq += 1;
        const seq = busesFetchSeq;
        busesFetchInFlight = true;
        try {
          let allBuses = hasOverride ? allBusesOverride : [];
          
          console.log('[attachRouteToMap] fetchAndDisplayBuses start', {
            seq,
            routeId,
            directionId,
            busApiType,
            disableGtfsRt,
            gtfsRtUrl,
            now: new Date().toISOString()
          });

          if (!hasOverride && busApiType === 'gtfs-rt' && !disableGtfsRt) {
            const urlsToFetch = urlsToFetchShared;
            if (!urlsToFetch.length) {
              console.warn('[attachRouteToMap] gtfs-rt mode but no URLs configured.', { gtfsRtProxyUrls, gtfsRtUrls, gtfsRtUrl });
            } else {
              console.log('[attachRouteToMap] Fetching GTFS-RT feed(s):', urlsToFetch);
              const feedResults = await Promise.all(urlsToFetch.map(async (url) => {
                const res = await fetch(url, { cache: 'no-store' });
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

          // Filter buses for this route (all directions).
          // Also check routeData.route_id if available (from routes_index.js)
          const routeNum = String(routeId);
          const routeDataRouteId = routeData?.route_id || routeData?.meta?.route_id || null;

          // Cincinnati multi-agency safety: match agency + exact route_id number.
          // Also drop vehicles far away from the route polyline (prevents "deep Ohio" outliers).
          const mfOverlayAgency = routeNum.startsWith('sorta_') ? 'sorta' : routeNum.startsWith('tank_') ? 'tank' : null;
          const mfOverlayRouteDigits = (function () {
            const raw = routeNum.startsWith('sorta_') ? routeNum.slice(6) : routeNum.startsWith('tank_') ? routeNum.slice(5) : routeNum;
            const m = String(raw).match(/\d+/);
            return m ? String(m[0]).replace(/^0+/, '') || String(m[0]) : '';
          })();
          const mfMaxDistM =
            window.CITY_CONFIG && Number.isFinite(Number(window.CITY_CONFIG.busMaxDistanceFromRouteMeters))
              ? Number(window.CITY_CONFIG.busMaxDistanceFromRouteMeters)
              : 1500;
          
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
            // Agency gate (Cincinnati): don't let TANK bleed into SORTA routes (or vice versa).
            try {
              if (mfOverlayAgency) {
                const vag = String(v.agency || v.operator || v.system || '').toLowerCase();
                if (vag && vag !== mfOverlayAgency) return false;
              }
            } catch (_) {}

            // Exact route_id gate when available (Cincinnati vehicles.json uses route_id digits).
            try {
              if (mfOverlayAgency && mfOverlayRouteDigits) {
                const vr = v.routeId != null ? String(v.routeId) : (v.route_id != null ? String(v.route_id) : String(v.routeNumber || ''));
                const m = vr.match(/\d+/);
                const vDigits = m ? (String(m[0]).replace(/^0+/, '') || String(m[0])) : '';
                if (vDigits && vDigits !== mfOverlayRouteDigits) return false;
              }
            } catch (_) {}

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
            if (routeMatch) {
              console.log(
                `[attachRouteToMap] ✅ Matched bus: route "${v.routeNumber}" == "${routeNum}"${routeDataRouteId ? ` (route_id: "${routeDataRouteId}")` : ""}`
              );
            }

            if (!routeMatch) return false;

            // Geo sanity check: only keep vehicles near this route's primary polyline.
            try {
              const la = Number(v.latitude);
              const lo = Number(v.longitude);
              if (Number.isFinite(la) && Number.isFinite(lo) && Array.isArray(primaryShape) && primaryShape.length > 1) {
                const info = metrofeedNearestSegmentInfo(primaryShape, la, lo);
                if (info && Number.isFinite(info.distanceM) && info.distanceM > mfMaxDistM) return false;
              }
            } catch (_) {}

            return true;
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
              if (!id) return;
              stopIdSet.add(id);
              // Add common normalized variant so `sorta_XXXX` matches `XXXX`.
              if (id.startsWith("sorta_")) stopIdSet.add(id.slice(6));
              else if (id.startsWith("tank_")) stopIdSet.add(id.slice(5));
              else if (id.includes("_")) stopIdSet.add(id.slice(id.indexOf("_") + 1));
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
          const headingEnabled = !(
            window.CITY_CONFIG && window.CITY_CONFIG.busMarkerHeading === false
          );

          vehiclesForMarkers.forEach((bus) => {
            const latN = Number(bus.latitude);
            const lonN = Number(bus.longitude);
            if (!Number.isFinite(latN) || !Number.isFinite(lonN)) return;
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

            const markerKey = String(
              bus.vehicleID != null && String(bus.vehicleID).trim() !== ""
                ? bus.vehicleID
                : blockId
            );
            if (!vehicleHeadingState[markerKey]) vehicleHeadingState[markerKey] = {};
            const hState = vehicleHeadingState[markerKey];
            const spd = Number(bus.speed);
            const hasSpd = Number.isFinite(spd);
            const slow = hasSpd ? spd < 0.45 : false;
            const hasLast =
              Number.isFinite(hState.lastLat) &&
              Number.isFinite(hState.lastLon) &&
              Number.isFinite(hState.lastTime);
            let distLast = 0;
            if (hasLast) {
              distLast = metrofeedHaversineM(hState.lastLat, hState.lastLon, latN, lonN);
            }
            const movedStep = hasLast && distLast > 3;
            const stoppedNow = hasLast && (hasSpd ? slow && !movedStep : distLast < 2.5);

            // Determine this vehicle's direction relative to the currently-selected overlay direction.
            // We show all buses for the route, but dim the opposite-direction ones.
            let busDir = null;
            if (bus.direction === 0 || bus.direction === 1) {
              busDir = Number(bus.direction);
            } else {
              const inferred = metrofeedMaybeFlipInferredDirection(
                inferDirectionFromPolylineAndBearing(canonicalDirShape, latN, lonN, bus.bearing)
              );
              if (inferred === 0 || inferred === 1) busDir = inferred;
            }
            const isOppositeDir = busDir != null && Number(busDir) !== Number(directionId);

            let rawHeading = headingEnabled
              ? metrofeedBusMarkerHeadingDeg(bus, hState, primaryShape)
              : null;

            // Snap marker heading to the route tangent and LOCK to a segment (hysteresis),
            // so the plane stays parallel to the line even on loops/curves.
            const snapMaxM =
              (window.CITY_CONFIG && window.CITY_CONFIG.busMarkerSnapMaxMeters) != null
                ? Number(window.CITY_CONFIG.busMarkerSnapMaxMeters)
                : 60;
            const lookaheadSegs =
              (window.CITY_CONFIG && window.CITY_CONFIG.busMarkerSnapLookaheadSegs) != null
                ? Number(window.CITY_CONFIG.busMarkerSnapLookaheadSegs)
                : 3;
            const hystRatio =
              (window.CITY_CONFIG && window.CITY_CONFIG.busMarkerSnapHysteresisRatio) != null
                ? Number(window.CITY_CONFIG.busMarkerSnapHysteresisRatio)
                : 0.25;

            const snappedHeading = headingEnabled
              ? metrofeedSnapHeadingParallelLocked({
                  shapes,
                  lat: latN,
                  lon: lonN,
                  rawHeading,
                  directionId,
                  maxSnapMeters: snapMaxM,
                  lookaheadSegs,
                  hysteresisRatio: hystRatio,
                  state: hState
                })
              : null;
            if (snappedHeading != null) rawHeading = snappedHeading;
            let displayHeading = null;
            if (!stoppedNow && rawHeading != null) {
              displayHeading = metrofeedEmaAngleDeg(hState.smoothedHeading, rawHeading, 0.38);
              hState.smoothedHeading = displayHeading;
            } else if (!stoppedNow && rawHeading == null && hState.smoothedHeading != null) {
              displayHeading = metrofeedNormalizeHeadingDeg(hState.smoothedHeading);
            } else {
              if (stoppedNow) hState.smoothedHeading = null;
            }

            hState.lastLat = latN;
            hState.lastLon = lonN;
            hState.lastTime = Date.now();

            const busElement = buildMbtaBusMarkerElement(
              routeColor,
              metrofeedFormatRouteBadge(routeId),
              displayVehicleID,
              displayHeading
            );
            try { busElement.classList.add('mf-bus-marker'); } catch (_) {}
            if (isOppositeDir) {
              // Visual language: opposite direction = faded (like dashed line / hollow stops).
              busElement.style.opacity = "0.45";
            } else {
              busElement.style.opacity = "1";
            }
            const busMarker = new maplibregl.Marker({
              element: busElement,
              ...mbtaBusMarkerMapOptions()
            });
            busMarker.setLngLat([lonN, latN]);
            
            const popupContent = document.createElement('div');
            
            const refreshBusPopup = () => {
              let dirLabel = "";
              if (busDir === 1) dirLabel = isOppositeDir ? "Inbound (opposite)" : "Inbound";
              else if (busDir === 0) dirLabel = isOppositeDir ? "Outbound (opposite)" : "Outbound";
              else dirLabel = "Unknown";
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
            
            busMarkers[markerKey] = busMarker;
            overlayElements.markers.push(busMarker);
          });

          const aliveHeadingIds = new Set(
            vehiclesForMarkers.map((v) => {
              const bid = v.blockID || v.vehicleID || "";
              return String(
                v.vehicleID != null && String(v.vehicleID).trim() !== "" ? v.vehicleID : bid
              );
            }).filter(Boolean)
          );
          Object.keys(vehicleHeadingState).forEach((k) => {
            if (!aliveHeadingIds.has(k)) delete vehicleHeadingState[k];
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
      
      // gtfs-rt + VPS trips.json (+ optional gtfsRtTripUpdatesUrl) → TripUpdates-shaped data for stop + bus ETAs
      let realtimeTripsInterval = null;
      const gtfsRtTripUpdatesUrl =
        options.gtfsRtTripUpdatesUrl ||
        (window.CITY_CONFIG && window.CITY_CONFIG.gtfsRtTripUpdatesUrl) ||
        null;
      const realtimeTripUrls = [...new Set([realtimeTripsUrl, gtfsRtTripUpdatesUrl].filter(Boolean))];
      const overlayKeyForTrips = options.overlayKey || `${routeId}-${directionId}`;
      const fetchRealtimeTripsJson = async () => {
        try {
          const jsonParts = [];
          for (let ui = 0; ui < realtimeTripUrls.length; ui++) {
            const u = realtimeTripUrls[ui];
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 20000);
            const res = await fetch(u, { signal: controller.signal, cache: 'no-store' });
            clearTimeout(timeout);
            if (!res.ok) throw new Error(`realtime trips HTTP ${res.status}: ${res.statusText} (${u})`);
            jsonParts.push(await res.json());
          }
          const mergedTrips = metrofeedMergeRealtimeTripJsonParts(jsonParts);
          const parsed = parseRealtimeTripsJsonToTripUpdates({ trips: mergedTrips }, routeId, routeData);
          tripIndexForPatternFilter = parsed.tripUpdatesByTripId;
          window.currentRouteTripUpdates = {
            overlayKey: overlayKeyForTrips,
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
            if (ok === overlayKeyForTrips) {
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
              if (useSharedVehicleCache && busApiType === "gtfs-rt" && !disableGtfsRt && urlsToFetchShared.length) {
                const mgr = metrofeedGetSharedVehicleFeedManager();
                fetchAndDisplayBuses(mgr.getLatest(urlsToFetchShared));
              } else {
                fetchAndDisplayBuses();
              }
            } catch (e2) {}
          }, 150);
        } catch (e) {
          console.warn("[realtimeTrips] Unavailable:", e);
        }
      };

      (async function startLiveBusUpdates() {
        if (busApiType === "gtfs-rt" && realtimeTripUrls.length) {
          await fetchRealtimeTripsJson();
        }
        if (useSharedVehicleCache && busApiType === "gtfs-rt" && !disableGtfsRt && urlsToFetchShared.length) {
          const mgr = metrofeedGetSharedVehicleFeedManager();
          const unsub = mgr.subscribe(urlsToFetchShared, sharedPollMs, (vehicles) => {
            try {
              fetchAndDisplayBuses(vehicles);
            } catch (_) {}
          });
          overlayElements.unsubscribers.push(unsub);
          // Also do one immediate render from whatever cache exists.
          try {
            fetchAndDisplayBuses(mgr.getLatest(urlsToFetchShared));
          } catch (_) {}
        } else {
          fetchAndDisplayBuses();
          const busInterval = setInterval(fetchAndDisplayBuses, 30000);
          overlayElements.intervals.push(busInterval);
        }
        if (busApiType === "gtfs-rt" && realtimeTripUrls.length) {
          realtimeTripsInterval = setInterval(fetchRealtimeTripsJson, 30000);
          overlayElements.intervals.push(realtimeTripsInterval);
        }
      })();
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

      // Shared subscriptions / cleanup hooks
      (overlayElements.unsubscribers || []).forEach((fn) => {
        try { if (typeof fn === "function") fn(); } catch (_) {}
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
      overlayElements.unsubscribers = [];
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
