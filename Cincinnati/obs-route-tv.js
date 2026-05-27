/**
 * RoamRaven OBS Route TV — automated map director for 24/7 browser source.
 * Open from roamravenapp.com/Cincinnati/obs-route-tv.html
 * Loaded only after password gate in obs-route-tv.html unlocks.
 */
(function () {
  'use strict';

  if (sessionStorage.getItem('obsTvAuth') !== '1') {
    return;
  }
  const LAYER_ROUTE = 'rr-tv-route';
  const LAYER_ROUTE_SRC = 'rr-tv-route-src';
  const LAYER_VEH = 'rr-tv-vehicles';
  const LAYER_VEH_SRC = 'rr-tv-vehicles-src';
  const LAYER_VEH_MATCH = 'rr-tv-vehicles-match';
  const LAYER_VEH_OTHER = 'rr-tv-vehicles-other';
  const LAYER_INC_SRC = 'rr-tv-incidents-src';
  const LAYER_INC = 'rr-tv-incidents';
  const LAYER_INC_HI = 'rr-tv-incident-highlight';
  const LAYER_SLOW_SRC = 'rr-tv-slow-src';
  const LAYER_SLOW = 'rr-tv-slow';
  const LAYER_FLOW_SRC = 'rr-tv-flow-src';
  const LAYER_FLOW = 'rr-tv-flow';

  const TV = {
    map: null,
    paused: false,
    mode: 'ROUTE_MODE', // ROUTE_MODE | INCIDENT_MODE | CAMERA_MODE | IDLE_MODE
    routes: [],
    routeCursor: 0,
    currentRouteId: null,
    directionId: 0,
    segmentIndex: 0,
    segments: [],
    currentRouteData: null,
    vehicles: [],
    incidents: [],
    slowdowns: [],
    flow: [],
    cameras: [],
    shownIncidentIds: new Map(),
    lastIncidentInterrupt: 0,
    lastCameraBreak: 0,
    phase: 'overview', // overview | segment | incident | camera
    phaseEndsAt: 0,
    incidentFocus: null,
    cameraQueue: [],
    cameraIndex: 0,
    tickTimer: null,
    vehicleTimer: null,
    incidentTimer: null,
    debug: []
  };

  function log(msg) {
    const line = new Date().toLocaleTimeString() + ' ' + msg;
    TV.debug.unshift(line);
    if (TV.debug.length > 40) TV.debug.length = 40;
    const el = document.getElementById('adminDebug');
    if (el) el.textContent = TV.debug.join('\n');
  }

  function getCfg() {
    const c = typeof getCityConfig === 'function' ? getCityConfig('cincinnati') : {};
    const routeIndexUrls = [
      './routes_index.js',
      'https://routes.metrofeedus.com/route_data/cincinnati/Cincinnati/routes_index.js'
    ];
    const routeDataBases = [
      (c.routeDataBase || './route_data/').replace(/\/?$/, '/'),
      'https://routes.metrofeedus.com/route_data/cincinnati/'
    ];
    return {
      cityName: c.cityName || 'Cincinnati',
      dayStyle: c.dayStyle || 'https://tiles.metrofeedus.com/styles/0/style.json',
      nightStyle: c.nightStyle || c.dayStyle,
      defaultCenter: c.defaultCenter || [-84.512, 39.103],
      defaultZoom: c.defaultZoom || 11,
      bounds: c.bounds || { west: -85.22, south: 38.59, east: -83.88, north: 39.71 },
      incidentsFeedUrl: c.incidentsFeedUrl || 'https://traffic-api.metrofeedus.com/incidents/ohio',
      slowdownsFeedUrl: c.slowdownsFeedUrl || 'https://traffic-api.metrofeedus.com/slowdowns/ohio',
      flowFeedUrl: c.flowFeedUrl || 'https://traffic-api.metrofeedus.com/flow/ohio',
      camerasFeedUrl: c.camerasFeedUrl || 'https://traffic-api.metrofeedus.com/cameras/ohio',
      vehiclesUrl:
        (c.gtfsRtProxyUrls && c.gtfsRtProxyUrls[0]) ||
        'https://routes.metrofeedus.com/realtime/cincinnati/vehicles.json',
      routeIndexUrls,
      routeDataBases,
      busModalSystems: c.busModalSystems || [],
      overviewSec: 7,
      segmentSec: 16,
      incidentDwellSec: 35,
      cameraDwellSec: 14,
      incidentCooldownMs: 180000,
      cameraBreakIntervalMs: 600000,
      incidentMinScore: 50,
      cameraRadiusMiles: 8,
      startInRouteModeMs: 120000
    };
  }

  let CFG = null;

  // --- Day geometry (same as home.html) ---
  function applyDayGeometry(routeData) {
    if (!routeData || !routeData.geometry) return;
    const d = new Date().getDay();
    const dayType = d === 0 ? 'sunday' : d === 6 ? 'saturday' : 'weekday';
    const geo = routeData.geometry[dayType];
    if (geo && geo.trip_count > 0) {
      const hasShape = Array.isArray(geo.shape) && geo.shape.length > 1;
      const hasShapes =
        Array.isArray(geo.shapes) && geo.shapes.length && geo.shapes.some((s) => s && s.length > 1);
      if (hasShape || hasShapes) {
        if (hasShape) routeData.shape = geo.shape;
        if (hasShapes) routeData.shapes = geo.shapes;
        if (Array.isArray(geo.stops) && geo.stops.length) routeData.stops = geo.stops;
      }
    } else if (geo && geo.trip_count === 0 && routeData.geometry.weekday) {
      const wk = routeData.geometry.weekday;
      if (wk.trip_count > 0) {
        if (Array.isArray(wk.shape) && wk.shape.length > 1) routeData.shape = wk.shape;
        if (Array.isArray(wk.stops) && wk.stops.length) routeData.stops = wk.stops;
      }
    }
  }

  function shapeToLine(shape) {
    if (!Array.isArray(shape) || shape.length < 2) return [];
    return shape.map((p) => [Number(p[1]), Number(p[0])]);
  }

  function getPrimaryShape(routeData) {
    if (!routeData) return [];
    if (Array.isArray(routeData.shapes) && routeData.shapes.length) {
      const s = routeData.shapes.find((x) => Array.isArray(x) && x.length > 1);
      if (s) return shapeToLine(s);
    }
    return shapeToLine(routeData.shape);
  }

  function boundsFromCoords(coords) {
    const b = new maplibregl.LngLatBounds(coords[0], coords[0]);
    for (let i = 1; i < coords.length; i++) b.extend(coords[i]);
    return b;
  }

  function flyToBounds(coords, padding, duration) {
    if (!TV.map || !coords.length) return;
    const b = boundsFromCoords(coords);
    TV.map.fitBounds(b, { padding: padding || 80, duration: duration || 2200, maxZoom: 14 });
  }

  function splitSegments(coords, count) {
    if (!coords.length) return [];
    const n = Math.min(Math.max(count, 3), 6);
    const total = coords.length;
    const per = Math.max(2, Math.floor(total / n));
    const segs = [];
    for (let i = 0; i < n; i++) {
      const start = i * per;
      const end = i === n - 1 ? total : Math.min(total, (i + 1) * per + 1);
      const slice = coords.slice(start, end);
      if (slice.length >= 2) segs.push(slice);
    }
    return segs.length ? segs : [coords];
  }

  async function fetchText(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }

  async function loadRoutesCatalog() {
    for (const url of CFG.routeIndexUrls) {
      try {
        const text = await fetchText(url);
        const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (!match) continue;
        const arr = JSON.parse(match[0]);
        if (Array.isArray(arr) && arr.length) {
          TV.routes = arr;
          log('Routes loaded: ' + arr.length + ' from ' + url);
          return;
        }
      } catch (e) {
        log('Index fail: ' + url + ' — ' + e.message);
      }
    }
    if (typeof window.ROUTES !== 'undefined' && window.ROUTES.cincinnati && window.ROUTES.cincinnati.busRoutes) {
      TV.routes = window.ROUTES.cincinnati.busRoutes;
      log('Routes from window.ROUTES: ' + TV.routes.length);
    }
  }

  async function fetchRouteJson(routeId, directionId) {
    const safeId = String(routeId).replace(/[/?#]+/g, '_');
    const files = [
      'route-' + safeId + '-dir' + directionId + '.json',
      'route-' + encodeURIComponent(String(routeId)) + '-dir' + directionId + '.json'
    ];
    for (const base of CFG.routeDataBases) {
      const b = base.endsWith('/') ? base : base + '/';
      for (const f of files) {
        try {
          const r = await fetch(b + f, { cache: 'no-store' });
          if (r.ok) return await r.json();
        } catch (_) {}
      }
    }
    throw new Error('Route not found: ' + routeId);
  }

  function agencyLabel(routeId) {
    const id = String(routeId || '');
    const systems = CFG.busModalSystems || [];
    for (let i = 0; i < systems.length; i++) {
      const p = systems[i].idPrefix || '';
      if (p && id.startsWith(p)) return systems[i].label || systems[i].id;
    }
    return '';
  }

  function countVehiclesOnRoute(routeId) {
    const rid = String(routeId || '');
    let n = 0;
    for (let i = 0; i < TV.vehicles.length; i++) {
      const v = TV.vehicles[i];
      const vr = v.route_id != null ? String(v.route_id) : v.routeId != null ? String(v.routeId) : '';
      if (vr === rid) n++;
    }
    return n;
  }

  function drawRouteLine(coords) {
    const map = TV.map;
    if (!map) return;
    const geo = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
    if (map.getSource(LAYER_ROUTE_SRC)) {
      map.getSource(LAYER_ROUTE_SRC).setData(geo);
    } else {
      map.addSource(LAYER_ROUTE_SRC, { type: 'geojson', data: geo });
      map.addLayer({
        id: LAYER_ROUTE,
        type: 'line',
        source: LAYER_ROUTE_SRC,
        paint: { 'line-color': '#9333ea', 'line-width': 5, 'line-opacity': 0.9 }
      });
    }
  }

  function updateVehicleLayer() {
    const map = TV.map;
    if (!map || !map.isStyleLoaded()) return;
    const features = [];
    for (let i = 0; i < TV.vehicles.length; i++) {
      const v = TV.vehicles[i];
      const lat = Number(v.lat ?? v.latitude);
      const lon = Number(v.lon ?? v.lng ?? v.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const routeId = v.route_id != null ? String(v.route_id) : v.routeId != null ? String(v.routeId) : '';
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { id: String(v.id || i), route_id: routeId }
      });
    }
    const fc = { type: 'FeatureCollection', features };
    if (map.getSource(LAYER_VEH_SRC)) {
      map.getSource(LAYER_VEH_SRC).setData(fc);
    } else {
      map.addSource(LAYER_VEH_SRC, { type: 'geojson', data: fc });
      map.addLayer({
        id: LAYER_VEH_OTHER,
        type: 'circle',
        source: LAYER_VEH_SRC,
        paint: {
          'circle-radius': 4,
          'circle-color': '#93c5fd',
          'circle-opacity': 0.22,
          'circle-stroke-width': 0
        }
      });
      map.addLayer({
        id: LAYER_VEH_MATCH,
        type: 'circle',
        source: LAYER_VEH_SRC,
        paint: {
          'circle-radius': 7,
          'circle-color': '#1E90FF',
          'circle-opacity': 0.95,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff'
        }
      });
    }

    const rid = TV.currentRouteId != null ? String(TV.currentRouteId) : '';
    try {
      if (map.getLayer(LAYER_VEH_MATCH)) {
        map.setFilter(LAYER_VEH_MATCH, ['==', ['get', 'route_id'], rid]);
      }
      if (map.getLayer(LAYER_VEH_OTHER)) {
        map.setFilter(LAYER_VEH_OTHER, rid ? ['!=', ['get', 'route_id'], rid] : true);
      }
    } catch (_) {}
  }

  function updateSlowdownsLayer() {
    const map = TV.map;
    if (!map || !map.isStyleLoaded()) return;
    const feats = [];
    for (let i = 0; i < TV.slowdowns.length; i++) {
      const it = TV.slowdowns[i];
      const lat = Number(it.lat ?? it.latitude);
      const lon = Number(it.lon ?? it.lng ?? it.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      feats.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { title: String(it.location || 'Slowdown'), description: String(it.description || '') }
      });
    }
    const fc = { type: 'FeatureCollection', features: feats };
    if (!map.getSource(LAYER_SLOW_SRC)) {
      map.addSource(LAYER_SLOW_SRC, { type: 'geojson', data: fc });
      map.addLayer({
        id: LAYER_SLOW,
        type: 'circle',
        source: LAYER_SLOW_SRC,
        paint: {
          'circle-radius': 5,
          'circle-color': '#ff9800',
          'circle-opacity': 0.6,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff'
        }
      });
    } else {
      map.getSource(LAYER_SLOW_SRC).setData(fc);
    }
  }

  function updateFlowLayer() {
    const map = TV.map;
    if (!map || !map.isStyleLoaded()) return;
    const feats = [];
    for (let i = 0; i < TV.flow.length; i++) {
      const it = TV.flow[i];
      const lat = Number(it.lat ?? it.latitude);
      const lon = Number(it.lon ?? it.lng ?? it.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      feats.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { title: String(it.location || 'Flow'), description: String(it.description || '') }
      });
    }
    const fc = { type: 'FeatureCollection', features: feats };
    if (!map.getSource(LAYER_FLOW_SRC)) {
      map.addSource(LAYER_FLOW_SRC, { type: 'geojson', data: fc });
      map.addLayer({
        id: LAYER_FLOW,
        type: 'circle',
        source: LAYER_FLOW_SRC,
        paint: {
          'circle-radius': 4,
          'circle-color': '#00bcd4',
          'circle-opacity': 0.45,
          'circle-stroke-width': 0
        }
      });
    } else {
      map.getSource(LAYER_FLOW_SRC).setData(fc);
    }
  }

  function updateIncidentsLayer(highlightLngLat) {
    const map = TV.map;
    if (!map || !map.isStyleLoaded()) return;
    const Mf = window.MfTrafficIncidents;
    if (!Mf) return;
    const features = [];
    for (let i = 0; i < TV.incidents.length; i++) {
      const inc = TV.incidents[i];
      const ll = Mf.incidentLngLat(inc);
      if (!ll) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: ll },
        properties: { id: Mf.formatIncidentForDisplay(inc, i).id }
      });
    }
    const fc = { type: 'FeatureCollection', features };
    if (!map.getSource(LAYER_INC_SRC)) {
      map.addSource(LAYER_INC_SRC, { type: 'geojson', data: fc });
      map.addLayer({
        id: LAYER_INC,
        type: 'circle',
        source: LAYER_INC_SRC,
        paint: {
          'circle-radius': 6,
          'circle-color': '#ff6b35',
          'circle-opacity': 0.7,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff'
        }
      });
    } else {
      map.getSource(LAYER_INC_SRC).setData(fc);
    }
    if (highlightLngLat) {
      const hi = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: highlightLngLat }
      };
      if (map.getSource(LAYER_INC_HI)) {
        map.getSource(LAYER_INC_HI).setData(hi);
      } else {
        map.addSource(LAYER_INC_HI, { type: 'geojson', data: hi });
        map.addLayer({
          id: LAYER_INC_HI,
          type: 'circle',
          source: LAYER_INC_HI,
          paint: {
            'circle-radius': 18,
            'circle-color': '#ff3333',
            'circle-opacity': 0.35,
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ff0000'
          }
        });
      }
    } else if (map.getLayer(LAYER_INC_HI)) {
      map.removeLayer(LAYER_INC_HI);
      if (map.getSource(LAYER_INC_HI)) map.removeSource(LAYER_INC_HI);
    }
  }

  function setLowerThird(title, sub, meta) {
    document.getElementById('ltTitle').textContent = title || '';
    document.getElementById('ltSub').textContent = sub || '';
    document.getElementById('ltMeta').textContent = meta || '';
    document.getElementById('lowerThird').classList.add('visible');
  }

  function setTicker(text) {
    document.getElementById('ticker').textContent = text || '';
  }

  function showIncidentPanel(display) {
    const panel = document.getElementById('incidentPanel');
    if (!display) {
      panel.classList.remove('visible');
      return;
    }
    document.getElementById('ipTitle').textContent = display.title;
    const linesEl = document.getElementById('ipLines');
    linesEl.innerHTML = '';
    (display.lines || []).forEach((line) => {
      const d = document.createElement('div');
      d.className = 'ip-line';
      d.textContent = line;
      linesEl.appendChild(d);
    });
    panel.classList.add('visible');
  }

  function hideIncidentPanel() {
    document.getElementById('incidentPanel').classList.remove('visible');
  }

  function showCameraPanel(cam) {
    const panel = document.getElementById('cameraPanel');
    const img = document.getElementById('cameraImg');
    const label = document.getElementById('cameraLabel');
    if (!cam || !cam.url) {
      label.textContent = (cam && cam.name) || 'Nearby camera';
      img.style.display = 'none';
      panel.classList.add('visible');
      return;
    }
    img.style.display = 'block';
    const sep = cam.url.includes('?') ? '&' : '?';
    img.src = cam.url + sep + 't=' + Date.now();
    img.onerror = () => {
      img.style.display = 'none';
    };
    label.textContent = cam.name || 'Traffic camera';
    panel.classList.add('visible');
  }

  function hideCameraPanel() {
    document.getElementById('cameraPanel').classList.remove('visible');
  }

  function pickNextRouteIndex() {
    if (!TV.routes.length) return 0;
    let best = TV.routeCursor;
    let bestScore = -1;
    for (let t = 0; t < Math.min(8, TV.routes.length); t++) {
      const idx = (TV.routeCursor + t) % TV.routes.length;
      const r = TV.routes[idx];
      const id = r.id || r.route_id;
      const score = countVehiclesOnRoute(id) * 10 + Math.random() * 3;
      if (score > bestScore) {
        bestScore = score;
        best = idx;
      }
    }
    return best;
  }

  async function loadCurrentRoute() {
    if (!TV.routes.length) return false;
    TV.routeCursor = pickNextRouteIndex();
    const entry = TV.routes[TV.routeCursor];
    const routeId = entry.id || entry.route_id;
    TV.currentRouteId = routeId;
    TV.directionId = 0;
    try {
      TV.currentRouteData = await fetchRouteJson(routeId, TV.directionId);
      applyDayGeometry(TV.currentRouteData);
      const coords = getPrimaryShape(TV.currentRouteData);
      if (coords.length < 2) {
        log('Skip route (no shape): ' + routeId);
        TV.routeCursor = (TV.routeCursor + 1) % TV.routes.length;
        return false;
      }
      TV.segments = splitSegments(coords, coords.length > 200 ? 5 : coords.length > 80 ? 4 : 3);
      TV.segmentIndex = 0;
      drawRouteLine(coords);
      const title =
        TV.currentRouteData.route_title ||
        TV.currentRouteData.route_long_name ||
        'Route ' + (TV.currentRouteData.route_short_name || routeId);
      const agency = agencyLabel(routeId);
      const buses = countVehiclesOnRoute(routeId);
      setLowerThird(
        title,
        (TV.currentRouteData.direction_name || 'Outbound') + (agency ? ' · ' + agency : ''),
        CFG.cityName + (buses ? ' · ' + buses + ' bus' + (buses === 1 ? '' : 'es') + ' live' : '')
      );
      setTicker('Now: ' + title + ' → Next: route overview');
      flyToBounds(coords, 100, 2500);
      updateVehicleLayer();
      TV.phase = 'overview';
      TV.phaseEndsAt = Date.now() + CFG.overviewSec * 1000;
      log('Route: ' + routeId);
      return true;
    } catch (e) {
      log('Route load fail: ' + routeId + ' — ' + e.message);
      TV.routeCursor = (TV.routeCursor + 1) % TV.routes.length;
      return false;
    }
  }

  function advanceSegment() {
    if (!TV.segments.length) return;
    TV.segmentIndex = (TV.segmentIndex + 1) % TV.segments.length;
    if (TV.segmentIndex === 0) {
      TV.routeCursor = (TV.routeCursor + 1) % TV.routes.length;
      loadCurrentRoute();
      return;
    }
    const seg = TV.segments[TV.segmentIndex];
    flyToBounds(seg, 60, 2800);
    TV.phase = 'segment';
    TV.phaseEndsAt = Date.now() + CFG.segmentSec * 1000;
    const rd = TV.currentRouteData;
    const title = rd ? rd.route_title || rd.route_long_name || 'Route' : 'Route';
    setTicker('Now: ' + title + ' (segment ' + (TV.segmentIndex + 1) + '/' + TV.segments.length + ')');
  }

  function pickMajorIncident() {
    const Mf = window.MfTrafficIncidents;
    if (!Mf || !TV.incidents.length) return null;
    let best = null;
    let bestScore = 0;
    const now = Date.now();
    for (let i = 0; i < TV.incidents.length; i++) {
      const inc = TV.incidents[i];
      const d = Mf.formatIncidentForDisplay(inc, i);
      if (d.score < CFG.incidentMinScore) continue;
      const last = TV.shownIncidentIds.get(d.id) || 0;
      if (now - last < 600000) continue;
      if (d.score > bestScore) {
        bestScore = d.score;
        best = d;
      }
    }
    return best;
  }

  function nearestCameras(lngLat, limit) {
    const Mf = window.MfTrafficIncidents;
    if (!lngLat || !TV.cameras.length) return [];
    const [lon, lat] = lngLat;
    const withDist = TV.cameras
      .map((c) => ({
        ...c,
        dist: Mf.haversineMiles(lon, lat, c.lon, c.lat)
      }))
      .filter((c) => c.dist <= CFG.cameraRadiusMiles)
      .sort((a, b) => a.dist - b.dist);
    return withDist.slice(0, limit || 3);
  }

  async function enterIncidentMode(display) {
    TV.mode = 'INCIDENT_MODE';
    TV.incidentFocus = display;
    TV.shownIncidentIds.set(display.id, Date.now());
    TV.lastIncidentInterrupt = Date.now();
    hideCameraPanel();
    showIncidentPanel(display);
    setLowerThird('TRAFFIC ALERT', display.title, CFG.cityName);
    setTicker('Traffic alert: ' + display.title);
    if (display.lngLat) {
      updateIncidentsLayer(display.lngLat);
      TV.map.flyTo({
        center: display.lngLat,
        zoom: 13,
        duration: 2800,
        essential: true
      });
    }
    TV.cameraQueue = nearestCameras(display.lngLat, 3);
    TV.cameraIndex = 0;
    TV.phase = 'incident';
    TV.phaseEndsAt = Date.now() + CFG.incidentDwellSec * 1000;
    log('INCIDENT: ' + display.title);
  }

  function exitIncidentMode() {
    hideIncidentPanel();
    hideCameraPanel();
    updateIncidentsLayer(null);
    TV.incidentFocus = null;
    TV.cameraQueue = [];
    TV.mode = 'ROUTE_MODE';
    TV.phase = 'overview';
    loadCurrentRoute();
  }

  async function enterCameraBreak(forced) {
    if (!TV.cameras.length) return;
    TV.mode = 'CAMERA_MODE';
    hideIncidentPanel();
    const pool = forced
      ? TV.cameras
      : TV.cameras.filter(() => Math.random() > 0.5);
    if (!pool.length) return;
    const cam = pool[Math.floor(Math.random() * pool.length)];
    TV.cameraQueue = [cam];
    TV.cameraIndex = 0;
    showCameraPanel(cam);
    if (cam.lon != null && cam.lat != null) {
      TV.map.flyTo({ center: [cam.lon, cam.lat], zoom: 12.5, duration: 2200 });
    }
    setLowerThird('Traffic camera', cam.name || 'Ohio DOT', CFG.cityName);
    setTicker('Camera: ' + (cam.name || 'Live view'));
    TV.phase = 'camera';
    TV.phaseEndsAt = Date.now() + CFG.cameraDwellSec * 1000;
    TV.lastCameraBreak = Date.now();
    log('Camera: ' + (cam.name || cam.id));
  }

  function tick() {
    if (TV.paused) return;
    const now = Date.now();

    document.getElementById('clock').textContent = new Date().toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit'
    });

    if (TV.mode === 'ROUTE_MODE' && now - TV.lastIncidentInterrupt > CFG.incidentCooldownMs) {
      const major = pickMajorIncident();
      if (major) {
        enterIncidentMode(major);
        return;
      }
    }

    if (
      TV.mode === 'ROUTE_MODE' &&
      now - TV.lastCameraBreak > CFG.startInRouteModeMs &&
      now - TV.lastCameraBreak > CFG.cameraBreakIntervalMs &&
      Math.random() < 0.06
    ) {
      enterCameraBreak(false);
      return;
    }

    if (now < TV.phaseEndsAt) return;

    if (TV.mode === 'INCIDENT_MODE') {
      if (TV.phase === 'incident' && TV.cameraQueue.length && TV.cameraIndex < TV.cameraQueue.length) {
        const cam = TV.cameraQueue[TV.cameraIndex];
        TV.cameraIndex++;
        TV.phase = 'incident_camera';
        showCameraPanel(cam);
        if (cam.lon != null && cam.lat != null) {
          TV.map.flyTo({ center: [cam.lon, cam.lat], zoom: 13.2, duration: 2000 });
        }
        TV.phaseEndsAt = Date.now() + CFG.cameraDwellSec * 1000;
        return;
      }
      exitIncidentMode();
      return;
    }

    if (TV.mode === 'CAMERA_MODE') {
      hideCameraPanel();
      TV.mode = 'ROUTE_MODE';
      loadCurrentRoute();
      return;
    }

    if (TV.phase === 'overview') {
      TV.phase = 'segment';
      TV.segmentIndex = 0;
      if (TV.segments[0]) flyToBounds(TV.segments[0], 60, 2800);
      TV.phaseEndsAt = Date.now() + CFG.segmentSec * 1000;
      return;
    }

    if (TV.phase === 'segment') {
      advanceSegment();
    }
  }

  async function pollVehicles() {
    try {
      const r = await fetch(CFG.vehiclesUrl, { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      TV.vehicles = Array.isArray(data) ? data : data.entity || data.vehicles || [];
      updateVehicleLayer();
    } catch (e) {
      log('Vehicles: ' + e.message);
    }
  }

  async function pollIncidents() {
    try {
      const r = await fetch(CFG.incidentsFeedUrl, { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      TV.incidents = Array.isArray(data.incidents) ? data.incidents : [];
      if (TV.mode === 'ROUTE_MODE') updateIncidentsLayer(null);
    } catch (e) {
      log('Incidents: ' + e.message);
    }
  }

  async function pollSlowdownsAndFlow() {
    try {
      const [slowRes, flowRes] = await Promise.all([
        fetch(CFG.slowdownsFeedUrl, { cache: 'no-store' }),
        fetch(CFG.flowFeedUrl, { cache: 'no-store' })
      ]);
      if (slowRes && slowRes.ok) {
        const slowData = await slowRes.json();
        TV.slowdowns = Array.isArray(slowData.slowdowns)
          ? slowData.slowdowns
          : Array.isArray(slowData.items)
            ? slowData.items
            : [];
      }
      if (flowRes && flowRes.ok) {
        const flowData = await flowRes.json();
        TV.flow = Array.isArray(flowData.flow) ? flowData.flow : [];
      }
      updateSlowdownsLayer();
      updateFlowLayer();
    } catch (e) {
      log('Flow/slow: ' + e.message);
    }
  }

  async function pollCameras() {
    try {
      const r = await fetch(CFG.camerasFeedUrl, { cache: 'no-store' });
      if (!r.ok) return;
      const raw = await r.json();
      const list = Array.isArray(raw) ? raw : raw.cameras || raw.items || [];
      TV.cameras = list
        .map((c, idx) => ({
          id: c.id != null ? String(c.id) : String(idx),
          name: c.name || c.title || 'Camera ' + idx,
          lat: Number(c.lat ?? c.latitude),
          lon: Number(c.lon ?? c.lng ?? c.longitude),
          url: c.url || c.imageUrl || c.image_url || ''
        }))
        .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
      log('Cameras: ' + TV.cameras.length);
    } catch (e) {
      log('Cameras: ' + e.message);
    }
  }

  function bindAdmin() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        document.getElementById('adminPanel').classList.toggle('open');
      }
    });
    document.getElementById('btnPause').onclick = () => {
      TV.paused = true;
      log('Paused');
    };
    document.getElementById('btnPlay').onclick = () => {
      TV.paused = false;
      log('Playing');
    };
    document.getElementById('btnNextRoute').onclick = () => {
      TV.routeCursor = (TV.routeCursor + 1) % TV.routes.length;
      loadCurrentRoute();
    };
    document.getElementById('btnPrevRoute').onclick = () => {
      TV.routeCursor = (TV.routeCursor - 1 + TV.routes.length) % TV.routes.length;
      loadCurrentRoute();
    };
    document.getElementById('btnForceIncident').onclick = () => {
      const m = pickMajorIncident() || (TV.incidents[0] && window.MfTrafficIncidents.formatIncidentForDisplay(TV.incidents[0], 0));
      if (m) enterIncidentMode(m);
    };
    document.getElementById('btnForceCamera').onclick = () => enterCameraBreak(true);
    document.getElementById('btnRouteMode').onclick = () => exitIncidentMode();
    const syncCfg = () => {
      CFG.overviewSec = Number(document.getElementById('cfgOverview').value) || 7;
      CFG.segmentSec = Number(document.getElementById('cfgSegment').value) || 16;
    };
    document.getElementById('cfgOverview').onchange = syncCfg;
    document.getElementById('cfgSegment').onchange = syncCfg;
  }

  async function startApp() {
    CFG = getCfg();
    bindAdmin();
    log('Starting TV director…');

    const setup = initMetroFeedMap('map', {
      defaultCenter: CFG.defaultCenter,
      defaultZoom: CFG.defaultZoom,
      bounds: CFG.bounds,
      dayStyle: CFG.dayStyle,
      nightStyle: CFG.nightStyle,
      defaultToNight: true
    });
    TV.map = setup.map;

    TV.map.on('load', async () => {
      await loadRoutesCatalog();
      await pollCameras();
      await pollIncidents();
      await pollSlowdownsAndFlow();
      await pollVehicles();
      if (TV.routes.length) await loadCurrentRoute();
      else setLowerThird('RoamRaven TV', 'No routes loaded', 'Check route index URLs');

      TV.tickTimer = setInterval(tick, 1000);
      TV.vehicleTimer = setInterval(pollVehicles, 12000);
      TV.incidentTimer = setInterval(pollIncidents, 90000);
      setInterval(pollSlowdownsAndFlow, 120000);
      setInterval(pollCameras, 300000);
      log('Director running');
    });
  }

  // Future: weather alert interrupt, agency alerts, sponsor break, AI narration,
  // emergency override, multi-city rotation, YouTube chat command queue.

  window.obsTvStart = startApp;
})();
