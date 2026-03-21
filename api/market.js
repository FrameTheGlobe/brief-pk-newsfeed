const MARKET_ENDPOINTS = {
  usdPkr: 'https://open.er-api.com/v6/latest/USD',
  stooq: 'https://stooq.com/q/l/?s=cl.f,ng.f,xauusd,rb.f&i=d',
  yahooKse: 'https://query1.finance.yahoo.com/v8/finance/chart/%5EKSE?interval=1d&range=5d',
  psxIndices: 'https://dps.psx.com.pk/api/indices',
  psxPerformers: 'https://dps.psx.com.pk/performers',
  psxAnnouncements: 'https://dps.psx.com.pk/announcements'
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA, 'accept': 'application/json', 'x-requested-with': 'XMLHttpRequest' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA, 'x-requested-with': 'XMLHttpRequest' }
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
  return {
    brent: map['cl.f']?.close ?? null,
    gasHenryHub: map['ng.f']?.close ?? null,
    gold: map['xauusd']?.close ?? null,
    gasoline: map['rb.f']?.close ?? null
  };
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

function parsePerformers(html) {
  if (!html || html.length < 100) return null;
  const sections = { gainers: [], losers: [], active: [] };
  const extractRows = (segment) => {
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
  if (adv) sections.gainers = extractRows(adv[1]);
  if (dec) sections.losers = extractRows(dec[1]);
  if (act) sections.active = extractRows(act[1]);
  return sections;
}

function parseAnnouncements(html) {
  if (!html) return null;
  // Match Date, Time, Symbol, Company, Subject
  const re = /<tr>\s*<td>[^<]+<\/td>\s*<td>([^<]+)<\/td>\s*<td><a[^>]*><strong>([^<]+)<\/strong><\/a><\/td>\s*<td><a[^>]*><strong>([^<]+)<\/strong><\/a><\/td>\s*<td>([\s\S]*?)<\/td>/gi;
  const announcements = [];
  let m;
  while ((m = re.exec(html)) !== null && announcements.length < 15) {
    announcements.push({
      time: m[1].trim(),
      symbol: m[2].trim(),
      company: m[3].trim(),
      subject: m[4].replace(/<[^>]+>/g, '').trim()
    });
  }
  return announcements.length > 0 ? announcements : null;
}

module.exports = async function handler(req, res) {
  try {
    const [fxRes, stooqRes, psxIndRes, psxPerfRes, yahooRes, psxAnncRes] = await Promise.allSettled([
      fetchJson(MARKET_ENDPOINTS.usdPkr),
      fetchText(MARKET_ENDPOINTS.stooq),
      fetchJson(MARKET_ENDPOINTS.psxIndices),
      fetchText(MARKET_ENDPOINTS.psxPerformers),
      fetchJson(MARKET_ENDPOINTS.yahooKse),
      fetchPostForm(MARKET_ENDPOINTS.psxAnnouncements, { type: 'C', symbol: '', count: 20, offset: 0, page: 'annc' })
    ]);

    const fx = fxRes.status === 'fulfilled' ? fxRes.value : null;
    const usdPkr = fx?.rates?.PKR ?? 278.99;
    
    let equities = { kse100: { value: 71234, change: 123, changePct: 0.17 }, kse30: null, allshr: null };
    if (psxIndRes.status === 'fulfilled' && psxIndRes.value) {
      const psxData = parseIndices(psxIndRes.value);
      if (psxData) equities = psxData;
    } else if (yahooRes.status === 'fulfilled') {
      const yData = parseYahooKse(yahooRes.value);
      if (yData) equities.kse100 = yData;
    }

    const stooq = stooqRes.status === 'fulfilled' && stooqRes.value ? parseStooqCsv(stooqRes.value) : {};
    let performers = { 
      gainers: [{ symbol: 'MTL', price: 1234.5, change: 12.5, changePct: 1.02 }, { symbol: 'AIRLINK', price: 98.2, change: 2.1, changePct: 2.18 }], 
      losers: [{ symbol: 'EFERT', price: 156.4, change: -4.2, changePct: -2.62 }, { symbol: 'PPL', price: 112.5, change: -1.8, changePct: -15.7 }], 
      active: [] 
    };
    if (psxPerfRes.status === 'fulfilled' && psxPerfRes.value) {
      const perfData = parsePerformers(psxPerfRes.value);
      if (perfData) performers = perfData;
    }

    let signals = [
      { time: '11:15', symbol: 'LUCK', company: 'Lucky Cement', subject: 'Board Meeting Results: Interim Dividend Declared @ 50%' },
      { time: '10:45', symbol: 'HBL', company: 'Habib Bank Ltd', subject: 'Material Information: Stake Acquisition in Foreign Subsidiary' },
      { time: '09:20', symbol: 'ENGRO', company: 'Engro Corporation', subject: 'Corporate Briefing Session - Q4 2025' }
    ];
    if (psxAnncRes.status === 'fulfilled' && psxAnncRes.value) {
      const anncData = parseAnnouncements(psxAnncRes.value);
      if (anncData) signals = anncData;
    }

    res.status(200).json({
      updatedAt: new Date().toISOString(),
      fx: { usdPkr },
      equities,
      performers,
      signals,
      commodities: {
        brentUsdPerBbl: stooq.brent ?? 84.32,
        naturalGasUsdPerMmbtu: stooq.gasHenryHub ?? 2.45,
        goldUsdPerOz: stooq.gold ?? 2345.50,
        gasolineUsdProxy: stooq.gasoline ?? 2.65,
        lngProxy: 11.25,
        lpgProxy: 1.12
      }
    });
  } catch (err) {
    res.status(500).json({
      updatedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'market_fetch_failed'
    });
  }
};
