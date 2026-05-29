/**
 * TV director bootstrap — home.html?tv=1&panel=map&bw=1920&bh=1080
 */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  if (params.get('tv') !== '1' && params.get('tv') !== 'true') return;

  if (sessionStorage.getItem('obsTvAuth') !== '1') {
    var ret = encodeURIComponent(window.location.pathname.split('/').pop() + window.location.search);
    window.location.replace('obs-route-tv.html?return=' + ret);
    return;
  }

  var spec =
    typeof window.mfTvParsePanelParams === 'function'
      ? window.mfTvParsePanelParams(params)
      : {
          panel: 'map',
          isMap: true,
          bw: 1920,
          bh: 1080,
          scale: 1,
          crop: { x: 0, y: 0, w: 1920, h: 1080 },
          stage: { width: 2400, height: 1350 }
        };

  window.MF_TV_STAGE_SPEC = spec;
  window.MF_TV_STAGE_MODE = true;
  window.MF_TV_PANEL = spec.panel;

  if (!spec.isMap) {
    window.location.replace('obs-tv.html?' + params.toString());
    return;
  }

  window.MF_TV_MODE = true;

  var crop = spec.crop || { x: 0, y: 0, w: 1920, h: 1080 };
  window.MF_TV_MAP_PX = { w: crop.w, h: crop.h, bw: spec.bw, bh: spec.bh };

  /** Lock page pixels NOW (before #map exists) — fixes OBS 100vw/100vh blow-up. */
  function applyStageCritical() {
    var root = document.documentElement;
    root.style.setProperty('--mf-tv-bw', spec.bw + 'px');
    root.style.setProperty('--mf-tv-bh', spec.bh + 'px');
    root.style.setProperty('--mf-tv-crop-w', crop.w + 'px');
    root.style.setProperty('--mf-tv-crop-h', crop.h + 'px');
    root.classList.add('tv-mode', 'tv-stage-mode', 'tv-panel-' + spec.panel);

    var vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.setAttribute('name', 'viewport');
      document.head.appendChild(vp);
    }
    vp.setAttribute(
      'content',
      'width=' +
        spec.bw +
        ', height=' +
        spec.bh +
        ', initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no'
    );

    var crit = document.getElementById('mfTvStageCritical');
    if (!crit) {
      crit = document.createElement('style');
      crit.id = 'mfTvStageCritical';
      document.head.appendChild(crit);
    }
    crit.textContent =
      'html.tv-stage-mode,html.tv-stage-mode body{width:' +
      spec.bw +
      'px!important;height:' +
      spec.bh +
      'px!important;max-width:' +
      spec.bw +
      'px!important;max-height:' +
      spec.bh +
      'px!important;overflow:hidden!important;margin:0!important;padding:0!important;}' +
      'html.tv-stage-mode #map{width:' +
      crop.w +
      'px!important;height:' +
      crop.h +
      'px!important;max-width:' +
      crop.w +
      'px!important;max-height:' +
      crop.h +
      'px!important;position:absolute!important;top:0!important;left:0!important;right:auto!important;bottom:auto!important;}';
  }

  applyStageCritical();

  if (params.get('tvReset') === '1' || params.get('tvReset') === 'true') {
    try {
      ['mfTvObsPanelLayout_v1', 'mfTvAlertsSize_v1', 'mfLiveBadgePos_v1'].forEach(function (k) {
        localStorage.removeItem(k);
      });
    } catch (_) {}
  }

  window.MF_TV_CONFIG = window.MF_TV_CONFIG || {
    routeLegDwellMs: 0,
    routeLegsBeforeTraffic: 10,
    segmentPanEnabled: true,
    segmentPanIntervalMs: 11000,
    segmentPanChunks: 4,
    segmentPanStartDelayMs: 4500,
    routeOverlaySettleMs: 5000,
    incidentDwellMs: 32000,
    slowdownDwellMs: 28000,
    constructionDwellMs: 28000,
    weatherDwellMs: 55000,
    mapFlyDurationMs: 2400,
    tvBucketMinHoldMs: 4500,
    tvEpisodeGapMs: 2800,
    vehiclePollMs: 6000,
    routeBucketRadiusMiles: 1.0,
    routeBucketMaxIncidents: 0,
    routeBucketMaxSlowdowns: 0,
    routeBucketMaxCameras: 4,
    routeBucketItemCap: 12,
    routeBucketIncidentDwellMs: 14000,
    routeBucketSlowdownDwellMs: 12000,
    routeBucketCameraDwellMs: 11000,
    tvCameraPanelWidthPx: 880,
    tvCameraPanelWidthRatio: 0,
    tvCameraMapZoom: 14.3,
    tvCameraMapPadExtraPx: 56,
    tvPostCamResetMs: 1600,
    tvTransitMaxZoom: 15.4,
    tvMapPadTop: 48,
    tvMapPadBottom: 48,
    tvMapPadLeft: 40,
    tvMapPadRight: 40,
    routeBucketEnabled: true,
    routeBucketPrefetchOppositeMs: 4000,
    routeAgencyPrefix: null,
    routeDeployablePrefixes: ['sorta_', 'tank_', 'bcrta_'],
    routeAgencyOrder: ['sorta_', 'tank_', 'bcrta_'],
    bcrtaLegDwellMs: 22000,
    useLazyRouteIndex: true
  };

  if (window.MF_TV_CONFIG.useLazyRouteIndex && !window.routesIndex) {
    var lazyIdx = document.createElement('script');
    lazyIdx.src = 'routes_index.lazy.js';
    lazyIdx.async = false;
    document.head.appendChild(lazyIdx);
  }

  try {
    var manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) manifestLink.remove();
  } catch (_) {}

  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'obs-tv.css?v=20260602';
  document.head.appendChild(link);

  var stageCss = document.createElement('link');
  stageCss.rel = 'stylesheet';
  stageCss.href = 'obs-tv-stage.css?v=2';
  document.head.appendChild(stageCss);

  var busJs = document.createElement('script');
  busJs.src = 'obs-tv-bus.js?v=1';
  document.head.appendChild(busJs);

  function forceMapBoxSize() {
    var mapEl = document.getElementById('map');
    if (!mapEl) return;
    mapEl.style.setProperty('width', crop.w + 'px', 'important');
    mapEl.style.setProperty('height', crop.h + 'px', 'important');
    mapEl.style.setProperty('max-width', crop.w + 'px', 'important');
    mapEl.style.setProperty('max-height', crop.h + 'px', 'important');
  }

  function resizeMap() {
    forceMapBoxSize();
    try {
      if (window.map && typeof window.map.resize === 'function') {
        window.map.resize();
      }
      if (window.mfTvDirector && typeof window.mfTvDirector.refitMap === 'function') {
        window.mfTvDirector.refitMap();
      }
    } catch (_) {}
  }

  window.addEventListener('resize', resizeMap);

  function ensureTvMapResize() {
    if (typeof ResizeObserver !== 'undefined') {
      var attachRo = function () {
        var mapEl = document.getElementById('map');
        if (!mapEl) return;
        try {
          new ResizeObserver(resizeMap).observe(mapEl);
        } catch (_) {}
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachRo);
      } else {
        attachRo();
      }
    }

    [0, 200, 600, 1500, 3500, 8000, 12000].forEach(function (ms) {
      setTimeout(resizeMap, ms);
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        forceMapBoxSize();
        setTimeout(resizeMap, 100);
        setTimeout(resizeMap, 800);
      });
    }

    var poll = setInterval(function () {
      if (!window.map) return;
      clearInterval(poll);
      try {
        window.map.on('load', resizeMap);
        if (window.map.loaded && window.map.loaded()) resizeMap();
      } catch (_) {
        resizeMap();
      }
    }, 150);
  }

  ensureTvMapResize();

  function hideTvChrome() {
    ['#favoritesWrapper', '.favorites-wrapper', 'footer.site-footer', '#minimizedItinerary', '#mfTripPlannerSearchBar', '#menuBtn'].forEach(
      function (sel) {
        try {
          document.querySelectorAll(sel).forEach(function (el) {
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
          });
        } catch (_) {}
      }
    );
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideTvChrome);
  } else {
    hideTvChrome();
  }
})();
