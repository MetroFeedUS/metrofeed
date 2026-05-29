/**
 * TV sync — map browser (leader) writes route state; alerts browser (follower) reads it.
 * Same-origin: ./tv-sync-publish.php + ./tv-now-playing.json
 */
(function () {
  'use strict';

  function syncConfig() {
    const c = window.CITY_CONFIG || {};
    const base = c.tvSyncBaseUrl || './';
    const baseSlash = String(base).endsWith('/') ? base : base + '/';
    return {
      readUrl: c.tvSyncReadUrl || baseSlash + 'tv-now-playing.json',
      writeUrl: c.tvSyncWriteUrl || baseSlash + 'tv-sync-publish.php',
      pollMs: Number(c.tvSyncPollMs) || 1500
    };
  }

  function publishTvSync(payload) {
    if (!window.MF_TV_SYNC_LEADER) return;
    const cfg = syncConfig();
    const body = Object.assign(
      {
        v: 1,
        updatedAt: Date.now()
      },
      payload || {}
    );
    try {
      fetch(cfg.writeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        keepalive: true
      }).catch(function () {});
    } catch (_) {}
  }

  async function fetchTvSync() {
    const cfg = syncConfig();
    try {
      const res = await fetch(cfg.readUrl + (cfg.readUrl.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now(), {
        cache: 'no-store'
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== 'object') return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  window.mfTvPublishSync = publishTvSync;
  window.mfTvFetchSync = fetchTvSync;
  window.mfTvSyncPollMs = function () {
    return syncConfig().pollMs;
  };
})();
