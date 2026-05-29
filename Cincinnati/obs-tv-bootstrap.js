/**

 * TV director bootstrap — run on home.html?tv=1

 * Sets MF_TV_MODE, requires obsTvAuth from obs-route-tv.html gate.

 */

(function () {

  'use strict';

  var params = new URLSearchParams(window.location.search);

  var tv = params.get('tv');

  if (tv !== '1' && tv !== 'true') return;



  if (sessionStorage.getItem('obsTvAuth') !== '1') {

    var ret = encodeURIComponent(window.location.pathname.split('/').pop() + window.location.search);

    window.location.replace('obs-route-tv.html?return=' + ret);

    return;

  }



  window.MF_TV_MODE = true;



  if (params.get('alertsColumn') === '1' || params.get('alertsColumn') === 'true') {

    window.MF_TV_ALERTS_COLUMN = true;

  }



  window.MF_TV_CONFIG = window.MF_TV_CONFIG || {

    routeLegDwellMs: 0,

    routeLegsBeforeTraffic: 10,

    segmentPanEnabled: true,

    /** Slower pans so the route line is readable on stream */

    segmentPanIntervalMs: 11000,

    segmentPanChunks: 4,

    segmentPanStartDelayMs: 4500,

    routeOverlaySettleMs: 5000,

    incidentDwellMs: 32000,

    slowdownDwellMs: 28000,

    constructionDwellMs: 28000,

    weatherDwellMs: 55000,

    /** Slower map flies / fitBounds (readable on TV) */

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

    tvCameraPanelWidthPx: 0,

    /** ~half screen for camera column — map flyTo pads right so pin stays on the left */

    tvCameraPanelWidthRatio: 0.5,

    tvCameraMapZoom: 14.3,

    tvCameraMapPadExtraPx: 56,

    tvPostCamResetMs: 1600,

    tvTransitMaxZoom: 15.4,

    /** Balanced padding — fills 16:9 frame (avoids empty band at bottom) */

    tvMapPadTop: 64,

    tvMapPadBottom: 64,

    tvMapPadLeft: 48,

    tvMapPadRight: 48,

    routeBucketEnabled: true,

    routeBucketPrefetchOppositeMs: 4000,

    /** null = all agencies in routes_index order (SORTA, TANK, BCRTA, …) */

    routeAgencyPrefix: null,

    /** Only agencies with route_data JSON on the server (skips index-only rows like acrta_). */

    routeDeployablePrefixes: ['sorta_', 'tank_', 'bcrta_'],

    /** Episode order: SORTA (live buses) first, BCRTA last. */

    routeAgencyOrder: ['sorta_', 'tank_', 'bcrta_'],

    /** Shorter pan segment on BCRTA (no live vehicles in feed). */

    bcrtaLegDwellMs: 22000,

    /** Build TV queue from routes_index.lazy.js when available (matches real files). */

    useLazyRouteIndex: true

  };



  if (window.MF_TV_CONFIG.useLazyRouteIndex && !window.routesIndex) {

    var lazyIdx = document.createElement('script');

    lazyIdx.src = 'routes_index.lazy.js';

    lazyIdx.async = false;

    document.head.appendChild(lazyIdx);

  }



  document.documentElement.classList.add('tv-mode');



  try {

    var manifestLink = document.querySelector('link[rel="manifest"]');

    if (manifestLink) manifestLink.remove();

  } catch (_) {}



  /** ?obs=1 — full-width map, camera card overlay (for OBS multi-source layout) */

  if (params.get('obs') === '1' || params.get('obs') === 'true') {

    /** Corner cam overlay — resolveTvCameraPanelWidthPx() uses ~38vw when ratio is 0 */

    window.MF_TV_CONFIG.tvCameraPanelWidthRatio = 0;

    window.MF_TV_CONFIG.tvCameraPanelWidthPx = 0;

    window.MF_TV_CONFIG.tvMapPadTop = 56;

    window.MF_TV_CONFIG.tvMapPadBottom = 56;

    window.MF_TV_CONFIG.tvMapPadLeft = 40;

    window.MF_TV_CONFIG.tvMapPadRight = 40;

    document.documentElement.classList.add('tv-obs-layout');

  }



  var link = document.createElement('link');

  link.rel = 'stylesheet';

  link.href = 'obs-tv.css?v=20260530';
  document.head.appendChild(link);

  var layoutCss = document.createElement('link');
  layoutCss.rel = 'stylesheet';
  layoutCss.href = 'obs-tv-layout.css?v=1';
  document.head.appendChild(layoutCss);

  var layoutJs = document.createElement('script');
  layoutJs.src = 'obs-tv-layout.js?v=1';
  document.head.appendChild(layoutJs);

  /** OBS Browser Source: keep MapLibre canvas pixel size = container (fixes route line drift). */

  function ensureTvMapResize() {

    function resizeMap() {

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

    if (typeof ResizeObserver !== 'undefined') {

      var attachRo = function () {

        var mapEl = document.getElementById('map');

        if (!mapEl) return;

        try {

          var ro = new ResizeObserver(function () {

            resizeMap();

          });

          ro.observe(mapEl);

        } catch (_) {}

      };

      if (document.readyState === 'loading') {

        document.addEventListener('DOMContentLoaded', attachRo);

      } else {

        attachRo();

      }

    }



    var waits = [0, 200, 600, 1500, 3500, 8000];

    for (var i = 0; i < waits.length; i++) {

      (function (ms) {

        setTimeout(resizeMap, ms);

      })(waits[i]);

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

    [

      '#favoritesWrapper',

      '.favorites-wrapper',

      'footer.site-footer',

      '#minimizedItinerary',

      '#mfTripPlannerSearchBar',

      '#menuBtn'

    ].forEach(function (sel) {

      try {

        document.querySelectorAll(sel).forEach(function (el) {

          el.style.setProperty('display', 'none', 'important');

          el.style.setProperty('visibility', 'hidden', 'important');

        });

      } catch (_) {}

    });

  }

  if (document.readyState === 'loading') {

    document.addEventListener('DOMContentLoaded', hideTvChrome);

  } else {

    hideTvChrome();

  }

})();


