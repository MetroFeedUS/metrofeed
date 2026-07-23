/**
 * Read anonymous operational counters.
 * Requires header: X-MF-Stats-Key: <MF_OPS_STATS_KEY env>
 * Functions v2 (default export) so Netlify Blobs auto-configures.
 */
import { getStore } from "@netlify/blobs";

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

export default async (req) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  const expected = process.env.MF_OPS_STATS_KEY || "";
  const got = req.headers.get("x-mf-stats-key") || "";
  if (!expected || got !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  try {
    const store = getStore("mf-ops-stats");
    const counts = {};
    for (const name of EVENT_NAMES) {
      const raw = await store.get(name);
      const n = parseInt(raw || "0", 10);
      counts[name] = Number.isFinite(n) ? n : 0;
    }
    return new Response(JSON.stringify({ ok: true, counts }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "store_unavailable",
        detail: String(err && err.message ? err.message : err),
      }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
