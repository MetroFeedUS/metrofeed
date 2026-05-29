/**
 * RoamRaven TV — fixed stage layout + URL panel parser.
 * Every OBS browser source uses the same query vocabulary; only the crop changes.
 *
 * Params:
 *   tv=1          (required)
 *   panel=map|alerts|camera|ticker|live|lower|preview
 *   bw=1920       browser-source width in OBS (defaults to panel size)
 *   bh=1080       browser-source height in OBS
 *   x,y,w,h       optional crop override on the master stage (pixels)
 */
(function (global) {
  'use strict';

  var STAGE = {
    width: 2400,
    height: 1350,
    panels: {
      map: { x: 0, y: 0, w: 1920, h: 1080, defaultBw: 1920, defaultBh: 1080 },
      alerts: { x: 1920, y: 64, w: 480, h: 860, defaultBw: 480, defaultBh: 860 },
      camera: { x: 1040, y: 100, w: 880, h: 880, defaultBw: 880, defaultBh: 880 },
      ticker: { x: 0, y: 1080, w: 1920, h: 160, defaultBw: 1920, defaultBh: 160 },
      live: { x: 40, y: 36, w: 140, h: 56, defaultBw: 140, defaultBh: 56 },
      lower: { x: 40, y: 40, w: 720, h: 100, defaultBw: 720, defaultBh: 100 },
      preview: { x: 0, y: 0, w: 2400, h: 1350, defaultBw: 2400, defaultBh: 1350 }
    }
  };

  function num(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function parseTvPanelParams(search) {
    var params =
      search instanceof URLSearchParams
        ? search
        : new URLSearchParams(typeof search === 'string' ? search : global.location.search);

    var panel = String(params.get('panel') || 'map').toLowerCase();
    if (panel === 'director') panel = 'map';
    if (!STAGE.panels[panel]) panel = 'map';

    var def = STAGE.panels[panel];
    var crop = {
      x: params.has('x') ? num(params.get('x'), def.x) : def.x,
      y: params.has('y') ? num(params.get('y'), def.y) : def.y,
      w: params.has('w') ? num(params.get('w'), def.w) : def.w,
      h: params.has('h') ? num(params.get('h'), def.h) : def.h
    };

    var bw = num(params.get('bw'), def.defaultBw || crop.w);
    var bh = num(params.get('bh'), def.defaultBh || crop.h);
    var scale = Math.min(bw / crop.w, bh / crop.h);

    return {
      panel: panel,
      stage: STAGE,
      crop: crop,
      bw: bw,
      bh: bh,
      scale: scale,
      isMap: panel === 'map' || panel === 'preview',
      needsDirector: panel === 'map'
    };
  }

  function buildTvQuery(panel, bw, bh) {
    var q = new URLSearchParams();
    q.set('tv', '1');
    q.set('panel', panel || 'map');
    if (bw) q.set('bw', String(bw));
    if (bh) q.set('bh', String(bh));
    return q.toString();
  }

  global.MF_TV_STAGE = STAGE;
  global.mfTvParsePanelParams = parseTvPanelParams;
  global.mfTvBuildQuery = buildTvQuery;

  /** Map/director: use fixed OBS pixels, not window.innerWidth (CEF lies in browser sources). */
  global.mfTvViewportPx = function () {
    if (global.MF_TV_MAP_PX && global.MF_TV_MAP_PX.w) {
      return { w: global.MF_TV_MAP_PX.w, h: global.MF_TV_MAP_PX.h };
    }
    var mapEl = global.document && global.document.getElementById('map');
    if (mapEl) {
      var r = mapEl.getBoundingClientRect();
      if (r.width > 80 && r.height > 80) {
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }
    }
    var spec = global.MF_TV_STAGE_SPEC;
    if (spec && spec.crop) {
      return { w: spec.crop.w, h: spec.crop.h };
    }
    return { w: 1920, h: 1080 };
  };
})(typeof window !== 'undefined' ? window : global);
