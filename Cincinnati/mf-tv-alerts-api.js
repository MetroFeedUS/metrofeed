/**
 * Shared Cincinnati route alerts API (map + OBS alerts rail).
 */
(function () {
  'use strict';

  let cachedAlerts = null;
  let alertsCacheTime = null;
  const ALERTS_CACHE_DURATION = 5 * 60 * 1000;

  function metrofeedHomeAgencyParts(routeId) {
    if (typeof window.metrofeedAgencyFromRouteId === 'function') {
      return window.metrofeedAgencyFromRouteId(routeId);
    }
    const s = String(routeId || '');
    if (s.startsWith('sorta_')) return { feedAgency: 'sorta', label: 'Metro', digits: s.slice(6) };
    if (s.startsWith('tank_')) return { feedAgency: 'tank', label: 'TANK', digits: s.slice(5) };
    if (s.startsWith('bcrta_')) return { feedAgency: 'bcrta', label: 'BCRTA', digits: s.slice(6) };
    return null;
  }

  async function fetchAlertsData() {
    const cacheNow = Date.now();
    if (cachedAlerts && alertsCacheTime && cacheNow - alertsCacheTime < ALERTS_CACHE_DURATION) {
      return cachedAlerts;
    }
    try {
      const url =
        (window.CITY_CONFIG && window.CITY_CONFIG.realtimeAlertsUrl) ||
        'https://routes.metrofeedus.com/realtime/cincinnati/alerts.json';
      const response = await fetch(url);
      if (!response.ok) return [];
      const text = await response.text();
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith('<')) return [];
      const data = JSON.parse(text);
      if (data && Array.isArray(data.alerts)) {
        cachedAlerts = data.alerts;
        alertsCacheTime = cacheNow;
        return cachedAlerts;
      }
      return [];
    } catch (e) {
      console.warn('[mf-tv-alerts-api] fetch failed', e);
      return [];
    }
  }

  function mfCincyAlertSearchBlob(a) {
    if (!a || typeof a !== 'object') return '';
    const parts = [a.title, a.header, a.summary, a.text, a.description, a.body, a.detail];
    return parts
      .filter(function (x) {
        return x != null && String(x).trim() !== '';
      })
      .map(function (x) {
        return String(x);
      })
      .join('\n');
  }

  function mfCincyAlertHasContent(a) {
    if (!a || typeof a !== 'object') return false;
    if (!String(a.agency || '').trim()) return false;
    return String(mfCincyAlertSearchBlob(a)).trim().length > 0;
  }

  function mfCincyAlertEscapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function mfCincyAlertSafeHref(a) {
    const u = String(a.url || a.link || '').trim();
    if (!/^https?:\/\//i.test(u)) return '';
    return u.replace(/"/g, '&quot;').replace(/</g, '');
  }

  function mfCincyAlertCardInnerHtml(a) {
    const title = String(a.title || a.header || '').trim();
    const detail = String(a.description || a.body || a.detail || '').trim();
    const text = String(a.text || '').trim();
    const href = mfCincyAlertSafeHref(a);
    const titleEsc = title ? mfCincyAlertEscapeHtml(title) : '';
    const detailEsc = detail ? mfCincyAlertEscapeHtml(detail) : '';
    const textEsc = text ? mfCincyAlertEscapeHtml(text) : '';
    let html = '';
    if (titleEsc && detailEsc) {
      html +=
        '<div style="font-weight:700;color:#fff;line-height:1.3;margin-bottom:0.45rem;">' +
        titleEsc +
        '</div>';
      html +=
        '<div style="color:#ccc;line-height:1.45;font-size:0.93rem;white-space:pre-wrap;">' +
        detailEsc +
        '</div>';
    } else if (titleEsc) {
      html +=
        '<div style="color:#fff;line-height:1.38;font-size:0.95rem;white-space:pre-wrap;">' +
        titleEsc +
        '</div>';
    } else {
      html +=
        '<div style="color:#fff;line-height:1.38;font-size:0.95rem;white-space:pre-wrap;">' +
        (textEsc || detailEsc || 'No details') +
        '</div>';
    }
    if (href) {
      html +=
        '<div style="margin-top:0.65rem;"><a href="' +
        href +
        '" target="_blank" rel="noopener noreferrer" style="color:#93c5fd;">Official link →</a></div>';
    }
    return html;
  }

  function mfExtractExplicitRouteNums(text) {
    const t = String(text || '');
    const nums = new Set();
    const re = /\broute(?:\s*\(s\))?\s*([0-9]{1,3}(?:\s*(?:,|&|and|\/)\s*[0-9]{1,3})*)\b/gi;
    let m;
    while ((m = re.exec(t)) !== null) {
      const chunk = m[1] || '';
      (chunk.match(/[0-9]{1,3}/g) || []).forEach(function (n) {
        nums.add(String(n));
      });
    }
    return nums;
  }

  function getRouteAlerts(routeId, alerts) {
    if (!alerts || !alerts.length) return null;
    const normalizedRouteId = String(routeId);
    const isCincy =
      alerts.length > 0 && alerts[0] && typeof alerts[0] === 'object' && 'agency' in alerts[0];

    if (isCincy) {
      const ag = metrofeedHomeAgencyParts(normalizedRouteId);
      const agency = ag ? ag.feedAgency : null;
      const numMatch = ag && ag.digits ? String(ag.digits).match(/\d+/) : null;
      const num = numMatch ? numMatch[0] : '';
      const routeAlerts = alerts.filter(function (a) {
        if (!a || !mfCincyAlertHasContent(a)) return false;
        if (agency && String(a.agency || '').toLowerCase() !== agency) return false;
        const explicit = mfExtractExplicitRouteNums(mfCincyAlertSearchBlob(a));
        if (!explicit.size) return false;
        return explicit.has(String(num));
      });
      if (!routeAlerts.length) return null;
      return { count: routeAlerts.length, severity: 'moderate', alerts: routeAlerts };
    }
    return null;
  }

  window.fetchAlertsData = fetchAlertsData;
  window.getRouteAlerts = getRouteAlerts;
  window.mfCincyAlertCardInnerHtml = mfCincyAlertCardInnerHtml;
  window.metrofeedHomeAgencyParts = metrofeedHomeAgencyParts;
})();
