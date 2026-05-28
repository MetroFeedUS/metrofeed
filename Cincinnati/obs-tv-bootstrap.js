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
    segmentPanIntervalMs: 4000,
    segmentPanChunks: 8,
    segmentPanStartDelayMs: 2500,
    incidentDwellMs: 32000,
    slowdownDwellMs: 28000,
    constructionDwellMs: 28000,
    weatherDwellMs: 55000,
    mapFlyDurationMs: 900,
    vehiclePollMs: 6000,
    // Per-route bucket: after both directions for a route, show nearby traffic + cameras
    routeBucketRadiusMiles: 0.5,
    routeBucketMaxIncidents: 1,
    routeBucketMaxCameras: 4,
    routeBucketIncidentDwellMs: 12000,
    routeBucketCameraDwellMs: 8000,
    /** SORTA/Metro only — index includes agencies without local route JSON (e.g. acrta_). */
    routeAgencyPrefix: 'sorta_'
  };

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
