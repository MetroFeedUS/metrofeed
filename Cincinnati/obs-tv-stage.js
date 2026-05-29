/**
 * Apply URL-driven stage viewport (home.html + obs-tv.html).
 */
(function () {
  'use strict';

  function applyStage(doc, spec) {
    if (!doc || !spec) return;
    var root = doc.documentElement;
    root.style.setProperty('--mf-tv-bw', spec.bw + 'px');
    root.style.setProperty('--mf-tv-bh', spec.bh + 'px');
    root.style.setProperty('--mf-tv-scale', String(spec.scale));
    root.style.setProperty('--mf-tv-crop-x', spec.crop.x + 'px');
    root.style.setProperty('--mf-tv-crop-y', spec.crop.y + 'px');
    root.style.setProperty('--mf-tv-crop-w', spec.crop.w + 'px');
    root.style.setProperty('--mf-tv-crop-h', spec.crop.h + 'px');
    root.style.setProperty('--mf-tv-stage-w', spec.stage.width + 'px');
    root.style.setProperty('--mf-tv-stage-h', spec.stage.height + 'px');
    root.classList.add('tv-stage-mode');
    root.classList.add('tv-panel-' + spec.panel);
  }

  window.mfTvStageApply = applyStage;
})();
