'use strict';

/**
 * api/market.js — Pakistan Market Data Endpoint
 * GET /api/market
 *
 * Live data via Yahoo Finance (no API key needed):
 *   - USD/PKR  → PKR=X
 *   - KSE-100  → ^KSE100
 *   - Gold     → GC=F (USD/troy-oz) → converted to PKR/tola
 *
 * Static / govt-set prices (OGRA/NEPRA notified rates, March 2026):
 *   - Petrol, Diesel, LPG, Electricity, Atta, Sugar, Rice, Chicken
 *
 * Returns structure expected by renderMarket() in public/js/app.js
 */

// ─── In-memory cache (15-min TTL) ────────────────────────────────────────────
let _cache   = null;
let _cacheTs = 0;
const CACHE_TTL = 15 * 60 * 1000;

// ─── Static prices — OGRA/NEPRA notified rates as of March 2026 ──────────────
// Petrol/Diesel: OGRA fortnightly revision (1st & 16th of month)
// Electricity: NEPRA average national tariff incl. FCA surcharges
// LPG: OGRA monthly notification
// Food: PBS/average open-market composite (Punjab/Sindh major cities)
const STATIC = {
  petrol:      279.75,   // PKR/litre  — OGRA March 2026
  diesel:      287.33,   // PKR/litre  — HSD, OGRA March 2026
  lpg:         247.50,   // PKR/kg     — OGRA March 2026
  electricity: 42.50,    // PKR/unit   — avg consumer tariff incl. FCA
  atta:        1050,     // PKR/10kg   — open market fine flour (Punjab avg)
  sugar:       135,      // PKR/kg     — retail composite
  rice:        270,      // PKR/kg     — Basmati 385 (Lahore/Karachi avg)
  chicken:     590,      // PKR/kg     — live weight, March 2026 avg
};

// ─── Yahoo Finance helper ─────────────────────────────────────────────────────
async function yahooFetch(symbol, timeoutMs = 7000) {
  const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res  = await fetch(url, {
      signal:  ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 brief.pk/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(tid);
  }
}

function parseQuote(json) {
  try {
    const meta  = json.chart.result[0].meta;
    const cur   = meta.regularMarketPrice;
    const prev  = meta.chartPreviousClose ?? meta.previousClose ?? cur;
    const chg   = prev ? ((cur - prev) / prev) * 100 : 0;
    return { val: cur, changePct: parseFloat(chg.toFixed(2)) };
  } catch {
    return null;
  }
}

// ─── Build market payload ─────────────────────────────────────────────────────
async function buildMarketData() {
  const [usdRes, kseRes, goldRes] = await Promise.allSettled([
    yahooFetch('PKR=X'),
    yahooFetch('%5EKSE100'),
    yahooFetch('GC=F'),
  ]);

  const usdQ  = usdRes.status  === 'fulfilled' ? parseQuote(usdRes.value)  : null;
  const kseQ  = kseRes.status  === 'fulfilled' ? parseQuote(kseRes.value)  : null;
  const goldQ = goldRes.status === 'fulfilled' ? parseQuote(goldRes.value) : null;

  // USD/PKR
  const usdVal    = usdQ  ? parseFloat(usdQ.val.toFixed(2))  : null;
  const usdChange = usdQ  ? usdQ.changePct                   : null;

  // KSE-100
  const kseVal    = kseQ  ? Math.round(kseQ.val)             : null;
  const kseChange = kseQ  ? kseQ.changePct                   : null;

  // Gold: GC=F is USD/troy-oz → convert to PKR/tola
  // 1 tola = 11.664 g  |  1 troy oz = 31.1035 g  →  ratio = 11.664/31.1035 ≈ 0.37499
  let goldVal = null;
  if (goldQ) {
    const pkrPerOz   = goldQ.val * (usdVal || 279.50);
    const pkrPerTola = pkrPerOz * (11.664 / 31.1035);
    goldVal          = Math.round(pkrPerTola);
  }

  return {
    usd:         { val: usdVal,              change: usdChange  },
    kse:         { val: kseVal,              change: kseChange  },
    gold:        { val: goldVal                                  },
    petrol:      { val: STATIC.petrol                           },
    diesel:      { val: STATIC.diesel                           },
    lpg:         { val: STATIC.lpg,          change: 0          },
    electricity: { val: STATIC.electricity,  change: 0          },
    atta:        { val: STATIC.atta,          change: 0          },
    sugar:       { val: STATIC.sugar,         change: 0          },
    rice:        { val: STATIC.rice,          change: 0          },
    chicken:     { val: STATIC.chicken,       change: 0          },
    _updated:    new Date().toISOString(),
  };
}

// ─── Cached getter ────────────────────────────────────────────────────────────
async function getMarketData() {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) return _cache;
  const data = await buildMarketData();
  _cache     = data;
  _cacheTs   = Date.now();
  return data;
}

// ─── Vercel / Express handler ─────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type',                'application/json; charset=utf-8');
  res.setHeader('Cache-Control',               's-maxage=300, stale-while-revalidate=60');

  try {
    const data = await getMarketData();
    return res.status(200).json(data);
  } catch (err) {
    console.error('[market] fatal error:', err.message);
    // Serve static-only fallback so the bar still shows something useful
    return res.status(200).json({
      usd:         { val: null,             change: null },
      kse:         { val: null,             change: null },
      gold:        { val: null                           },
      petrol:      { val: STATIC.petrol                 },
      diesel:      { val: STATIC.diesel                 },
      lpg:         { val: STATIC.lpg,       change: 0   },
      electricity: { val: STATIC.electricity,change: 0  },
      atta:        { val: STATIC.atta,       change: 0   },
      sugar:       { val: STATIC.sugar,      change: 0   },
      rice:        { val: STATIC.rice,       change: 0   },
      chicken:     { val: STATIC.chicken,    change: 0   },
      _error:      err.message,
      _updated:    new Date().toISOString(),
    });
  }
};
