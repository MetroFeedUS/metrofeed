/**
 * Draggable LIVE badge — position saved in localStorage (OBS browser source).
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'mfLiveBadgePos_v1';
  var badge = document.getElementById('mfLiveBadge');
  if (!badge) return;

  function clampPos(x, y) {
    var W = window.innerWidth || 320;
    var H = window.innerHeight || 120;
    var r = badge.getBoundingClientRect();
    var w = r.width || 88;
    var h = r.height || 32;
    return {
      x: Math.max(0, Math.min(x, W - w)),
      y: Math.max(0, Math.min(y, H - h))
    };
  }

  function applyPos(x, y) {
    var p = clampPos(x, y);
    badge.style.left = p.x + 'px';
    badge.style.top = p.y + 'px';
    return p;
  }

  function savePos(x, y) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
    } catch (_) {}
  }

  function loadPos() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data && Number.isFinite(data.x) && Number.isFinite(data.y)) return data;
    } catch (_) {}
    return null;
  }

  var saved = loadPos();
  if (saved) {
    applyPos(saved.x, saved.y);
  }

  var drag = null;

  badge.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    var r = badge.getBoundingClientRect();
    drag = {
      startX: e.clientX,
      startY: e.clientY,
      origX: r.left,
      origY: r.top
    };
    badge.classList.add('mf-live-badge--dragging');
    badge.setPointerCapture(e.pointerId);
  });

  badge.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.startX;
    var dy = e.clientY - drag.startY;
    applyPos(drag.origX + dx, drag.origY + dy);
  });

  function endDrag() {
    if (!drag) return;
    drag = null;
    badge.classList.remove('mf-live-badge--dragging');
    var r = badge.getBoundingClientRect();
    savePos(r.left, r.top);
  }

  badge.addEventListener('pointerup', endDrag);
  badge.addEventListener('pointercancel', endDrag);
})();
