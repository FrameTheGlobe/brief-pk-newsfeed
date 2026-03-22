// ── Server-side in-memory cache ──────────────────────────────────────────────
let _mapCache = null;
let _mapCacheTs = 0;
const MAP_CACHE_TTL = 10 * 60 * 1000; // 10 minutes (weather/AQI data)

const OPEN_METEO = {
  weather: 'https://api.open-meteo.com/v1/forecast',
  air: 'https://air-quality-api.open-meteo.com/v1/air-quality'
};

const OPEN_SKY = {
  states: 'https://opensky-network.org/api/states/all?lamin=23&lomin=60&lamax=37&lomax=78'
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CITIES = [
  { id: 'isb', name: 'Islamabad', lat: 33.6844, lon: 73.0479, x: 61, y: 28 },
  { id: 'lhr', name: 'Lahore', lat: 31.5204, lon: 74.3587, x: 70, y: 40 },
  { id: 'khi', name: 'Karachi', lat: 24.8607, lon: 67.0011, x: 37, y: 83 },
  { id: 'psh', name: 'Peshawar', lat: 34.0151, lon: 71.5249, x: 48, y: 27 },
  { id: 'qta', name: 'Quetta', lat: 30.1798, lon: 66.975, x: 28, y: 49 },
  { id: 'mtn', name: 'Multan', lat: 30.1575, lon: 71.5249, x: 52, y: 52 },
  { id: 'fbd', name: 'Faisalabad', lat: 31.4504, lon: 73.135, x: 60, y: 44 },
  { id: 'hyd', name: 'Hyderabad', lat: 25.396, lon: 68.3578, x: 44, y: 74 }
];

const AIRPORT_CORRIDORS = [
  { code: 'KHI', name: 'Karachi', lat: 24.9065, lon: 67.1608 },
  { code: 'LHE', name: 'Lahore', lat: 31.5216, lon: 74.4036 },
  { code: 'ISB', name: 'Islamabad', lat: 33.549, lon: 72.826 }
];

const WEATHER_CODE_SEVERE = new Set([95, 96, 99]);
const WEATHER_CODE_ALERT = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 80, 81, 82]);

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': UA,
        accept: 'application/json'
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function weatherUrl(city) {
  return `${OPEN_METEO.weather}?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,precipitation_sum&forecast_days=1&timezone=Asia%2FKarachi`;
}

function airUrl(city) {
  return `${OPEN_METEO.air}?latitude=${city.lat}&longitude=${city.lon}&current=us_aqi,pm2_5,pm10&timezone=Asia%2FKarachi`;
}

