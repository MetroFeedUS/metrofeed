/**
 * RoamRaven OBS support ticker — clock, NWS weather, tiered alert styling.
 * clear → caution (watch/advisory) → warning → emergency (tornado)
 */
(function () {
  'use strict';

  const TZ = (window.CITY_CONFIG && window.CITY_CONFIG.timezone) || 'America/New_York';
  const CITY = (window.CITY_CONFIG && window.CITY_CONFIG.cityName) || 'Cincinnati';
  const STATE = (window.CITY_CONFIG && window.CITY_CONFIG.state) || 'OH';

  const EVENT_RANK = {
    'Tornado Warning': 100,
    'Tornado Watch': 95,
    'Severe Thunderstorm Warning': 90,
    'Severe Thunderstorm Watch': 85,
    'Flash Flood Warning': 80,
    'Flash Flood Watch': 75,
    'Flood Warning': 70,
    'Flood Watch': 65
  };

  let lastWeatherSnapshot = {
    temp: null,
    desc: '',
    emoji: '🌤️'
  };

  const DEMO_ALERTS = {
    clear: [],
    caution: [
      {
        properties: {
          event: 'Heat Advisory',
          severity: 'Moderate',
          areaDesc: 'Hamilton; Butler; Warren',
          expires: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()
        }
      }
    ],
    warning: [
      {
        properties: {
          event: 'Severe Thunderstorm Warning',
          severity: 'Severe',
          areaDesc: 'Hamilton; Butler; Warren',
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        }
      }
    ],
    emergency: [
      {
        properties: {
          event: 'Tornado Warning',
          severity: 'Extreme',
          areaDesc: 'Hamilton; Butler; Clermont',
          headline: 'A tornado warning remains in effect until 5:15 PM EDT.',
          instruction: 'Take shelter now in a basement or interior room on the lowest floor.',
          expires: new Date(Date.now() + 30 * 60 * 1000).toISOString()
        }
      }
    ]
  };

  function getDemoMode() {
    try {
      const raw = String(new URLSearchParams(window.location.search).get('tvDemo') || '').toLowerCase();
      if (raw === 'clear' || raw === 'caution' || raw === 'warning' || raw === 'emergency') {
        return raw;
      }
    } catch (_) {}
    return null;
  }

  function updateSourceLabel(demoMode) {
    const src = el('rrWeatherSource');
    if (!src) return;
    if (demoMode) {
      src.textContent = 'Source: NWS · DEMO';
      src.className = 'rr-ticker__source rr-ticker__source--demo';
    } else {
      src.textContent = 'Source: NWS';
      src.className = 'rr-ticker__source';
    }
  }

  function applyDemoMode(mode) {
    updateSourceLabel(mode);
    const feats = DEMO_ALERTS[mode] || [];
    if (!feats.length) {
      setTickerMode('clear');
      return;
    }
    const primary = feats[0].properties || {};
    setTickerMode(mode, primary, feats.length - 1);
  }

  function el(id) {
    return document.getElementById(id);
  }

  function tickClock() {
    const now = new Date();
    const timeEl = el('rrClockTime');
    const dateEl = el('rrClockDate');
    if (!timeEl || !dateEl) return;

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).formatToParts(now);

    let hour = '';
    let minute = '';
    let second = '';
    let dayPeriod = '';
    parts.forEach(function (p) {
      if (p.type === 'hour') hour = p.value;
      if (p.type === 'minute') minute = p.value;
      if (p.type === 'second') second = p.value;
      if (p.type === 'dayPeriod') dayPeriod = p.value;
    });

    timeEl.innerHTML =
      hour + ':' + minute + '<span class="rr-clock__sec">:' + second + '</span> ' + dayPeriod;

    const ticker = el('rrTicker');
    const isEmergency = ticker && ticker.classList.contains('rr-ticker--emergency');
    dateEl.textContent = now.toLocaleDateString('en-US', {
      timeZone: TZ,
      weekday: isEmergency ? undefined : 'long',
      month: isEmergency ? 'short' : 'long',
      day: 'numeric',
      year: isEmergency ? undefined : 'numeric'
    });
  }

  function weatherEmoji(text) {
    const t = String(text || '').toLowerCase();
    if (t.includes('thunder')) return '⛈️';
    if (t.includes('snow') || t.includes('flurr')) return '❄️';
    if (t.includes('rain') || t.includes('shower') || t.includes('drizzle')) return '🌧️';
    if (t.includes('fog') || t.includes('mist')) return '🌫️';
    if (t.includes('cloud') || t.includes('overcast')) return '☁️';
    if (t.includes('clear') || t.includes('sunny')) return '☀️';
    return '🌤️';
  }

  function nwsHeaders() {
    return { 'User-Agent': 'roamravenapp.com, contact@metrofeedus.com' };
  }

  function nwsPoint() {
    const c = window.CITY_CONFIG;
    if (c && c.defaultCenter) {
      return { lat: c.defaultCenter[1], lon: c.defaultCenter[0] };
    }
    return { lat: 39.103, lon: -84.512 };
  }

  function alertRank(feature) {
    const p = (feature && feature.properties) || {};
    const event = String(p.event || '');
    const sevRank = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
    const sev = sevRank[String(p.severity || 'Unknown')] || 0;
    const ev = EVENT_RANK[event] || 0;
    return ev * 10 + sev;
  }

  function sortAlerts(features) {
    return (features || []).slice().sort(function (a, b) {
      return alertRank(b) - alertRank(a);
    });
  }

  /** clear | caution | warning | emergency */
  function alertTier(props) {
    const event = String((props && props.event) || '').trim();
    const sev = String((props && props.severity) || '');

    if (/tornado warning/i.test(event)) return 'emergency';
    if (/warning/i.test(event)) return 'warning';
    if (/watch/i.test(event) || /advisory/i.test(event) || /statement/i.test(event)) {
      return 'caution';
    }
    if (sev === 'Extreme') return 'emergency';
    if (sev === 'Severe') return 'warning';
    if (props) return 'caution';
    return 'clear';
  }

  function formatUntil(expires) {
    if (!expires) return '';
    try {
      const d = new Date(expires);
      if (Number.isNaN(d.getTime())) return '';
      return (
        'Until ' +
        d.toLocaleTimeString('en-US', {
          timeZone: TZ,
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        })
      );
    } catch (_) {
      return '';
    }
  }

  function shortArea(areaDesc) {
    let s = String(areaDesc || '').trim();
    if (!s) return '';
    s = s.replace(/^Including the cities of\s*/i, '');
    if (s.length > 72) s = s.slice(0, 70) + '…';
    return s;
  }

  function alertHeadline(props, extraCount) {
    const event = String((props && props.event) || 'Weather alert').trim();
    const area = shortArea(props && props.areaDesc);
    let line = event;
    if (area) line += ' · ' + area;
    if (extraCount > 0) line += ' (+' + extraCount + ' more)';
    return line;
  }

  function emergencyDetail(props) {
    const headline = String((props && props.headline) || '').trim();
    const instruction = String((props && props.instruction) || '').trim();
    if (headline) {
      const first = headline.split(/\.\s+/)[0];
      if (first && first.length < 120) return first;
    }
    if (instruction) {
      const first = instruction.split(/\.\s+/)[0];
      if (first) return first.length > 100 ? first.slice(0, 98) + '…' : first;
    }
    return 'Take shelter now · Radar indicated';
  }

  function setTickerMode(mode, primaryProps, extraCount) {
    const ticker = el('rrTicker');
    const bar = el('rrTickerBar');
    const icon = el('rrAlertBarIcon');
    const text = el('rrAlertBarText');
    const until = el('rrAlertBarUntil');
    const tonight = el('rrTonight');
    const emergencyPanel = el('rrEmergencyPanel');
    const emergencyEvent = el('rrEmergencyEvent');
    const emergencyDetailEl = el('rrEmergencyDetail');
    const emergencyCounties = el('rrEmergencyCounties');

    if (!ticker || !bar || !text) return;

    ticker.className = 'rr-ticker rr-ticker--' + mode;
    bar.className = 'rr-ticker__bar';

    if (emergencyPanel) {
      const isEmergency = mode === 'emergency';
      emergencyPanel.hidden = !isEmergency;
      emergencyPanel.setAttribute('aria-hidden', isEmergency ? 'false' : 'true');
    }

    if (icon) {
      icon.hidden = mode === 'clear';
      icon.setAttribute('aria-hidden', mode === 'clear' ? 'true' : 'false');
    }
    if (until) {
      until.hidden = true;
      until.textContent = '';
    }
    if (tonight) tonight.hidden = false;

    if (mode === 'clear') {
      text.textContent = 'No active weather alerts';
      text.className = 'rr-alert-bar__text rr-alert-bar__text--clear';
      return;
    }

    const props = primaryProps || {};
    const untilStr = formatUntil(props.expires);
    const headline = alertHeadline(props, extraCount);

    if (mode === 'caution') {
      text.textContent = '⚠ ' + headline;
      text.className = 'rr-alert-bar__text rr-alert-bar__text--caution';
      if (until && untilStr) {
        until.hidden = false;
        until.textContent = untilStr;
      }
      return;
    }

    if (mode === 'warning') {
      bar.className = 'rr-ticker__bar rr-ticker__bar--warning';
      text.textContent = headline.toUpperCase();
      text.className = 'rr-alert-bar__text rr-alert-bar__text--warning';
      if (until && untilStr) {
        until.hidden = false;
        until.textContent = untilStr;
      }
      if (tonight) tonight.hidden = true;
      return;
    }

    if (mode === 'emergency') {
      bar.className = 'rr-ticker__bar rr-ticker__bar--emergency';
      if (emergencyEvent) emergencyEvent.textContent = String(props.event || 'Tornado Warning');
      if (emergencyDetailEl) emergencyDetailEl.textContent = emergencyDetail(props);
      if (emergencyCounties) {
        const area = shortArea(props.areaDesc);
        emergencyCounties.textContent = [area, untilStr].filter(Boolean).join(' · ');
      }
      const snap = lastWeatherSnapshot;
      text.textContent =
        (snap.temp != null ? snap.temp + '°F · ' : '') +
        snap.emoji +
        ' ' +
        (snap.desc || 'Current conditions') +
        ' · Seek shelter immediately';
      text.className = 'rr-alert-bar__text rr-alert-bar__text--emergency';
      if (tonight) tonight.hidden = true;
      if (until) until.hidden = true;
    }
  }

  function applyAlerts(features) {
    if (getDemoMode()) return;
    const sorted = sortAlerts(features);
    if (!sorted.length) {
      setTickerMode('clear');
      return;
    }

    const primary = sorted[0].properties || {};
    const tier = alertTier(primary);
    setTickerMode(tier, primary, sorted.length - 1);
  }

  function setWeatherLoading() {
    const desc = el('rrWeatherDesc');
    const hourly = el('rrHourlyRow');
    if (desc) desc.textContent = 'Loading conditions…';
    if (hourly) hourly.innerHTML = '<div class="rr-ticker__loading">Loading forecast…</div>';
  }

  async function loadWeather() {
    setWeatherLoading();
    const pt = nwsPoint();
    const pointsUrl = 'https://api.weather.gov/points/' + pt.lat + ',' + pt.lon;
    const alertsUrl = 'https://api.weather.gov/alerts/active?point=' + pt.lat + ',' + pt.lon;

    try {
      const [pointsRes, alertsRes] = await Promise.all([
        fetch(pointsUrl, { headers: nwsHeaders() }),
        fetch(alertsUrl, { headers: nwsHeaders() })
      ]);
      const pointsData = pointsRes.ok ? await pointsRes.json() : null;
      const alertsData = alertsRes.ok ? await alertsRes.json() : null;
      const feats = (alertsData && alertsData.features) || [];
      const demoMode = getDemoMode();
      if (demoMode) {
        applyDemoMode(demoMode);
      } else {
        applyAlerts(feats);
      }

      let currentTemp = null;
      let currentDesc = '';
      let feelsLike = null;
      let periods = [];

      if (pointsData && pointsData.properties) {
        const props = pointsData.properties;
        if (props.forecastHourly) {
          const hRes = await fetch(props.forecastHourly, { headers: nwsHeaders() });
          if (hRes.ok) {
            const hData = await hRes.json();
            periods = (hData.properties && hData.properties.periods) || [];
            if (periods[0]) {
              currentTemp = periods[0].temperature;
              currentDesc = periods[0].shortForecast || '';
              if (periods[0].apparentTemperature != null) {
                feelsLike = periods[0].apparentTemperature;
              }
            }
          }
        }
        if (props.forecast) {
          try {
            const dRes = await fetch(props.forecast, { headers: nwsHeaders() });
            if (dRes.ok) {
              const dData = await dRes.json();
              const daily = (dData.properties && dData.properties.periods) || [];
              const tonight = daily.find(function (p) {
                return p && p.isDaytime === false;
              });
              const tipEl = el('rrTonight');
              if (tipEl && tonight) {
                const fc = String(tonight.shortForecast || '').trim();
                const short = fc.length > 42 ? fc.slice(0, 40) + '…' : fc;
                tipEl.textContent = 'Tonight: ' + short + ' · ' + tonight.temperature + '°';
              }
            }
          } catch (_) {}
        }
      }

      lastWeatherSnapshot = {
        temp: currentTemp,
        desc: currentDesc || 'Current conditions',
        emoji: weatherEmoji(currentDesc)
      };

      const emojiEl = el('rrWeatherEmoji');
      const tempEl = el('rrWeatherTemp');
      const descEl = el('rrWeatherDesc');
      const feelsEl = el('rrWeatherFeels');
      if (emojiEl) emojiEl.textContent = lastWeatherSnapshot.emoji;
      if (tempEl) tempEl.textContent = currentTemp != null ? currentTemp + '°F' : '—';
      if (descEl) descEl.textContent = currentDesc || 'Current conditions';
      if (feelsEl) {
        feelsEl.textContent =
          feelsLike != null && feelsLike !== currentTemp ? 'Feels like ' + feelsLike + '°F' : '';
      }

      renderHourly(periods);

      const upd = el('rrWeatherUpdated');
      if (upd) {
        upd.textContent =
          'Updated ' +
          new Date().toLocaleTimeString('en-US', {
            timeZone: TZ,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
      }

      /* Refresh emergency bottom strip with live temp */
      const ticker = el('rrTicker');
      if (ticker && ticker.classList.contains('rr-ticker--emergency')) {
        if (demoMode) applyDemoMode(demoMode);
        else if (feats.length) applyAlerts(feats);
      }
    } catch (e) {
      console.warn('[rrTicker] weather failed', e);
      const descEl = el('rrWeatherDesc');
      if (descEl) descEl.textContent = 'Weather unavailable';
      const hourly = el('rrHourlyRow');
      if (hourly) hourly.innerHTML = '<div class="rr-ticker__loading">—</div>';
    }
  }

  function renderHourly(periods) {
    const row = el('rrHourlyRow');
    if (!row) return;
    if (!periods || !periods.length) {
      row.innerHTML = '<div class="rr-ticker__loading">No hourly data</div>';
      return;
    }
    let html = '';
    periods.slice(0, 6).forEach(function (p, i) {
      const time = new Date(p.startTime);
      const timeStr = time.toLocaleTimeString('en-US', {
        timeZone: TZ,
        hour: 'numeric',
        hour12: true
      });
      html +=
        '<div class="rr-hourly__card' +
        (i === 0 ? ' rr-hourly__card--now' : '') +
        '">' +
        '<div class="rr-hourly__time">' +
        (i === 0 ? 'Now' : timeStr) +
        '</div>' +
        '<div class="rr-hourly__main">' +
        '<div class="rr-hourly__emoji">' +
        weatherEmoji(p.shortForecast) +
        '</div>' +
        '<div class="rr-hourly__temp">' +
        p.temperature +
        '°</div>' +
        '</div>' +
        '</div>';
    });
    row.innerHTML = html;
  }

  function init() {
    const place = el('rrClockPlace');
    if (place) place.textContent = CITY + ', ' + STATE;

    const demoMode = getDemoMode();
    updateSourceLabel(demoMode);
    if (demoMode) {
      applyDemoMode(demoMode);
    } else {
      setTickerMode('clear');
    }

    tickClock();
    setInterval(tickClock, 1000);

    loadWeather();
    setInterval(loadWeather, 10 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
