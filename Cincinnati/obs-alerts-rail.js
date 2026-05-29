/**
 * OBS alerts column — follower only (no director). Reads tv-now-playing.json from map leader.
 */
(function () {
  'use strict';

  function el(id) {
    return document.getElementById(id);
  }

  let lastKey = '';

  function renderEmpty(msg) {
    const body = el('mfArailBody');
    if (body) {
      body.innerHTML = '<div class="mf-arail__empty">' + String(msg || 'No active alerts.') + '</div>';
    }
  }

  async function tick() {
    const routeEl = el('mfArailRoute');
    const statusEl = el('mfArailStatus');
    const bodyEl = el('mfArailBody');
    if (!routeEl || !bodyEl) return;

    const sync =
      typeof window.mfTvFetchSync === 'function' ? await window.mfTvFetchSync() : null;

    if (!sync || !sync.routeId) {
      routeEl.textContent = 'Waiting for map…';
      if (statusEl) statusEl.textContent = 'Start the map browser source first';
      renderEmpty('No route on air yet.');
      lastKey = '';
      return;
    }

    const routeId = String(sync.routeId);
    const label = sync.routeLabel ? String(sync.routeLabel) : routeId;
    const dir = sync.dirLabel ? String(sync.dirLabel) : '';
    const key = routeId + '|' + dir;

    routeEl.textContent = label + (dir ? ' · ' + dir : '');
    if (statusEl) {
      const ago = sync.updatedAt
        ? Math.max(0, Math.round((Date.now() - Number(sync.updatedAt)) / 1000))
        : null;
      statusEl.textContent =
        (sync.phase ? String(sync.phase) + ' · ' : '') +
        (ago != null ? 'map sync ' + ago + 's ago' : 'synced');
    }

    if (key === lastKey) return;
    lastKey = key;

    if (typeof window.fetchAlertsData !== 'function' || typeof window.getRouteAlerts !== 'function') {
      renderEmpty('Load home.html scripts on server for alert APIs.');
      return;
    }

    renderEmpty('Loading…');
    try {
      const alerts = await window.fetchAlertsData();
      const info = window.getRouteAlerts(routeId, alerts);
      if (!info || !info.alerts || !info.alerts.length) {
        renderEmpty('No active alerts for this route.');
        return;
      }
      const max = 8;
      const slice = info.alerts.slice(0, max);
      const cards = slice.map(function (a) {
        if (typeof window.mfCincyAlertCardInnerHtml === 'function') {
          return '<div class="mf-arail__card">' + window.mfCincyAlertCardInnerHtml(a) + '</div>';
        }
        const txt = String(
          (a && (a.title || a.header || a.text || a.description || a.body || a.detail)) || ''
        ).trim();
        return (
          '<div class="mf-arail__card"><div style="color:#fff;white-space:pre-wrap;">' +
          (txt || 'Alert') +
          '</div></div>'
        );
      });
      const more =
        info.alerts.length > max
          ? '<div class="mf-arail__more">+' + (info.alerts.length - max) + ' more</div>'
          : '';
      bodyEl.innerHTML = cards.join('') + more;
    } catch (_) {
      renderEmpty('Unable to load alerts.');
    }
  }

  tick();
  setInterval(tick, typeof window.mfTvSyncPollMs === 'function' ? window.mfTvSyncPollMs() : 1500);
})();
