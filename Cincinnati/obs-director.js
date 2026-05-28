/**
 * RoamRaven TV director — drives home.html?tv=1 via production map APIs.
 * Requires: MF_TV_MODE, metrofeedTvApi, showRouteOverlay, hideRouteOverlay
 */
(function () {
  'use strict';

  if (!window.MF_TV_MODE) return;

  const MODES = {
    ROUTE: 'ROUTE_MODE',
    TRAFFIC: 'INCIDENT_MODE',
    CONSTRUCTION: 'CONSTRUCTION_MODE',
    WEATHER: 'WEATHER_MODE',
    IDLE: 'IDLE_MODE'
  };

  const TV = {
    mode: MODES.IDLE,
    routes: [],
    routeIndex: 0,
    episodeGeneration: 0,
    legs: [],
    legIndex: 0,
    legsThisCycle: 0,
    trafficQueue: [],
    trafficIndex: 0,
    segmentTimer: null,
    segmentIndex: 0,
    phaseTimer: null,
    phaseEndsAt: 0,
    phaseRemainingMs: null,
    paused: false,
    running: false,
    currentRoute: null,
    currentRouteKey: null,
    currentLeg: null,
    tempPinMarker: null,
    routeShapeCache: Object.create(null)
  };

  function log(msg) {
    console.log('[mfTvDirector]', msg);
  }

  function cfg(key, fallback) {
    const c = window.MF_TV_CONFIG || {};
    const v = c[key];
    return v != null ? v : fallback;
  }

  function el(id) {
    return document.getElementById(id);
  }

  function setPhaseBadge(text) {
    const b = el('mfTvPhaseBadge');
    if (b) b.textContent = text || '';
  }

  function setLowerThird(title, sub) {
    const root = el('mfTvLowerThird');
    const t = el('mfTvLowerThirdTitle');
    const s = el('mfTvLowerThirdSub');
    if (!root) return;
    if (!title) {
      root.classList.add('mf-tv-hidden');
      return;
    }
    root.classList.remove('mf-tv-hidden');
    if (t) t.textContent = title;
    if (s) s.textContent = sub || '';
  }

  function hideTrafficDetail() {
    const p = el('mfTvTrafficDetail');
    const img = el('mfTvTrafficDetailImage');
    const bo = el('mfTvTrafficDetailBody');
    if (p) {
      p.classList.add('mf-tv-hidden');
      p.classList.remove('mf-tv-camera-card', 'mf-tv-incident-card', 'mf-tv-slowdown-card');
    }
    if (bo) bo.style.display = '';
    if (img) {
      img.classList.add('mf-tv-hidden');
      img.removeAttribute('src');
    }
    if (
      typeof window.TrafficCamerasOverlay !== 'undefined' &&
      window.TrafficCamerasOverlay.hideCameraModal
    ) {
      try {
        window.TrafficCamerasOverlay.hideCameraModal();
      } catch (_) {}
    }
    if (window.metrofeedTvApi && window.metrofeedTvApi.closeTrafficDetail) {
      window.metrofeedTvApi.closeTrafficDetail();
    }
    clearFocusRing();
  }

  function removeTempPin() {
    try {
      if (TV.tempPinMarker && typeof TV.tempPinMarker.remove === 'function') {
        TV.tempPinMarker.remove();
      }
    } catch (_) {}
    TV.tempPinMarker = null;
  }

  function showTempPin(lng, lat, label, kind) {
    removeTempPin();
    const m = map();
    if (!m || typeof maplibregl === 'undefined' || !maplibregl.Marker) return;
    const elPin = document.createElement('div');
    elPin.style.cssText =
      'pointer-events:none;transform:translateY(-10px);' +
      'background:rgba(10,10,14,0.88);border:1px solid rgba(147,51,234,0.6);' +
      'border-radius:10px;padding:8px 10px;box-shadow:0 10px 28px rgba(0,0,0,0.55);' +
      'color:#e2e8f0;font:700 12px/1.2 Segoe UI,system-ui,sans-serif;max-width:260px;';
    const badge = document.createElement('div');
    badge.style.cssText =
      'display:inline-block;margin-bottom:6px;padding:2px 8px;border-radius:999px;' +
      'background:rgba(147,51,234,0.28);border:1px solid rgba(147,51,234,0.55);' +
      'color:#e9d5ff;font:700 10px/1 Segoe UI,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;';
    badge.textContent = kind === 'camera' ? 'Camera' : 'Traffic';
    const txt = document.createElement('div');
    txt.textContent = label || '';
    txt.style.cssText = 'font-weight:800;color:#f8fafc;';
    const dot = document.createElement('div');
    dot.style.cssText =
      'width:12px;height:12px;border-radius:50%;margin:8px auto 0;' +
      'background:' +
      (kind === 'camera' ? '#38bdf8' : '#fb7185') +
      ';box-shadow:0 0 0 3px rgba(0,0,0,0.35), 0 0 18px rgba(147,51,234,0.35);';
    elPin.appendChild(badge);
    elPin.appendChild(txt);
    elPin.appendChild(dot);
    try {
      TV.tempPinMarker = new maplibregl.Marker({ element: elPin, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(m);
    } catch (_) {
      TV.tempPinMarker = null;
    }
  }

  function ensureFocusRingLayer() {
    const m = map();
    if (!m || typeof m.getSource !== 'function') return false;
    const srcId = 'mf-tv-focus-src';
    const layerId = 'mf-tv-focus-ring';
    try {
      if (!m.getSource(srcId)) {
        m.addSource(srcId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
      }
      if (!m.getLayer(layerId)) {
        m.addLayer({
          id: layerId,
          type: 'circle',
          source: srcId,
          paint: {
            'circle-radius': 18,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': '#9333ea',
            'circle-stroke-width': 4,
            'circle-stroke-opacity': 0.9
          }
        });
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function setFocusRing(lng, lat) {
    const m = map();
    if (!m) return;
    if (!ensureFocusRingLayer()) return;
    try {
      const src = m.getSource('mf-tv-focus-src');
      if (!src || typeof src.setData !== 'function') return;
      src.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [lng, lat] }
          }
        ]
      });
    } catch (_) {}
  }

  function clearFocusRing() {
    const m = map();
    if (!m) return;
    try {
      const src = m.getSource && m.getSource('mf-tv-focus-src');
      if (src && typeof src.setData === 'function') {
        src.setData({ type: 'FeatureCollection', features: [] });
      }
    } catch (_) {}
  }

  function showTrafficDetail(title, body, meta, imageUrl, kind) {
    const p = el('mfTvTrafficDetail');
    const ti = el('mfTvTrafficDetailTitle');
    const img = el('mfTvTrafficDetailImage');
    const bo = el('mfTvTrafficDetailBody');
    const me = el('mfTvTrafficDetailMeta');
    if (!p) return;
    p.classList.remove('mf-tv-hidden', 'mf-tv-camera-card', 'mf-tv-incident-card', 'mf-tv-slowdown-card');
    if (kind === 'camera') p.classList.add('mf-tv-camera-card');
    else if (kind === 'incident') p.classList.add('mf-tv-incident-card');
    else if (kind === 'slowdown') p.classList.add('mf-tv-slowdown-card');
    p.setAttribute('aria-hidden', 'false');
    if (ti) ti.textContent = title || 'Traffic';
    const url = imageUrl != null ? String(imageUrl).trim() : '';
    if (img) {
      if (url) {
        img.classList.remove('mf-tv-hidden');
        img.alt = title || 'Traffic camera';
        img.referrerPolicy = 'no-referrer';
        const sep = url.indexOf('?') >= 0 ? '&' : '?';
        img.onerror = function () {
          img.classList.add('mf-tv-hidden');
          img.removeAttribute('src');
          if (bo && !bo.textContent) {
            bo.textContent = 'Camera image could not be loaded.';
          }
        };
        img.onload = function () {
          if (bo && bo.textContent === 'Camera image could not be loaded.') {
            bo.textContent = body || '';
          }
        };
        img.src = url + sep + 't=' + Date.now();
      } else {
        img.classList.add('mf-tv-hidden');
        img.removeAttribute('src');
      }
    }
    if (bo) {
      if (kind === 'camera' && url) {
        bo.textContent = '';
        bo.style.display = 'none';
      } else {
        bo.textContent = body || '';
        bo.style.display = body ? 'block' : 'none';
      }
    }
    if (me) {
      if (kind === 'camera') {
        me.textContent = '';
        me.style.display = 'none';
      } else {
        me.textContent = meta || '';
        me.style.display = meta ? 'block' : 'none';
      }
    }
  }

  /** Shift map center left so camera location stays visible beside the right-side feed panel. */
  function flyToTvBucketItem(m, it) {
    if (!m || !it || !Number.isFinite(it.lng) || !Number.isFinite(it.lat)) return;
    const flyMs = Number(cfg('mapFlyDurationMs', 900)) || 900;
    try {
      if (it.kind === 'camera') {
        const panelW = Number(cfg('tvCameraPanelWidthPx', 380)) || 380;
        const padExtra = Number(cfg('tvCameraMapPadExtraPx', 56)) || 56;
        const padRight = panelW + padExtra;
        m.flyTo({
          center: [it.lng, it.lat],
          zoom: Number(cfg('tvCameraMapZoom', 14.3)) || 14.3,
          padding: { top: 64, bottom: 64, left: 40, right: padRight },
          duration: flyMs,
          essential: true
        });
      } else {
        m.flyTo({
          center: [it.lng, it.lat],
          zoom: 14.1,
          duration: flyMs,
          essential: true
        });
      }
    } catch (_) {}
  }

  function clearPhaseTimerOnly() {
    if (TV.phaseTimer) {
      clearTimeout(TV.phaseTimer);
      TV.phaseTimer = null;
    }
    TV.phaseEndsAt = 0;
  }

  function clearPhaseTimer() {
    clearPhaseTimerOnly();
    stopSegmentPan();
  }

  function schedulePhase(ms, fn) {
    clearPhaseTimerOnly();
    TV.phaseEndsAt = Date.now() + ms;
    TV.phaseTimer = setTimeout(function () {
      TV.phaseTimer = null;
      TV.phaseEndsAt = 0;
      if (TV.paused) return;
      fn();
    }, ms);
  }

  function api() {
    return window.metrofeedTvApi;
  }

  function map() {
    return window.map;
  }

  function milesToMeters(mi) {
    const n = Number(mi);
    return Number.isFinite(n) ? n * 1609.344 : 0;
  }

  /** 0 in config = show all found (capped by routeBucketItemCap). */
  function bucketKindCap(cfgKey, fallback) {
    const n = Number(cfg(cfgKey, fallback));
    if (!Number.isFinite(n) || n <= 0) {
      return Math.max(1, Number(cfg('routeBucketItemCap', 20)) || 20);
    }
    return Math.floor(n);
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function waitForReady() {
    return new Promise(function (resolve) {
      let n = 0;
      const max = 150;
      const tick = function () {
        n++;
        const m = map();
        const needLazy = cfg('useLazyRouteIndex', true) !== false;
        const lazyReady = !needLazy || (window.routesIndex && window.routesIndex.routes);
        if (
          m &&
          typeof window.showRouteOverlay === 'function' &&
          window.metrofeedTvApi &&
          window.ROUTES &&
          window.ROUTES.cincinnati &&
          lazyReady
        ) {
          if (m.isStyleLoaded && m.isStyleLoaded()) return resolve();
          if (m.loaded && m.loaded()) return resolve();
        }
        if (n >= max) return resolve();
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  function routeDeployablePrefixes() {
    const p = cfg('routeDeployablePrefixes', ['sorta_', 'tank_', 'bcrta_']);
    return Array.isArray(p) ? p : ['sorta_', 'tank_', 'bcrta_'];
  }

  /** SORTA first (live GTFS), then TANK, then BCRTA last. */
  function routeAgencyOrderPrefixes() {
    const p = cfg('routeAgencyOrder', ['sorta_', 'tank_', 'bcrta_']);
    return Array.isArray(p) ? p : ['sorta_', 'tank_', 'bcrta_'];
  }

  function agencySortRank(routeId) {
    const rid = String(routeId || '');
    const order = routeAgencyOrderPrefixes();
    for (let i = 0; i < order.length; i++) {
      if (rid.indexOf(order[i]) === 0) return i;
    }
    return order.length;
  }

  function sortRoutesByAgency(routes, idOrder) {
    const orderMap = Object.create(null);
    if (Array.isArray(idOrder)) {
      idOrder.forEach(function (id, idx) {
        orderMap[String(id)] = idx;
      });
    }
    routes.sort(function (a, b) {
      const ra = agencySortRank(a.routeId);
      const rb = agencySortRank(b.routeId);
      if (ra !== rb) return ra - rb;
      const ia = orderMap[a.routeId];
      const ib = orderMap[b.routeId];
      if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;
      return String(a.routeId).localeCompare(String(b.routeId));
    });
    return routes;
  }

  function routeIdAllowed(id) {
    const rid = String(id || '');
    const one = cfg('routeAgencyPrefix', null);
    if (one && rid.indexOf(one) !== 0) return false;
    const prefixes = routeDeployablePrefixes();
    if (!prefixes.length) return true;
    for (let i = 0; i < prefixes.length; i++) {
      if (rid.indexOf(prefixes[i]) === 0) return true;
    }
    return false;
  }

  /** Queue from routes_index.lazy.js — only routes that have JSON files on disk. */
  function buildRouteQueueFromLazyIndex() {
    const entries = window.routesIndex && window.routesIndex.routes;
    if (!Array.isArray(entries) || !entries.length) return null;

    const byId = Object.create(null);
    const order = [];
    entries.forEach(function (e) {
      if (!e || !e.route_id || !e.file) return;
      const rid = String(e.route_id);
      if (!routeIdAllowed(rid)) return;
      if (!byId[rid]) {
        byId[rid] = { dirs: Object.create(null) };
        order.push(rid);
      }
      byId[rid].dirs[String(e.direction_id)] = true;
    });

    const busMeta = Object.create(null);
    const busRoutes =
      (window.ROUTES && window.ROUTES.cincinnati && window.ROUTES.cincinnati.busRoutes) || [];
    busRoutes.forEach(function (r) {
      if (r && r.id) busMeta[String(r.id)] = r;
    });

    const out = [];
    order.forEach(function (rid) {
      const dirs = byId[rid].dirs;
      const hasDir0 = !!dirs['0'];
      const hasDir1 = !!dirs['1'];
      if (!hasDir0 && !hasDir1) return;
      const meta = busMeta[rid] || {};
      out.push({
        routeId: rid,
        label: meta.label || rid,
        dir0: meta.dir0 || 'Outbound',
        dir1: meta.dir1 || 'Inbound',
        hasDir0: hasDir0,
        hasDir1: hasDir1
      });
    });
    sortRoutesByAgency(out, order);
    return out.length ? out : null;
  }

  /** Master list: deployable agencies only (SORTA, TANK, BCRTA), index order. */
  function buildRouteQueue() {
    const fromLazy = cfg('useLazyRouteIndex', true) !== false ? buildRouteQueueFromLazyIndex() : null;
    if (fromLazy && fromLazy.length) {
      log('Route queue: ' + fromLazy.length + ' routes (SORTA→TANK→BCRTA, lazy index)');
      return fromLazy;
    }

    const routes = (window.ROUTES && window.ROUTES.cincinnati && window.ROUTES.cincinnati.busRoutes) || [];
    const out = [];
    routes.forEach(function (r) {
      if (!r || !r.id) return;
      if (!routeIdAllowed(r.id)) return;
      out.push({
        routeId: String(r.id),
        label: r.label || r.id,
        dir0: r.dir0 || 'Outbound',
        dir1: r.dir1 || 'Inbound',
        hasDir0: true,
        hasDir1: true
      });
    });
    sortRoutesByAgency(out, null);
    log(
      'Route queue: ' +
        out.length +
        ' routes (SORTA→TANK→BCRTA, routes_index.js)'
    );
    return out;
  }

  function legDwellMs(routeId) {
    const rid = String(routeId || '');
    const bcrtaFast = cfg('bcrtaLegDwellMs', null);
    if (rid.indexOf('bcrta_') === 0 && bcrtaFast != null && Number(bcrtaFast) > 0) {
      return Number(bcrtaFast);
    }
    const fixed = cfg('routeLegDwellMs', null);
    if (fixed != null && Number(fixed) > 0) return Number(fixed);
    const panInterval = Number(cfg('segmentPanIntervalMs', 7000)) || 7000;
    const panChunks = Number(cfg('segmentPanChunks', 4)) || 4;
    let ms = panChunks * panInterval + 2000;
    if (rid.indexOf('bcrta_') === 0) {
      ms = Math.max(12000, Math.floor(ms * 0.5));
    }
    return ms;
  }

  function routeDataBaseUrl() {
    const base =
      (typeof window.ROUTE_DATA_BASE !== 'undefined' && window.ROUTE_DATA_BASE) ||
      (window.CITY_CONFIG && window.CITY_CONFIG.routeDataBase) ||
      './route_data/';
    return String(base).endsWith('/') ? String(base) : String(base) + '/';
  }

  function shapeFromRouteJson(rd) {
    if (!rd) return [];
    if (Array.isArray(rd.shape) && rd.shape.length > 1) return rd.shape;
    if (Array.isArray(rd.shapes) && rd.shapes.length) {
      const out = [];
      rd.shapes.forEach(function (s) {
        if (!Array.isArray(s)) return;
        s.forEach(function (pt) {
          if (pt && pt.length >= 2) out.push(pt);
        });
      });
      if (out.length > 1) return out;
    }
    return [];
  }

  async function fetchRouteJsonQuiet(routeId, directionId) {
    const safeId = String(routeId).replace(/[/?#]+/g, '_');
    const dir = Number(directionId);
    const base = routeDataBaseUrl();
    const tryFiles = [
      'route-' + safeId + '-dir' + dir + '.json',
      'route-' + encodeURIComponent(String(routeId)) + '-dir' + dir + '.json',
      'route-' + safeId + '.json'
    ];
    for (let i = 0; i < tryFiles.length; i++) {
      try {
        const res = await fetch(base + tryFiles[i], { cache: 'force-cache' });
        if (res.ok) return await res.json();
      } catch (_) {}
    }
    return null;
  }

  function storeShapeInCache(routeId, directionId, shapeLatLon) {
    if (!Array.isArray(shapeLatLon) || shapeLatLon.length < 2) return;
    const rid = String(routeId);
    if (!TV.routeShapeCache[rid]) TV.routeShapeCache[rid] = Object.create(null);
    TV.routeShapeCache[rid][String(directionId)] = shapeLatLon;
  }

  async function waitForOverlayReady(routeId, directionId, maxMs, gen) {
    const overlayKey = routeId + '-' + directionId;
    const limit = Number(maxMs) || 12000;
    const start = Date.now();
    while (Date.now() - start < limit) {
      if (gen != null && episodeStale(gen)) return false;
      const hasOverlay = window.activeRouteOverlays && window.activeRouteOverlays[overlayKey];
      const coords = getRouteShapeCoords(routeId, directionId);
      if (hasOverlay && coords.length >= 2) return true;
      await sleep(300);
    }
    return !!(window.activeRouteOverlays && window.activeRouteOverlays[overlayKey]);
  }

  function hideOtherLegOverlays(routeId, keepDirectionId) {
    [0, 1].forEach(function (d) {
      if (Number(d) === Number(keepDirectionId)) return;
      const key = routeId + '-' + d;
      if (window.activeRouteOverlays && window.activeRouteOverlays[key]) {
        try {
          window.hideRouteOverlay(routeId, d);
        } catch (_) {}
      }
    });
  }

  function directionExists(route, directionId) {
    const d = Number(directionId);
    if (d === 0) {
      if (route.hasDir0 === false) return false;
      return true;
    }
    if (d === 1) {
      if (route.hasDir1 === false) return false;
      return true;
    }
    return true;
  }

  function episodeLegDirections(route) {
    const dirs = [];
    const fromLazy =
      route.hasDir0 === true ||
      route.hasDir1 === true ||
      route.hasDir0 === false ||
      route.hasDir1 === false;
    if (fromLazy) {
      if (route.hasDir1) dirs.push(1);
      if (route.hasDir0) dirs.push(0);
      return dirs;
    }
    return [1, 0];
  }

  function episodeStale(gen) {
    return gen !== TV.episodeGeneration || TV.paused;
  }

  async function waitUnlessPaused(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (TV.paused) {
        await new Promise(function (resolve) {
          const tick = function () {
            if (!TV.paused) {
              clearInterval(TV._pauseWaitTimer);
              TV._pauseWaitTimer = null;
              resolve();
            }
          };
          TV._pauseWaitTimer = setInterval(tick, 250);
        });
      }
      const left = end - Date.now();
      if (left <= 0) break;
      await sleep(Math.min(200, left));
    }
  }

  function clearMapBetweenRoutes() {
    stopSegmentPan();
    hideAllRouteOverlays();
    try {
      if (typeof window.clearAllRouteOverlays === 'function') {
        window.clearAllRouteOverlays();
      }
    } catch (_) {}
    clearGlobalFleetMarkers();
    hideTrafficDetail();
    setLowerThird('');
    removeTempPin();
    TV.currentRouteKey = null;
    TV.currentLeg = null;
    const a = api();
    if (a && a.trafficOff) {
      try {
        a.trafficOff();
      } catch (_) {}
    }
    if (typeof window.metrofeedClearTvTrafficRouteFilter === 'function') {
      try {
        window.metrofeedClearTvTrafficRouteFilter();
      } catch (_) {}
    }
  }

  function parseRouteDisplay(label, routeId) {
    let name = label || routeId;
    name = name.replace(/^\[[^\]]+\]\s*/, '');
    const m = name.match(/^([^-]+)\s*-\s*(.+)$/);
    if (m) return { number: m[1].trim(), title: m[2].trim() };
    return { number: routeId, title: name };
  }

  function hideAllRouteOverlays() {
    const active = window.activeRouteOverlays || {};
    Object.keys(active).forEach(function (key) {
      const m = key.match(/^(.+)-(\d+)$/);
      if (!m) return;
      try {
        window.hideRouteOverlay(m[1], Number(m[2]));
      } catch (_) {}
    });
  }

  function shapePtToLngLat(pt) {
    if (!pt || pt.length < 2) return null;
    const a = Number(pt[0]);
    const b = Number(pt[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    // Cincinnati JSON uses [lat, lon]; MapLibre wants [lon, lat]
    if (Math.abs(a) <= 90 && Math.abs(b) > 90) return [b, a];
    if (Math.abs(b) <= 90 && Math.abs(a) > 90) return [a, b];
    return [b, a];
  }

  function getRouteShapeCoords(routeId, directionId) {
    const key = routeId + '-' + directionId;
    const desc =
      (window.activeRouteOverlayDescriptors && window.activeRouteOverlayDescriptors[key]) ||
      null;
    const rd = desc && desc.options && desc.options.routeData;
    if (!rd) return [];

    const out = [];
    if (Array.isArray(rd.shape) && rd.shape.length > 1) {
      rd.shape.forEach(function (pt) {
        const ll = shapePtToLngLat(pt);
        if (ll) out.push(ll);
      });
      if (out.length > 1) return out;
    }
    if (Array.isArray(rd.shapes) && rd.shapes.length) {
      rd.shapes.forEach(function (s) {
        if (!Array.isArray(s)) return;
        s.forEach(function (pt) {
          const ll = shapePtToLngLat(pt);
          if (ll) out.push(ll);
        });
      });
      if (out.length > 1) return out;
    }
    return [];
  }

  function getRouteShapeLatLon(routeId, directionId) {
    const key = routeId + '-' + directionId;
    const desc =
      (window.activeRouteOverlayDescriptors && window.activeRouteOverlayDescriptors[key]) ||
      null;
    const rd = desc && desc.options && desc.options.routeData;
    if (!rd) return [];
    if (Array.isArray(rd.shape) && rd.shape.length > 1) return rd.shape;
    if (Array.isArray(rd.shapes) && rd.shapes.length) {
      // Flatten for distance checks; segment distance only needs a continuous polyline.
      const out = [];
      rd.shapes.forEach(function (s) {
        if (!Array.isArray(s)) return;
        s.forEach(function (pt) {
          if (pt && pt.length >= 2) out.push(pt);
        });
      });
      return out;
    }
    return [];
  }

  function chunkShape(coords, segments) {
    if (!coords.length) return [];
    const n = Math.max(1, segments);
    const size = Math.ceil(coords.length / n);
    const chunks = [];
    for (let i = 0; i < coords.length; i += size) {
      const slice = coords.slice(i, i + size);
      if (slice.length > 1) chunks.push(slice);
    }
    return chunks.length ? chunks : [coords];
  }

  function stopSegmentPan() {
    if (TV.segmentTimer) {
      clearInterval(TV.segmentTimer);
      TV.segmentTimer = null;
    }
  }

  function startSegmentPan(routeId, directionId) {
    stopSegmentPan();
    if (!cfg('segmentPanEnabled', true)) return;
    const m = map();
    if (!m) return;

    const interval = cfg('segmentPanIntervalMs', 7000);
    const numChunks = cfg('segmentPanChunks', 4);
    const flyMs = cfg('mapFlyDurationMs', 900);

    function runWithCoords(coords) {
      if (!coords || coords.length < 2) {
        log('Segment pan skipped (no shape): ' + routeId + '-' + directionId);
        return;
      }
      const chunks = chunkShape(coords, numChunks);
      TV.segmentIndex = 0;
      log(
        'Segment pan: ' +
          chunks.length +
          ' steps every ' +
          interval +
          'ms on ' +
          routeId +
          '-' +
          directionId
      );

      const flyChunk = function () {
        const chunk = chunks[TV.segmentIndex % chunks.length];
        TV.segmentIndex++;
        if (!chunk || chunk.length < 2) return;
        let minLng = Infinity,
          minLat = Infinity,
          maxLng = -Infinity,
          maxLat = -Infinity;
        chunk.forEach(function (c) {
          minLng = Math.min(minLng, c[0]);
          maxLng = Math.max(maxLng, c[0]);
          minLat = Math.min(minLat, c[1]);
          maxLat = Math.max(maxLat, c[1]);
        });
        const centerLng = (minLng + maxLng) / 2;
        const centerLat = (minLat + maxLat) / 2;
        try {
          m.flyTo({
            center: [centerLng, centerLat],
            zoom: 13.2,
            duration: flyMs,
            essential: true
          });
        } catch (_) {
          try {
            m.fitBounds(
              [
                [minLng, minLat],
                [maxLng, maxLat]
              ],
              {
                padding: { top: 90, bottom: 150, left: 70, right: 70 },
                maxZoom: 14,
                duration: flyMs
              }
            );
          } catch (_2) {}
        }
      };

      flyChunk();
      TV.segmentTimer = setInterval(flyChunk, interval);
    }

    function tryStart(attempt) {
      const coords = getRouteShapeCoords(routeId, directionId);
      if (coords.length >= 2) {
        runWithCoords(coords);
        return;
      }
      if (attempt < 8) {
        setTimeout(function () {
          tryStart(attempt + 1);
        }, 400);
      } else {
        log('Segment pan gave up waiting for shape: ' + routeId + '-' + directionId);
      }
    }

    tryStart(0);
  }

  function cacheLegShape(leg) {
    try {
      if (!leg || !leg.routeId) return;
      const shape = getRouteShapeLatLon(leg.routeId, leg.directionId);
      storeShapeInCache(leg.routeId, leg.directionId, shape);
    } catch (_) {}
  }

  function getCachedRouteShapeLatLon(routeId) {
    const rid = String(routeId || '');
    const entry = TV.routeShapeCache[rid];
    if (!entry) return [];
    const s0 = entry['0'];
    const s1 = entry['1'];
    // Prefer longest; also allow combining for better coverage.
    const out = [];
    if (Array.isArray(s0) && s0.length > 1) out.push.apply(out, s0);
    if (Array.isArray(s1) && s1.length > 1) out.push.apply(out, s1);
    return out.length > 1 ? out : (Array.isArray(s0) ? s0 : (Array.isArray(s1) ? s1 : []));
  }

  function resolveCameraImageUrl(c) {
    if (!c) return '';
    const direct = String(c.url || c.imageUrl || c.image_url || c.streamUrl || c.stream_url || '').trim();
    if (direct) return direct;
    const id = c.id != null ? String(c.id) : '';
    if (!id) return '';
    const feed =
      window.CITY_CONFIG && window.CITY_CONFIG.camerasFeedUrl
        ? String(window.CITY_CONFIG.camerasFeedUrl)
        : '';
    if (feed.indexOf('ohio') >= 0) {
      return (
        'https://traffic-api.metrofeedus.com/cameras/ohio/' + encodeURIComponent(id) + '/image'
      );
    }
    return '';
  }

  function normalizeCamerasPayload(raw) {
    const list = Array.isArray(raw) ? raw : raw && (raw.cameras || raw.items || raw.data) || [];
    if (!Array.isArray(list)) return [];
    return list
      .map(function (c, idx) {
        const id = c && c.id != null ? String(c.id) : String(idx);
        const lat = Number(c && (c.lat ?? c.latitude));
        const lon = Number(c && (c.lon ?? c.lng ?? c.longitude));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return {
          id: id,
          name: (c && (c.name || c.title)) || ('Camera ' + id),
          description: (c && (c.description || c.location || c.name)) || '',
          lat: lat,
          lon: lon,
          url: (c && (c.url || c.imageUrl || c.image_url || c.streamUrl || c.stream_url)) || ''
        };
      })
      .filter(Boolean);
  }

  async function displayBucketItem(it, dwellMs, badge) {
    if (TV.paused) return;
    const m = map();
    setPhaseBadge(badge || 'Transit + Traffic');
    setLowerThird('', '');
    hideTrafficDetail();
    setFocusRing(it.lng, it.lat);
    flyToTvBucketItem(m, it);

    if (it.kind === 'camera') {
      const imgUrl = resolveCameraImageUrl(it);
      showTrafficDetail(it.title, '', '', imgUrl, 'camera');
    } else if (it.kind === 'incident') {
      showTrafficDetail(it.title, it.body, it.meta, null, 'incident');
      setLowerThird('Traffic incident', it.title);
    } else if (it.kind === 'slowdown') {
      showTrafficDetail(it.title, it.body, it.meta, null, 'slowdown');
      setLowerThird('Slowdown', it.title);
    } else {
      showTrafficDetail(it.title, it.body, it.meta);
    }

    await sleep(dwellMs);
    hideTrafficDetail();
    if (it.kind === 'incident' || it.kind === 'slowdown') {
      setLowerThird('', '');
    }
  }

  async function prefetchLegShapeQuiet(routeId, directionId) {
    const rid = String(routeId);
    const dir = String(directionId);
    const cached = TV.routeShapeCache[rid] && TV.routeShapeCache[rid][dir];
    if (Array.isArray(cached) && cached.length > 1) return true;
    const rd = await fetchRouteJsonQuiet(routeId, directionId);
    if (!rd) return false;
    try {
      if (typeof window.mfApplyDayGeometry === 'function') {
        window.mfApplyDayGeometry(rd);
      }
    } catch (_) {}
    const shape = shapeFromRouteJson(rd);
    if (shape.length < 2) return false;
    storeShapeInCache(routeId, directionId, shape);
    log('Prefetched shape (json) ' + routeId + '-' + directionId);
    return true;
  }

  async function runRouteBucketForRoute(routeId) {
    if (!routeId || TV.paused) return;
    const m = map();
    const a = api();
    if (!m || !a) return;

    if (cfg('routeBucketEnabled', true) === false) return;
    log('Route package — traffic & cameras: ' + String(routeId));

    const radiusMi = Number(cfg('routeBucketRadiusMiles', 1)) || 1;
    const radiusM = milesToMeters(radiusMi);
    const maxIncidents = bucketKindCap('routeBucketMaxIncidents', 0);
    const maxSlowdowns = bucketKindCap('routeBucketMaxSlowdowns', 0);
    const maxCameras = Math.max(0, Number(cfg('routeBucketMaxCameras', 4)) || 0);
    const incDwell = Math.max(2000, Number(cfg('routeBucketIncidentDwellMs', 10000)) || 10000);
    const slowDwell = Math.max(2000, Number(cfg('routeBucketSlowdownDwellMs', 9000)) || 9000);
    const camDwell = Math.max(1500, Number(cfg('routeBucketCameraDwellMs', 7000)) || 7000);

    const shapeLatLon = getCachedRouteShapeLatLon(routeId);
    const canDist =
      typeof window.metrofeedNearestSegmentInfo === 'function' &&
      Array.isArray(shapeLatLon) &&
      shapeLatLon.length > 1;

    if (!canDist) {
      log(
        'Bucket skipped (no polyline distance): ' +
          String(routeId) +
          ' nearestFn=' +
          (typeof window.metrofeedNearestSegmentInfo === 'function') +
          ' shapePts=' +
          (Array.isArray(shapeLatLon) ? shapeLatLon.length : 0)
      );
      return;
    }

    // --- Incidents + slowdowns near route ---
    try {
      await a.ensureTraffic();
    } catch (_) {}

    if (typeof window.metrofeedSyncTrafficLayersNearRoute === 'function') {
      try {
        window.metrofeedSyncTrafficLayersNearRoute(m, shapeLatLon, radiusMi);
      } catch (syncErr) {
        console.warn('[mfTvDirector] sync traffic near route failed', syncErr);
      }
    }

    const nearIncidents = [];
    const nearSlowdowns = [];
    try {
      const incs = a.incidentsInCity ? a.incidentsInCity() : [];
      for (let i = 0; i < incs.length; i++) {
        const inc = incs[i];
        const fmt =
          window.MfTrafficIncidents && window.MfTrafficIncidents.formatIncidentForDisplay
            ? window.MfTrafficIncidents.formatIncidentForDisplay(inc, i)
            : a.incidentDisplay
              ? a.incidentDisplay(inc, i)
              : null;
        if (!fmt || !fmt.lngLat) continue;
        const lat = Number(fmt.lngLat[1]);
        const lon = Number(fmt.lngLat[0]);
        const info = window.metrofeedNearestSegmentInfo(shapeLatLon, lat, lon);
        if (!info || !Number.isFinite(info.distanceM)) continue;
        if (info.distanceM <= radiusM) {
          const distLabel =
            info.distanceM <= 50 ? '<50 m from route' : Math.round(info.distanceM) + ' m from route';
          nearIncidents.push({
            kind: 'incident',
            distanceM: info.distanceM,
            lng: lon,
            lat: lat,
            title: fmt.title || 'Traffic incident',
            body: fmt.description || (fmt.lines && fmt.lines.join('\n')) || '',
            meta: distLabel
          });
        }
      }
      const slows = a.slowdownsInCity ? a.slowdownsInCity() : [];
      for (let i = 0; i < slows.length; i++) {
        const s = slows[i];
        const fmt = a.slowdownDisplay ? a.slowdownDisplay(s, i) : null;
        if (!fmt || !fmt.lngLat) continue;
        const lat = Number(fmt.lngLat[1]);
        const lon = Number(fmt.lngLat[0]);
        const info = window.metrofeedNearestSegmentInfo(shapeLatLon, lat, lon);
        if (!info || !Number.isFinite(info.distanceM)) continue;
        if (info.distanceM <= radiusM) {
          nearSlowdowns.push({
            kind: 'slowdown',
            distanceM: info.distanceM,
            lng: lon,
            lat: lat,
            title: fmt.title || 'Slowdown',
            body: fmt.description || (fmt.lines && fmt.lines.join('\n')) || '',
            meta:
              'Near route · ' +
              (info.distanceM <= 50 ? '<50m' : Math.round(info.distanceM) + 'm')
          });
        }
      }
    } catch (e) {
      console.warn('[mfTvDirector] bucket incidents failed', e);
    }

    nearIncidents.sort(function (x, y) {
      return x.distanceM - y.distanceM;
    });
    nearSlowdowns.sort(function (x, y) {
      return x.distanceM - y.distanceM;
    });

    log(
      'Near route: ' +
        nearIncidents.length +
        ' incidents, ' +
        nearSlowdowns.length +
        ' slowdowns (≤' +
        radiusMi +
        'mi)'
    );

    if (nearIncidents.length) {
      setPhaseBadge('Incident on route');
    }
    for (let i = 0; i < Math.min(maxIncidents, nearIncidents.length); i++) {
      await displayBucketItem(nearIncidents[i], incDwell, 'Incident on route');
    }

    for (let i = 0; i < Math.min(maxSlowdowns, nearSlowdowns.length); i++) {
      await displayBucketItem(nearSlowdowns[i], slowDwell, 'Slowdowns near route');
    }

    // --- Cameras near route (up to 4) — same loader as home.html / TrafficCamerasOverlay ---
    if (!window._mfTvAllCameras || !Array.isArray(window._mfTvAllCameras)) {
      try {
        if (
          typeof window.TrafficCamerasOverlay !== 'undefined' &&
          window.TrafficCamerasOverlay.getCamerasData
        ) {
          log('Cameras: loading via TrafficCamerasOverlay.getCamerasData()…');
          window._mfTvAllCameras = await window.TrafficCamerasOverlay.getCamerasData();
        } else {
          const camsUrl =
            window.CITY_CONFIG && window.CITY_CONFIG.camerasFeedUrl
              ? String(window.CITY_CONFIG.camerasFeedUrl).trim()
              : 'data/cameras.json';
          const res = await fetch(camsUrl, { cache: 'no-store' });
          if (res.ok) {
            const raw = await res.json();
            window._mfTvAllCameras = normalizeCamerasPayload(raw);
          } else {
            window._mfTvAllCameras = [];
            log('Cameras fetch failed: HTTP ' + res.status);
          }
        }
      } catch (e) {
        window._mfTvAllCameras = [];
        log('Cameras fetch failed (network/CORS): ' + String(e && e.message ? e.message : e));
      }
    }

    const box = a.cityBoundsBox ? a.cityBoundsBox() : null;
    const inBox = function (lon, lat) {
      if (!box) return true;
      return lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north;
    };

    const nearCams = [];
    const cams = window._mfTvAllCameras || [];
    log('Cameras cached: ' + cams.length);
    for (let i = 0; i < cams.length; i++) {
      const c = cams[i];
      const lat = Number(c.lat);
      const lon = Number(c.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!inBox(lon, lat)) continue;
      const info = window.metrofeedNearestSegmentInfo(shapeLatLon, lat, lon);
      if (!info || !Number.isFinite(info.distanceM)) continue;
      if (info.distanceM <= radiusM) {
        const camUrl = resolveCameraImageUrl(c);
        if (!camUrl) continue;
        nearCams.push({
          kind: 'camera',
          id: String(c.id != null ? c.id : i),
          url: camUrl,
          distanceM: info.distanceM,
          lng: lon,
          lat: lat,
          title: String(c.name || c.title || 'Traffic camera'),
          body: String(c.description || c.location || c.name || ''),
          meta:
            'Near route · ' +
            (info.distanceM <= 50 ? '<50m' : Math.round(info.distanceM) + 'm')
        });
      }
    }
    nearCams.sort(function (x, y) {
      return x.distanceM - y.distanceM;
    });
    log(
      'Cameras near route: ' +
        nearCams.length +
        ' (radius ' +
        cfg('routeBucketRadiusMiles', 0.5) +
        'mi, with image URL: ' +
        nearCams.filter(function (c) {
          return c.url;
        }).length +
        ')'
    );

    for (let i = 0; i < Math.min(maxCameras, nearCams.length); i++) {
      await displayBucketItem(nearCams[i], camDwell, 'Cameras near route');
    }

    log('Route package complete: ' + String(routeId));
  }

  /**
   * One direction: overlay + pans; keep line on map until episode clear (after traffic).
   */
  async function playDirectionLeg(route, directionId, gen) {
    const routeId = route.routeId;
    const dirLabel = Number(directionId) === 1 ? route.dir1 : route.dir0;
    const leg = {
      routeId: routeId,
      directionId: directionId,
      label: route.label,
      dirLabel: dirLabel
    };
    TV.currentLeg = leg;
    const overlayKey = routeId + '-' + directionId;
    TV.currentRouteKey = overlayKey;
    adminUpdateStatus();

    const disp = parseRouteDisplay(route.label, routeId);
    setLowerThird('Route ' + disp.number, disp.title + ' · ' + dirLabel);

    hideOtherLegOverlays(routeId, directionId);
    clearGlobalFleetMarkers();

    let overlayOk = false;
    try {
      await window.showRouteOverlay(routeId, directionId, undefined, undefined, {
        ensureOn: true,
        tvMode: true,
        fitBounds: Number(directionId) === 1
      });
      overlayOk = await waitForOverlayReady(
        routeId,
        directionId,
        Number(cfg('routeOverlaySettleMs', 3500)) + 10000,
        gen
      );
    } catch (e) {
      console.warn('[mfTvDirector] showRouteOverlay failed', overlayKey, e);
    }

    if (!overlayOk) {
      log('Skip leg (no overlay): ' + overlayKey);
      setLowerThird('', '');
      return false;
    }

    const oppositeDir = Number(directionId) === 1 ? 0 : 1;
    const oppositeOk = directionExists(route, oppositeDir);
    const pfMs = Number(cfg('routeBucketPrefetchOppositeMs', 4000)) || 0;
    if (oppositeOk && pfMs > 0) {
      setTimeout(function () {
        if (!episodeStale(gen) && TV.currentRouteKey === overlayKey) {
          prefetchLegShapeQuiet(routeId, oppositeDir);
        }
      }, pfMs);
    }

    const panDelay = Number(cfg('segmentPanStartDelayMs', 2800)) || 2800;
    await waitUnlessPaused(panDelay);
    if (episodeStale(gen)) return false;

    if (cfg('segmentPanEnabled', true) !== false) {
      startSegmentPan(routeId, directionId);
    }
    await waitUnlessPaused(legDwellMs(routeId));
    if (episodeStale(gen)) return false;

    stopSegmentPan();
    cacheLegShape(leg);
    setLowerThird('', '');
    return true;
  }

  /** One route episode: dir 1 → dir 0 → traffic/cams → clear map. */
  async function runRouteEpisode(route, gen) {
    const routeId = route.routeId;
    TV.currentRoute = route;
    TV.mode = MODES.ROUTE;
    setPhaseBadge('Transit');
    hideTrafficDetail();
    const wp = el('mfTvWeatherPanel');
    if (wp) wp.classList.add('mf-tv-hidden');
    const a = api();
    if (a && a.trafficOff) {
      try {
        await a.trafficOff();
      } catch (_) {}
    }

    delete TV.routeShapeCache[routeId];
    clearGlobalFleetMarkers();

    const disp = parseRouteDisplay(route.label, routeId);
    log('Episode start: ' + disp.number + ' (' + routeId + ')');

    const legDirs = episodeLegDirections(route);
    for (let li = 0; li < legDirs.length; li++) {
      await playDirectionLeg(route, legDirs[li], gen);
      if (episodeStale(gen)) return;
    }

    if (getCachedRouteShapeLatLon(routeId).length < 2) {
      if (directionExists(route, 0)) await prefetchLegShapeQuiet(routeId, 0);
      if (!episodeStale(gen) && directionExists(route, 1)) {
        await prefetchLegShapeQuiet(routeId, 1);
      }
    }

    if (getCachedRouteShapeLatLon(routeId).length > 1) {
      try {
        await runRouteBucketForRoute(routeId);
      } catch (e) {
        console.warn('[mfTvDirector] route bucket failed', e);
      }
    } else {
      log('Skip traffic/cams (no route shape): ' + routeId);
    }

    if (episodeStale(gen)) return;
    clearMapBetweenRoutes();
    delete TV.routeShapeCache[routeId];
    TV.currentRoute = null;
    log('Episode done: ' + routeId);
  }

  async function runNextRouteEpisode() {
    if (!TV.running) return;
    clearPhaseTimerOnly();

    if (!TV.routes.length) TV.routes = buildRouteQueue();
    if (!TV.routes.length) {
      log('No routes in queue — retry in 10s');
      schedulePhase(10000, runNextRouteEpisode);
      return;
    }

    const idx = TV.routeIndex % TV.routes.length;
    const route = TV.routes[idx];
    TV.routeIndex = (TV.routeIndex + 1) % TV.routes.length;
    const gen = ++TV.episodeGeneration;

    try {
      await runRouteEpisode(route, gen);
    } catch (e) {
      console.warn('[mfTvDirector] episode error', e);
      clearMapBetweenRoutes();
    }

    if (!TV.running || TV.paused || TV.mode !== MODES.ROUTE) return;
    setTimeout(function () {
      runNextRouteEpisode();
    }, 1200);
  }

  function enterRouteMode() {
    TV.mode = MODES.ROUTE;
    const wp = el('mfTvWeatherPanel');
    if (wp) wp.classList.add('mf-tv-hidden');
    TV.episodeGeneration++;
    clearMapBetweenRoutes();
    runNextRouteEpisode();
  }

  function finishRouteLeg(leg) {
    stopSegmentPan();
    try {
      if (leg) window.hideRouteOverlay(leg.routeId, leg.directionId);
    } catch (_) {}
    setLowerThird('', '');
  }

  function parseOverlayKey(key) {
    const m = String(key || '').match(/^(.+)-(\d+)$/);
    if (!m) return null;
    return { routeId: m[1], directionId: Number(m[2]) };
  }

  function adminUpdateStatus() {
    const st = el('mfTvAdminStatus');
    if (!st) return;
    const leg = TV.currentLeg;
    const r = TV.currentRoute;
    const total = TV.routes.length;
    const pos = total ? ((TV.routeIndex - 1 + total) % total) + 1 : 0;
    const lines = [
      'Mode: ' + (TV.mode || '—'),
      'Paused: ' + (TV.paused ? 'YES' : 'no'),
      total ? 'Route ' + pos + ' / ' + total : 'Route —',
      r ? 'On air: ' + parseRouteDisplay(r.label, r.routeId).number : '',
      leg ? 'Leg: dir ' + leg.directionId + ' · ' + leg.dirLabel : '',
      TV.mode === MODES.TRAFFIC
        ? 'Traffic: ' + TV.trafficIndex + ' / ' + TV.trafficQueue.length
        : ''
    ].filter(Boolean);
    st.textContent = lines.join('\n');
  }

  function adminInterrupt(fn) {
    TV.paused = false;
    TV.phaseRemainingMs = null;
    clearPhaseTimer();
    hideTrafficDetail();
    const wp = el('mfTvWeatherPanel');
    if (wp) wp.classList.add('mf-tv-hidden');
    try {
      fn();
    } catch (e) {
      console.warn('[mfTvDirector] admin', e);
    }
    adminUpdateStatus();
  }

  function adminSkipStep() {
    adminInterrupt(function () {
      if (TV.mode === MODES.ROUTE) {
        TV.episodeGeneration++;
        clearMapBetweenRoutes();
        runNextRouteEpisode();
        return;
      }
      if (TV.mode === MODES.TRAFFIC) {
        hideTrafficDetail();
        if (TV.trafficIndex < TV.trafficQueue.length) {
          showNextTrafficItem();
        } else {
          enterConstructionMode();
        }
        return;
      }
      if (TV.mode === MODES.CONSTRUCTION) {
        enterWeatherMode();
        return;
      }
      if (TV.mode === MODES.WEATHER) {
        enterRouteMode();
      }
    });
  }

  function adminSkipPhase() {
    adminInterrupt(function () {
      if (TV.mode === MODES.ROUTE) {
        TV.episodeGeneration++;
        clearMapBetweenRoutes();
        runNextRouteEpisode();
        return;
      }
      hideAllRouteOverlays();
      finishRouteLeg(TV.currentLeg);
      if (TV.mode === MODES.TRAFFIC) {
        enterConstructionMode();
      } else if (TV.mode === MODES.CONSTRUCTION) {
        enterWeatherMode();
      } else {
        TV.legsThisCycle = 0;
        enterRouteMode();
      }
    });
  }

  function adminNextRoute() {
    adminInterrupt(function () {
      TV.episodeGeneration++;
      clearMapBetweenRoutes();
      runNextRouteEpisode();
    });
  }

  function adminPrevRoute() {
    adminInterrupt(function () {
      if (!TV.routes.length) TV.routes = buildRouteQueue();
      if (!TV.routes.length) return;
      TV.routeIndex = (TV.routeIndex - 2 + TV.routes.length * 2) % TV.routes.length;
      TV.episodeGeneration++;
      clearMapBetweenRoutes();
      runNextRouteEpisode();
    });
  }

  function adminPause() {
    if (TV.paused) return;
    TV.paused = true;
    if (TV.phaseEndsAt > Date.now()) {
      TV.phaseRemainingMs = TV.phaseEndsAt - Date.now();
    }
    clearPhaseTimer();
    adminUpdateStatus();
    log('Paused');
  }

  function adminResume() {
    if (!TV.paused) return;
    TV.paused = false;
    const wait = TV.phaseRemainingMs != null ? TV.phaseRemainingMs : 8000;
    TV.phaseRemainingMs = null;

    if (TV.mode === MODES.ROUTE) {
      runNextRouteEpisode();
    } else if (TV.mode === MODES.TRAFFIC) {
      showNextTrafficItem();
    } else if (TV.mode === MODES.CONSTRUCTION) {
      schedulePhase(wait, enterWeatherMode);
    } else if (TV.mode === MODES.WEATHER) {
      schedulePhase(wait, function () {
        const panel = el('mfTvWeatherPanel');
        if (panel) panel.classList.add('mf-tv-hidden');
        enterRouteMode();
      });
    }
    adminUpdateStatus();
    log('Resumed');
  }

  function adminForceMode(mode) {
    adminInterrupt(function () {
      hideAllRouteOverlays();
      finishRouteLeg(TV.currentLeg);
      if (mode === 'traffic') {
        TV.legsThisCycle = 0;
        enterTrafficMode();
      } else if (mode === 'construction') {
        enterConstructionMode();
      } else if (mode === 'weather') {
        enterWeatherMode();
      } else {
        TV.episodeGeneration++;
        clearMapBetweenRoutes();
        enterRouteMode();
      }
    });
  }

  function adminPanelOpen(open) {
    const panel = el('mfTvAdminPanel');
    const toggle = el('mfTvAdminToggle');
    if (!panel) return;
    if (open) {
      panel.classList.remove('mf-tv-hidden');
      panel.setAttribute('aria-hidden', 'false');
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    } else {
      panel.classList.add('mf-tv-hidden');
      panel.setAttribute('aria-hidden', 'true');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }
    adminUpdateStatus();
  }

  function adminPanelToggle() {
    const panel = el('mfTvAdminPanel');
    adminPanelOpen(panel && panel.classList.contains('mf-tv-hidden'));
  }

  function bindAdminPanel() {
    const toggle = el('mfTvAdminToggle');
    const closeBtn = el('mfTvAdminClose');
    const panel = el('mfTvAdminPanel');
    if (!toggle || !panel) return;

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      adminPanelToggle();
    });
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        adminPanelOpen(false);
      });
    }

    panel.querySelectorAll('[data-mf-tv-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const cmd = btn.getAttribute('data-mf-tv-cmd');
        if (cmd === 'pause') adminPause();
        else if (cmd === 'resume') adminResume();
        else if (cmd === 'skipStep') adminSkipStep();
        else if (cmd === 'skipPhase') adminSkipPhase();
        else if (cmd === 'nextRoute') adminNextRoute();
        else if (cmd === 'prevRoute') adminPrevRoute();
        else if (cmd === 'traffic') adminForceMode('traffic');
        else if (cmd === 'construction') adminForceMode('construction');
        else if (cmd === 'weather') adminForceMode('weather');
        else if (cmd === 'routes') adminForceMode('routes');
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        adminPanelToggle();
      }
    });

    setInterval(adminUpdateStatus, 2000);
    adminUpdateStatus();
  }

  function buildTrafficQueue() {
    const a = api();
    if (!a) return [];
    const items = [];
    const incs = a.incidentsInCity() || [];
    incs.forEach(function (inc, i) {
      let fmt = null;
      if (window.MfTrafficIncidents && window.MfTrafficIncidents.formatIncidentForDisplay) {
        fmt = window.MfTrafficIncidents.formatIncidentForDisplay(inc, i);
      } else if (a.incidentDisplay) {
        fmt = a.incidentDisplay(inc, i);
      }
      if (!fmt || !fmt.lngLat) return;
      items.push({
        kind: 'incident',
        lng: fmt.lngLat[0],
        lat: fmt.lngLat[1],
        title: fmt.title,
        body: fmt.description || (fmt.lines && fmt.lines.join('\n')) || '',
        meta: fmt.tier === 'major' ? 'Major incident' : 'Traffic incident',
        score: fmt.score || 10
      });
    });
    const slows = a.slowdownsInCity() || [];
    slows.forEach(function (s, i) {
      const fmt = a.slowdownDisplay ? a.slowdownDisplay(s, i) : null;
      if (!fmt || !fmt.lngLat) return;
      items.push({
        kind: 'slowdown',
        lng: fmt.lngLat[0],
        lat: fmt.lngLat[1],
        title: fmt.title,
        body: fmt.description || '',
        meta: 'Slowdown',
        score: 40
      });
    });
    items.sort(function (x, y) {
      return (y.score || 0) - (x.score || 0);
    });
    return items;
  }

  async function enterTrafficMode() {
    TV.mode = MODES.TRAFFIC;
    adminUpdateStatus();
    setPhaseBadge('Traffic');
    hideAllRouteOverlays();
    setLowerThird('Traffic', 'Incidents & slowdowns');
    stopSegmentPan();

    const a = api();
    if (!a) {
      schedulePhase(5000, enterConstructionMode);
      return;
    }

    try {
      await a.ensureTraffic();
    } catch (e) {
      console.warn('[mfTvDirector] ensureTraffic failed', e);
    }

    TV.trafficQueue = buildTrafficQueue();
    TV.trafficIndex = 0;

    if (!TV.trafficQueue.length) {
      log('No traffic items in city bounds');
      schedulePhase(4000, enterConstructionMode);
      return;
    }

    showNextTrafficItem();
  }

  function showNextTrafficItem() {
    if (TV.mode !== MODES.TRAFFIC) return;
    if (TV.trafficIndex >= TV.trafficQueue.length) {
      hideTrafficDetail();
      setLowerThird('', '');
      enterConstructionMode();
      return;
    }

    const item = TV.trafficQueue[TV.trafficIndex++];
    const m = map();
    const dwell =
      item.kind === 'slowdown' ? cfg('slowdownDwellMs', 28000) : cfg('incidentDwellMs', 32000);

    setLowerThird(item.kind === 'slowdown' ? 'Slowdown' : 'Incident', item.title);

    if (m) {
      try {
        m.flyTo({
          center: [item.lng, item.lat],
          zoom: 13.5,
          duration: cfg('mapFlyDurationMs', 2800),
          essential: true
        });
      } catch (_) {}
    }

    if (window.metrofeedTvApi && window.metrofeedTvApi.showTrafficDetail) {
      window.metrofeedTvApi.showTrafficDetail(item.lng, item.lat, item.title, item.body);
    }
    showTrafficDetail(item.title, item.body, item.meta);

    schedulePhase(dwell, function () {
      hideTrafficDetail();
      showNextTrafficItem();
    });
  }

  async function enterConstructionMode() {
    TV.mode = MODES.CONSTRUCTION;
    adminUpdateStatus();
    setPhaseBadge('Construction');
    hideTrafficDetail();
    setLowerThird('Construction', 'Metro area overview');

    const a = api();
    if (a) {
      try {
        await a.ensureTraffic();
        a.showConstructionLayer();
        a.fitCity(80);
      } catch (_) {}
    }

    schedulePhase(cfg('constructionDwellMs', 28000), enterWeatherMode);
  }

  function weatherEmoji(text) {
    const t = String(text || '').toLowerCase();
    if (t.includes('thunder')) return '⛈️';
    if (t.includes('snow') || t.includes('flurr')) return '❄️';
    if (t.includes('rain') || t.includes('shower') || t.includes('drizzle')) return '🌧️';
    if (t.includes('fog') || t.includes('mist')) return '🌫️';
    if (t.includes('cloud') || t.includes('overcast')) return '☁️';
    if (t.includes('clear') || t.includes('sunny')) return '☀️';
    return '🌤️';
  }

  function nwsHeaders() {
    return { 'User-Agent': 'roamravenapp.com, contact@metrofeedus.com' };
  }

  function nwsPoint() {
    if (typeof mfNwsPointFromCityConfig === 'function') return mfNwsPointFromCityConfig();
    const c = window.CITY_CONFIG;
    if (c && c.defaultCenter) {
      return { lat: c.defaultCenter[1], lon: c.defaultCenter[0] };
    }
    return { lat: 39.1271, lon: -84.5144 };
  }

  async function loadTvWeather() {
    const panel = el('mfTvWeatherPanel');
    if (!panel) return;
    panel.classList.remove('mf-tv-hidden');

    const tempEl = el('mfTvWeatherTemp');
    const feelsEl = el('mfTvWeatherFeels');
    const descEl = el('mfTvWeatherDesc');
    const emojiEl = el('mfTvWeatherEmoji');
    const alertsEl = el('mfTvWeatherAlerts');
    const hourlyEl = el('mfTvWeatherHourly');

    if (tempEl) tempEl.textContent = '—';
    if (hourlyEl) hourlyEl.innerHTML = '<div style="color:#888">Loading…</div>';

    const pt = nwsPoint();
    const pointsUrl = 'https://api.weather.gov/points/' + pt.lat + ',' + pt.lon;
    const alertsUrl = 'https://api.weather.gov/alerts/active?point=' + pt.lat + ',' + pt.lon;

    try {
      const [pointsRes, alertsRes] = await Promise.all([
        fetch(pointsUrl, { headers: nwsHeaders() }),
        fetch(alertsUrl, { headers: nwsHeaders() })
      ]);
      const pointsData = pointsRes.ok ? await pointsRes.json() : null;
      const alertsData = alertsRes.ok ? await alertsRes.json() : null;

      if (alertsEl) {
        const feats = (alertsData && alertsData.features) || [];
        if (feats.length) {
          alertsEl.className = 'mf-tv-weather-alerts has-alert';
          alertsEl.textContent =
            '⚠️ ' + feats.length + ' active alert' + (feats.length > 1 ? 's' : '') + ': ' + (feats[0].properties.event || 'Weather alert');
        } else {
          alertsEl.className = 'mf-tv-weather-alerts no-alert';
          alertsEl.textContent = 'No active weather alerts';
        }
      }

      let currentTemp = null;
      let currentDesc = '';
      let feelsLike = null;

      if (pointsData && pointsData.properties) {
        const props = pointsData.properties;
        if (props.forecastHourly) {
          const hRes = await fetch(props.forecastHourly, { headers: nwsHeaders() });
          if (hRes.ok) {
            const hData = await hRes.json();
            const periods = (hData.properties && hData.properties.periods) || [];
            if (periods[0]) {
              currentTemp = periods[0].temperature;
              currentDesc = periods[0].shortForecast || '';
              if (periods[0].apparentTemperature != null) {
                feelsLike = periods[0].apparentTemperature;
              }
            }
            if (hourlyEl && periods.length) {
              let html = '';
              periods.slice(0, 10).forEach(function (p) {
                const time = new Date(p.startTime);
                const timeStr = time.toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                });
                html +=
                  '<div class="mf-tv-weather-hour">' +
                  '<div class="mf-tv-weather-hour-time">' +
                  timeStr +
                  '</div>' +
                  '<div class="mf-tv-weather-hour-emoji">' +
                  weatherEmoji(p.shortForecast) +
                  '</div>' +
                  '<div class="mf-tv-weather-hour-temp">' +
                  p.temperature +
                  '°' +
                  (p.temperatureUnit || 'F') +
                  '</div>' +
                  '<div class="mf-tv-weather-hour-label">' +
                  (p.shortForecast || '') +
                  '</div></div>';
              });
              hourlyEl.innerHTML = html;
            }
          }
        }
        if (props.observationStations && props.observationStations[0]) {
          try {
            const obsRes = await fetch(props.observationStations[0] + '/observations/latest', {
              headers: nwsHeaders()
            });
            if (obsRes.ok) {
              const obs = await obsRes.json();
              const op = obs.properties || {};
              if (op.temperature && op.temperature.value != null) {
                currentTemp = Math.round((op.temperature.value * 9) / 5 + 32);
              }
              if (op.textDescription) currentDesc = op.textDescription;
              if (op.heatIndex && op.heatIndex.value != null) {
                feelsLike = Math.round((op.heatIndex.value * 9) / 5 + 32);
              } else if (op.windChill && op.windChill.value != null) {
                feelsLike = Math.round((op.windChill.value * 9) / 5 + 32);
              }
            }
          } catch (_) {}
        }
      }

      if (emojiEl) emojiEl.textContent = weatherEmoji(currentDesc);
      if (tempEl) tempEl.textContent = currentTemp != null ? currentTemp + '°F' : '—';
      if (descEl) descEl.textContent = currentDesc || 'Current conditions';
      if (feelsEl) {
        feelsEl.textContent =
          feelsLike != null && feelsLike !== currentTemp ? 'Feels like ' + feelsLike + '°F' : '';
      }
    } catch (e) {
      console.warn('[mfTvDirector] weather load failed', e);
      if (hourlyEl) hourlyEl.innerHTML = '<div style="color:#f55">Weather unavailable</div>';
    }
  }

  async function enterWeatherMode() {
    TV.mode = MODES.WEATHER;
    adminUpdateStatus();
    setPhaseBadge('Weather');
    hideTrafficDetail();
    setLowerThird('', '');

    const a = api();
    if (a && a.hideConstructionLayer) a.hideConstructionLayer();

    await loadTvWeather();

    schedulePhase(cfg('weatherDwellMs', 55000), function () {
      const panel = el('mfTvWeatherPanel');
      if (panel) panel.classList.add('mf-tv-hidden');
      enterRouteMode();
    });
  }

  function applyTvVehicleTuning() {
    if (!window.CITY_CONFIG) return;
    const poll = cfg('vehiclePollMs', 6000);
    window.CITY_CONFIG.sharedVehiclePollMs = poll;
    window.CITY_CONFIG.useSharedVehicleCache = true;
  }

  function clearGlobalFleetMarkers() {
    try {
      if (window.allBusesInterval) {
        clearInterval(window.allBusesInterval);
        window.allBusesInterval = null;
      }
      if (window.busMarkers) {
        const bm = window.busMarkers;
        if (Array.isArray(bm)) {
          bm.forEach(function (m) {
            if (m && typeof m.remove === 'function') m.remove();
          });
          window.busMarkers = [];
        } else if (bm && typeof bm === 'object') {
          Object.keys(bm).forEach(function (k) {
            const m = bm[k];
            if (m && typeof m.remove === 'function') m.remove();
          });
          window.busMarkers = {};
        }
      }
    } catch (e) {
      console.warn('[mfTvDirector] clearGlobalFleetMarkers', e);
    }
  }

  function hidePageChrome() {
    var sel = [
      '#favoritesWrapper',
      '.favorites-wrapper',
      'footer.site-footer',
      '#minimizedItinerary',
      '.minimized-itinerary',
      '#mfTripPlannerSearchBar',
      '#menuBtn',
      '.side-buttons'
    ];
    sel.forEach(function (s) {
      document.querySelectorAll(s).forEach(function (el) {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.setAttribute('aria-hidden', 'true');
      });
    });
  }

  function startDirector() {
    if (TV.running) return;
    TV.running = true;
    applyTvVehicleTuning();
    clearGlobalFleetMarkers();
    hidePageChrome();
    bindAdminPanel();
    TV.routes = buildRouteQueue();
    TV.routeIndex = 0;
    log('Director started; ' + TV.routes.length + ' routes (episode loop)');
    runNextRouteEpisode();
  }

  window.mfTvDirectorStart = function () {
    waitForReady().then(startDirector);
  };

  window.mfTvDirector = {
    skipStep: adminSkipStep,
    skipPhase: adminSkipPhase,
    nextRoute: adminNextRoute,
    prevRoute: adminPrevRoute,
    pause: adminPause,
    resume: adminResume,
    forceTraffic: function () {
      adminForceMode('traffic');
    },
    forceConstruction: function () {
      adminForceMode('construction');
    },
    forceWeather: function () {
      adminForceMode('weather');
    },
    forceRoutes: function () {
      adminForceMode('routes');
    },
    togglePanel: adminPanelToggle,
    openPanel: function () {
      adminPanelOpen(true);
    },
    closePanel: function () {
      adminPanelOpen(false);
    },
    getState: function () {
      return {
        mode: TV.mode,
        paused: TV.paused,
        routeIndex: TV.routeIndex,
        routeTotal: TV.routes.length,
        currentRoute: TV.currentRoute,
        currentLeg: TV.currentLeg,
        trafficIndex: TV.trafficIndex,
        trafficTotal: TV.trafficQueue.length
      };
    }
  };
})();