function toFlightRecord(stateRow) {
  if (!Array.isArray(stateRow)) return null;
  const lon = Number(stateRow[5]);
  const lat = Number(stateRow[6]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return {
    icao24: stateRow[0] || null,
    callsign: String(stateRow[1] || '').trim() || null,
    country: stateRow[2] || null,
    longitude: lon,
    latitude: lat,
    onGround: Boolean(stateRow[8]),
    velocityMs: Number.isFinite(Number(stateRow[9])) ? Number(stateRow[9]) : null,
    headingDeg: Number.isFinite(Number(stateRow[10])) ? Number(stateRow[10]) : null,
    verticalRate: Number.isFinite(Number(stateRow[11])) ? Number(stateRow[11]) : null,
    geoAltitudeM: Number.isFinite(Number(stateRow[13])) ? Number(stateRow[13]) : null
  };
}

function nearestCityIndex(lat, lon, cities) {
  let idx = -1;
  let best = Infinity;
  for (let i = 0; i < cities.length; i += 1) {
    const dLat = lat - cities[i].lat;
    const dLon = lon - cities[i].lon;
    const distSq = dLat * dLat + dLon * dLon;
    if (distSq < best) {
      best = distSq;
      idx = i;
    }
  }
  return idx;
}

function distanceSq(lat1, lon1, lat2, lon2) {
  const dLat = lat1 - lat2;
  const dLon = lon1 - lon2;
  return dLat * dLat + dLon * dLon;
}

function parseWeatherRisk(current = {}) {
  const temp = Number(current.temperature_2m);
  const wind = Number(current.wind_speed_10m);
  const code = Number(current.weather_code);

  let score = 0;
  if (Number.isFinite(temp)) {
    if (temp >= 42) score += 55;
    else if (temp >= 36) score += 30;
    else if (temp <= 2) score += 28;
  }

  if (Number.isFinite(wind)) {
    if (wind >= 45) score += 35;
    else if (wind >= 28) score += 20;
  }

  if (WEATHER_CODE_SEVERE.has(code)) score += 35;
  else if (WEATHER_CODE_ALERT.has(code)) score += 18;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const level = score >= 70 ? 'critical' : score >= 45 ? 'elevated' : score >= 20 ? 'watch' : 'normal';

  return {
    score,
    level,
    temperatureC: Number.isFinite(temp) ? temp : null,
    windKph: Number.isFinite(wind) ? wind : null,
    weatherCode: Number.isFinite(code) ? code : null
  };
}

function parseAgriRisk(current = {}, daily = {}) {
  const tempNow = Number(current.temperature_2m);
  const tempMax = Number(daily.temperature_2m_max?.[0]);
  const rain = Number(daily.precipitation_sum?.[0]);

  let score = 0;

  if (Number.isFinite(tempMax)) {
    if (tempMax >= 44) score += 60;
    else if (tempMax >= 39) score += 38;
    else if (tempMax >= 35) score += 22;
  } else if (Number.isFinite(tempNow)) {
    if (tempNow >= 42) score += 55;
    else if (tempNow >= 36) score += 30;
  }

  if (Number.isFinite(rain)) {
    if (rain < 1) score += 32;
    else if (rain < 3) score += 20;
    else if (rain < 8) score += 8;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 70 ? 'critical' : score >= 45 ? 'elevated' : score >= 20 ? 'watch' : 'normal';

  return {
    score,
    level,
    tempMaxC: Number.isFinite(tempMax) ? tempMax : null,
    precipitationMm: Number.isFinite(rain) ? rain : null
  };
}

function parseAqiRisk(current = {}) {
  const aqi = Number(current.us_aqi);
  const pm25 = Number(current.pm2_5);
  const pm10 = Number(current.pm10);

  if (!Number.isFinite(aqi)) {
    return {
      score: 0,
      level: 'unknown',
      usAqi: null,
      pm25: Number.isFinite(pm25) ? pm25 : null,
      pm10: Number.isFinite(pm10) ? pm10 : null
    };
  }

  const score = Math.max(0, Math.min(100, Math.round((aqi / 300) * 100)));
  const level = aqi >= 200 ? 'hazardous' : aqi >= 151 ? 'very_unhealthy' : aqi >= 101 ? 'unhealthy' : aqi >= 51 ? 'moderate' : 'good';

  return {
    score,
    level,
    usAqi: aqi,
    pm25: Number.isFinite(pm25) ? pm25 : null,
    pm10: Number.isFinite(pm10) ? pm10 : null
  };
}

function hotspot(points, key, topN = 3) {
  return [...points]
    .filter((p) => Number.isFinite(p?.[key]?.score))
    .sort((a, b) => b[key].score - a[key].score)
    .slice(0, topN)
    .map((p) => ({
      city: p.name,
      score: p[key].score,
      level: p[key].level
    }));
}

function toLevel(score) {
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= 70) return 'critical';
  if (score >= 45) return 'elevated';
  if (score >= 20) return 'watch';
  return 'normal';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');

  const force = req.query?.force === '1';
  if (!force && _mapCache && Date.now() - _mapCacheTs < MAP_CACHE_TTL) {
    return res.status(200).json({ ..._mapCache, cached: true });
  }

  try {
    const [cityReads, flightsRes] = await Promise.all([
      Promise.all(
      CITIES.map(async (city) => {
        const [weatherRes, airRes] = await Promise.allSettled([
          fetchJson(weatherUrl(city)),
          fetchJson(airUrl(city))
        ]);

        const weatherCurrent = weatherRes.status === 'fulfilled' ? weatherRes.value?.current || {} : {};
        const weatherDaily = weatherRes.status === 'fulfilled' ? weatherRes.value?.daily || {} : {};
        const airCurrent = airRes.status === 'fulfilled' ? airRes.value?.current || {} : {};

        return {
          id: city.id,
          name: city.name,
          x: city.x,
          y: city.y,
          weather: parseWeatherRisk(weatherCurrent),
          agri: parseAgriRisk(weatherCurrent, weatherDaily),
          aqi: parseAqiRisk(airCurrent),
          observedAt: weatherCurrent.time || airCurrent.time || null
        };
      })
      ),
      fetchJson(OPEN_SKY.states).catch(() => null)
    ]);

    const flightsRaw = Array.isArray(flightsRes?.states)
      ? flightsRes.states.map(toFlightRecord).filter(Boolean)
      : [];

    const flightsAirborne = flightsRaw.filter((f) => !f.onGround).length;
    const flightsOnGround = flightsRaw.filter((f) => f.onGround).length;

    const approachCandidates = flightsRaw.filter((f) => {
      if (f.onGround) return false;
      if (!Number.isFinite(f.verticalRate) || !Number.isFinite(f.geoAltitudeM)) return false;
      return f.verticalRate <= -1.5 && f.geoAltitudeM <= 4500;
    });

    const corridorRadiusSq = 1.1 * 1.1;
    const corridorCounts = {
      KHI: 0,
      LHE: 0,
      ISB: 0
    };
    for (const flight of flightsRaw) {
      for (const airport of AIRPORT_CORRIDORS) {
        if (distanceSq(flight.latitude, flight.longitude, airport.lat, airport.lon) <= corridorRadiusSq) {
          corridorCounts[airport.code] += 1;
        }
      }
    }
    const cityFlightCounts = CITIES.map(() => 0);

    for (const flight of flightsRaw) {
      const idx = nearestCityIndex(flight.latitude, flight.longitude, CITIES);
      if (idx >= 0) cityFlightCounts[idx] += 1;
    }

    const maxCityFlights = Math.max(1, ...cityFlightCounts);
    const flightsAvg = cityFlightCounts.length
      ? Math.round(cityFlightCounts.reduce((acc, v) => acc + v, 0) / cityFlightCounts.length)
      : 0;

    const pointsWithFlights = cityReads.map((point, idx) => {
      const count = cityFlightCounts[idx] || 0;
      const score = Math.round((count / maxCityFlights) * 100);
      return {
        ...point,
        flights: {
          count,
          score,
          level: toLevel(score)
        }
      };
    });

    const observedTimes = pointsWithFlights
      .map((p) => new Date(p.observedAt || '').getTime())
      .filter((v) => Number.isFinite(v));
    const observedAtLatest = observedTimes.length
      ? new Date(Math.max(...observedTimes)).toISOString()
      : null;

    const weatherAvg = pointsWithFlights.length
      ? Math.round(pointsWithFlights.reduce((acc, c) => acc + (c.weather.score || 0), 0) / pointsWithFlights.length)
      : 0;
    const aqiAvg = pointsWithFlights.length
      ? Math.round(pointsWithFlights.reduce((acc, c) => acc + (c.aqi.score || 0), 0) / pointsWithFlights.length)
      : 0;
    const agriAvg = pointsWithFlights.length
      ? Math.round(pointsWithFlights.reduce((acc, c) => acc + (c.agri.score || 0), 0) / pointsWithFlights.length)
      : 0;

    const mapPayload = {
      updatedAt: new Date().toISOString(),
      meta: {
        observedAtLatest,
        sources: {
          weather: 'open_meteo_forecast',
          aqi: 'open_meteo_air_quality',
          agri: 'open_meteo_daily',
          flights: 'opensky_states_all'
        }
      },
      summary: {
        weatherAverage: weatherAvg,
        agriAverage: agriAvg,
        aqiAverage: aqiAvg,
        flightsAverage: flightsAvg,
        weatherHotspots: hotspot(pointsWithFlights, 'weather', 3),
        agriHotspots: hotspot(pointsWithFlights, 'agri', 3),
        aqiHotspots: hotspot(pointsWithFlights, 'aqi', 3),
        flightsHotspots: hotspot(pointsWithFlights, 'flights', 3),
        flightsInAirspace: flightsRaw.length,
        flightsAirborne,
        flightsOnGround,
        flightsApproachPressure: approachCandidates.length,
        flightsCorridors: corridorCounts
      },
      points: pointsWithFlights
    };

    _mapCache = mapPayload;
    _mapCacheTs = Date.now();
    res.status(200).json(mapPayload);
  } catch (err) {
    if (_mapCache) return res.status(200).json({ ..._mapCache, stale: true });
    res.status(500).json({
      updatedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'pakistan_map_fetch_failed',
      points: []
    });
  }
};
