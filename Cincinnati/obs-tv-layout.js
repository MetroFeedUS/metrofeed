/**
 * OBS TV — draggable / resizable panel layouts (alerts, camera, traffic).
 * Ctrl+Shift+L = layout edit mode · positions saved in localStorage.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'mfTvObsPanelLayout_v1';
  var editMode = false;
  var previewOpen = { alerts: false, camera: false, traffic: false };

  var PANEL_META = {
    alerts: {
      label: 'Route alerts',
      resolveEl: function () {
        return document.getElementById('mfTvAlertsPanel');
      }
    },
    camera: {
      label: 'Traffic camera',
      resolveEl: function () {
        return document.getElementById('mfTvTrafficDetail');
      }
    },
    traffic: {
      label: 'Traffic alert',
      resolveEl: function () {
        return document.getElementById('mfTvTrafficDetail');
      }
    }
  };

  function defaults() {
    var W = window.innerWidth || 1920;
    var H = window.innerHeight || 1080;
    return {
      alerts: { x: Math.max(0, W - 400), y: 80, w: 400, h: 700 },
      camera: { x: Math.round(W * 0.52), y: 0, w: Math.round(W * 0.48), h: H },
      traffic: { x: 48, y: Math.max(80, H - 260), w: Math.max(320, W - 96), h: 220 }
    };
  }

  function loadAll() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : {};
    } catch (_) {
      return {};
    }
  }

  function saveRect(key, rect) {
    try {
      var all = loadAll();
      all[key] = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.w),
        h: Math.round(rect.h)
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (_) {}
  }

  function getRect(key) {
    var all = loadAll();
    var d = defaults();
    if (all[key] && Number.isFinite(all[key].x)) return all[key];
    return d[key];
  }

  function clampRect(rect) {
    var W = window.innerWidth || 1920;
    var H = window.innerHeight || 1080;
    var minW = 160;
    var minH = 100;
    var w = Math.max(minW, Math.min(rect.w, W));
    var h = Math.max(minH, Math.min(rect.h, H));
    var x = Math.max(0, Math.min(rect.x, W - minW));
    var y = Math.max(0, Math.min(rect.y, H - minH));
    if (x + w > W) w = W - x;
    if (y + h > H) h = H - y;
    return { x: x, y: y, w: w, h: h };
  }

  function applyRect(el, rect) {
    if (!el || !rect) return;
    var r = clampRect(rect);
    el.style.setProperty('position', 'fixed', 'important');
    el.style.setProperty('left', r.x + 'px', 'important');
    el.style.setProperty('top', r.y + 'px', 'important');
    el.style.setProperty('right', 'auto', 'important');
    el.style.setProperty('bottom', 'auto', 'important');
    el.style.setProperty('width', r.w + 'px', 'important');
    el.style.setProperty('height', r.h + 'px', 'important');
    el.style.setProperty('max-width', 'none', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('min-width', '0', 'important');
    el.style.setProperty('min-height', '0', 'important');
    el.classList.add('mf-tv-layout-positioned');
    el.setAttribute('data-mf-tv-layout-key', el.getAttribute('data-mf-tv-layout-active') || '');
  }

  function readRectFromEl(el) {
    var r = el.getBoundingClientRect();
    return clampRect({ x: r.left, y: r.top, w: r.width, h: r.height });
  }

  function ensureChrome(el, key, label) {
    if (!el || el.querySelector('.mf-tv-layout-chrome')) return;
    var chrome = document.createElement('div');
    chrome.className = 'mf-tv-layout-chrome';
    chrome.setAttribute('data-mf-tv-layout-drag', key);
    chrome.innerHTML =
      '<span class="mf-tv-layout-chrome__label">' +
      label +
      '</span><span class="mf-tv-layout-chrome__hint">drag · corner to resize</span>';
    el.insertBefore(chrome, el.firstChild);

    var resize = document.createElement('div');
    resize.className = 'mf-tv-layout-resize';
    resize.setAttribute('data-mf-tv-layout-resize', key);
    el.appendChild(resize);
  }

  function setupPanelChrome() {
    Object.keys(PANEL_META).forEach(function (key) {
      var meta = PANEL_META[key];
      var el = meta.resolveEl();
      if (el) ensureChrome(el, key, meta.label);
    });
  }

  window.mfTvLayoutKeyForKind = function (kind) {
    return kind === 'camera' ? 'camera' : 'traffic';
  };

  function clearLayoutInline(el) {
    if (!el) return;
    [
      'position',
      'left',
      'top',
      'right',
      'bottom',
      'width',
      'height',
      'max-width',
      'max-height',
      'min-width',
      'min-height'
    ].forEach(function (prop) {
      el.style.removeProperty(prop);
    });
    el.classList.remove('mf-tv-layout-positioned');
    el.removeAttribute('data-mf-tv-layout-key');
  }

  window.mfTvClearSavedLayout = function () {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('mfTvAlertsSize_v1');
    } catch (_) {}
    Object.keys(PANEL_META).forEach(function (key) {
      var meta = PANEL_META[key];
      var node = meta && meta.resolveEl ? meta.resolveEl() : null;
      if (node) clearLayoutInline(node);
    });
  };

  window.mfTvLayoutApply = function (key) {
    var meta = PANEL_META[key];
    if (!meta) return;
    var el = meta.resolveEl();
    if (!el) return;
    el.setAttribute('data-mf-tv-layout-active', key);
    var obsLayout = document.documentElement.classList.contains('tv-obs-layout');
    if (obsLayout && (key === 'camera' || key === 'traffic') && !editMode) {
      clearLayoutInline(el);
      return;
    }
    applyRect(el, getRect(key));
  };

  function showPreview(key) {
    if (key === 'alerts') {
      var panel = document.getElementById('mfTvAlertsPanel');
      if (panel) {
        panel.classList.remove('mf-tv-hidden');
        panel.setAttribute('aria-hidden', 'false');
        var routeEl = document.getElementById('mfTvAlertsPanelRoute');
        var bodyEl = document.getElementById('mfTvAlertsPanelBody');
        if (routeEl) routeEl.textContent = '[Layout] Route 43 · Reading Rd · Outbound';
        if (bodyEl) {
          bodyEl.innerHTML =
            '<div class="mf-tv-alerts-panel__empty">Position this panel for OBS, then Ctrl+Shift+L to lock.</div>';
        }
        previewOpen.alerts = true;
        window.mfTvLayoutApply('alerts');
      }
      return;
    }

    var p = document.getElementById('mfTvTrafficDetail');
    var ti = document.getElementById('mfTvTrafficDetailTitle');
    var img = document.getElementById('mfTvTrafficDetailImage');
    var bo = document.getElementById('mfTvTrafficDetailBody');
    var me = document.getElementById('mfTvTrafficDetailMeta');
    if (!p) return;

    p.classList.remove('mf-tv-hidden', 'mf-tv-camera-card', 'mf-tv-incident-card', 'mf-tv-slowdown-card');
    p.setAttribute('aria-hidden', 'false');

    if (key === 'camera') {
      p.classList.add('mf-tv-camera-card');
      if (ti) ti.textContent = '[Layout] I-75 at Lockland Split';
      if (img) {
        img.classList.remove('mf-tv-hidden', 'mf-tv-cam-fit-grid');
        img.alt = 'Camera preview';
        img.src =
          'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">' +
              '<rect fill="#111827" width="640" height="360"/>' +
              '<text x="50%" y="50%" fill="#64748b" font-family="sans-serif" font-size="22" text-anchor="middle">Camera preview</text></svg>'
          );
      }
      if (bo) {
        bo.textContent = '';
        bo.style.display = 'none';
      }
      if (me) {
        me.textContent = '';
        me.style.display = 'none';
      }
      previewOpen.camera = true;
    } else {
      p.classList.add('mf-tv-incident-card');
      if (ti) ti.textContent = '[Layout] Sample traffic incident';
      if (img) {
        img.classList.add('mf-tv-hidden');
        img.removeAttribute('src');
      }
      if (bo) {
        bo.textContent = 'Drag and resize this box for OBS. Director uses the same spot for incidents & slowdowns.';
        bo.style.display = 'block';
      }
      if (me) {
        me.textContent = 'Layout preview';
        me.style.display = 'block';
      }
      previewOpen.traffic = true;
    }

    window.mfTvLayoutApply(key);
  }

  function hidePreviews() {
    if (previewOpen.alerts && !window.MF_TV_ALERTS_COLUMN) {
      var panel = document.getElementById('mfTvAlertsPanel');
      if (panel) {
        panel.classList.add('mf-tv-hidden');
        panel.setAttribute('aria-hidden', 'true');
      }
    }
    previewOpen.alerts = false;

    if (previewOpen.camera || previewOpen.traffic) {
      var p = document.getElementById('mfTvTrafficDetail');
      if (p) {
        p.classList.add('mf-tv-hidden');
        p.setAttribute('aria-hidden', 'true');
      }
      previewOpen.camera = false;
      previewOpen.traffic = false;
    }
  }

  function resetLayouts() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    Object.keys(PANEL_META).forEach(function (key) {
      var el = PANEL_META[key].resolveEl();
      if (el && !el.classList.contains('mf-tv-hidden')) {
        window.mfTvLayoutApply(key);
      }
    });
  }

  function ensureToolbar() {
    if (document.getElementById('mfTvLayoutBar')) return;
    var bar = document.createElement('div');
    bar.id = 'mfTvLayoutBar';
    bar.className = 'mf-tv-layout-bar mf-tv-hidden';
    bar.innerHTML =
      '<div class="mf-tv-layout-bar__title">Panel layout mode</div>' +
      '<button type="button" data-mf-layout-preview="alerts">Show alerts</button>' +
      '<button type="button" data-mf-layout-preview="camera">Show camera</button>' +
      '<button type="button" data-mf-layout-preview="traffic">Show traffic</button>' +
      '<button type="button" data-mf-layout-reset="1">Reset positions</button>' +
      '<div class="mf-tv-layout-bar__hint">Drag header · resize corner · Ctrl+Shift+L to lock &amp; resume</div>';
    document.body.appendChild(bar);

    bar.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var preview = t.getAttribute('data-mf-layout-preview');
      if (preview) showPreview(preview);
      if (t.getAttribute('data-mf-layout-reset') === '1') resetLayouts();
    });
  }

  function setEditMode(on) {
    editMode = !!on;
    document.documentElement.classList.toggle('tv-layout-edit', editMode);
    var bar = document.getElementById('mfTvLayoutBar');
    if (bar) bar.classList.toggle('mf-tv-hidden', !editMode);

    if (editMode) {
      setupPanelChrome();
      if (window.mfTvDirector && typeof window.mfTvDirector.pause === 'function') {
        window.mfTvDirector.pause();
      }
    } else {
      hidePreviews();
      if (window.mfTvDirector && typeof window.mfTvDirector.resume === 'function') {
        window.mfTvDirector.resume();
      }
    }
  }

  function bindPointerDrag() {
    var state = null;

    function onMove(e) {
      if (!state || !editMode) return;
      var el = state.el;
      var dx = e.clientX - state.startX;
      var dy = e.clientY - state.startY;
      var rect;

      if (state.mode === 'drag') {
        rect = clampRect({
          x: state.orig.x + dx,
          y: state.orig.y + dy,
          w: state.orig.w,
          h: state.orig.h
        });
      } else {
        rect = clampRect({
          x: state.orig.x,
          y: state.orig.y,
          w: state.orig.w + dx,
          h: state.orig.h + dy
        });
      }

      applyRect(el, rect);
    }

    function onUp() {
      if (!state) return;
      saveRect(state.key, readRectFromEl(state.el));
      state = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }

    document.addEventListener(
      'pointerdown',
      function (e) {
        if (!editMode) return;
        var dragKey = e.target && e.target.closest && e.target.closest('[data-mf-tv-layout-drag]');
        var resizeKey = e.target && e.target.closest && e.target.closest('[data-mf-tv-layout-resize]');
        var key = '';
        var mode = '';

        if (resizeKey) {
          key = resizeKey.getAttribute('data-mf-tv-layout-resize');
          mode = 'resize';
        } else if (dragKey) {
          key = dragKey.getAttribute('data-mf-tv-layout-drag');
          mode = 'drag';
        } else {
          return;
        }

        var meta = PANEL_META[key];
        if (!meta) return;
        var el = meta.resolveEl();
        if (!el || el.classList.contains('mf-tv-hidden')) return;

        e.preventDefault();
        state = {
          key: key,
          el: el,
          mode: mode,
          startX: e.clientX,
          startY: e.clientY,
          orig: readRectFromEl(el)
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      },
      true
    );
  }

  window.mfTvLayoutSetEditMode = setEditMode;
  window.mfTvLayoutIsEditMode = function () {
    return editMode;
  };

  function bindAlertsSizePersist() {
    var panel = document.getElementById('mfTvAlertsPanel');
    if (!panel || panel.getAttribute('data-mf-alerts-size-ro') === '1') return;
    panel.setAttribute('data-mf-alerts-size-ro', '1');
    if (typeof ResizeObserver === 'undefined') return;
    var timer;
    try {
      var ro = new ResizeObserver(function () {
        if (editMode || panel.classList.contains('mf-tv-hidden')) return;
        if (panel.classList.contains('mf-tv-layout-positioned')) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
          var r = panel.getBoundingClientRect();
          if (r.width < 200 || r.height < 200) return;
          try {
            localStorage.setItem(
              'mfTvAlertsSize_v1',
              JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) })
            );
          } catch (_) {}
        }, 400);
      });
      ro.observe(panel);
    } catch (_) {}
  }

  window.mfTvLayoutInit = function () {
    ensureToolbar();
    setupPanelChrome();
    bindPointerDrag();
    bindAlertsSizePersist();

    document.addEventListener('keydown', function (e) {
      if (!window.MF_TV_MODE) return;
      if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        setEditMode(!editMode);
      }
    });
  };

  if (window.MF_TV_MODE) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', window.mfTvLayoutInit);
    } else {
      window.mfTvLayoutInit();
    }
  }
})();
