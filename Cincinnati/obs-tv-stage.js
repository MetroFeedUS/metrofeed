/**
 * Apply URL-driven stage viewport (home.html + obs-tv.html).
 */
(function () {
  'use strict';

  function applyStage(doc, spec) {
    if (!doc || !spec) return;
    var root = doc.documentElement;
    var crop = spec.crop || { x: 0, y: 0, w: 1920, h: 1080 };

    root.style.setProperty('--mf-tv-bw', spec.bw + 'px');
    root.style.setProperty('--mf-tv-bh', spec.bh + 'px');
    root.style.setProperty('--mf-tv-scale', String(spec.scale));
    root.style.setProperty('--mf-tv-crop-x', crop.x + 'px');
    root.style.setProperty('--mf-tv-crop-y', crop.y + 'px');
    root.style.setProperty('--mf-tv-crop-w', crop.w + 'px');
    root.style.setProperty('--mf-tv-crop-h', crop.h + 'px');
    root.style.setProperty('--mf-tv-stage-w', spec.stage.width + 'px');
    root.style.setProperty('--mf-tv-stage-h', spec.stage.height + 'px');
    root.classList.add('tv-stage-mode');
    root.classList.add('tv-panel-' + spec.panel);

    window.MF_TV_MAP_PX = { w: crop.w, h: crop.h, bw: spec.bw, bh: spec.bh };

    var vp = doc.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = doc.createElement('meta');
      vp.setAttribute('name', 'viewport');
      doc.head.appendChild(vp);
    }
    vp.setAttribute(
      'content',
      'width=' +
        spec.bw +
        ', height=' +
        spec.bh +
        ', initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no'
    );

    var crit = doc.getElementById('mfTvStageCritical');
    if (!crit) {
      crit = doc.createElement('style');
      crit.id = 'mfTvStageCritical';
      doc.head.appendChild(crit);
    }
    crit.textContent =
      'html.tv-stage-mode,html.tv-stage-mode body{width:' +
      spec.bw +
      'px!important;height:' +
      spec.bh +
      'px!important;max-width:' +
      spec.bw +
      'px!important;max-height:' +
      spec.bh +
      'px!important;overflow:hidden!important;margin:0!important;padding:0!important;}' +
      'html.tv-stage-mode #map{width:' +
      crop.w +
      'px!important;height:' +
      crop.h +
      'px!important;max-width:' +
      crop.w +
      'px!important;max-height:' +
      crop.h +
      'px!important;min-width:0!important;min-height:0!important;position:absolute!important;top:0!important;left:0!important;right:auto!important;bottom:auto!important;}' +
      'html.tv-stage-mode .maplibregl-map,html.tv-stage-mode .maplibregl-canvas-container{width:100%!important;height:100%!important;position:absolute!important;top:0!important;left:0!important;}';
  }

  window.mfTvStageApply = applyStage;
})();
