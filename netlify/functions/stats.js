/**
 * Read anonymous operational counters (lifetime + daily + monthly).
 * Requires header: X-MF-Stats-Key: <MF_OPS_STATS_KEY env>
 */
import { getStore } from "@netlify/blobs";

const EVENT_NAMES = [
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
  "cookie_accept",
  "cookie_decline",
  "back_to_national",
];

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function etDayMonth(d) {
  const day = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return { day, month: day.slice(0, 7) };
}

function addEtDays(base, delta) {
  const t = new Date(base.getTime() + delta * 86400000);
  return etDayMonth(t).day;
}

async function readCounts(store, prefix) {
  const counts = {};
  let total = 0;
  for (const name of EVENT_NAMES) {
    const key = prefix ? prefix + name : name;
    const raw = await store.get(key);
    const n = parseInt(raw || "0", 10);
    const v = Number.isFinite(n) ? n : 0;
    counts[name] = v;
    total += v;
  }
  return { counts, total };
}

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
    const now = new Date();
    const { day: today, month: thisMonth } = etDayMonth(now);

    const lifetime = await readCounts(store, "");
    const todayPack = await readCounts(store, "d:" + today + ":");
    const monthPack = await readCounts(store, "m:" + thisMonth + ":");

    const days = [];
    for (let i = 0; i < 14; i++) {
      const date = addEtDays(now, -i);
      const pack = await readCounts(store, "d:" + date + ":");
      days.push({ date, total: pack.total, counts: pack.counts });
    }

    const months = [];
    const seen = new Set();
    for (let i = 0; i < 180; i += 28) {
      const m = etDayMonth(new Date(now.getTime() - i * 86400000)).month;
      if (seen.has(m)) continue;
      seen.add(m);
      const pack = await readCounts(store, "m:" + m + ":");
      months.push({ month: m, total: pack.total, counts: pack.counts });
      if (months.length >= 6) break;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        timezone: "America/New_York",
        lifetime: lifetime.counts,
        lifetimeTotal: lifetime.total,
        today: { date: today, total: todayPack.total, counts: todayPack.counts },
        thisMonth: { month: thisMonth, total: monthPack.total, counts: monthPack.counts },
        days,
        months,
        /* back-compat for old curl habits */
        counts: lifetime.counts,
      }),
      { status: 200, headers: JSON_HEADERS }
    );
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
