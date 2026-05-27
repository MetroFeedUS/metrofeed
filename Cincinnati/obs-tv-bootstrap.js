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
    routeLegDwellMs: 60000,
    routeLegsBeforeTraffic: 10,
    segmentPanEnabled: true,
    segmentPanIntervalMs: 14000,
    incidentDwellMs: 32000,
    slowdownDwellMs: 28000,
    constructionDwellMs: 28000,
    weatherDwellMs: 55000,
    mapFlyDurationMs: 2800,
    routeAgencyPrefix: null
  };

  document.documentElement.classList.add('tv-mode');

  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'obs-tv.css';
  document.head.appendChild(link);
})();
