/**
 * Single-page OBS broadcast layout (2540×1080) — map | cameras | alerts + HUD.
 */
(function () {
  'use strict';

  function el(id) {
    return document.getElementById(id);
  }

  function resizeMapSoon() {
    var delays = [0, 100, 400, 1200, 2500];
    for (var i = 0; i < delays.length; i++) {
      (function (ms) {
        setTimeout(function () {
          try {
            if (window.map && typeof window.map.resize === 'function') {
              window.map.resize();
            }
            if (window.mfTvDirector && typeof window.mfTvDirector.refitMap === 'function') {
              window.mfTvDirector.refitMap();
            }
          } catch (_) {}
        }, ms);
      })(delays[i]);
    }
  }

  window.mfTvBroadcastInit = function () {
    if (!window.MF_TV_BROADCAST) return;

    var root = el('mfTvBroadcastRoot');
    if (!root || root.getAttribute('data-mf-bcast-ready') === '1') return;
    root.setAttribute('data-mf-bcast-ready', '1');

    document.documentElement.classList.add('tv-broadcast-layout');
    root.classList.remove('mf-tv-hidden');
    root.setAttribute('aria-hidden', 'false');

    var mapEl = el('map');
    var mapWrap = el('mfTvBroadcastMapWrap');
    if (mapEl && mapWrap && mapEl.parentNode !== mapWrap) {
      mapWrap.appendChild(mapEl);
    }

    var alertsPanel = el('mfTvAlertsPanel');
    var alertsWrap = el('mfTvBroadcastAlertsWrap');
    if (alertsPanel && alertsWrap && alertsPanel.parentNode !== alertsWrap) {
      alertsWrap.appendChild(alertsPanel);
    }

    if (alertsPanel) {
      alertsPanel.classList.remove('mf-tv-hidden');
      alertsPanel.setAttribute('aria-hidden', 'false');
    }

    var toggle = el('mfTvAlertsToggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');

    resizeMapSoon();

    if (typeof ResizeObserver !== 'undefined' && mapWrap) {
      try {
        var ro = new ResizeObserver(resizeMapSoon);
        ro.observe(mapWrap);
      } catch (_) {}
    }
  };

  window.mfTvBroadcastSetWeatherMode = function (on) {
    try {
      document.documentElement.classList.toggle('tv-broadcast-weather', !!on);
    } catch (_) {}
    resizeMapSoon();
  };

  function tryEarlyInit() {
    if (!window.MF_TV_BROADCAST) return;
    if (el('map') && el('mfTvBroadcastMapWrap')) {
      window.mfTvBroadcastInit();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryEarlyInit);
  } else {
    tryEarlyInit();
  }
})();
