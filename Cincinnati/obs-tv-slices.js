/**
 * RoamRaven TV — panel slices (alerts, camera, lower). One panel per OBS browser source.
 */
(function () {
  'use strict';

  var spec = window.MF_TV_STAGE_SPEC;
  if (!spec) return;

  var myPanel = spec.panel;

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

  function setCamera(title, imgUrl) {
    var titleEl = el('mfTvSliceCameraTitle');
    var imgEl = el('mfTvSliceCameraImg');
    var emptyEl = el('mfTvSliceCameraEmpty');
    if (titleEl) titleEl.textContent = title || 'Traffic camera';
    if (!imgUrl) {
      if (imgEl) {
        imgEl.classList.add('mf-tv-hidden');
        imgEl.removeAttribute('src');
      }
      if (emptyEl) emptyEl.style.display = 'flex';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (imgEl) {
      imgEl.classList.remove('mf-tv-hidden');
      imgEl.alt = title || 'Traffic camera';
      imgEl.referrerPolicy = 'no-referrer';
      var sep = imgUrl.indexOf('?') >= 0 ? '&' : '?';
      imgEl.src = imgUrl + sep + 't=' + Date.now();
    }
  }

  function setLower(title, sub) {
    var root = el('mfTvSliceLower');
    var t = el('mfTvSliceLowerTitle');
    var s = el('mfTvSliceLowerSub');
    if (!root) return;
    if (!title) {
      root.style.opacity = '0';
      return;
    }
    root.style.opacity = '1';
    if (t) t.textContent = title;
    if (s) s.textContent = sub || '';
  }

  function onBus(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'alerts' && myPanel === 'alerts') {
      setAlerts(msg.route, msg.html);
    } else if (msg.t === 'camera' && myPanel === 'camera') {
      if (msg.open) setCamera(msg.title, msg.imgUrl);
      else setCamera('', '');
    } else if (msg.t === 'lower' && myPanel === 'lower') {
      setLower(msg.title, msg.sub);
    }
  }

  if (typeof window.mfTvBusSubscribe === 'function') {
    window.mfTvBusSubscribe(onBus);
  }

  if (myPanel === 'alerts') {
    setAlerts('', '<div class="mf-tv-alerts-panel__empty">Waiting for map source…</div>');
  } else if (myPanel === 'camera') {
    setCamera('', '');
  } else if (myPanel === 'lower') {
    setLower('', '');
  }
})();
