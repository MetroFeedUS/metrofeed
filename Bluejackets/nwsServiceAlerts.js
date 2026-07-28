/**
 * NWS weather helpers — forecast uses city center; alerts use service-county areas.
 */
(function (global) {
  'use strict';

  var NWS_USER_AGENT = 'roamravenapp.com, contact@metrofeedus.com';

  var SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

  var EVENT_RANK = {
    'Tornado Warning': 100,
    'Tornado Watch': 95,
    'Severe Thunderstorm Warning': 90,
    'Severe Thunderstorm Watch': 85,
    'Flash Flood Warning': 80,
    'Flash Flood Watch': 75,
    'Flood Warning': 70,
    'Flood Watch': 65,
    'Winter Storm Warning': 60,
    'Winter Storm Watch': 55,
    'High Wind Warning': 50,
    'High Wind Watch': 45
  };

  function cityConfig() {
    return global.CITY_CONFIG || (typeof getCityConfig === 'function' ? getCityConfig() : null);
  }

  function nwsHeaders() {
    return { 'User-Agent': NWS_USER_AGENT };
  }

  function pointFromConfig(cfg) {
    var c = cfg || cityConfig();
    if (c && Array.isArray(c.defaultCenter) && c.defaultCenter.length >= 2) {
      var lon = Number(c.defaultCenter[0]);
      var lat = Number(c.defaultCenter[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat: lat, lon: lon };
    }
    return { lat: 39.1271, lon: -84.5144 };
  }

  function mapClickUrl(cfg) {
    var pt = pointFromConfig(cfg);
    return (
      'https://forecast.weather.gov/MapClick.php?lat=' + pt.lat + '&lon=' + pt.lon
    );
  }

  function pointsApiUrl(cfg) {
    var pt = pointFromConfig(cfg);
    return 'https://api.weather.gov/points/' + pt.lat + ',' + pt.lon;
  }

  /** FIPS GEOID (5-digit) → NWS county area code, e.g. 21015 → KYC015 */
  function geoidToNwsArea(geoid) {
    var g = String(geoid || '').trim();
    if (!/^\d{5}$/.test(g)) return '';
    var stFips = g.slice(0, 2);
    var county = g.slice(2);
    var stMap = {
      '01': 'AL',
      '21': 'KY',
      '39': 'OH'
    };
    var st = stMap[stFips];
    if (!st) return '';
    return st + 'C' + county;
  }

  function serviceCounties(cfg) {
    var c = cfg || cityConfig();
    if (!c) return [];
    if (Array.isArray(c.serviceCounties) && c.serviceCounties.length) {
      return c.serviceCounties.slice();
    }
    if (Array.isArray(c.nwsAlertAreas) && c.nwsAlertAreas.length) {
      return c.nwsAlertAreas.map(function (area) {
        return { nwsArea: String(area) };
      });
    }
    return [];
  }

  function serviceCountyNames(cfg) {
    var rows = serviceCounties(cfg);
    var names = [];
    rows.forEach(function (row) {
      if (row && row.name) names.push(String(row.name));
    });
    return names;
  }

  function nwsAlertAreas(cfg) {
    var c = cfg || cityConfig();
    if (c && Array.isArray(c.nwsAlertAreas) && c.nwsAlertAreas.length) {
      return c.nwsAlertAreas.slice();
    }
    var areas = [];
    serviceCounties(c).forEach(function (row) {
      if (row && row.nwsArea) areas.push(String(row.nwsArea));
      else if (row && row.geoid) {
        var code = geoidToNwsArea(row.geoid);
        if (code) areas.push(code);
      }
    });
    var seen = Object.create(null);
    return areas.filter(function (a) {
      if (!a || seen[a]) return false;
      seen[a] = true;
      return true;
    });
  }

  /** NWS UGC county codes (OHC061, KYC015, …) — queried via ?zone= not ?area= */
  function nwsAlertZones(cfg) {
    return nwsAlertAreas(cfg);
  }

  function alertWebUrl(feature, fallbackMapClickUrl) {
    var alert = feature && feature.properties ? feature.properties : {};
    var featureId =
      feature && feature.id != null
        ? String(feature.id)
        : alert.id != null
          ? String(alert.id)
          : '';
    var fallback = fallbackMapClickUrl || mapClickUrl();
    var u = '';
    if (alert.same && Array.isArray(alert.same) && alert.same.length > 0) {
      u = String(alert.same[0]).trim();
    } else if (alert.web && typeof alert.web === 'string') {
      u = alert.web.trim();
    } else if (alert.uri && typeof alert.uri === 'string') {
      u = alert.uri.trim();
    } else if (featureId && featureId.indexOf('api.weather.gov') >= 0) {
      u = featureId.replace('api.weather.gov', 'www.weather.gov');
    }
    if (!u || !/^https?:\/\//i.test(u)) return fallback;
    return u;
  }

  function alertFeatureId(feature) {
    if (!feature) return '';
    if (feature.id != null) return String(feature.id);
    if (feature.properties && feature.properties.id != null) {
      return String(feature.properties.id);
    }
    if (feature.properties && feature.properties['@id']) {
      return String(feature.properties['@id']);
    }
    return '';
  }

  function alertRank(feature) {
    var p = (feature && feature.properties) || {};
    var event = String(p.event || '');
    var sev = SEVERITY_RANK[String(p.severity || 'Unknown')] || 0;
    var ev = EVENT_RANK[event] || 0;
    return ev * 10 + sev;
  }

  /** Life-safety alerts for startup interrupt (warnings, not routine advisories). */
  var LIFE_SAFETY_EVENTS = {
    'Tornado Warning': true,
    'Severe Thunderstorm Warning': true,
    'Flash Flood Warning': true,
    'Extreme Wind Warning': true,
    'Tsunami Warning': true,
    'Hurricane Warning': true,
    'Typhoon Warning': true,
    'Storm Surge Warning': true
  };

  function isLifeSafetyAlert(feature) {
    var p = feature && feature.properties;
    if (!p) return false;
    if (p.status && String(p.status).toLowerCase() !== 'actual') return false;
    if (p.messageType && String(p.messageType).toLowerCase() === 'cancel') return false;

    var event = String(p.event || '').trim();
    var sev = String(p.severity || '');

    if (LIFE_SAFETY_EVENTS[event]) return true;
    if (sev === 'Extreme') return true;
    if (sev === 'Severe' && /warning/i.test(event)) return true;
    return false;
  }

  function filterLifeSafetyAlerts(features) {
    return sortAlertFeatures((features || []).filter(isLifeSafetyAlert));
  }

  function sortAlertFeatures(features) {
    return (features || []).slice().sort(function (a, b) {
      return alertRank(b) - alertRank(a);
    });
  }

  /** Keep only county names that fall inside the RoamRaven service list. */
  function filterAreaDescToServiceCounties(areaDesc, cfg) {
    if (!areaDesc) return '';
    var names = serviceCountyNames(cfg);
    if (!names.length) return String(areaDesc);

    var lookup = Object.create(null);
    names.forEach(function (n) {
      lookup[String(n).toLowerCase()] = n;
    });

    var matched = [];
    String(areaDesc)
      .split(/[;,]/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean)
      .forEach(function (part) {
        var lower = part.toLowerCase();
        for (var key in lookup) {
          if (Object.prototype.hasOwnProperty.call(lookup, key) && lower.indexOf(key) >= 0) {
            matched.push(lookup[key]);
            break;
          }
        }
      });

    var uniq = [];
    var seen = Object.create(null);
    matched.forEach(function (n) {
      if (!seen[n]) {
        seen[n] = true;
        uniq.push(n);
      }
    });
    return uniq.length ? uniq.join(', ') : String(areaDesc);
  }

  function serviceAreaLabel(cfg) {
    var names = serviceCountyNames(cfg);
    if (!names.length) return 'this service area';
    if (names.length === 1) return names[0] + ' County';
    if (names.length === 2) return names[0] + ' and ' + names[1] + ' counties';
    return (
      names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1] + ' counties'
    );
  }

  function fetchAlertsForZones(zones) {
    if (!zones || !zones.length) {
      return Promise.resolve({ features: [] });
    }
    var url =
      'https://api.weather.gov/alerts/active?status=actual&message_type=alert&zone=' +
      zones.join(',');
    return fetch(url, { headers: nwsHeaders() }).then(function (res) {
      if (!res.ok) throw new Error('NWS alerts HTTP ' + res.status);
      return res.json();
    });
  }

  function fetchAlertsForZone(zone) {
    var url =
      'https://api.weather.gov/alerts/active?status=actual&message_type=alert&zone=' +
      encodeURIComponent(zone);
    return fetch(url, { headers: nwsHeaders() }).then(function (res) {
      if (!res.ok) throw new Error('NWS alerts HTTP ' + res.status + ' (' + zone + ')');
      return res.json();
    });
  }

  function mergeAlertFeatures(listOfFeatureArrays) {
    var byId = Object.create(null);
    var out = [];
    (listOfFeatureArrays || []).forEach(function (arr) {
      (arr || []).forEach(function (feature) {
        var id = alertFeatureId(feature);
        var key = id || JSON.stringify(feature && feature.properties);
        if (byId[key]) return;
        byId[key] = true;
        out.push(feature);
      });
    });
    return sortAlertFeatures(out);
  }

  /**
   * Active NWS alerts for all service counties (deduped, severity-sorted).
   * Falls back to point query when no county list is configured.
   */
  function fetchServiceAreaAlerts(cfg) {
    var c = cfg || cityConfig();
    var zones = nwsAlertZones(c);

    if (!zones.length) {
      var pt = pointFromConfig(c);
      var pointUrl =
        'https://api.weather.gov/alerts/active?point=' + pt.lat + ',' + pt.lon;
      return fetch(pointUrl, { headers: nwsHeaders() })
        .then(function (res) {
          if (!res.ok) throw new Error('NWS alerts HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          return {
            features: sortAlertFeatures((data && data.features) || []),
            zones: [],
            usedPointFallback: true
          };
        });
    }

    return fetchAlertsForZones(zones)
      .then(function (data) {
        return {
          features: sortAlertFeatures((data && data.features) || []),
          zones: zones,
          usedPointFallback: false
        };
      })
      .catch(function (err) {
        console.warn('[MfNwsWeather] combined zone query failed, per-county fallback', err);
        return Promise.all(
          zones.map(function (zone) {
            return fetchAlertsForZone(zone)
              .then(function (data) {
                return (data && data.features) || [];
              })
              .catch(function (zoneErr) {
                console.warn('[MfNwsWeather] zone alerts failed:', zone, zoneErr);
                return [];
              });
          })
        ).then(function (groups) {
          return {
            features: mergeAlertFeatures(groups),
            zones: zones,
            usedPointFallback: false
          };
        });
      });
  }

  global.MfNwsWeather = {
    nwsHeaders: nwsHeaders,
    pointFromConfig: pointFromConfig,
    mapClickUrl: mapClickUrl,
    pointsApiUrl: pointsApiUrl,
    geoidToNwsArea: geoidToNwsArea,
    nwsAlertAreas: nwsAlertAreas,
    nwsAlertZones: nwsAlertZones,
    serviceCountyNames: serviceCountyNames,
    serviceAreaLabel: serviceAreaLabel,
    alertWebUrl: alertWebUrl,
    isLifeSafetyAlert: isLifeSafetyAlert,
    filterLifeSafetyAlerts: filterLifeSafetyAlerts,
    sortAlertFeatures: sortAlertFeatures,
    filterAreaDescToServiceCounties: filterAreaDescToServiceCounties,
    fetchServiceAreaAlerts: fetchServiceAreaAlerts
  };
})(typeof window !== 'undefined' ? window : global);
