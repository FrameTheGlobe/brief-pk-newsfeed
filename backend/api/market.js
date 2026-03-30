// ── Server-side in-memory cache ──────────────────────────────────────────────
let _marketCache = null;
let _marketCacheTs = 0;
const MARKET_CACHE_TTL = 90 * 1000; // ~1.5 minutes — PSX session moves during the day

const MARKET_ENDPOINTS = {
  usdPkr: 'https://open.er-api.com/v6/latest/USD',
  /** No-key fallback (Fawaz loosely-curated daily FX matrix) if ER-API is slow or blocked */
  usdPkrFallback: 'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
  stooqBase: 'https://stooq.com/q/l/',
  fredBrent: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU',
  // query2 bypasses the Vercel IP block that query1 enforces
  yahooChartBase: 'https://query2.finance.yahoo.com/v8/finance/chart',
  yahooSpark: 'https://query2.finance.yahoo.com/v7/finance/spark',
  yahooKse: 'https://query2.finance.yahoo.com/v8/finance/chart/%5EKSE?interval=1d&range=5d',
  /** PSX removed JSON /api/indices (404); indices page is server-rendered with live data-order cells */
  psxIndicesPage: 'https://dps.psx.com.pk/indices',
  psxPerformers: 'https://dps.psx.com.pk/performers',
  psxAnnouncements: 'https://dps.psx.com.pk/announcements'
};

const YAHOO_COMMODITY_SYMBOLS = {
  brent: 'BZ=F',
  gasHenryHub: 'NG=F',
  gold: 'GC=F',
  gasoline: 'RB=F'
};

const STOOQ_SYMBOLS = {
  brent: 'cb.f',       // ICE Brent Crude (was cl.f = WTI — wrong benchmark)
  gasHenryHub: 'ng.f',
  gold: 'xauusd',
  gasoline: 'rb.f'
};

/** Extra Yahoo chart symbols for the expanded market snapshot (no API keys). */
const SNAPSHOT_CHARTS = [
  { key: 'silver', symbol: 'SI=F', label: 'Silver', prefix: '$', suffix: '/oz' },
  { key: 'wti', symbol: 'CL=F', label: 'WTI crude', prefix: '$', suffix: '/bbl' },
  { key: 'platinum', symbol: 'PL=F', label: 'Platinum', prefix: '$', suffix: '/oz' },
  { key: 'palladium', symbol: 'PA=F', label: 'Palladium', prefix: '$', suffix: '/oz' },
  { key: 'copper', symbol: 'HG=F', label: 'Copper', prefix: '$', suffix: '/lb' },
  { key: 'corn', symbol: 'ZC=F', label: 'Corn', prefix: '', suffix: '¢/bu' },
  { key: 'wheat', symbol: 'ZW=F', label: 'Wheat', prefix: '', suffix: '¢/bu' },
  { key: 'btc', symbol: 'BTC-USD', label: 'Bitcoin', prefix: '$', suffix: '' },
  { key: 'eth', symbol: 'ETH-USD', label: 'Ethereum', prefix: '$', suffix: '' },
  { key: 'eurUsd', symbol: 'EURUSD=X', label: 'EUR/USD', prefix: '', suffix: '' }
];

/**
 * Order-of-magnitude Pakistan energy context (annual / survey figures — not live prices).
 * Numbers are rounded public-estimate bands; always read against MOE / OGRA / company filings.
 */
