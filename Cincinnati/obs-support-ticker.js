/**
 * RoamRaven OBS support ticker — clock, NWS weather, rotating tips.
 */
(function () {
  'use strict';

  const TZ = (window.CITY_CONFIG && window.CITY_CONFIG.timezone) || 'America/New_York';
  const CITY =
    (window.CITY_CONFIG && window.CITY_CONFIG.cityName) || 'Cincinnati';
  const STATE = (window.CITY_CONFIG && window.CITY_CONFIG.state) || 'OH';

  const TIPS = [
    'Live buses & routes at roamravenapp.com/cincinnati',
    'Tap a route on the map for stops, times & alerts',
    'Greater Cincinnati · Northern Kentucky transit',
    'Weather data: National Weather Service',
    'Service alerts match the route on air'
  ];

  let tipIndex = 0;

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
      hour +
      ':' +
      minute +
      '<span class="rr-clock__sec">:' +
      second +
      '</span> ' +
      dayPeriod;

    dateEl.textContent = now.toLocaleDateString('en-US', {
      timeZone: TZ,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
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

      const alertEl = el('rrWeatherAlert');
      const feats = (alertsData && alertsData.features) || [];
      if (alertEl) {
        if (feats.length) {
          alertEl.className = 'rr-weather-alert rr-weather-alert--warn';
          const p = feats[0].properties || {};
          alertEl.textContent =
            '⚠ ' +
            (p.event || 'Weather alert') +
            (feats.length > 1 ? ' (+' + (feats.length - 1) + ' more)' : '');
        } else {
          alertEl.className = 'rr-weather-alert rr-weather-alert--ok';
          alertEl.textContent = 'No active weather alerts';
        }
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
                const short =
                  fc.length > 42 ? fc.slice(0, 40) + '…' : fc;
                tipEl.textContent =
                  'Tonight: ' + short + ' · ' + tonight.temperature + '°';
              }
            }
          } catch (_) {}
        }
      }

      const emojiEl = el('rrWeatherEmoji');
      const tempEl = el('rrWeatherTemp');
      const descEl = el('rrWeatherDesc');
      const feelsEl = el('rrWeatherFeels');
      if (emojiEl) emojiEl.textContent = weatherEmoji(currentDesc);
      if (tempEl) tempEl.textContent = currentTemp != null ? currentTemp + '°F' : '—';
      if (descEl) descEl.textContent = currentDesc || 'Current conditions';
      if (feelsEl) {
        feelsEl.textContent =
          feelsLike != null && feelsLike !== currentTemp
            ? 'Feels like ' + feelsLike + '°F'
            : '';
      }

      renderHourly(periods);

      const upd = el('rrWeatherUpdated');
      if (upd) {
        upd.textContent =
          'Weather updated ' +
          new Date().toLocaleTimeString('en-US', {
            timeZone: TZ,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
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
        '<div class="rr-hourly__emoji">' +
        weatherEmoji(p.shortForecast) +
        '</div>' +
        '<div class="rr-hourly__temp">' +
        p.temperature +
        '°</div>' +
        '</div>';
    });
    row.innerHTML = html;
  }

  function rotateTip() {
    const tipEl = el('rrTickerTip');
    if (!tipEl) return;
    tipEl.innerHTML = '<span>Tip ·</span> ' + TIPS[tipIndex % TIPS.length];
    tipIndex++;
  }

  function init() {
    const place = el('rrClockPlace');
    if (place) place.textContent = CITY + ', ' + STATE;

    tickClock();
    setInterval(tickClock, 1000);

    rotateTip();
    setInterval(rotateTip, 14000);

    loadWeather();
    setInterval(loadWeather, 10 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
