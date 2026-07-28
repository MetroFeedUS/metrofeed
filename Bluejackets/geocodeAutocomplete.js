/**
 * RoamRaven — address/place autocomplete via MetroFeed location API (Geoapify proxy).
 */
(function (global) {
  'use strict';

  function autocompleteBaseUrl(cfg) {
    var c = cfg || global.CITY_CONFIG;
    if (!c || !c.geocodeAutocompleteUrl) return '';
    return String(c.geocodeAutocompleteUrl).replace(/\/$/, '');
  }

  function placeFromFeature(feature) {
    if (!feature) return null;
    var p = feature.properties || {};
    var label = String(p.formatted || p.address_line1 || p.name || '').trim();
    if (!label) return null;

    var lat = Number(p.lat);
    var lon = Number(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      var g = feature.geometry;
      if (g && g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
        lon = Number(g.coordinates[0]);
        lat = Number(g.coordinates[1]);
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return {
      label: label,
      lat: lat,
      lon: lon,
      category: p.category || p.result_type || ''
    };
  }

  function fetchPlaceSuggestions(text, cfg) {
    var q = String(text || '').trim();
    var base = autocompleteBaseUrl(cfg);
    if (!base || q.length < 2) return Promise.resolve([]);

    var url = base + '?text=' + encodeURIComponent(q);

    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('Autocomplete HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var features = (data && data.features) || [];
        var out = [];
        var seen = Object.create(null);
        for (var i = 0; i < features.length && out.length < 8; i++) {
          var place = placeFromFeature(features[i]);
          if (!place) continue;
          var key = place.lat.toFixed(5) + ',' + place.lon.toFixed(5) + '|' + place.label.toLowerCase();
          if (seen[key]) continue;
          seen[key] = true;
          out.push(place);
        }
        return out;
      })
      .catch(function (err) {
        console.warn('[geocodeAutocomplete]', err);
        return [];
      });
  }

  global.MfGeocodeAutocomplete = {
    autocompleteBaseUrl: autocompleteBaseUrl,
    fetchPlaceSuggestions: fetchPlaceSuggestions,
    placeFromFeature: placeFromFeature
  };
})(typeof window !== 'undefined' ? window : global);
