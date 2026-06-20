/**
 * RoamRaven — Explore nearby POI from a bus stop (Geoapify Place Details via VPS).
 */
(function (global) {
  'use strict';

  var ISO_SOURCE = 'mf-explore-isochrone';
  var ISO_LAYER = 'mf-explore-isochrone-fill';
  var ISO_LINE = 'mf-explore-isochrone-line';
  var state = {
    markers: [],
    stopPin: null,
    panel: null,
    pending: null
  };

  var GEOM_RANK = { walk_5: 5, walk_10: 10, walk_15: 15, walk_30: 30 };

  function cfg() {
    return global.CITY_CONFIG || (global.getCityConfig && global.getCityConfig()) || {};
  }

  function exploreCfg() {
    var c = cfg();
    return (c && c.explore) || {};
  }

  function placeDetailsBaseUrl() {
    var c = cfg();
    if (!c || !c.placeDetailsUrl) return '';
    return String(c.placeDetailsUrl).replace(/\/$/, '');
  }

  function uiAccent() {
    try {
      if (typeof global.metrofeedUiAccent === 'function') return global.metrofeedUiAccent();
    } catch (_) {}
    return '#9333ea';
  }

  function getMap() {
    if (global.map && typeof global.map.addSource === 'function') return global.map;
    if (global.metrofeedMap && typeof global.metrofeedMap.addSource === 'function') return global.metrofeedMap;
    return null;
  }

  function explorePanelTopPx() {
    try {
      var raw = getComputedStyle(document.documentElement).getPropertyValue('--mf-right-rail-alert-top');
      var n = parseInt(String(raw || '').trim(), 10);
      if (Number.isFinite(n) && n > 0) return n + 6;
    } catch (_) {}
    try {
      var toggle = document.getElementById('mfTripPlannerToggle');
      if (toggle && toggle.getBoundingClientRect) {
        return Math.max(64, Math.round(toggle.getBoundingClientRect().bottom + 8));
      }
    } catch (_) {}
    return 72;
  }

  function getExplorePanelHost() {
    try {
      if (typeof global.getRouteOverlayMount === 'function') {
        return global.getRouteOverlayMount();
      }
    } catch (_) {}
    return document.body;
  }

  function geometryRank(id) {
    return GEOM_RANK[id] || 0;
  }

  function categoryAllowedForGeometry(cat, geomId) {
    var min = cat && cat.minGeometry ? cat.minGeometry : 'walk_5';
    return geometryRank(geomId) >= geometryRank(min);
  }

  function buildFeaturesList(geometryId, categoryIds) {
    var geom = String(geometryId || 'walk_10');
    var cats = Array.isArray(categoryIds) ? categoryIds.slice(0, 2) : [];
    var out = [geom];
    cats.forEach(function (id) {
      out.push(geom + '.' + id);
    });
    return out;
  }

  function categoryById(id) {
    var cats = exploreCfg().categories || [];
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].id === id) return cats[i];
    }
    return null;
  }

  function parseCategoryFromFeatureType(featureType, geometryId) {
    var ft = String(featureType || '');
    var prefix = String(geometryId || '') + '.';
    if (ft.indexOf(prefix) === 0) return ft.slice(prefix.length);
    var dot = ft.indexOf('.');
    if (dot < 0) return '';
    return ft.slice(dot + 1);
  }

  function placeCoordsFromFeature(feature) {
    if (!feature) return null;
    var p = feature.properties || {};
    var lat = Number(p.lat);
    var lon = Number(p.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat: lat, lon: lon };
    }
    var g = feature.geometry;
    if (g && g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
      return { lon: Number(g.coordinates[0]), lat: Number(g.coordinates[1]) };
    }
    return null;
  }

  function isPlaceExploreFeature(feature, geometryId, catSet) {
    var ft = feature && feature.properties && feature.properties.feature_type;
    if (!ft || ft === geometryId || ft === 'details') return false;
    var catId = parseCategoryFromFeatureType(ft, geometryId);
    if (!catId || !catSet[catId]) return false;
    return !!placeCoordsFromFeature(feature);
  }

  function clearExploreMapLayers() {
    var map = getMap();
    if (!map) return;
    try {
      if (map.getLayer(ISO_LAYER)) map.removeLayer(ISO_LAYER);
      if (map.getLayer(ISO_LINE)) map.removeLayer(ISO_LINE);
      if (map.getSource(ISO_SOURCE)) map.removeSource(ISO_SOURCE);
    } catch (_) {}
    state.markers.forEach(function (m) {
      try { m.remove(); } catch (_) {}
    });
    state.markers = [];
    if (state.stopPin) {
      try { state.stopPin.remove(); } catch (_) {}
      state.stopPin = null;
    }
  }

  function clearExploreLayers() {
    clearExploreMapLayers();
    if (state.panel && state.panel.parentNode) {
      state.panel.parentNode.removeChild(state.panel);
      state.panel = null;
    }
  }

  function ensureExplorePanel() {
    if (state.panel && state.panel.parentNode) {
      state.panel.style.top = explorePanelTopPx() + 'px';
      return state.panel;
    }
    var host = getExplorePanelHost();
    if (!host) return null;
    var topPx = explorePanelTopPx();
    var el = document.createElement('div');
    el.id = 'mfExplorePanel';
    el.style.cssText =
      'position:fixed;z-index:1003;top:' + topPx + 'px;left:50%;transform:translateX(-50%);' +
      'max-width:min(92vw,420px);background:rgba(20,20,20,0.94);color:#fff;' +
      'border:1px solid ' + uiAccent() + ';border-radius:10px;padding:10px 14px;' +
      'font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.45);display:flex;align-items:center;gap:10px;flex-wrap:wrap;' +
      'pointer-events:auto;';
    el.innerHTML =
      '<span id="mfExplorePanelText" style="flex:1 1 auto;line-height:1.35;"></span>' +
      '<button type="button" id="mfExploreClearBtn" style="background:#444;color:#fff;border:1px solid #666;' +
      'padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:bold;white-space:nowrap;">Clear</button>';
    host.appendChild(el);
    var clearBtn = el.querySelector('#mfExploreClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        clearExploreLayers();
      });
    }
    state.panel = el;
    return el;
  }

  function setPanelText(text) {
    var panel = ensureExplorePanel();
    if (!panel) return;
    var span = panel.querySelector('#mfExplorePanelText');
    if (span) span.textContent = String(text || '');
  }

  function moveExploreLayersToTop(map) {
    try {
      if (map.getLayer(ISO_LAYER)) map.moveLayer(ISO_LAYER);
      if (map.getLayer(ISO_LINE)) map.moveLayer(ISO_LINE);
    } catch (_) {}
  }

  function drawIsochrone(map, feature) {
    if (!map || !feature || !feature.geometry) return;
    var accent = uiAccent();
    var fc = { type: 'FeatureCollection', features: [feature] };
    try {
      if (map.getSource(ISO_SOURCE)) {
        map.getSource(ISO_SOURCE).setData(fc);
      } else {
        map.addSource(ISO_SOURCE, { type: 'geojson', data: fc });
        map.addLayer({
          id: ISO_LAYER,
          type: 'fill',
          source: ISO_SOURCE,
          paint: {
            'fill-color': accent,
            'fill-opacity': 0.14
          }
        });
        map.addLayer({
          id: ISO_LINE,
          type: 'line',
          source: ISO_SOURCE,
          paint: {
            'line-color': accent,
            'line-width': 2.5,
            'line-opacity': 0.7
          }
        });
      }
      moveExploreLayersToTop(map);
    } catch (err) {
      console.warn('[explorePlaces] isochrone layer', err);
    }
  }

  function addPlaceMarker(map, feature, catMeta) {
    var pt = placeCoordsFromFeature(feature);
    if (!pt) return;
    var p = feature.properties || {};
    var ft = String(p.feature_type || '');
    var catId = parseCategoryFromFeatureType(ft, '') || (catMeta && catMeta.id) || '';
    var meta = catMeta || categoryById(catId) || {};
    var color = meta.color || uiAccent();
    var icon = meta.icon || '📍';
    var name = String(p.name || p.address_line1 || 'Place').trim();

    var el = document.createElement('div');
    el.className = 'mf-explore-place-marker';
    el.style.cssText =
      'width:30px;height:30px;border-radius:50%;background:' + color + ';' +
      'border:2px solid #fff;display:flex;align-items:center;justify-content:center;' +
      'font-size:15px;box-shadow:0 2px 8px rgba(0,0,0,0.45);cursor:pointer;';
    el.textContent = icon;
    el.title = name;

    var popupHtml =
      '<div style="padding:8px 10px;min-width:140px;color:#222;">' +
      '<strong>' + name.replace(/</g, '&lt;') + '</strong>' +
      (meta.label ? '<div style="font-size:12px;color:#555;margin-top:4px;">' + meta.label + '</div>' : '') +
      '</div>';

    var marker = new global.maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([pt.lon, pt.lat])
      .setPopup(new global.maplibregl.Popup({ offset: 14, closeButton: true }).setHTML(popupHtml))
      .addTo(map);
    state.markers.push(marker);
  }

  function extendBoundsWithGeometry(bounds, geometry) {
    if (!bounds || !geometry) return;
    var t = geometry.type;
    var c = geometry.coordinates;
    if (t === 'Point' && c && c.length >= 2) {
      bounds.extend([c[0], c[1]]);
    } else if (t === 'Polygon' && Array.isArray(c)) {
      c.forEach(function (ring) {
        if (!Array.isArray(ring)) return;
        ring.forEach(function (pt) {
          if (Array.isArray(pt) && pt.length >= 2) bounds.extend([pt[0], pt[1]]);
        });
      });
    } else if (t === 'MultiPolygon' && Array.isArray(c)) {
      c.forEach(function (poly) {
        extendBoundsWithGeometry(bounds, { type: 'Polygon', coordinates: poly });
      });
    }
  }

  function fitMapToExploreResults(map, geomFeature) {
    if (!map || !state.pending) return;
    try {
      var bounds = new global.maplibregl.LngLatBounds();
      bounds.extend([state.pending.lon, state.pending.lat]);
      state.markers.forEach(function (m) {
        try {
          var ll = m.getLngLat && m.getLngLat();
          if (ll) bounds.extend([ll.lng, ll.lat]);
        } catch (_) {}
      });
      if (geomFeature && geomFeature.geometry) {
        extendBoundsWithGeometry(bounds, geomFeature.geometry);
      }
      map.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 900 });
    } catch (_) {}
  }

  function renderExploreResults(data, geometryId, categoryIds) {
    var map = getMap();
    if (!map) return 0;
    clearExploreMapLayers();

    var features = (data && data.features) || [];
    var geomFeature = null;
    var placeCount = 0;
    var catSet = {};
    (categoryIds || []).forEach(function (id) { catSet[id] = true; });

    features.forEach(function (f) {
      var ft = f && f.properties && f.properties.feature_type;
      if (!ft) return;
      if (ft === geometryId) {
        geomFeature = f;
        return;
      }
      if (!isPlaceExploreFeature(f, geometryId, catSet)) return;
      var catId = parseCategoryFromFeatureType(ft, geometryId);
      addPlaceMarker(map, f, categoryById(catId));
      placeCount++;
    });

    if (geomFeature) drawIsochrone(map, geomFeature);

    if (state.pending) {
      var accent = uiAccent();
      var el = document.createElement('div');
      el.style.cssText =
        'width:14px;height:14px;border-radius:50%;background:' + accent + ';' +
        'border:3px solid #fff;box-shadow:0 0 0 2px ' + accent + '88;';
      state.stopPin = new global.maplibregl.Marker({ element: el })
        .setLngLat([state.pending.lon, state.pending.lat])
        .addTo(map);
    }

    if (placeCount > 0 || geomFeature) {
      fitMapToExploreResults(map, geomFeature);
    } else if (state.pending) {
      try {
        map.flyTo({
          center: [state.pending.lon, state.pending.lat],
          zoom: Math.max(map.getZoom(), 14),
          duration: 800
        });
      } catch (_) {}
    }

    return placeCount;
  }

  function fetchExplore(lat, lon, geometryId, categoryIds) {
    var base = placeDetailsBaseUrl();
    if (!base) return Promise.reject(new Error('Explore API not configured'));

    var features = buildFeaturesList(geometryId, categoryIds);
    var url =
      base +
      '?lat=' + encodeURIComponent(lat) +
      '&lon=' + encodeURIComponent(lon) +
      '&features=' + encodeURIComponent(features.join(','));

    return fetch(url).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) {}
        if (!res.ok) {
          var msg = (data && data.error) ? String(data.error) : ('HTTP ' + res.status);
          throw new Error(msg);
        }
        return data;
      });
    });
  }

  function readModalSelections() {
    var geomSel = document.getElementById('mfExploreGeometry');
    var geometryId = geomSel ? String(geomSel.value || 'walk_10') : 'walk_10';
    var boxes = document.querySelectorAll('.mf-explore-cat-cb:checked');
    var cats = [];
    boxes.forEach(function (cb) {
      if (cb.value && cats.length < 2) cats.push(cb.value);
    });
    return { geometryId: geometryId, categories: cats };
  }

  function updateExploreGoButton() {
    var btn = document.getElementById('mfExploreGoBtn');
    var hint = document.getElementById('mfExploreHint');
    if (!btn) return;
    var sel = readModalSelections();
    var ok = sel.categories.length >= 1 && sel.categories.length <= 2;
    btn.disabled = !ok;
    btn.style.opacity = ok ? '1' : '0.45';
    btn.style.cursor = ok ? 'pointer' : 'not-allowed';
    if (hint) {
      if (sel.categories.length === 0) {
        hint.textContent = 'Pick 1–2 place types to explore.';
      } else if (sel.categories.length === 2) {
        hint.textContent = 'Maximum 2 place types per search.';
      } else {
        hint.textContent = 'You can add one more place type.';
      }
    }
  }

  function syncCategoryAvailability() {
    var geomSel = document.getElementById('mfExploreGeometry');
    var geometryId = geomSel ? String(geomSel.value || 'walk_10') : 'walk_10';
    var boxes = document.querySelectorAll('.mf-explore-cat-cb');
    boxes.forEach(function (cb) {
      var cat = categoryById(cb.value);
      var allowed = categoryAllowedForGeometry(cat, geometryId);
      var wrap = cb.closest('.mf-explore-cat-wrap');
      cb.disabled = !allowed;
      if (!allowed) cb.checked = false;
      if (wrap) {
        wrap.style.opacity = allowed ? '1' : '0.35';
        wrap.title = allowed ? '' : 'Not available for 5 min walk — try 10 min or longer.';
      }
    });
    var checked = document.querySelectorAll('.mf-explore-cat-cb:checked');
    if (checked.length > 2) {
      for (var i = 2; i < checked.length; i++) checked[i].checked = false;
    }
    updateExploreGoButton();
  }

  function populateExploreModal() {
    var geomSel = document.getElementById('mfExploreGeometry');
    var catHost = document.getElementById('mfExploreCategories');
    var ex = exploreCfg();
    if (!geomSel || !catHost) return;

    if (!geomSel.options.length) {
      (ex.geometries || []).forEach(function (g) {
        var opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.label;
        if (g.id === (ex.defaultGeometry || 'walk_10')) opt.selected = true;
        geomSel.appendChild(opt);
      });
    }

    if (!catHost.childElementCount) {
      (ex.categories || []).forEach(function (cat) {
        var wrap = document.createElement('div');
        wrap.className = 'mf-explore-cat-wrap';
        wrap.style.cssText = 'display:flex;align-items:center;gap:0.35rem;';
        wrap.innerHTML =
          '<input type="checkbox" class="mf-explore-cat-cb" id="mfExploreCat_' + cat.id + '" value="' + cat.id + '" style="margin:0;">' +
          '<label for="mfExploreCat_' + cat.id + '" style="margin:0;color:#fff;font-size:0.9rem;cursor:pointer;">' +
          (cat.icon ? cat.icon + ' ' : '') + cat.label + '</label>';
        catHost.appendChild(wrap);
      });
      catHost.addEventListener('change', function (e) {
        var t = e.target;
        if (!t || !t.classList || !t.classList.contains('mf-explore-cat-cb')) return;
        var checked = document.querySelectorAll('.mf-explore-cat-cb:checked');
        if (checked.length > 2) {
          t.checked = false;
        }
        syncCategoryAvailability();
      });
      geomSel.addEventListener('change', syncCategoryAvailability);
    }

    document.querySelectorAll('.mf-explore-cat-cb').forEach(function (cb) { cb.checked = false; });
    geomSel.value = ex.defaultGeometry || 'walk_10';
    syncCategoryAvailability();
  }

  function hideExploreModal() {
    var modal = document.getElementById('exploreOptionsModal');
    if (!modal) return;
    modal.style.display = 'none';
    try {
      if (typeof global.mfDeactivateDialogA11y === 'function') global.mfDeactivateDialogA11y('exploreOptionsModal');
    } catch (_) {}
    try {
      var prev = global.__mfLastFocusEl;
      if (prev && prev.focus) prev.focus();
    } catch (_) {}
  }

  function showExploreModal() {
    var modal = document.getElementById('exploreOptionsModal');
    var modalContent = modal ? modal.querySelector('.mf-modal') : null;
    if (!modal) return;
    populateExploreModal();
    try { global.__mfLastFocusEl = document.activeElement; } catch (_) {}
    modal.style.display = 'flex';
    try {
      if (typeof global.mfActivateDialogA11y === 'function') {
        global.mfActivateDialogA11y('exploreOptionsModal', hideExploreModal);
      }
    } catch (_) {}
    setTimeout(function () {
      try { modalContent && modalContent.focus && modalContent.focus(); } catch (_) {}
    }, 0);
  }

  function runExploreFromModal() {
    var sel = readModalSelections();
    if (!state.pending || sel.categories.length < 1) return;

    var lat = state.pending.lat;
    var lon = state.pending.lon;
    var stopName = state.pending.stopName || 'this stop';
    var geomLabel = sel.geometryId.replace('walk_', '') + ' min walk';

    hideExploreModal();
    setPanelText('Loading places near ' + stopName + '…');
    ensureExplorePanel();

    fetchExplore(lat, lon, sel.geometryId, sel.categories)
      .then(function (data) {
        var count = renderExploreResults(data, sel.geometryId, sel.categories);
        if (count === 0) {
          var onlyIso = !!(data && data.features && data.features.some(function (f) {
            return f && f.properties && f.properties.feature_type === sel.geometryId;
          }));
          if (onlyIso) {
            setPanelText('Walk area shown — no matching places found within ' + geomLabel + '.');
          } else {
            setPanelText('No places found within ' + geomLabel + ' of ' + stopName + '.');
          }
        } else {
          setPanelText(count + ' place' + (count === 1 ? '' : 's') + ' on map within ' + geomLabel + ' of ' + stopName + '. Tap markers for names.');
        }
      })
      .catch(function (err) {
        console.warn('[explorePlaces]', err);
        var msg = (err && err.message) ? err.message : 'Explore failed';
        if (/missing id/i.test(msg)) {
          msg = 'Explore could not load — location API needs lat/lon support on the server.';
        }
        setPanelText(msg);
        ensureExplorePanel();
      });
  }

  global.openExploreFromStop = function (opts) {
    var lat = Number(opts && opts.lat);
    var lon = Number(opts && opts.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!placeDetailsBaseUrl()) {
      alert('Explore is not configured for this city yet.');
      return;
    }
    state.pending = {
      lat: lat,
      lon: lon,
      stopId: opts && opts.stopId ? String(opts.stopId) : '',
      stopName: opts && opts.stopName ? String(opts.stopName) : 'Stop'
    };
    var title = document.getElementById('mfExploreStopTitle');
    if (title) title.textContent = state.pending.stopName;
    showExploreModal();
  };

  global.hideExploreOptionsModal = hideExploreModal;
  global.runExploreFromModal = runExploreFromModal;
  global.clearExploreLayers = clearExploreLayers;

  global.MfExplorePlaces = {
    clear: clearExploreLayers,
    fetchExplore: fetchExplore,
    buildFeaturesList: buildFeaturesList
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', populateExploreModal);
  } else {
    try { populateExploreModal(); } catch (_) {}
  }
})(typeof window !== 'undefined' ? window : global);
