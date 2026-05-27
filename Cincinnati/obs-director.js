/**
 * RoamRaven TV director — drives home.html?tv=1 via production map APIs.
 * Requires: MF_TV_MODE, metrofeedTvApi, showRouteOverlay, hideRouteOverlay
 */
(function () {
  'use strict';

  if (!window.MF_TV_MODE) return;

  const CFG = window.MF_TV_CONFIG;
  const MODES = {
    ROUTE: 'ROUTE_MODE',
    TRAFFIC: 'INCIDENT_MODE',
    CONSTRUCTION: 'CONSTRUCTION_MODE',
    WEATHER: 'WEATHER_MODE',
    IDLE: 'IDLE_MODE'
  };

  const TV = {
    mode: MODES.IDLE,
    legs: [],
    legIndex: 0,
    legsThisCycle: 0,
    trafficQueue: [],
    trafficIndex: 0,
    segmentTimer: null,
    segmentIndex: 0,
    phaseTimer: null,
    running: false,
    currentRouteKey: null
  };

  function log(msg) {
    console.log('[mfTvDirector]', msg);
  }

  function cfg(key, fallback) {
    const v = CFG[key];
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
    if (p) p.classList.add('mf-tv-hidden');
    if (window.metrofeedTvApi && window.metrofeedTvApi.closeTrafficDetail) {
      window.metrofeedTvApi.closeTrafficDetail();
    }
  }

  function showTrafficDetail(title, body, meta) {
    const p = el('mfTvTrafficDetail');
    const ti = el('mfTvTrafficDetailTitle');
    const bo = el('mfTvTrafficDetailBody');
    const me = el('mfTvTrafficDetailMeta');
    if (!p) return;
    p.classList.remove('mf-tv-hidden');
    if (ti) ti.textContent = title || 'Traffic';
    if (bo) bo.textContent = body || '';
    if (me) {
      me.textContent = meta || '';
      me.style.display = meta ? 'block' : 'none';
    }
  }

  function clearPhaseTimer() {
    if (TV.phaseTimer) {
      clearTimeout(TV.phaseTimer);
      TV.phaseTimer = null;
    }
    stopSegmentPan();
  }

  function schedulePhase(ms, fn) {
    clearPhaseTimer();
    TV.phaseTimer = setTimeout(fn, ms);
  }

  function api() {
    return window.metrofeedTvApi;
  }

  function map() {
    return window.map;
  }

  function waitForReady() {
    return new Promise(function (resolve) {
      let n = 0;
      const max = 150;
      const tick = function () {
        n++;
        const m = map();
        if (
          m &&
          typeof window.showRouteOverlay === 'function' &&
          window.metrofeedTvApi &&
          window.ROUTES &&
          window.ROUTES.cincinnati
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

  function buildLegQueue() {
    const routes = (window.ROUTES && window.ROUTES.cincinnati && window.ROUTES.cincinnati.busRoutes) || [];
    const prefix = cfg('routeAgencyPrefix', null);
    const legs = [];
    routes.forEach(function (r) {
      if (!r || !r.id) return;
      if (prefix && String(r.id).indexOf(prefix) !== 0) return;
      legs.push({
        routeId: r.id,
        directionId: 0,
        label: r.label || r.id,
        dirLabel: r.dir0 || 'Direction 0'
      });
      legs.push({
        routeId: r.id,
        directionId: 1,
        label: r.label || r.id,
        dirLabel: r.dir1 || 'Direction 1'
      });
    });
    return legs;
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

  function getRouteShapeCoords(routeId, directionId) {
    const key = routeId + '-' + directionId;
    const desc = window.activeRouteOverlayDescriptors && window.activeRouteOverlayDescriptors[key];
    const rd = desc && desc.options && desc.options.routeData;
    if (!rd) return [];
    if (Array.isArray(rd.shape) && rd.shape.length > 1) {
      return rd.shape.map(function (pt) {
        return [Number(pt[1]), Number(pt[0])];
      });
    }
    if (Array.isArray(rd.shapes) && rd.shapes.length) {
      const out = [];
      rd.shapes.forEach(function (s) {
        if (!Array.isArray(s)) return;
        s.forEach(function (pt) {
          out.push([Number(pt[1]), Number(pt[0])]);
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
    const coords = getRouteShapeCoords(routeId, directionId);
    if (coords.length < 2) return;
    const dwell = cfg('routeLegDwellMs', 60000);
    const interval = cfg('segmentPanIntervalMs', 14000);
    const segCount = Math.max(2, Math.min(6, Math.floor(dwell / interval)));
    const chunks = chunkShape(coords, segCount);
    TV.segmentIndex = 0;

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
      try {
        m.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat]
          ],
          {
            padding: { top: 100, bottom: 160, left: 80, right: 80 },
            maxZoom: 14,
            duration: cfg('mapFlyDurationMs', 2800)
          }
        );
      } catch (_) {}
    };

    flyChunk();
    TV.segmentTimer = setInterval(flyChunk, interval);
  }

  async function enterRouteMode() {
    TV.mode = MODES.ROUTE;
    setPhaseBadge('Transit');
    hideTrafficDetail();
    el('mfTvWeatherPanel') && el('mfTvWeatherPanel').classList.add('mf-tv-hidden');

    const a = api();
    if (a && a.trafficOff) await a.trafficOff();

    if (!TV.legs.length) TV.legs = buildLegQueue();
    if (!TV.legs.length) {
      log('No routes in queue');
      schedulePhase(5000, enterTrafficMode);
      return;
    }

    const leg = TV.legs[TV.legIndex % TV.legs.length];
    TV.legIndex = (TV.legIndex + 1) % TV.legs.length;
    TV.legsThisCycle++;

    hideAllRouteOverlays();
    TV.currentRouteKey = leg.routeId + '-' + leg.directionId;

    const disp = parseRouteDisplay(leg.label, leg.routeId);
    setLowerThird('Route ' + disp.number, disp.title + ' · ' + leg.dirLabel);

    try {
      await window.showRouteOverlay(leg.routeId, leg.directionId, undefined, undefined, {
        ensureOn: true,
        tvMode: true
      });
    } catch (e) {
      console.warn('[mfTvDirector] showRouteOverlay failed', e);
    }

    startSegmentPan(leg.routeId, leg.directionId);

    const maxLegs = cfg('routeLegsBeforeTraffic', 10);
    const dwell = cfg('routeLegDwellMs', 60000);

    schedulePhase(dwell, function () {
      stopSegmentPan();
      try {
        window.hideRouteOverlay(leg.routeId, leg.directionId);
      } catch (_) {}
      setLowerThird('', '');
      if (TV.legsThisCycle >= maxLegs) {
        TV.legsThisCycle = 0;
        enterTrafficMode();
      } else {
        enterRouteMode();
      }
    });
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

  function startDirector() {
    if (TV.running) return;
    TV.running = true;
    TV.legs = buildLegQueue();
    log('Director started; ' + TV.legs.length + ' route legs');
    enterRouteMode();
  }

  window.mfTvDirectorStart = function () {
    waitForReady().then(startDirector);
  };
})();
