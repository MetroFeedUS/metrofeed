/**
 * Shared traffic incident helpers (home.html + obs-route-tv.html).
 * No separate detail API — display fields come from the bulk incidents feed.
 */
(function (global) {
  'use strict';

  function pair(lon, lat) {
    const lo = Number(lon);
    const la = Number(lat);
    return Number.isFinite(lo) && Number.isFinite(la) ? [lo, la] : null;
  }

  function incidentLngLat(inc) {
    if (!inc || typeof inc !== 'object') return null;
    let r = pair(inc.longitude, inc.latitude);
    if (r) return r;
    r = pair(inc.lng, inc.lat);
    if (r) return r;
    r = pair(inc.lon, inc.lat);
    if (r) return r;
    const g = inc.geometry;
    if (g && g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
      r = pair(g.coordinates[0], g.coordinates[1]);
      if (r) return r;
    }
    const loc = inc.location;
    if (loc) {
      r = pair(loc.longitude ?? loc.lng ?? loc.lon, loc.latitude ?? loc.lat);
      if (r) return r;
    }
    if (Array.isArray(inc.coordinates) && inc.coordinates.length >= 2) {
      r = pair(inc.coordinates[0], inc.coordinates[1]);
      if (r) return r;
    }
    const props = inc.properties;
    if (props) {
      r = pair(props.longitude ?? props.lng, props.latitude ?? props.lat);
      if (r) return r;
    }
    const begin = inc.begin || inc.start || inc.from;
    if (begin) {
      r = pair(begin.longitude ?? begin.lng, begin.latitude ?? begin.lat);
      if (r) return r;
    }
    return null;
  }

  function incidentTitle(inc) {
    return String(
      inc.headline || inc.title || inc.name || inc.summary || inc.road || inc.route || inc.roadway || 'Traffic incident'
    );
  }

  function incidentDescription(inc) {
    return String(inc.description || inc.details || inc.comment || inc.message || inc.text || '');
  }

  function incidentSeverityTier(inc) {
    const blob = [
      inc.severity,
      inc.impact,
      inc.priority,
      inc.level,
      inc.type,
      inc.category,
      inc.headline,
      inc.title,
      incidentDescription(inc)
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (/crash|collision|accident|closure|closed|disabled|stalled|hazmat|emergency/.test(blob)) return 'major';
    if (/severe|major|critical|high/.test(blob)) return 'major';
    if (/congestion|delay|slow|backup|jam/.test(blob)) return 'moderate';
    if (/construction|work zone|maintenance/.test(blob)) return 'minor';
    return 'minor';
  }

  function incidentScore(inc) {
    const tier = incidentSeverityTier(inc);
    if (tier === 'major') return 100;
    if (tier === 'moderate') return 50;
    return 10;
  }

  /** @returns {{ title, description, lines, tier, lngLat, id }} */
  function formatIncidentForDisplay(inc, index) {
    const lines = [];
    const type = inc.type || inc.category || inc.eventType || '';
    if (type) lines.push(String(type));
    const sev = inc.severity || inc.impact || inc.level || '';
    if (sev) lines.push('Severity: ' + String(sev));
    const dir = inc.direction || inc.travelDirection || (inc.location && inc.location.direction) || '';
    if (dir) lines.push('Direction: ' + String(dir));
    const road = inc.road || inc.route || inc.roadway || inc.highway || '';
    if (road && !incidentTitle(inc).includes(String(road))) lines.push(String(road));
    const lanes = inc.lanes || inc.laneClosure || inc.closedLanes || '';
    if (lanes) lines.push(String(lanes));
    const start = inc.startTime || inc.start || inc.beginTime || (inc.begin && inc.begin.time) || '';
    const end = inc.endTime || inc.end || inc.endTime || (inc.end && inc.end.time) || '';
    if (start) lines.push('Start: ' + String(start));
    if (end) lines.push('End: ' + String(end));

    const desc = incidentDescription(inc);
    if (desc) lines.push(desc);

    return {
      id: inc.id != null ? String(inc.id) : 'inc-' + String(index != null ? index : 0),
      title: incidentTitle(inc),
      description: desc,
      lines: lines,
      tier: incidentSeverityTier(inc),
      score: incidentScore(inc),
      lngLat: incidentLngLat(inc),
      raw: inc
    };
  }

  function haversineMiles(lon1, lat1, lon2, lat2) {
    const R = 3958.8;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  global.MfTrafficIncidents = {
    incidentLngLat,
    incidentTitle,
    incidentDescription,
    incidentSeverityTier,
    incidentScore,
    formatIncidentForDisplay,
    haversineMiles
  };
})(typeof window !== 'undefined' ? window : global);
