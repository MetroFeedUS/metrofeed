/**
 * Anonymous aggregate operational stats — POST { "name": "weather_open" }.
 * Increments lifetime + America/New_York day + month buckets.
 * Functions v2 so Netlify Blobs auto-configures.
 */
import { getStore } from "@netlify/blobs";

const ALLOWLIST = new Set([
  "city_open_cincinnati",
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
  "sponsor_popup",
  "cookie_banner_shown",
  "cookie_accept",
  "cookie_decline",
  "back_to_national",
]);

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function etDayMonth() {
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return { day, month: day.slice(0, 7) };
}

async function bump(store, key) {
  const prevRaw = await store.get(key);
  const prev = parseInt(prevRaw || "0", 10);
  const next = (Number.isFinite(prev) ? prev : 0) + 1;
  await store.set(key, String(next));
  return next;
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: JSON_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  let name = "";
  try {
    const body = await req.json();
    name = body && body.name != null ? String(body.name).trim() : "";
  } catch (_) {
    return new Response(JSON.stringify({ error: "bad_json" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  if (!ALLOWLIST.has(name)) {
    return new Response(JSON.stringify({ error: "unknown_event" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    const store = getStore("mf-ops-stats");
    const { day, month } = etDayMonth();
    const lifetime = await bump(store, name);
    await bump(store, "d:" + day + ":" + name);
    await bump(store, "m:" + month + ":" + name);
    return new Response(JSON.stringify({ ok: true, lifetime }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (_) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }
};
