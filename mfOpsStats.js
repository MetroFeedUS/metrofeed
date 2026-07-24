/**
 * Anonymous operational usage stats (feature counters only).
 * Runs even when optional analytics / cookies are declined.
 * No user IDs, cookies, or fingerprints — POST { name } only.
 *
 * Delivery: sendBeacon (text/plain JSON) first for unload/redirect safety,
 * then fetch+keepalive if beacon unavailable. Server accepts both.
 *
 * Call-site rule: fire only at the durable moment (page load, overlay ON,
 * modal visible) — never mid-navigation or on toggle-off.
 */
(function (w) {
  var ENDPOINT = "/.netlify/functions/event";
  var ALLOWED = {
    city_open_cincinnati: 1,
    menu_open: 1,
    weather_open: 1,
    cameras_open: 1,
    alerts_open: 1,
    buses_open: 1,
    rail_open: 1,
    traffic_open: 1,
    tickets_open: 1,
    resources_open: 1,
    find_me: 1,
    trip_go: 1,
    sponsor_popup: 1,
    cookie_banner_shown: 1,
    cookie_accept: 1,
    cookie_decline: 1,
    back_to_national: 1,
  };

  function mfIsTvMode() {
    try {
      if (w.MF_TV_MODE) return true;
      var q = w.location && w.location.search ? w.location.search : "";
      return q.indexOf("tv=1") !== -1 || q.indexOf("tv=true") !== -1;
    } catch (_) {
      return false;
    }
  }

  function mfPostEvent(name) {
    var body = JSON.stringify({ name: name });
    var beaconOk = false;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        /* text/plain is more reliable with sendBeacon than application/json in some browsers */
        var blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
        beaconOk = !!navigator.sendBeacon(ENDPOINT, blob);
      }
    } catch (_) {
      beaconOk = false;
    }
    if (beaconOk) return;
    if (typeof fetch !== "function") return;
    try {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true,
        credentials: "omit",
        mode: "same-origin",
        cache: "no-store",
      }).catch(function () {});
    } catch (_) {}
  }

  w.mfTrack = function (name) {
    try {
      if (mfIsTvMode()) return;
      name = String(name || "").trim();
      if (!name || !ALLOWED[name]) return;
      mfPostEvent(name);
    } catch (_) {}
  };

  /** Track then navigate same-tab (survives unload better than bare onclick+href). */
  w.mfTrackGo = function (name, url) {
    try {
      w.mfTrack(name);
    } catch (_) {}
    try {
      if (url) w.location.href = url;
    } catch (_) {}
  };
})(window);
