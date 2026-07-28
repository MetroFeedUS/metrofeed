/**
 * RoamRaven TV — route alerts slice (obs-tv.html?panel=alerts).
 */
(function () {
  'use strict';

  var spec = window.MF_TV_STAGE_SPEC;
  if (!spec || spec.panel !== 'alerts') return;

  function el(id) {
    return document.getElementById(id);
  }

  function setAlerts(route, html) {
    var routeEl = el('mfTvSliceAlertsRoute');
    var bodyEl = el('mfTvSliceAlertsBody');
    if (routeEl) routeEl.textContent = route || 'Waiting for route…';
    if (bodyEl) {
      bodyEl.innerHTML =
        html ||
        '<div class="mf-tv-alerts-panel__empty">Waiting for director…</div>';
    }
  }

  if (typeof window.mfTvBusSubscribe === 'function') {
    window.mfTvBusSubscribe(function (msg) {
      if (msg && msg.t === 'alerts') {
        setAlerts(msg.route, msg.html);
      }
    });
  }

  setAlerts('', '<div class="mf-tv-alerts-panel__empty">Waiting for map source…</div>');
})();
