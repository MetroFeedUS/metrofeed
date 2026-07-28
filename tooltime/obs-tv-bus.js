/**
 * RoamRaven TV — bus between OBS browser sources (same origin).
 * BroadcastChannel works in one tab; OBS uses separate CEF instances per source,
 * so we also mirror messages through localStorage + storage events.
 */
(function () {
  'use strict';

  var CHANNEL = 'mf-tv-obs-v1';
  var STORE_KEY = 'mf-tv-obs-bus-v1';
  var bus = null;
  var listeners = [];

  function dispatch(data) {
    if (!data || typeof data !== 'object') return;
    listeners.forEach(function (fn) {
      try {
        fn(data);
      } catch (_) {}
    });
  }

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bus = new BroadcastChannel(CHANNEL);
      bus.addEventListener('message', function (ev) {
        dispatch(ev.data);
      });
    }
  } catch (_) {}

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', function (ev) {
      if (ev.key !== STORE_KEY || !ev.newValue) return;
      try {
        dispatch(JSON.parse(ev.newValue));
      } catch (_) {}
    });
  }

  function publish(msg) {
    if (!msg || typeof msg !== 'object') return;
    var payload = Object.assign({ ts: Date.now() }, msg);
    if (bus) {
      try {
        bus.postMessage(payload);
      } catch (_) {}
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);

    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var last = JSON.parse(raw);
        if (last && last.t) fn(last);
      }
    } catch (_) {}

    return function () {
      listeners = listeners.filter(function (f) {
        return f !== fn;
      });
    };
  }

  window.mfTvBusPublish = publish;
  window.mfTvBusSubscribe = subscribe;
})();
