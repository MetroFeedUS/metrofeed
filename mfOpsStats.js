/**
 * Anonymous operational usage stats (feature counters only).
 * Runs even when optional analytics / cookies are declined.
 * No user IDs, cookies, or fingerprints — POST { name } only.
 */
(function (w) {
  var ENDPOINT = "/.netlify/functions/event";
  var ALLOWED = {
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
    cookie_accept: 1,
    cookie_decline: 1,
    city_open_cincinnati: 1,
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

  w.mfTrack = function (name) {
    try {
      if (mfIsTvMode()) return;
      name = String(name || "").trim();
      if (!name || !ALLOWED[name]) return;
      if (typeof fetch !== "function") return;
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name }),
        keepalive: true,
        credentials: "omit",
        mode: "same-origin",
        cache: "no-store",
      }).catch(function () {});
    } catch (_) {}
  };
})(window);
