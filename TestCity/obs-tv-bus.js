/**
 * RoamRaven TV — BroadcastChannel bus between OBS browser sources (same origin).
 * Map/director publishes; alerts/camera/lower panels subscribe.
 */
(function () {
  'use strict';

  var CHANNEL = 'mf-tv-obs-v1';
  var bus = null;

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bus = new BroadcastChannel(CHANNEL);
    }
  } catch (_) {}

  function publish(msg) {
    if (!bus || !msg || typeof msg !== 'object') return;
    try {
      bus.postMessage(Object.assign({ ts: Date.now() }, msg));
    } catch (_) {}
  }

  function subscribe(fn) {
    if (!bus || typeof fn !== 'function') return function () {};
    var handler = function (ev) {
      try {
        fn(ev.data);
      } catch (_) {}
    };
    bus.addEventListener('message', handler);
    return function () {
      try {
        bus.removeEventListener('message', handler);
      } catch (_) {}
    };
  }

  window.mfTvBusPublish = publish;
  window.mfTvBusSubscribe = subscribe;
})();