const PAKISTAN_ENERGY_REFERENCE = [
  { label: 'Proven oil (band)', value: '~0.3–0.6 Bbbl', hint: 'International survey ballparks; domestic fields vary year to year' },
  { label: 'Proven gas (band)', value: '~20+ Tcf', hint: 'Order of magnitude — Sui / tight gas / new discoveries move totals' },
  { label: 'Refining nameplate', value: '~400 kb/d', hint: 'Aggregated capacity; utilisation & crude slate drive product supply' },
  { label: 'LNG / products', value: 'Import-led', hint: 'Brent + JKM / freight set power & industrial gas cost pressure' }
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchJson(url, timeoutMs = 7000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA, 'accept': 'application/json', 'x-requested-with': 'XMLHttpRequest', ...extraHeaders }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYahooJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA, 'accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs = 7000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA, 'x-requested-with': 'XMLHttpRequest', 'accept': 'text/html,application/xhtml+xml,*/*', ...extraHeaders }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPostForm(url, bodyObj, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const params = new URLSearchParams();
    for (const k in bodyObj) params.append(k, bodyObj[k]);
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest' },
      body: params
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseStooqCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return {};
  const rows = lines.slice(1).map((line) => {
    const [symbol, date, time, open, high, low, close] = line.split(',');
    return {
      symbol: (symbol || '').toLowerCase(),
      date, time,
      open: Number(open), high: Number(high), low: Number(low), close: Number(close)
    };
  });
  const map = Object.create(null);
  for (const row of rows) {
    if (!row.symbol) continue;
    map[row.symbol] = row;
  }

  const rowIso = (row) => {
    if (!row?.date) return null;
    const candidate = row.time ? `${row.date}T${row.time}Z` : `${row.date}T00:00:00Z`;
    const parsed = new Date(candidate);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };

  return {
    brent: map['cl.f']?.close ?? null,
    brentAsOf: rowIso(map['cl.f']),
    gasHenryHub: map['ng.f']?.close ?? null,
    gasHenryHubAsOf: rowIso(map['ng.f']),
    gold: map['xauusd']?.close ?? null,
    goldAsOf: rowIso(map['xauusd']),
    gasoline: map['rb.f']?.close ?? null,
    gasolineAsOf: rowIso(map['rb.f'])
  };
}

function parseFredLatest(csvText) {
  const lines = String(csvText || '').trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  for (let i = lines.length - 1; i >= 1; i -= 1) {
    const [date, valueRaw] = lines[i].split(',');
    const value = Number(valueRaw);
    if (!Number.isFinite(value)) continue;

    const asOfCandidate = new Date(`${date}T00:00:00Z`);
    return {
      value,
      asOf: Number.isNaN(asOfCandidate.getTime()) ? null : asOfCandidate.toISOString()
    };
  }

  return null;
}

function stooqQuoteUrl(symbol) {
  return `${MARKET_ENDPOINTS.stooqBase}?s=${encodeURIComponent(symbol)}&i=d`;
}

function parseStooqQuote(csvText) {
  const lines = String(csvText || '').trim().split(/\r?\n/);
  // Scan backward for the most recent valid data row; skip header if present
  for (let i = lines.length - 1; i >= 0; i--) {
    const parts = lines[i].split(',');
    if (parts.length < 7) continue;
    const [symbol, date, time, , , , close] = parts;
    if (!symbol || symbol.toLowerCase() === 'symbol') continue; // skip header
    const value = Number(close);
    if (!date || !Number.isFinite(value) || value <= 0) continue;
    const candidate = time ? `${date}T${time}Z` : `${date}T00:00:00Z`;
    const parsed = new Date(candidate);
    return {
      value,
      asOf: Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
    };
  }
  return null;
}

function yahooChartUrl(symbol, interval = '5m', range = '1d') {
  return `${MARKET_ENDPOINTS.yahooChartBase}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
}

function yahooSparkUrl(symbols, interval = '5m', range = '1d') {
  return `${MARKET_ENDPOINTS.yahooSpark}?symbols=${encodeURIComponent(symbols.join(','))}&range=${range}&interval=${interval}&indicators=close`;
}

function parseYahooCommodity(data) {
  const chart = data?.chart?.result?.[0];
  if (!chart) return null;

  const closes = chart.indicators?.quote?.[0]?.close || [];
  const ts = chart.timestamp || chart.timestamps || [];
  if (!closes.length || !ts.length) return null;

  let lastIdx = -1;
  for (let i = closes.length - 1; i >= 0; i -= 1) {
    if (typeof closes[i] === 'number' && Number.isFinite(closes[i])) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx === -1) return null;

  let prevIdx = -1;
  for (let i = lastIdx - 1; i >= 0; i -= 1) {
    if (typeof closes[i] === 'number' && Number.isFinite(closes[i])) {
      prevIdx = i;
      break;
    }
  }

  const value = closes[lastIdx];
  const previous = prevIdx >= 0 ? closes[prevIdx] : value;
  const asOfMs = Number(ts[lastIdx]) * 1000;
  const asOf = Number.isFinite(asOfMs) ? new Date(asOfMs).toISOString() : null;

  return {
    value,
    change: value - previous,
    changePct: previous ? ((value - previous) / previous) * 100 : 0,
    asOf
  };
}

function parseYahooSpark(data) {
  const results = data?.spark?.result;
  if (!Array.isArray(results)) return {};

  const out = {};
  for (const row of results) {
    const symbol = row?.symbol;
    const payload = row?.response?.[0];
    if (!symbol || !payload) continue;

    const closes = payload.close || payload.indicators?.quote?.[0]?.close || [];
    const ts = payload.timestamp || [];
    if (!closes.length || !ts.length) continue;

    let lastIdx = -1;
    for (let i = closes.length - 1; i >= 0; i -= 1) {
      if (typeof closes[i] === 'number' && Number.isFinite(closes[i])) {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx === -1) continue;

    let prevIdx = -1;
    for (let i = lastIdx - 1; i >= 0; i -= 1) {
      if (typeof closes[i] === 'number' && Number.isFinite(closes[i])) {
        prevIdx = i;
        break;
      }
    }

    const value = closes[lastIdx];
    const previous = prevIdx >= 0 ? closes[prevIdx] : value;
    const asOfMs = Number(ts[lastIdx]) * 1000;
    const asOf = Number.isFinite(asOfMs) ? new Date(asOfMs).toISOString() : null;

    out[symbol] = {
      value,
      change: value - previous,
      changePct: previous ? ((value - previous) / previous) * 100 : 0,
      asOf
    };
  }

  return out;
}

function parseYahooKse(data) {
  const chart = data?.chart?.result?.[0];
  if (!chart) return null;
  const closes = chart.indicators?.quote?.[0]?.close || [];
  const valid = closes.filter(v => typeof v === 'number');
  if (!valid.length) return null;
  const current = valid[valid.length - 1];
  const prev = valid.length > 1 ? valid[valid.length - 2] : current;
  return {
    value: current,
    change: current - prev,
    changePct: prev ? ((current - prev) / prev) * 100 : 0
  };
}

function parseIndices(indices) {
  if (!Array.isArray(indices)) return null;
  const findIndex = (name) => {
    const d = indices.find(i => i.index === name);
    if (!d) return null;
    return {
      value: parseFloat(d.current),
      change: parseFloat(d.change),
      changePct: parseFloat(d.percentage)
    };
  };
  return {
    kse100: findIndex('KSE100'),
    kse30: findIndex('KSE30'),
    allshr: findIndex('ALLSHR')
  };
}

/**
 * PSX DPS "Market Indices" HTML: each row has data-code="KSE100" etc. and
 * numeric cells use data-order="…" (high, low, current, change, % change).
 */
function parsePsxIndicesFromHtml(html) {
  if (!html || typeof html !== 'string' || html.length < 500) return null;
  const tbMatch = html.match(/id="indicesTable"[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbMatch) return null;
  const tbody = tbMatch[1];
  const byCode = Object.create(null);
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tm;
  while ((tm = trRe.exec(tbody)) !== null) {
    const tr = tm[1];
    const dc = tr.match(/data-code="([^"]+)"/i);
    if (!dc) continue;
    const orders = [...tr.matchAll(/<td class="right"[^>]*data-order="([^"]+)"/gi)].map((m) => parseFloat(m[1]));
    if (orders.length < 5) continue;
    const [, , current, change, changePct] = orders;
    if (!Number.isFinite(current)) continue;
    byCode[dc[1].toUpperCase()] = {
      value: current,
      change: Number.isFinite(change) ? change : 0,
      changePct: Number.isFinite(changePct) ? changePct : 0
    };
  }
  const pick = (code) => {
    const row = byCode[code];
    if (!row || !Number.isFinite(row.value)) return null;
    return { value: row.value, change: row.change, changePct: row.changePct };
  };
  const out = {
    kse100: pick('KSE100'),
    kse30: pick('KSE30'),
    allshr: pick('ALLSHR')
  };
  return out.kse100 || out.kse30 || out.allshr ? out : null;
}

function resolveUsdPkr(fxErRes, fxFallbackRes) {
  if (fxErRes?.status === 'fulfilled' && fxErRes.value?.rates?.PKR != null) {
    const v = Number(fxErRes.value.rates.PKR);
    if (Number.isFinite(v) && v > 0) return v;
  }
  if (fxFallbackRes?.status === 'fulfilled' && fxFallbackRes.value?.usd?.pkr != null) {
    const v = Number(fxFallbackRes.value.usd.pkr);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 278.99;
}

function parsePerformers(html) {
  if (!html || html.length < 100) return null;

  /** PSX DPS 2025+ layout: h3 headings + tbl / <strong> symbols + change cell with (pct%) */
  const extractRowsModern = (tbodyInner) => {
    if (!tbodyInner) return [];
    const rows = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let tm;
    while ((tm = trRe.exec(tbodyInner)) !== null && rows.length < 12) {
      const tr = tm[1];
      const symMatch = tr.match(/<strong>([^<]+)<\/strong>/i);
      if (!symMatch) continue;
      const tdMatches = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      if (tdMatches.length < 3) continue;
      const priceText = tdMatches[1][1].replace(/<[^>]+>/g, '').replace(/,/g, '').trim();
      const price = parseFloat(priceText);
      const changePlain = tdMatches[2][1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const pctM = changePlain.match(/\(\s*(-?[\d.]+)\s*%\s*\)/);
      const changePct = pctM ? parseFloat(pctM[1]) : NaN;
      const leadM = changePlain.match(/(-?[\d,]+(?:\.\d+)?)\s*\(/);
      const change = leadM ? parseFloat(leadM[1].replace(/,/g, '')) : NaN;
      rows.push({
        symbol: symMatch[1].trim(),
        price: Number.isFinite(price) ? price : null,
        change: Number.isFinite(change) ? change : null,
        changePct: Number.isFinite(changePct) ? changePct : null
      });
    }
    return rows;
  };

  const tbodyAfterHeading = (needle) => {
    const i = html.toUpperCase().indexOf(needle.toUpperCase());
    if (i < 0) return null;
    const slice = html.slice(i);
    const m = slice.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    return m ? m[1] : null;
  };

  let gainers = extractRowsModern(tbodyAfterHeading('TOP ADVANCERS'));
  let losers = extractRowsModern(tbodyAfterHeading('TOP DECLINERS'));
  let active = extractRowsModern(tbodyAfterHeading('TOP ACTIVE STOCKS'));

  if (!gainers.length && !losers.length && !active.length) {
    const extractRowsLegacy = (segment) => {
      if (!segment) return [];
      const rows = [];
      const re = /<tr>\s*<td>(?:<a[^>]*>)?([^<]+)(?:<\/a>)?<\/td>\s*<td>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)%?<\/td>/gi;
      let m;
      while ((m = re.exec(segment)) !== null && rows.length < 10) {
        rows.push({
          symbol: m[1].trim(),
          price: parseFloat(m[2].replace(/,/g, '')),
          change: parseFloat(m[3]),
          changePct: parseFloat(m[4])
        });
      }
      return rows;
    };
    const adv = html.match(/id="advancers"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
    const dec = html.match(/id="decliners"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
    const act = html.match(/id="active"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
    if (adv) gainers = extractRowsLegacy(adv[1]);
    if (dec) losers = extractRowsLegacy(dec[1]);
    if (act) active = extractRowsLegacy(act[1]);
  }

  return { gainers, losers, active };
}

function parseAnnouncements(html) {
  if (!html) return null;
  // Match Date, Time, Symbol, Company, Subject
  const re = /<tr>\s*<td>[^<]+<\/td>\s*<td>([^<]+)<\/td>\s*<td><a[^>]*><strong>([^<]+)<\/strong><\/a><\/td>\s*<td><a[^>]*><strong>([^<]+)<\/strong><\/a><\/td>\s*<td>([\s\S]*?)<\/td>/gi;
  const announcements = [];
  let m;
  while ((m = re.exec(html)) !== null && announcements.length < 15) {
    const symbol = m[2].trim();
    let subject = m[4].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    // PSX often repeats the ticker at the start of the subject line
    const dup = new RegExp(`^${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–—:\\s]+`, 'i');
    subject = subject.replace(dup, '').trim();
    announcements.push({
      time: m[1].trim(),
      symbol,
      company: m[3].trim(),
      subject
    });
  }
  return announcements.length > 0 ? announcements : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=30');

  const force = req.query?.force === '1';
  if (!force && _marketCache && Date.now() - _marketCacheTs < MARKET_CACHE_TTL) {
    return res.status(200).json({ ..._marketCache, cached: true });
  }

  try {
    const PSX_HEADERS = {
      'referer': 'https://dps.psx.com.pk/',
      'origin': 'https://dps.psx.com.pk',
      'accept': 'application/json, text/html, */*'
    };

    const SNAPSHOT_BASE_LEN = 16;
    const settledAll = await Promise.allSettled([
      fetchJson(MARKET_ENDPOINTS.usdPkr),
      fetchJson(MARKET_ENDPOINTS.usdPkrFallback),
      fetchText(stooqQuoteUrl(STOOQ_SYMBOLS.brent)),
      fetchText(stooqQuoteUrl(STOOQ_SYMBOLS.gasHenryHub)),
      fetchText(stooqQuoteUrl(STOOQ_SYMBOLS.gold)),
      fetchText(stooqQuoteUrl(STOOQ_SYMBOLS.gasoline)),
      fetchText(MARKET_ENDPOINTS.fredBrent),
      fetchText(MARKET_ENDPOINTS.psxIndicesPage, 7000, PSX_HEADERS),
      fetchText(MARKET_ENDPOINTS.psxPerformers),
      fetchYahooJson(MARKET_ENDPOINTS.yahooKse),
      fetchPostForm(MARKET_ENDPOINTS.psxAnnouncements, { type: 'C', symbol: '', count: 20, offset: 0, page: 'annc' }),
      fetchYahooJson(`${MARKET_ENDPOINTS.yahooChartBase}/BZ=F?interval=1d&range=5d`),
      fetchYahooJson(`${MARKET_ENDPOINTS.yahooChartBase}/NG=F?interval=1d&range=5d`),
      fetchYahooJson(`${MARKET_ENDPOINTS.yahooChartBase}/GC=F?interval=1d&range=5d`),
      fetchYahooJson(`${MARKET_ENDPOINTS.yahooChartBase}/RB=F?interval=1d&range=5d`),
      fetchYahooJson(yahooSparkUrl(Object.values(YAHOO_COMMODITY_SYMBOLS))),
      ...SNAPSHOT_CHARTS.map(({ symbol }) =>
        fetchYahooJson(`${MARKET_ENDPOINTS.yahooChartBase}/${encodeURIComponent(symbol)}?interval=1d&range=5d`)
      )
    ]);

    const [
      fxRes,
      fxFallbackRes,
      stooqBrentRes,
      stooqGasRes,
      stooqGoldRes,
      stooqGasolineRes,
      fredBrentRes,
      psxIndRes,
      psxPerfRes,
      yahooKseRes,
      psxAnncRes,
      yahooBrentRes,
      yahooGasRes,
      yahooGoldRes,
      yahooGasolineRes,
      yahooCommoditySparkRes
    ] = settledAll;

    const snapshotChartResults = settledAll.slice(SNAPSHOT_BASE_LEN);

    const usdPkr = resolveUsdPkr(fxRes, fxFallbackRes);

    // Equities: PSX official indices page (HTML), Yahoo ^KSE chart fallback for KSE-100 only
    let equities = { kse100: null, kse30: null, allshr: null };
    if (psxIndRes.status === 'fulfilled' && psxIndRes.value) {
      const fromHtml = parsePsxIndicesFromHtml(psxIndRes.value);
      if (fromHtml) equities = fromHtml;
      else {
        try {
          const asJson = JSON.parse(psxIndRes.value);
          const psxData = parseIndices(Array.isArray(asJson) ? asJson : null);
          if (psxData) equities = psxData;
        } catch (_) { /* page is HTML */ }
      }
    }
    if (!equities.kse100 && yahooKseRes.status === 'fulfilled') {
      const yData = parseYahooKse(yahooKseRes.value);
      if (yData) equities.kse100 = yData;
    }

    const readStooq = (result) => {
      if (result.status !== 'fulfilled' || !result.value) return { value: null, asOf: null };
      return parseStooqQuote(result.value) || { value: null, asOf: null };
    };
    const stooqBrent = readStooq(stooqBrentRes);
    const stooqGas = readStooq(stooqGasRes);
    const stooqGold = readStooq(stooqGoldRes);
    const stooqGasoline = readStooq(stooqGasolineRes);
    const stooq = {
      brent: stooqBrent.value,
      brentAsOf: stooqBrent.asOf,
      gasHenryHub: stooqGas.value,
      gasHenryHubAsOf: stooqGas.asOf,
      gold: stooqGold.value,
      goldAsOf: stooqGold.asOf,
      gasoline: stooqGasoline.value,
      gasolineAsOf: stooqGasoline.asOf
    };

    // FRED only used if both Yahoo and Stooq fail for Brent, and only if data is recent
    const fredBrentRaw = fredBrentRes.status === 'fulfilled' && fredBrentRes.value
      ? parseFredLatest(fredBrentRes.value)
      : null;
    // Discard FRED data older than 7 days to avoid serving stale fallback as "current"
    const fredBrent = fredBrentRaw && fredBrentRaw.asOf
      && (Date.now() - new Date(fredBrentRaw.asOf).getTime()) < 7 * 24 * 60 * 60 * 1000
      ? fredBrentRaw
      : null;

    // Individual Yahoo chart fetches (query2) — primary live source
    const readYahooChart = (result) => result.status === 'fulfilled' ? parseYahooCommodity(result.value) : null;
    const yahooChartBrent    = readYahooChart(yahooBrentRes);
    const yahooChartGas      = readYahooChart(yahooGasRes);
    const yahooChartGold     = readYahooChart(yahooGoldRes);
    const yahooChartGasoline = readYahooChart(yahooGasolineRes);

    // Spark as secondary Yahoo source
    const sparkCommodities = yahooCommoditySparkRes.status === 'fulfilled'
      ? parseYahooSpark(yahooCommoditySparkRes.value)
      : {};
    const sparkBrent    = sparkCommodities[YAHOO_COMMODITY_SYMBOLS.brent] || null;
    const sparkGas      = sparkCommodities[YAHOO_COMMODITY_SYMBOLS.gasHenryHub] || null;
    const sparkGold     = sparkCommodities[YAHOO_COMMODITY_SYMBOLS.gold] || null;
    const sparkGasoline = sparkCommodities[YAHOO_COMMODITY_SYMBOLS.gasoline] || null;

    // Priority: Yahoo chart (query2) → Yahoo spark → Stooq daily → FRED (Brent only, recent only)
    const resolveCommodity = (yahooChart, yahooSpark, stooqVal, stooqAsOf, fredFallback = null) => {
      if (yahooChart) {
        return {
          value: yahooChart.value,
          changePct: Number.isFinite(yahooChart.changePct) ? yahooChart.changePct : null,
          asOf: yahooChart.asOf,
          source: 'yahoo_chart'
        };
      }
      if (yahooSpark) {
        return {
          value: yahooSpark.value,
          changePct: Number.isFinite(yahooSpark.changePct) ? yahooSpark.changePct : null,
          asOf: yahooSpark.asOf,
          source: 'yahoo_spark'
        };
      }
      if (Number.isFinite(stooqVal)) return { value: stooqVal, changePct: null, asOf: stooqAsOf, source: 'stooq_daily' };
      if (fredFallback && Number.isFinite(fredFallback.value)) {
        return { value: fredFallback.value, changePct: null, asOf: fredFallback.asOf, source: 'fred_daily' };
      }
      return { value: null, changePct: null, asOf: null, source: 'unavailable' };
    };

    const brent   = resolveCommodity(yahooChartBrent,    sparkBrent,    stooq.brent,       stooq.brentAsOf,       fredBrent);
    const natGas  = resolveCommodity(yahooChartGas,      sparkGas,      stooq.gasHenryHub, stooq.gasHenryHubAsOf);
    const gold    = resolveCommodity(yahooChartGold,     sparkGold,     stooq.gold,        stooq.goldAsOf);
    const gasoline = resolveCommodity(yahooChartGasoline, sparkGasoline, stooq.gasoline,    stooq.gasolineAsOf);

    const commodityAsOfCandidates = [brent.asOf, natGas.asOf, gold.asOf, gasoline.asOf]
      .filter(Boolean)
      .map((iso) => new Date(iso).getTime())
      .filter((v) => Number.isFinite(v));
    const commoditiesAsOf = commodityAsOfCandidates.length
      ? new Date(Math.max(...commodityAsOfCandidates)).toISOString()
      : null;
    const commodityAgeMinutes = commoditiesAsOf
      ? Math.round((Date.now() - new Date(commoditiesAsOf).getTime()) / 60000)
      : null;
    const commoditiesStale = commodityAgeMinutes === null ? true : commodityAgeMinutes > 180;
    let performers = { gainers: [], losers: [], active: [] };
    if (psxPerfRes.status === 'fulfilled' && psxPerfRes.value) {
      const perfData = parsePerformers(psxPerfRes.value);
      if (perfData) performers = perfData;
    }

    let signals = [];
    if (psxAnncRes.status === 'fulfilled' && psxAnncRes.value) {
      const anncData = parseAnnouncements(psxAnncRes.value);
      if (anncData) signals = anncData;
    }

    const snapQuotes = {};
    SNAPSHOT_CHARTS.forEach((spec, i) => {
      const r = snapshotChartResults[i];
      snapQuotes[spec.key] = r.status === 'fulfilled' ? parseYahooCommodity(r.value) : null;
    });

    const GMS_PER_TROY_OZ = 31.1034768;
    const GRAMS_PER_TOLA = 11.6638038;
    const lngProxyVal = Number.isFinite(natGas.value) ? +(natGas.value * 3.6 * 0.85).toFixed(3) : null;
    const lpgProxyVal = Number.isFinite(brent.value) ? +(brent.value * 0.012).toFixed(3) : null;

    const mkSnapRow = (label, value, opts = {}) => ({
      label,
      value: value != null && Number.isFinite(value) ? value : null,
      textValue: opts.textValue != null ? String(opts.textValue) : null,
      changePct: opts.changePct != null && Number.isFinite(opts.changePct) ? opts.changePct : null,
      prefix: opts.prefix || '',
      suffix: opts.suffix || '',
      hint: opts.hint || null,
      reference: Boolean(opts.reference)
    });

    const eq = equities;
    const eurQ = snapQuotes.eurUsd;
    const silverQ = snapQuotes.silver;
    const wtiQ = snapQuotes.wti;

    const marketSnapshot = {
      disclaimer:
        'Live legs: PSX indices (official DPS page), USD/PKR (ER-API + currency-api fallback), Yahoo futures/FX/crypto. PKR marks are Brent/Gold/Silver futures × spot USD/PKR (implied). Reference rows are rounded public bands — not intraday.',
      meta: {
        commoditiesStale,
        commoditiesAsOf,
        commoditiesAgeMinutes: commodityAgeMinutes
      },
      panels: [
        {
          title: 'FX & PSX',
          rows: [
            mkSnapRow('USD/PKR', usdPkr),
            mkSnapRow('EUR/USD', eurQ?.value, { changePct: eurQ?.changePct }),
            mkSnapRow('KSE-100', eq.kse100?.value, { changePct: eq.kse100?.changePct }),
            mkSnapRow('KSE-30', eq.kse30?.value, { changePct: eq.kse30?.changePct }),
            mkSnapRow('All-Share', eq.allshr?.value, { changePct: eq.allshr?.changePct })
          ]
        },
        {
          title: 'PKR marks (implied)',
          hint: 'USD leg from FX feed × last futures; gold/silver per gram; crude barrels.',
          rows: [
            mkSnapRow(
              'Gold / gram PKR',
              gold.value != null && usdPkr ? (gold.value * usdPkr) / GMS_PER_TROY_OZ : null
            ),
            mkSnapRow(
              'Gold / tola PKR',
              gold.value != null && usdPkr
                ? (gold.value * usdPkr * GRAMS_PER_TOLA) / GMS_PER_TROY_OZ
                : null
            ),
            mkSnapRow(
              'Silver / gram PKR',
              silverQ?.value != null && usdPkr ? (silverQ.value * usdPkr) / GMS_PER_TROY_OZ : null
            ),
            mkSnapRow('Brent / bbl PKR', brent.value != null && usdPkr ? brent.value * usdPkr : null),
            mkSnapRow('WTI / bbl PKR', wtiQ?.value != null && usdPkr ? wtiQ.value * usdPkr : null)
          ]
        },
        {
          title: 'Crude & refined (USD)',
          rows: [
            mkSnapRow('Brent ICE', brent.value, { changePct: brent.changePct, prefix: '$', suffix: '/bbl' }),
            mkSnapRow('WTI Nymex', wtiQ?.value, { changePct: wtiQ?.changePct, prefix: '$', suffix: '/bbl' }),
            mkSnapRow('Henry Hub', natGas.value, { changePct: natGas.changePct, prefix: '$', suffix: '/MMBtu' }),
            mkSnapRow('RBOB', gasoline.value, { changePct: gasoline.changePct, prefix: '$', suffix: '/gal' }),
            mkSnapRow('LNG proxy', lngProxyVal, { prefix: '$' }),
            mkSnapRow('LPG proxy', lpgProxyVal, { prefix: '$' })
          ]
        },
        {
          title: 'Precious metals (USD)',
          rows: [
            mkSnapRow('Gold', gold.value, { changePct: gold.changePct, prefix: '$', suffix: '/oz' }),
            mkSnapRow('Silver', silverQ?.value, { changePct: silverQ?.changePct, prefix: '$', suffix: '/oz' }),
            mkSnapRow('Platinum', snapQuotes.platinum?.value, { changePct: snapQuotes.platinum?.changePct, prefix: '$', suffix: '/oz' }),
            mkSnapRow('Palladium', snapQuotes.palladium?.value, { changePct: snapQuotes.palladium?.changePct, prefix: '$', suffix: '/oz' })
          ]
        },
        {
          title: 'Industrial & crops',
          rows: [
            mkSnapRow('Copper', snapQuotes.copper?.value, { changePct: snapQuotes.copper?.changePct, prefix: '$', suffix: '/lb' }),
            mkSnapRow('Corn', snapQuotes.corn?.value, { changePct: snapQuotes.corn?.changePct, suffix: ' ¢/bu' }),
            mkSnapRow('Wheat', snapQuotes.wheat?.value, { changePct: snapQuotes.wheat?.changePct, suffix: ' ¢/bu' })
          ]
        },
        {
          title: 'Crypto (USD)',
          rows: [
            mkSnapRow('Bitcoin', snapQuotes.btc?.value, { changePct: snapQuotes.btc?.changePct, prefix: '$' }),
            mkSnapRow('Ethereum', snapQuotes.eth?.value, { changePct: snapQuotes.eth?.changePct, prefix: '$' })
          ]
        },
        {
          title: 'Pakistan energy (reference)',
          hint: 'Illustrative bands — verify against OGRA / company / survey data.',
          rows: PAKISTAN_ENERGY_REFERENCE.map((r) =>
            mkSnapRow(r.label, null, { textValue: r.value, hint: r.hint, reference: true })
          )
        }
      ]
    };

    const payload = {
      updatedAt: new Date().toISOString(),
      fx: { usdPkr },
      equities,
      performers,
      signals,
      meta: {
        commoditiesAsOf,
        commoditiesAgeMinutes: commodityAgeMinutes,
        commoditiesStale
      },
      commodities: {
        brentUsdPerBbl: brent.value,
        naturalGasUsdPerMmbtu: natGas.value,
        goldUsdPerOz: gold.value,
        gasolineUsdProxy: gasoline.value,
        lngProxy: lngProxyVal != null ? lngProxyVal : 11.25,
        lpgProxy: lpgProxyVal != null ? lpgProxyVal : 1.12,
        sessionChangePct: {
          brent: brent.changePct,
          naturalGas: natGas.changePct,
          gold: gold.changePct,
          gasoline: gasoline.changePct
        },
        sources: {
          brent: brent.source,
          naturalGas: natGas.source,
          gold: gold.source,
          gasoline: gasoline.source
        }
      },
      marketSnapshot
    };

    _marketCache = payload;
    _marketCacheTs = Date.now();
    res.status(200).json(payload);
  } catch (err) {
    // Return stale cache on error
    if (_marketCache) return res.status(200).json({ ..._marketCache, stale: true });
    res.status(500).json({
      updatedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'market_fetch_failed'
    });
  }
};
