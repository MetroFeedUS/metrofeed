"""
MetroFeed Unified GTFS Builder
=============================

Generates Cincinnati-style frontend assets from GTFS:

- Per-route JSON files compatible with `Cincinnati/home.html` and `routeOverlay.js`:
    Output/<City>/route_data/route-<route_id>-dir<0|1>.json
  where each JSON contains:
    - route_id, route_number, route_name, route_long_name
    - direction_id, direction_name, route_title
    - shape: [[lat, lon], ...]  (primary / longest)
    - shapes: [shapeA, shapeB, ...] (optional; all unique shape_id polylines)
    - stops: [{ stop_id, name, lat, lon, times: ["HH:MM:SS", ...] }, ...]
    - geometry: { weekday, saturday, sunday } — per-service-day truth (see below)

- A `routes_index.js` in the existing Cincinnati format:
    window.ROUTES = { "<cityId>": { busRoutes: [...], railRoutes: [...] } }

This script replaces the old split between `premiumroutefinder.py` (mastermap variants)
and `build_test_routes.py` (stubs). It produces exactly what the current frontend loads.

Usage examples
--------------

Single-agency city folder:
  python build_routes_unified.py Cincinnati --gtfs-base "..\\gtfs"

Multi-agency city with subfolders (e.g., gtfs/Cincinnati/sorta, gtfs/Cincinnati/tank):
  python build_routes_unified.py Cincinnati --gtfs-base "..\\gtfs" --agencies sorta tank

Write outputs into the website city folder (optional):
  python build_routes_unified.py Cincinnati --gtfs-base "..\\gtfs" --agencies sorta tank --write-website

Legacy vs future (Cincinnati template)
------------------------------------
Top-level ``shape``, ``stops``, and ``schedule`` remain for **current RoamRaven** only
(merged / canonical-bucket behavior). Do not remove them until the app migrates.

**Future source of truth** for map + stops by calendar day::

    today = getDayType()  # weekday | saturday | sunday
    route.geometry[today].shape
    route.geometry[today].stops

Every route JSON always includes all three geometry keys. If a route does not run on
a day (e.g. Sunday), that bucket is still an object with ``trip_count: 0`` and empty
arrays — never ``null`` (avoids frontend null checks).

Notes
-----
- We prefix ids in multi-agency mode to avoid collisions:
    sorta_<route_id>, tank_<route_id>, etc.
- Stop times are derived from a representative set of trips (see MAX_* constants below)
  and are intentionally capped for filesize.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import math
import os
import re
import shutil
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple, Set, Any

import pandas as pd


# ============================================================
# MODE SWITCH (edit these two values)
# ============================================================
# Set BUILD_ALL_CITIES=True to scan gtfs/ and rebuild every city folder found.
# Otherwise, build a single city (set BUILD_ONE_CITY or pass a city arg).
BUILD_ALL_CITIES = False
BUILD_ONE_CITY = "Cincinnati"  # "" means: use CLI positional arg


# ----------------------------
# Tunables (size vs fidelity)
# ----------------------------
MAX_TRIPS_FOR_STOP_SEQUENCE = 250   # per (route_id, direction_id) to infer the "canonical" stop order
MAX_TRIPS_FOR_STOP_TIMES = 200      # per route-direction to sample departure times
MAX_UNIQUE_TIMES_PER_STOP = 80      # cap schedule list per stop
MAX_SHAPES_PER_ROUTE_DIR = 8        # cap number of distinct shape polylines we export per route-direction

# Stop-to-shape proximity used for shape coverage scoring (meters)
STOP_TO_SHAPE_MAX_DIST_M = 250.0

# Chunked reading for stop_times.txt (NYC-scale). Smaller numbers reduce RAM, increase runtime.
STOP_TIMES_CHUNK_ROWS = 750_000

# Always emit all three; non-service days use empty arrays + trip_count 0 (never null).
GEOMETRY_BUCKET_KEYS = ("weekday", "saturday", "sunday")


def _norm(s) -> str:
    return "" if s is None else str(s).strip()


def _safe_read_csv(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Missing GTFS file: {path}")
    return pd.read_csv(path, dtype=str)


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _slugify(value: str) -> str:
    value = str(value).strip()
    value = re.sub(r"[^\w\-]+", "_", value)
    value = re.sub(r"_+", "_", value).strip("_")
    return value or "route"


def _to_int_series(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce").fillna(0).astype(int)


def _prefix_col(df: pd.DataFrame, col: str, prefix: str) -> pd.DataFrame:
    if df is not None and col in df.columns:
        df[col] = prefix + "_" + df[col].astype(str)
    return df


@dataclass
class GtfsBundle:
    routes: pd.DataFrame
    trips: pd.DataFrame
    stop_times: pd.DataFrame
    stops: pd.DataFrame
    shapes: pd.DataFrame
    calendar: Optional[pd.DataFrame]
    calendar_dates: Optional[pd.DataFrame]


def _load_gtfs_folder(folder: str) -> GtfsBundle:
    return GtfsBundle(
        routes=_safe_read_csv(os.path.join(folder, "routes.txt")),
        trips=_safe_read_csv(os.path.join(folder, "trips.txt")),
        stop_times=_safe_read_csv(os.path.join(folder, "stop_times.txt")),
        stops=_safe_read_csv(os.path.join(folder, "stops.txt")),
        shapes=_safe_read_csv(os.path.join(folder, "shapes.txt")),
        calendar=pd.read_csv(os.path.join(folder, "calendar.txt"), dtype=str) if os.path.exists(os.path.join(folder, "calendar.txt")) else None,
        calendar_dates=pd.read_csv(os.path.join(folder, "calendar_dates.txt"), dtype=str) if os.path.exists(os.path.join(folder, "calendar_dates.txt")) else None,
    )


def _prefix_bundle(bundle: GtfsBundle, prefix: str) -> GtfsBundle:
    # Prefix keys likely to collide between agencies
    bundle.routes = _prefix_col(bundle.routes, "route_id", prefix)
    bundle.trips = _prefix_col(bundle.trips, "route_id", prefix)
    bundle.trips = _prefix_col(bundle.trips, "trip_id", prefix)
    bundle.trips = _prefix_col(bundle.trips, "shape_id", prefix)
    bundle.trips = _prefix_col(bundle.trips, "service_id", prefix)

    bundle.stop_times = _prefix_col(bundle.stop_times, "trip_id", prefix)
    bundle.stop_times = _prefix_col(bundle.stop_times, "stop_id", prefix)

    bundle.stops = _prefix_col(bundle.stops, "stop_id", prefix)
    bundle.shapes = _prefix_col(bundle.shapes, "shape_id", prefix)
    if bundle.calendar is not None:
        bundle.calendar = _prefix_col(bundle.calendar, "service_id", prefix)
    if bundle.calendar_dates is not None:
        bundle.calendar_dates = _prefix_col(bundle.calendar_dates, "service_id", prefix)
    return bundle


def _merge_bundles(bundles: List[GtfsBundle]) -> GtfsBundle:
    def _cat(attr: str) -> pd.DataFrame:
        frames = [getattr(b, attr) for b in bundles if getattr(b, attr) is not None]
        return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

    return GtfsBundle(
        routes=_cat("routes"),
        trips=_cat("trips"),
        stop_times=_cat("stop_times"),
        stops=_cat("stops"),
        shapes=_cat("shapes"),
        calendar=_cat("calendar") if any(b.calendar is not None for b in bundles) else None,
        calendar_dates=_cat("calendar_dates") if any(b.calendar_dates is not None for b in bundles) else None,
    )


def _parse_yyyymmdd(s: str) -> Optional[_dt.date]:
    s = _norm(s)
    if not s or not re.match(r"^\d{8}$", s):
        return None
    try:
        return _dt.date(int(s[0:4]), int(s[4:6]), int(s[6:8]))
    except Exception:
        return None


def _weekday_key(d: _dt.date) -> str:
    # GTFS calendar.txt uses monday..sunday flags
    return ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][d.weekday()]


def _pick_representative_dates(today: Optional[_dt.date] = None) -> Dict[str, _dt.date]:
    """Pick a concrete date for weekday/saturday/sunday buckets starting from today."""
    base = today or _dt.date.today()

    def next_weekday(target_py_weekday: int) -> _dt.date:
        delta = (target_py_weekday - base.weekday()) % 7
        if delta == 0:
            # If today matches, keep today (good enough for representative build)
            return base
        return base + _dt.timedelta(days=delta)

    # Monday as representative weekday, Saturday, Sunday
    return {
        "weekday": next_weekday(0),
        "saturday": next_weekday(5),
        "sunday": next_weekday(6),
    }


def _active_services_for_date(calendar_df: Optional[pd.DataFrame], calendar_dates_df: Optional[pd.DataFrame], day: _dt.date) -> Set[str]:
    """Return GTFS service_ids active on a date, honoring calendar_dates exceptions."""
    active: Set[str] = set()
    ds = int(day.strftime("%Y%m%d"))
    wk = _weekday_key(day)

    if calendar_df is not None and not calendar_df.empty:
        cal = calendar_df.copy()
        # Normalize columns
        for col in ("start_date", "end_date"):
            if col in cal.columns:
                cal[col] = pd.to_numeric(cal[col], errors="coerce")
        if wk in cal.columns:
            cal[wk] = cal[wk].fillna("0").astype(str)
        else:
            # If weekday flags missing, treat as unknown — fallback to all services
            wk = None

        for _, r in cal.iterrows():
            sid = _norm(r.get("service_id"))
            if not sid:
                continue
            start = r.get("start_date")
            end = r.get("end_date")
            try:
                if start and ds < int(start):
                    continue
                if end and ds > int(end):
                    continue
            except Exception:
                pass
            if wk is None:
                active.add(sid)
            else:
                if str(r.get(wk)) == "1":
                    active.add(sid)

    # calendar_dates overrides
    if calendar_dates_df is not None and not calendar_dates_df.empty:
        cd = calendar_dates_df
        # exception_type: 1=added, 2=removed
        for _, r in cd.iterrows():
            sid = _norm(r.get("service_id"))
            dt = _norm(r.get("date"))
            ex = _norm(r.get("exception_type"))
            if not sid or not dt:
                continue
            if dt != day.strftime("%Y%m%d"):
                continue
            if ex == "1":
                active.add(sid)
            elif ex == "2":
                if sid in active:
                    active.remove(sid)
    return active


def _read_stop_times_filtered(stop_times_path: str, trip_ids_needed: Set[str]) -> pd.DataFrame:
    """Read stop_times.txt rows only for specified trip_ids, using chunks for big files."""
    if not trip_ids_needed:
        return pd.DataFrame()
    usecols = None
    # We need trip_id, stop_id, stop_sequence and times.
    # Use usecols when possible to reduce memory.
    # Pandas may raise if columns missing; fallback to full read then select.
    want_cols = ["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"]
    try:
        # read small sample header to confirm columns
        sample = pd.read_csv(stop_times_path, dtype=str, nrows=5)
        have = set(sample.columns)
        usecols = [c for c in want_cols if c in have]
    except Exception:
        usecols = None

    chunks: List[pd.DataFrame] = []
    reader = pd.read_csv(stop_times_path, dtype=str, chunksize=STOP_TIMES_CHUNK_ROWS, usecols=usecols)
    for chunk in reader:
        if "trip_id" not in chunk.columns:
            continue
        sub = chunk[chunk["trip_id"].isin(trip_ids_needed)]
        if not sub.empty:
            chunks.append(sub)
    if not chunks:
        return pd.DataFrame()
    out = pd.concat(chunks, ignore_index=True)
    return out


def _build_shape_points(shapes_df: pd.DataFrame, shape_id: str) -> List[List[float]]:
    pts = shapes_df[shapes_df["shape_id"] == shape_id].copy()
    if pts.empty:
        return []
    if "shape_pt_sequence" in pts.columns:
        pts["shape_pt_sequence"] = _to_int_series(pts["shape_pt_sequence"])
        pts = pts.sort_values("shape_pt_sequence")
    out: List[List[float]] = []
    for _, r in pts.iterrows():
        try:
            out.append([float(r["shape_pt_lat"]), float(r["shape_pt_lon"])])
        except Exception:
            continue
    return out


def _approx_dist_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Fast equirectangular approximation in meters (good enough for <=~20km)."""
    # https://www.movable-type.co.uk/scripts/latlong.html (equirectangular)
    r = 6371000.0
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2.0))
    y = math.radians(lat2 - lat1)
    return math.sqrt(x * x + y * y) * r


