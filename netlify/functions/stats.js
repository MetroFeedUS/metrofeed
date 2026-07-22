/**
 * Read anonymous operational counters.
 * Requires header: X-MF-Stats-Key: <MF_OPS_STATS_KEY env>
 */
const { getStore } = require("@netlify/blobs");

const EVENT_NAMES = [
  "menu_open",
  "weather_open",
  "cameras_open",
  "alerts_open",
  "buses_open",
  "rail_open",
  "traffic_open",
  "tickets_open",
  "resources_open",
  "find_me",
  "trip_go",
  "cookie_accept",
  "cookie_decline",
  "city_open_cincinnati",
  "back_to_national",
];

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "method_not_allowed" }),
    };
  }

  const expected = process.env.MF_OPS_STATS_KEY || "";
  const headers = event.headers || {};
  const got =
    headers["x-mf-stats-key"] ||
    headers["X-MF-Stats-Key"] ||
    "";
  if (!expected || got !== expected) {
    return {
      statusCode: 401,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "unauthorized" }),
    };
  }

  try {
    const store = getStore("mf-ops-stats");
    const counts = {};
    for (const name of EVENT_NAMES) {
      const raw = await store.get(name);
      const n = parseInt(raw || "0", 10);
      counts[name] = Number.isFinite(n) ? n : 0;
    }
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: true, counts }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: false,
        error: "store_unavailable",
        detail: String(err && err.message ? err.message : err),
      }),
    };
  }
};
