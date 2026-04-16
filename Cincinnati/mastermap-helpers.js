/**
 * MetroFeed mastermap helpers — supports:
 * - Legacy: `const masterRoutes = [ { route_id, direction_id, shape, stops, ... }, ... ]`
 * - Service-day split: `const masterRoutes = { weekday: [...], sat: [...], sun: [...] }`
 *
 * Service day uses CITY_CONFIG.timezone when set (via options.timezone), else the browser's local calendar.
 * Saturday → `sat` (also accepts `saturday`). Sunday → `sun` (also `sunday`).
 * Monday–Friday → `weekday` (also `mon_fri`, `week`).
 */
(function (global) {
  var BUCKETS = ["weekday", "sat", "sun"];

  function bucketArrays(mr, bucket) {
    if (!mr || typeof mr !== "object") return [];
    var raw;
    if (bucket === "weekday") raw = mr.weekday || mr.mon_fri || mr.week;
    else if (bucket === "sat") raw = mr.sat || mr.saturday;
    else raw = mr.sun || mr.sunday;
    return Array.isArray(raw) ? raw : [];
  }

  function isNestedMastermap(mr) {
    if (!mr || typeof mr !== "object" || Array.isArray(mr)) return false;
    for (var i = 0; i < BUCKETS.length; i++) {
      var b = BUCKETS[i];
      var arr = bucketArrays(mr, b);
      if (Array.isArray(arr) && arr.length) return true;
    }
    return !!(mr.weekday || mr.sat || mr.sun || mr.saturday || mr.sunday || mr.mon_fri || mr.week);
  }

  function serviceDayBucket(date, timezone) {
    var d = date instanceof Date ? date : new Date(date);
    var dayNum;
    try {
      if (timezone) {
        var w = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(d);
        var map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        dayNum = map[w];
      }
    } catch (e) {}
    if (dayNum === undefined) dayNum = d.getDay();
    if (dayNum === 0) return "sun";
    if (dayNum === 6) return "sat";
    return "weekday";
  }

  /**
   * Routes for the active service day (with fallbacks if that bucket is empty).
   * @param {object} masterRoutes
   * @param {{ timezone?: string, date?: Date, day?: 'weekday'|'sat'|'sun' }} [opts]
   * @returns {Array}
   */
  function mastermapRoutesArray(masterRoutes, opts) {
    opts = opts || {};
    if (!masterRoutes) return [];
    if (Array.isArray(masterRoutes)) return masterRoutes;
    if (!isNestedMastermap(masterRoutes)) return [];

    var tz = opts.timezone != null ? opts.timezone : global.CITY_CONFIG && global.CITY_CONFIG.timezone;
    var primary = opts.day || serviceDayBucket(opts.date || new Date(), tz);
    var order = [primary, "weekday", "sat", "sun"].filter(function (k, i, a) {
      return a.indexOf(k) === i;
    });
    for (var i = 0; i < order.length; i++) {
      var arr = bucketArrays(masterRoutes, order[i]);
      if (Array.isArray(arr) && arr.length) return arr;
    }
    return [];
  }

  /**
   * Unique routes across all service buckets (for autocomplete, nearest-stop scan, OTP name mapping).
   */
  function mastermapUnionRoutes(masterRoutes) {
    if (!masterRoutes) return [];
    if (Array.isArray(masterRoutes)) return masterRoutes;
    if (!isNestedMastermap(masterRoutes)) return [];

    var seen = new Set();
    var out = [];
    for (var bi = 0; bi < BUCKETS.length; bi++) {
      var arr = bucketArrays(masterRoutes, BUCKETS[bi]);
      if (!Array.isArray(arr)) continue;
      for (var j = 0; j < arr.length; j++) {
        var r = arr[j];
        if (!r) continue;
        var key = String(r.route_id != null ? r.route_id : r.route_number) + "|" + String(r.direction_id);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
      }
    }
    return out;
  }

  function mastermapHasRoutes(masterRoutes) {
    if (!masterRoutes) return false;
    if (Array.isArray(masterRoutes)) return masterRoutes.length > 0;
    return mastermapUnionRoutes(masterRoutes).length > 0;
  }

  function findInList(list, routeId, directionId) {
    if (!list || !list.length) return null;
    var rid = routeId != null ? String(routeId) : "";
    var dir = directionId;
    var routeData = list.find(function (r) {
      return String(r.route_number) === rid && r.direction_id === dir;
    });
    if (!routeData) {
      routeData = list.find(function (r) {
        return (
          (String(r.route_number) === rid || String(r.route_id) === rid) &&
          r.direction_id === dir
        );
      });
    }
    if (!routeData) {
      routeData = list.find(function (r) {
        return String(r.route_number) === rid || String(r.route_id) === rid;
      });
    }
    return routeData || null;
  }

  /**
   * Prefer today's service bucket; if the route is missing there, search the union of all days.
   */
  function findRouteInMastermap(routeId, directionId, opts) {
    if (typeof global.masterRoutes === "undefined" || !global.masterRoutes) return null;
    var mr = global.masterRoutes;
    var tz = opts && opts.timezone != null ? opts.timezone : global.CITY_CONFIG && global.CITY_CONFIG.timezone;
    var o = Object.assign({ timezone: tz }, opts || {});

    var primary = mastermapRoutesArray(mr, o);
    var found = findInList(primary, routeId, directionId);
    if (found) return found;
    if (Array.isArray(mr)) return null;
    return findInList(mastermapUnionRoutes(mr), routeId, directionId);
  }

  global.metrofeedMastermapServiceDay = serviceDayBucket;
  global.metrofeedMastermapIsNested = isNestedMastermap;
  global.metrofeedMastermapRoutesArray = mastermapRoutesArray;
  global.metrofeedMastermapUnionRoutes = mastermapUnionRoutes;
  global.metrofeedMastermapHasRoutes = mastermapHasRoutes;
  global.metrofeedFindRouteInMastermap = findRouteInMastermap;
})(typeof window !== "undefined" ? window : this);
