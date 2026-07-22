/**
 * Anonymous aggregate operational stats — POST { "name": "weather_open" }.
 * No cookies, no user IDs, no fingerprints. Allowlisted event names only.
 */
const { getStore } = require("@netlify/blobs");

const ALLOWLIST = new Set([
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
]);

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "method_not_allowed" }),
    };
  }

  let name = "";
  try {
    const body = JSON.parse(event.body || "{}");
    name = body && body.name != null ? String(body.name).trim() : "";
  } catch (_) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "bad_json" }),
    };
  }

  if (!ALLOWLIST.has(name)) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "unknown_event" }),
    };
  }

  try {
    const store = getStore("mf-ops-stats");
    const prevRaw = await store.get(name);
    const prev = parseInt(prevRaw || "0", 10);
    const next = (Number.isFinite(prev) ? prev : 0) + 1;
    await store.set(name, String(next));
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: true }),
    };
  } catch (_) {
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false }),
    };
  }
};
