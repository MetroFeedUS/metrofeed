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
  window.MF_TV_CONFIG = window.MF_TV_CONFIG || {
    routeLegDwellMs: 0,
    routeLegsBeforeTraffic: 10,
    segmentPanEnabled: true,
    /** Slower pans so the route line is readable on stream */
    segmentPanIntervalMs: 7000,
    segmentPanChunks: 4,
    segmentPanStartDelayMs: 2800,
    routeOverlaySettleMs: 3500,
    incidentDwellMs: 32000,
    slowdownDwellMs: 28000,
    constructionDwellMs: 28000,
    weatherDwellMs: 55000,
    mapFlyDurationMs: 850,
    vehiclePollMs: 6000,
    routeBucketRadiusMiles: 1.0,
    routeBucketMaxIncidents: 0,
    routeBucketMaxSlowdowns: 0,
    routeBucketMaxCameras: 4,
    routeBucketItemCap: 12,
    routeBucketIncidentDwellMs: 9000,
    routeBucketSlowdownDwellMs: 5000,
    routeBucketCameraDwellMs: 5000,
    tvCameraPanelWidthPx: 0,
    tvCameraPanelWidthRatio: 0.5,
    tvCameraMapZoom: 14.3,
    tvCameraMapPadExtraPx: 56,
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

  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'obs-tv.css';
  document.head.appendChild(link);

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