def _shape_stop_coverage_score(shape: List[List[float]], stops_lonlat: List[Tuple[float, float]], max_dist_m: float) -> Tuple[int, float]:
    """
    Score shape by how many stops are within max_dist_m of any shape point.
    Returns (covered_stop_count, mean_min_distance_m).
    """
    if not shape or not stops_lonlat:
        return (0, float("inf"))

    # Subsample shape points for performance (keep endpoints and ~<=1500 points)
    n = len(shape)
    step = max(1, n // 1500)
    pts = shape[::step]

    covered = 0
    dist_sum = 0.0
    for (slon, slat) in stops_lonlat:
        best = float("inf")
        for (plat, plon) in pts:
            d = _approx_dist_m(float(slat), float(slon), float(plat), float(plon))
            if d < best:
                best = d
                if best <= max_dist_m:
                    break
        dist_sum += best if math.isfinite(best) else max_dist_m * 10
        if best <= max_dist_m:
            covered += 1
    mean = dist_sum / max(1, len(stops_lonlat))
    return (covered, mean)


def _select_primary_shape(
    shapes: List[List[List[float]]],
    canonical_stops: List[Dict[str, Any]],
    max_dist_m: float,
) -> Tuple[List[List[float]], Dict[str, Any]]:
    """
    Pick primary shape as the one with highest stop coverage (then lowest mean distance, then longest).
    Returns (primary_shape, debug_info).
    """
    stops_lonlat: List[Tuple[float, float]] = []
    for s in canonical_stops:
        try:
            slat = float(s.get("lat"))
            slon = float(s.get("lon"))
            if math.isfinite(slat) and math.isfinite(slon):
                stops_lonlat.append((slon, slat))
        except Exception:
            continue

    best = None
    scored = []
    for idx, sh in enumerate(shapes):
        cov, mean = _shape_stop_coverage_score(sh, stops_lonlat, max_dist_m)
        scored.append({"shape_index": idx, "points": len(sh), "covered_stops": cov, "mean_min_dist_m": round(mean, 1)})
        key = (cov, -mean, len(sh))
        if best is None or key > best[0]:
            best = (key, sh)
    primary = best[1] if best else (shapes[0] if shapes else [])
    return primary, {"coverage_scoring": scored, "max_dist_m": max_dist_m}


def _canonical_stop_sequence(
    trips_df: pd.DataFrame,
    stop_times_df: pd.DataFrame,
    route_id: str,
    direction_id: int,
) -> List[str]:
    td = trips_df[(trips_df["route_id"] == route_id) & (trips_df["direction_id"].fillna("0") == str(direction_id))]
    if td.empty:
        return []

    sample_trip_ids = td["trip_id"].head(MAX_TRIPS_FOR_STOP_SEQUENCE).tolist()
    st = stop_times_df[stop_times_df["trip_id"].isin(sample_trip_ids)].copy()
    if st.empty:
        return []

    if "stop_sequence" in st.columns:
        st["stop_sequence"] = _to_int_series(st["stop_sequence"])
    else:
        st["stop_sequence"] = 0

    sequences: Counter = Counter()
    for trip_id, g in st.groupby("trip_id"):
        g = g.sort_values("stop_sequence")
        seq = tuple(g["stop_id"].tolist())
        if seq:
            sequences[seq] += 1
    if not sequences:
        return []
    return list(sequences.most_common(1)[0][0])


def _stop_records_with_times_for_trips(
    stop_times_df: pd.DataFrame,
    stops_df: pd.DataFrame,
    trip_ids: List[str],
    stop_sequence: List[str],
) -> Tuple[List[Dict], Dict[str, List[str]]]:
    if not stop_sequence:
        return [], {}
    if not trip_ids:
        return [], {}

    sample_trip_ids = trip_ids[:MAX_TRIPS_FOR_STOP_TIMES]
    st = stop_times_df[stop_times_df["trip_id"].isin(sample_trip_ids)].copy() if not stop_times_df.empty else pd.DataFrame()
    if st.empty:
        # Still return stop metadata without times
        stops_lookup = stops_df.set_index("stop_id", drop=False) if not stops_df.empty and "stop_id" in stops_df.columns else None
        out = []
        for sid in stop_sequence:
            rec = {"stop_id": sid, "name": sid}
            if stops_lookup is not None and sid in stops_lookup.index:
                row = stops_lookup.loc[sid]
                rec["name"] = _norm(row.get("stop_name")) or sid
                try:
                    rec["lat"] = float(row.get("stop_lat"))
                    rec["lon"] = float(row.get("stop_lon"))
                except Exception:
                    pass
            out.append(rec)
        return out, {}

    # departure_time can be missing; fall back to arrival_time
    time_col = "departure_time" if "departure_time" in st.columns else ("arrival_time" if "arrival_time" in st.columns else None)
    if not time_col:
        time_col = None

    times_by_stop: Dict[str, set] = defaultdict(set)
    if time_col:
        # Keep only rows that are part of the canonical stop list
        st2 = st[st["stop_id"].isin(stop_sequence)]
        for _, r in st2.iterrows():
            sid = _norm(r.get("stop_id"))
            t = _norm(r.get(time_col))
            if sid and t:
                times_by_stop[sid].add(t)

    # Build stop metadata lookup
    stops_lookup = stops_df.set_index("stop_id", drop=False) if not stops_df.empty and "stop_id" in stops_df.columns else None

    out: List[Dict] = []
    for sid in stop_sequence:
        name = sid
        lat = None
        lon = None
        if stops_lookup is not None and sid in stops_lookup.index:
            row = stops_lookup.loc[sid]
            try:
                name = _norm(row.get("stop_name")) or sid
            except Exception:
                name = sid
            try:
                lat = float(row.get("stop_lat"))
                lon = float(row.get("stop_lon"))
            except Exception:
                lat = None
                lon = None

        # Convert times to a stable sorted list, cap for filesize
        tset = times_by_stop.get(sid, set())
        times_sorted = sorted(tset)[:MAX_UNIQUE_TIMES_PER_STOP] if tset else []

        rec = {"stop_id": sid, "name": name}
        if lat is not None and lon is not None:
            rec["lat"] = lat
            rec["lon"] = lon
        if times_sorted:
            rec["times"] = times_sorted
        out.append(rec)
    # Also return a map (stop_id -> times) for structured schedule
    times_map = {sid: sorted(list(times_by_stop.get(sid, set())))[:MAX_UNIQUE_TIMES_PER_STOP] for sid in stop_sequence}
    return out, times_map


def _route_meta(routes_df: pd.DataFrame, route_id: str) -> Dict[str, str]:
    if routes_df.empty:
        return {}
    r = routes_df[routes_df["route_id"] == route_id]
    if r.empty:
        return {}
    row = r.iloc[0].to_dict()
    return {k: _norm(v) for k, v in row.items()}


def _agency_tag_for_route_id(route_id: str) -> Optional[str]:
    rid = str(route_id or "")
    if rid.startswith("sorta_"):
        return "SORTA"
    if rid.startswith("tank_"):
        return "TANK"
    return None


def _direction_name(direction_id: int) -> str:
    return "Outbound" if direction_id == 0 else "Inbound" if direction_id == 1 else str(direction_id)


def _headsign_samples_for_direction(trips_df: pd.DataFrame, route_id: str, direction_id: int, trip_ids: List[str]) -> List[str]:
    if not trip_ids:
        return []
    td = trips_df[trips_df["trip_id"].isin(trip_ids)]
    if td.empty:
        return []
    col = "trip_headsign" if "trip_headsign" in td.columns else None
    if not col:
        return []
    counts = Counter([_norm(x) for x in td[col].dropna().tolist() if _norm(x)])
    if not counts:
        return []
    return [x for x, _ in counts.most_common(6)]


def _stop_sequence_for_trip_ids(stop_times_df: pd.DataFrame, trip_ids: List[str]) -> List[str]:
    """Most common stop order for a set of trips (same logic as canonical bucket)."""
    if not trip_ids:
        return []
    sample = trip_ids[:MAX_TRIPS_FOR_STOP_SEQUENCE]
    st = stop_times_df[stop_times_df["trip_id"].isin(sample)].copy() if not stop_times_df.empty else pd.DataFrame()
    if st.empty:
        return []
    if "stop_sequence" in st.columns:
        st["stop_sequence"] = _to_int_series(st["stop_sequence"])
    sequences: Counter = Counter()
    for _, g in st.groupby("trip_id"):
        g = g.sort_values("stop_sequence") if "stop_sequence" in g.columns else g
        seq_t = tuple(g["stop_id"].tolist())
        if seq_t:
            sequences[seq_t] += 1
    if not sequences:
        return []
    return list(sequences.most_common(1)[0][0])


def _collect_shapes_for_trip_ids(
    trips_df: pd.DataFrame,
    shapes_df: pd.DataFrame,
    trip_ids: List[str],
) -> Tuple[List[List[List[float]]], List[str]]:
    """Unique shape polylines for trips, sorted by length and capped (legacy + per-bucket)."""
    if not trip_ids:
        return [], []
    td = trips_df[trips_df["trip_id"].isin(trip_ids)]
    if td.empty:
        return [], []
    shape_ids = [sid for sid in td.get("shape_id", pd.Series(dtype=str)).dropna().unique().tolist() if _norm(sid)]
    shapes: List[List[List[float]]] = []
    shape_id_list: List[str] = []
    for sid in shape_ids:
        pts = _build_shape_points(shapes_df, sid)
        if len(pts) >= 2:
            shapes.append(pts)
            shape_id_list.append(sid)
    idxs = list(range(len(shapes)))
    idxs.sort(key=lambda i: len(shapes[i]), reverse=True)
    shapes = [shapes[i] for i in idxs]
    shape_id_list = [shape_id_list[i] for i in idxs]
    if MAX_SHAPES_PER_ROUTE_DIR and len(shapes) > MAX_SHAPES_PER_ROUTE_DIR:
        shapes = shapes[:MAX_SHAPES_PER_ROUTE_DIR]
        shape_id_list = shape_id_list[:MAX_SHAPES_PER_ROUTE_DIR]
    return shapes, shape_id_list


def _empty_geometry_bucket() -> Dict[str, Any]:
    """No-service day placeholder (e.g. Sunday does not run) — always objects, never null."""
    return {"shape": [], "shapes": [], "stops": [], "trip_count": 0}


def _build_geometry_bucket(
    *,
    trips_df: pd.DataFrame,
    stop_times_df: pd.DataFrame,
    stops_df: pd.DataFrame,
    shapes_df: pd.DataFrame,
    trip_ids: List[str],
) -> Dict[str, Any]:
    """
    Per calendar bucket: independent trip set → shapes → primary shape → stops.
    Does not merge trips across buckets. Empty trip_ids → _empty_geometry_bucket().
    """
    if not trip_ids:
        return _empty_geometry_bucket()

    entry: Dict[str, Any] = {
        "shape": [],
        "shapes": [],
        "stops": [],
        "trip_count": len(trip_ids),
    }

    seq = _stop_sequence_for_trip_ids(stop_times_df, trip_ids)
    stops: List[Dict] = []
    if seq:
        stop_recs, _ = _stop_records_with_times_for_trips(stop_times_df, stops_df, trip_ids, seq)
        stops = stop_recs
    entry["stops"] = stops

    shapes, _ = _collect_shapes_for_trip_ids(trips_df, shapes_df, trip_ids)
    primary_shape: List[List[float]] = []
    if shapes:
        primary_shape, _ = _select_primary_shape(shapes, stops, STOP_TO_SHAPE_MAX_DIST_M)
    entry["shape"] = primary_shape
    if len(shapes) > 1:
        entry["shapes"] = shapes
    return entry


def _build_route_json(
    *,
    routes_df: pd.DataFrame,
    trips_df: pd.DataFrame,
    stop_times_df: pd.DataFrame,
    stops_df: pd.DataFrame,
    shapes_df: pd.DataFrame,
    route_id: str,
    direction_id: int,
    trip_ids_by_bucket: Dict[str, List[str]],
    representative_bucket_order: List[str],
    warnings: List[str],
) -> Optional[Dict]:
    # Choose canonical bucket (weekday preferred, else saturday, else sunday)
    canonical_bucket = None
    for b in representative_bucket_order:
        if trip_ids_by_bucket.get(b):
            canonical_bucket = b
            break
    if canonical_bucket is None:
        return None

    meta = _route_meta(routes_df, route_id)
    route_short = meta.get("route_short_name") or meta.get("route_id") or route_id
    route_long = meta.get("route_long_name") or meta.get("route_desc") or meta.get("route_short_name") or route_id
    route_name = meta.get("route_desc") or meta.get("route_long_name") or meta.get("route_short_name") or route_id
    agency_id = _norm(meta.get("agency_id", "")) if "agency_id" in (routes_df.columns if not routes_df.empty else []) else ""

    # Canonical stop sequence derived from trips in canonical bucket (legacy stops + schedule)
    seq = _stop_sequence_for_trip_ids(stop_times_df, trip_ids_by_bucket.get(canonical_bucket, []))

    if not seq:
        warnings.append(f"{route_id} dir{direction_id}: missing canonical stop sequence")
        return None

    # Stops + schedules (both formats)
    schedule_struct: Dict[str, Any] = {}
    stops_base: Optional[List[Dict]] = None
    chosen_legacy_times_from = None

    for b in representative_bucket_order:
        trip_ids = trip_ids_by_bucket.get(b, [])
        stop_recs, times_map = _stop_records_with_times_for_trips(stop_times_df, stops_df, trip_ids, seq)
        schedule_struct[b] = {
            "trip_count": len(trip_ids),
            "stops": times_map,  # stop_id -> [times]
        }
        if stops_base is None:
            stops_base = stop_recs

        # Choose legacy stops[].times from weekday first, else first non-empty times
        if b == "weekday" and any(times_map.get(sid) for sid in seq):
            chosen_legacy_times_from = b
        elif chosen_legacy_times_from is None and any(times_map.get(sid) for sid in seq):
            chosen_legacy_times_from = b

    stops = stops_base or []
    # Ensure `stops[].times` exists from chosen bucket, if any.
    if chosen_legacy_times_from:
        times_map = schedule_struct[chosen_legacy_times_from]["stops"]
        for s in stops:
            sid = s.get("stop_id")
            t = times_map.get(sid, [])
            if t:
                s["times"] = t[:MAX_UNIQUE_TIMES_PER_STOP]

    # Legacy shape: union of all buckets' trips (unchanged for backward-compatible top-level fields)
    trip_ids_union: Set[str] = set()
    for b in representative_bucket_order:
        trip_ids_union.update(trip_ids_by_bucket.get(b, []))
    shapes, shape_id_list = _collect_shapes_for_trip_ids(trips_df, shapes_df, list(trip_ids_union))

    primary_shape = []
    shape_debug = {}
    if shapes:
        primary_shape, shape_debug = _select_primary_shape(shapes, stops, STOP_TO_SHAPE_MAX_DIST_M)
    else:
        warnings.append(f"{route_id} dir{direction_id}: missing shapes (shape_id empty or not found in shapes.txt)")

    # Per-bucket geometry — future frontend truth; always weekday + saturday + sunday keys
    geometry: Dict[str, Any] = {}
    for b in GEOMETRY_BUCKET_KEYS:
        geometry[b] = _build_geometry_bucket(
            trips_df=trips_df,
            stop_times_df=stop_times_df,
            stops_df=stops_df,
            shapes_df=shapes_df,
            trip_ids=trip_ids_by_bucket.get(b, []),
        )

    direction_name = _direction_name(direction_id)
    agency_tag = _agency_tag_for_route_id(route_id)
    route_title = f"[{agency_tag}] {route_short} - {route_long} ({direction_name})" if agency_tag else f"Route {route_short} - {direction_name}"

    headsign_samples = _headsign_samples_for_direction(trips_df, route_id, direction_id, trip_ids_by_bucket.get(canonical_bucket, []))

    out = {
        "route_id": str(route_id),
        "agency_id": agency_id,
        "route_short_name": str(route_short),
        "route_long_name": str(route_long),
        "route_name": str(route_name),
        "route_number": str(route_short),  # legacy alias
        "direction_id": int(direction_id),
        "route_type": _norm(meta.get("route_type", "")),
        "direction_name": direction_name,
        "trip_headsign_samples": headsign_samples,
        "route_title": route_title,
        # Legacy (RoamRaven today): merged shape + canonical stops + schedule by bucket
        "shape": primary_shape,
        "stops": stops,
        "schedule": schedule_struct,
        # Future: route.geometry[getDayType()].shape / .stops (never null buckets)
        "geometry": geometry,
        "shape_ids": shape_id_list,
        "meta": {
            "canonical_bucket": canonical_bucket,
            "trip_counts": {b: len(trip_ids_by_bucket.get(b, [])) for b in representative_bucket_order},
            "stop_count": len(stops),
            "shape_count": len(shapes),
            "primary_shape_debug": shape_debug,
        },
    }

    if len(shapes) > 1:
        out["shapes"] = shapes

    return out


def _build_routes_index_js(city_id: str, routes_df: pd.DataFrame) -> str:
    # Cincinnati format: window.ROUTES = { "cincinnati": { busRoutes: [...], railRoutes: [] } }
    bus_routes = []

    # Sort by numeric route_short_name when possible, else by route_id
    def _sort_key(rid: str, short: str) -> Tuple[int, str]:
        m = re.search(r"(\d+)", short or "")
        if m:
            return (0, f"{int(m.group(1)):06d}")
        return (1, rid)

    rows = []
    for _, r in routes_df.iterrows():
        rid = _norm(r.get("route_id"))
        if not rid:
            continue
        short = _norm(r.get("route_short_name")) or rid
        long = _norm(r.get("route_long_name")) or _norm(r.get("route_desc")) or short
        rows.append((rid, short, long))

    # Dedup by route_id (first wins)
    seen = set()
    uniq = []
    for rid, short, long in rows:
        if rid in seen:
            continue
        seen.add(rid)
        uniq.append((rid, short, long))
    uniq.sort(key=lambda x: _sort_key(x[0], x[1]))

    for rid, short, long in uniq:
        agency_tag = _agency_tag_for_route_id(rid)
        label = f"[{agency_tag}] {short} - {long}" if agency_tag else f"{short} - {long}"
        bus_routes.append(
            {
                "id": rid,
                "label": label,
                "dir0": "Outbound",
                "dir1": "Inbound",
            }
        )

    payload = {city_id: {"busRoutes": bus_routes, "railRoutes": []}}
    return "window.ROUTES = " + json.dumps(payload, indent=2) + ";\n"


def _build_lazy_routes_index_js(city_id: str, routes: List[Dict[str, Any]], version: str) -> str:
    """
    Boston-style lazy index (future-proof). The loader expects:
      window.routesIndex = { version: "...", routes: [{ route_id, direction_id, file, ...metadata }] }
    """
    payload = {"version": version, "city_id": city_id, "routes": routes}
    return "window.routesIndex = " + json.dumps(payload, indent=2) + ";\n"


def _is_valid_gtfs_folder(folder: str) -> bool:
    required = ["routes.txt", "trips.txt", "stop_times.txt", "stops.txt", "shapes.txt"]
    return all(os.path.exists(os.path.join(folder, f)) for f in required)


def _detect_agencies_for_city(city_folder: str) -> List[str]:
    """
    Auto-detect multi-agency city:
      - If city_folder itself is a valid GTFS folder => single-agency, return []
      - Else, return list of subfolder names that are valid GTFS folders
    """
    if _is_valid_gtfs_folder(city_folder):
        return []
    agencies = []
    for name in os.listdir(city_folder):
        p = os.path.join(city_folder, name)
        if os.path.isdir(p) and _is_valid_gtfs_folder(p):
            agencies.append(name)
    return sorted(agencies)


def _build_one_city(
    *,
    city: str,
    gtfs_base: str,
    output_base: str,
    agencies: Optional[List[str]],
    write_website: bool,
    output_root: str = "",
    route_data_dir: str = "",
    routes_index_path: str = "",
    lazy_index_path: str = "",
    report_path: str = "",
) -> None:
    city_folder = os.path.join(gtfs_base, city)
    if not os.path.isdir(city_folder):
        raise SystemExit(f"GTFS city folder not found: {city_folder}")

    # Auto-detect agencies per city unless overridden
    agencies = agencies if agencies is not None else _detect_agencies_for_city(city_folder)
    multi = bool(agencies)

    bundles: List[GtfsBundle] = []
    if multi:
        for ag in agencies:
            folder = os.path.join(city_folder, ag)
            if not os.path.isdir(folder):
                raise SystemExit(f"Agency GTFS folder not found: {folder}")
            b = _load_gtfs_folder(folder)
            bundles.append(_prefix_bundle(b, ag.lower()))
    else:
        bundles.append(_load_gtfs_folder(city_folder))

    merged = _merge_bundles(bundles)

    if "direction_id" not in merged.trips.columns:
        merged.trips["direction_id"] = "0"
    merged.trips["direction_id"] = merged.trips["direction_id"].fillna("0").astype(str)
    if "service_id" not in merged.trips.columns:
        merged.trips["service_id"] = ""
    merged.trips["service_id"] = merged.trips["service_id"].fillna("").astype(str)

    # Representative calendar buckets
    rep_dates = _pick_representative_dates()
    bucket_order = ["weekday", "saturday", "sunday"]
    services_by_bucket = {
        "weekday": _active_services_for_date(merged.calendar, merged.calendar_dates, rep_dates["weekday"]),
        "saturday": _active_services_for_date(merged.calendar, merged.calendar_dates, rep_dates["saturday"]),
        "sunday": _active_services_for_date(merged.calendar, merged.calendar_dates, rep_dates["sunday"]),
    }

    # Trip selection per route-dir per bucket
    trip_ids_needed: Set[str] = set()
    trip_ids_by_rdb: Dict[Tuple[str, int], Dict[str, List[str]]] = {}
    for (rid, did), g in merged.trips.groupby(["route_id", "direction_id"]):
        did_int = int(did) if str(did).isdigit() else 0
        by_bucket: Dict[str, List[str]] = {}
        for b in bucket_order:
            active = services_by_bucket[b]
            sub = g[g["service_id"].isin(active)] if active else g
            tids = [t for t in sub["trip_id"].dropna().tolist() if _norm(t)]
            by_bucket[b] = tids
            trip_ids_needed.update(tids[: max(MAX_TRIPS_FOR_STOP_SEQUENCE, MAX_TRIPS_FOR_STOP_TIMES)])
        if any(by_bucket.values()):
            trip_ids_by_rdb[(str(rid), did_int)] = by_bucket

    # Stop times: NYC-scale needs chunk filtering. In multi-agency mode we already prefixed trip_ids,
    # so we can safely filter the merged.stop_times in-memory (practical today).
    # If stop_times is huge, this still benefits from a pre-filter below.
    stop_times_df = pd.DataFrame()
    if not multi:
        # Single-agency: chunk-filter from disk to keep RAM bounded for very large feeds (NYC)
        stop_times_path = os.path.join(city_folder, "stop_times.txt")
        if os.path.exists(stop_times_path):
            stop_times_df = _read_stop_times_filtered(stop_times_path, trip_ids_needed)
        else:
            stop_times_df = merged.stop_times if merged.stop_times is not None else pd.DataFrame()
    else:
        stop_times_df = merged.stop_times if merged.stop_times is not None else pd.DataFrame()
        if not stop_times_df.empty and "trip_id" in stop_times_df.columns:
            stop_times_df = stop_times_df[stop_times_df["trip_id"].isin(trip_ids_needed)].copy()

    # Output paths (defaults preserved; overrides optional)
    out_root = output_root.strip() or os.path.join(output_base, city)
    out_route_data_dir = route_data_dir.strip() or os.path.join(out_root, "route_data")
    _ensure_dir(out_route_data_dir)
    out_routes_index_path = routes_index_path.strip() or os.path.join(out_root, "routes_index.js")
    out_lazy_index_path = lazy_index_path.strip() or os.path.join(out_root, "routes_index.lazy.js")
    out_report_path = report_path.strip() or os.path.join(out_root, "build_report.json")

    warnings: List[str] = []
    lazy_routes: List[Dict[str, Any]] = []
    coverage_rows: List[Dict[str, Any]] = []
    written = 0

    for (rid, did_int), by_bucket in sorted(trip_ids_by_rdb.items(), key=lambda x: (x[0][0], x[0][1])):
        route_json = _build_route_json(
            routes_df=merged.routes,
            trips_df=merged.trips,
            stop_times_df=stop_times_df,
            stops_df=merged.stops,
            shapes_df=merged.shapes,
            route_id=rid,
            direction_id=did_int,
            trip_ids_by_bucket=by_bucket,
            representative_bucket_order=bucket_order,
            warnings=warnings,
        )
        if not route_json:
            continue

        fn = f"route-{_slugify(rid)}-dir{did_int}.json"
        path = os.path.join(out_route_data_dir, fn)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(route_json, f, ensure_ascii=False, indent=2)
        written += 1

        # ---- Coverage tracking for build_report (reuse existing debug, no new scoring) ----
        try:
            num_stops = len(route_json.get("stops") or [])
            agency_id = route_json.get("agency_id", "") or ""
            shape_points = len(route_json.get("shape") or [])

            # Determine which shape index was used (compare to shapes[] when present)
            shape_idx = 0
            shapes_list = route_json.get("shapes")
            if isinstance(shapes_list, list) and shapes_list:
                for i, sh in enumerate(shapes_list):
                    if sh == route_json.get("shape"):
                        shape_idx = i
                        break

            shape_ids = route_json.get("shape_ids") or []
            shape_id_used = (
                shape_ids[shape_idx]
                if isinstance(shape_ids, list) and shape_idx < len(shape_ids)
                else (shape_ids[0] if isinstance(shape_ids, list) and shape_ids else None)
            )

            cov_debug = (((route_json.get("meta") or {}).get("primary_shape_debug") or {}).get("coverage_scoring") or [])
            matched = None
            if isinstance(cov_debug, list):
                for row in cov_debug:
                    if isinstance(row, dict) and row.get("shape_index") == shape_idx:
                        matched = row.get("covered_stops")
                        break
            if matched is None and isinstance(cov_debug, list) and len(cov_debug) == 1 and isinstance(cov_debug[0], dict):
                matched = cov_debug[0].get("covered_stops")

            num_stops_matched = int(matched) if matched is not None and str(matched).isdigit() else 0
            coverage_score = (num_stops_matched / num_stops) if num_stops else 0.0

            coverage_rows.append(
                {
                    "agency_id": agency_id,
                    "route_id": route_json.get("route_id"),
                    "direction_id": route_json.get("direction_id"),
                    "coverage_score": round(float(coverage_score), 4),
                    "num_stops": int(num_stops),
                    "num_stops_matched": int(num_stops_matched),
                    "shape_id_used": shape_id_used,
                    "shape_points": int(shape_points),
                    "file": fn,
                }
            )

            # Append warnings (do not overwrite existing warnings)
            if num_stops > 0:
                if coverage_score < 0.5:
                    warnings.append(
                        f"{route_json.get('route_id')} dir{did_int}: shape coverage VERY LOW {coverage_score:.2f} ({num_stops_matched}/{num_stops})"
                    )
                elif coverage_score < 0.6:
                    warnings.append(
                        f"{route_json.get('route_id')} dir{did_int}: shape coverage low {coverage_score:.2f} ({num_stops_matched}/{num_stops})"
                    )
        except Exception:
            # Never break the build because of reporting
            pass

        lazy_routes.append(
            {
                "route_id": rid,
                "direction_id": did_int,
                "file": fn,
                "route_type": route_json.get("route_type", ""),
                "route_short_name": route_json.get("route_short_name", route_json.get("route_number", "")),
                "route_long_name": route_json.get("route_long_name", ""),
                "agency_id": route_json.get("agency_id", ""),
                "direction_name": route_json.get("direction_name", ""),
                "route_title": route_json.get("route_title", ""),
            }
        )

    city_id = city.strip().lower()
    with open(out_routes_index_path, "w", encoding="utf-8") as f:
        f.write(_build_routes_index_js(city_id, merged.routes))

    version = _dt.datetime.now().strftime("%Y%m%d-%H%M")
    with open(out_lazy_index_path, "w", encoding="utf-8") as f:
        f.write(_build_lazy_routes_index_js(city_id, lazy_routes, version))

    report = {
        "city": city,
        "city_id": city_id,
        "gtfs_base": gtfs_base,
        "multi_agency": multi,
        "agencies": agencies or [],
        "representative_dates": {k: v.strftime("%Y%m%d") for k, v in rep_dates.items()},
        "services_by_bucket_counts": {k: len(v) for k, v in services_by_bucket.items()},
        "route_json_written": written,
        "lazy_index_routes": len(lazy_routes),
        "output": {
            "route_data_dir": out_route_data_dir,
            "routes_index_path": out_routes_index_path,
            "lazy_index_path": out_lazy_index_path,
            "report_path": out_report_path,
        },
        "warnings_count": len(warnings),
        "warnings": warnings[:5000],
    }

    # Coverage summary + worst offenders (ascending)
    total_routes = len(coverage_rows)
    below_08 = sum(1 for r in coverage_rows if (r.get("coverage_score") or 0) < 0.8)
    below_06 = sum(1 for r in coverage_rows if (r.get("coverage_score") or 0) < 0.6)
    below_05 = sum(1 for r in coverage_rows if (r.get("coverage_score") or 0) < 0.5)
    worst_25 = sorted(
        coverage_rows,
        key=lambda r: (
            r.get("coverage_score") or 0,
            str(r.get("route_id") or ""),
            int(r.get("direction_id") or 0),
        ),
    )[:25]

    report["coverage_summary"] = {
        "total_routes": int(total_routes),
        "below_0_8": int(below_08),
        "below_0_6": int(below_06),
        "below_0_5": int(below_05),
    }
    report["worst_coverage"] = worst_25

    with open(out_report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"Built {written} route JSON files -> {out_route_data_dir}")
    print(f"Built routes_index.js -> {out_routes_index_path}")
    print(f"Built routes_index.lazy.js -> {out_lazy_index_path}")
    print(f"Built build_report.json -> {out_report_path}")

    # IMPORTANT: Keep builds local only.
    # Deployment/copy-to-website is handled manually to avoid accidental folder overwrites.
    if write_website:
        print("NOTE: --write-website is deprecated and does nothing. Outputs were kept local.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("city", nargs="?", default="", help='City folder name under gtfs base, e.g. "Cincinnati"')
    ap.add_argument("--gtfs-base", default=os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "gtfs")))
    ap.add_argument(
        "--agencies",
        nargs="*",
        default=None,
        help="Optional override: agency subfolders under gtfs/<City>/. If omitted, auto-detected per city.",
    )
    ap.add_argument("--output-base", default=os.path.abspath(os.path.join(os.path.dirname(__file__), "Output")))
    ap.add_argument(
        "--write-website",
        action="store_true",
        help="DEPRECATED (no-op): builder keeps outputs local; deploy manually.",
    )
    ap.add_argument("--output-root", default="", help="Override output root directory (defaults to --output-base/<City>/)")
    ap.add_argument("--route-data-dir", default="", help="Override route_data output directory")
    ap.add_argument("--routes-index-path", default="", help="Override window.ROUTES index output path")
    ap.add_argument("--lazy-index-path", default="", help="Override window.routesIndex index output path")
    ap.add_argument("--report-path", default="", help="Override build report output path")
    args = ap.parse_args()

    gtfs_base = args.gtfs_base
    if not os.path.isdir(gtfs_base):
        raise SystemExit(f"GTFS base folder not found: {gtfs_base}")

    if BUILD_ALL_CITIES:
        cities = [n for n in os.listdir(gtfs_base) if os.path.isdir(os.path.join(gtfs_base, n))]
        if not cities:
            raise SystemExit(f"No cities found under: {gtfs_base}")
        for c in sorted(cities):
            print("\n===================================")
            print(f"BUILDING CITY: {c}")
            print("===================================\n")
            _build_one_city(
                city=c,
                gtfs_base=gtfs_base,
                output_base=args.output_base,
                agencies=args.agencies,
                write_website=args.write_website,
                output_root=args.output_root,
                route_data_dir=args.route_data_dir,
                routes_index_path=args.routes_index_path,
                lazy_index_path=args.lazy_index_path,
                report_path=args.report_path,
            )
        return

    city = BUILD_ONE_CITY.strip() or str(args.city or "").strip()
    if not city:
        raise SystemExit('No city specified. Set BUILD_ONE_CITY at top or pass "city" on the command line.')

    _build_one_city(
        city=city,
        gtfs_base=gtfs_base,
        output_base=args.output_base,
        agencies=args.agencies,
        write_website=args.write_website,
        output_root=args.output_root,
        route_data_dir=args.route_data_dir,
        routes_index_path=args.routes_index_path,
        lazy_index_path=args.lazy_index_path,
        report_path=args.report_path,
    )


if __name__ == "__main__":
    main()

