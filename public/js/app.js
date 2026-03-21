const REFRESH_MS = 60_000;
const BREAKING_LIMIT = 16;
const CARD_LIMIT = 12;
const LIVE_LIMIT = 36;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'after', 'into', 'over', 'about', 'amid',
  'pakistan', 'pakistani', 'says', 'said', 'will', 'have', 'has', 'its', 'their', 'his', 'her',
  'news', 'report', 'reports', 'update', 'video', 'live', 'more', 'than', 'they', 'you', 'your'
]);

const state = {
  updatedAt: null,
  news: [],
  market: null,
  scope: 'internal',
  strictFocus: true,
  search: '',
  popPeriod: 'today'
};

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function relTime(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '--';
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function fmtNum(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function pct(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function chgClass(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'chg-flat';
  if (v > 0) return 'chg-up';
  if (v < 0) return 'chg-down';
  return 'chg-flat';
}

function chgLabel(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '·';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
}

function setTickerDuration(trackEl, viewportEl, pxPerSec, minSeconds) {
  if (!trackEl || !viewportEl) return;
  const halfWidth = Math.max(1, trackEl.scrollWidth / 2);
  const distance = halfWidth + viewportEl.clientWidth;
  const duration = Math.max(minSeconds, distance / pxPerSec);
  trackEl.style.animationDuration = `${duration.toFixed(1)}s`;
}

function updateClock() {
  const now = new Date();
  const pkt = now.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Karachi' });
  setText('headerClock', pkt);
}

function filteredNews() {
  return state.news.filter((item) => {
    if (state.strictFocus) {
      if ((item.relevanceScore || 0) < 7) return false;
      if (item.scope === 'external' && !item.directPakistanSignal) return false;
    }

    if (state.scope !== 'all' && item.scope !== state.scope) return false;
    if (!state.search) return true;
    const hay = `${item.title} ${item.description} ${item.source} ${item.category}`.toLowerCase();
    return hay.includes(state.search.toLowerCase());
  });
}

function aggregateCounts(items, keyFn) {
  const map = new Map();
  for (const i of items) {
    const key = keyFn(i);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function inLastMinutes(item, minutes) {
  const t = new Date(item.publishedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= (Date.now() - minutes * 60_000);
}

function renderPsxSignals() {
  const el = document.getElementById('psxSignals');
  if (!el) return;
  const signals = state.market?.signals || [];
  if (!signals.length) {
    el.innerHTML = '<div class="signal-empty">No active corporate intelligence signals.</div>';
    return;
  }
  el.innerHTML = signals.map(s => `
    <div class="signal-row">
      <div class="signal-meta">
        <span class="signal-symbol">${escapeHtml(s.symbol)}</span>
        <span class="signal-time">${escapeHtml(s.time)}</span>
      </div>
      <div class="signal-company">${escapeHtml(s.company)}</div>
      <div class="signal-subject">${escapeHtml(s.subject)}</div>
    </div>
  `).join('');
}



function renderCategoryActivity(items) {
  const el = document.getElementById('categoryActivity');
  if (!el) return;

  const counts = aggregateCounts(items, (n) => n.category).slice(0, 8);
  const max = counts[0]?.[1] || 1;

  el.innerHTML = counts.map(([cat, count]) => {
    const pct = Math.round((count / max) * 100);
    return `
      <div class="cat-bar-row">
        <span class="cat-bar-label">${escapeHtml(cat)}</span>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="cat-bar-count">${count}</span>
      </div>
    `;
  }).join('');
}

function renderKeywordSignals(items) {
  const el = document.getElementById('keywordSignals');
  if (!el) return;

  const freq = new Map();
  for (const item of items.slice(0, 180)) {
    const tokens = `${item.title} ${item.description}`
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOPWORDS.has(t));

    for (const token of tokens.slice(0, 14)) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }
  }

  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  el.innerHTML = top.map(([k, c]) => `
    <button class="kw-pill" data-kw="${escapeHtml(k)}" title="${c} mentions">${escapeHtml(k)}</button>
  `).join('');

  el.querySelectorAll('.kw-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const kw = btn.dataset.kw;
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.value = kw;
        state.search = kw;
        renderAll();
      }
    });
  });
}

function renderMarketTicker() {
  const el = document.getElementById('marketTickerTrack');
  const viewport = document.getElementById('marketTickerViewport');
  if (!el) return;

  const m = state.market;
  if (!m) {
    el.innerHTML = '<span class="ticker-chip">Open market feeds unavailable right now</span>';
    return;
  }

  const kse = m?.equities?.kse100;
  const usd = m?.fx?.usdPkr;
  const c = m?.commodities || {};

  const chips = [];

  chips.push(
    `<span class="ticker-chip">USD/PKR <strong>${fmtNum(usd, 3)}</strong></span>`
  );

  if (kse?.value !== null && kse?.value !== undefined) {
    chips.push(
      `<span class="ticker-chip">KSE-100 <strong>${fmtNum(kse.value, 2)}</strong> <span class="${chgClass(kse.changePct)}">${chgLabel(kse.changePct)}</span></span>`
    );
  }

  chips.push(`<span class="ticker-chip">Brent <strong>$${fmtNum(c.brentUsdPerBbl, 2)}</strong></span>`);
  chips.push(`<span class="ticker-chip">Nat Gas <strong>$${fmtNum(c.naturalGasUsdPerMmbtu, 3)}</strong></span>`);
  chips.push(`<span class="ticker-chip">Gold <strong>$${fmtNum(c.goldUsdPerOz, 2)}</strong></span>`);
  chips.push(`<span class="ticker-chip">LNG Proxy <strong>$${fmtNum(c.lngProxy, 3)}</strong></span>`);
  chips.push(`<span class="ticker-chip">LPG Proxy <strong>$${fmtNum(c.lpgProxy, 3)}</strong></span>`);

  const html = chips.join('');
  el.innerHTML = html + html;

  requestAnimationFrame(() => {
    setTickerDuration(el, viewport, 36, 95);
  });
}

function renderFlashTicker(items) {
  const el = document.getElementById('flashTickerTrack');
  const viewport = document.getElementById('flashTickerViewport');
  if (!el) return;

  if (!items.length) {
    el.innerHTML = '<span class="flash-item">No Pakistan-linked headlines currently available</span>';
    return;
  }

  const html = items
    .slice(0, 30)
    .map((n) => `<a class="flash-item" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.title)}</a>`)
    .join('');

  el.innerHTML = html + html;

  requestAnimationFrame(() => {
    setTickerDuration(el, viewport, 32, 110);
  });
}

function renderHeaderSignals(items) {
  const uniqueSources = new Set(items.map((i) => i.source).filter(Boolean)).size;
  const m = state.market || {};
  const c = m.commodities || {};
  const kse = m.equities?.kse100;
  const usdPkr = m.fx?.usdPkr;
  const brent = c.brentUsdPerBbl;
  const gasoline = c.gasolineUsdProxy;
  const lng = c.lngProxy;
  const lpg = c.lpgProxy;

  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const items24h = items.filter((i) => new Date(i.publishedAt).getTime() >= oneDayAgo);
  const energy24h = items24h.filter((i) => i.category === 'Energy' || i.category === 'Markets').length;
  const mentionCount = (re) => items24h.filter((i) => re.test(`${i.title} ${i.description}`.toLowerCase())).length;
  const imf24h = mentionCount(/\bimf\b/);
  const fuelMentions24h = mentionCount(/\b(petrol|diesel|mogas|hsd)\b/);

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const fuelPressure = Number.isFinite(brent) && Number.isFinite(usdPkr) && Number.isFinite(gasoline)
    ? Math.round(
        clamp(((brent - 75) / 25) * 40, 0, 40) +
        clamp(((usdPkr - 260) / 40) * 35, 0, 35) +
        clamp(((gasoline - 2.2) / 1.2) * 25, 0, 25)
      )
    : null;

  setText('headlineCount', `${items.length} headlines`);
  setText('sourceCount', `${uniqueSources} sources`);

  setText('hdrUsdPkr', Number.isFinite(usdPkr) ? fmtNum(usdPkr, 3) : '--');
  setText('hdrKse100', Number.isFinite(kse?.value) ? `${fmtNum(kse.value, 0)} (${chgLabel(kse.changePct)})` : '--');
  setText('hdrBrent', Number.isFinite(brent) ? `$${fmtNum(brent, 2)}` : '--');
  setText('hdrGasoline', Number.isFinite(gasoline) ? `$${fmtNum(gasoline, 3)}` : '--');
  setText('hdrLngLpg', Number.isFinite(lng) && Number.isFinite(lpg) ? `$${fmtNum(lng, 2)} / $${fmtNum(lpg, 2)}` : '--');
  setText('hdrFuelPressure', Number.isFinite(fuelPressure) ? `${fuelPressure}/100` : '--/100');

  setText('hdrEnergy24h', `${energy24h}`);
  setText('hdrImf24h', `${imf24h}`);
  setText('hdrFuelMentions24h', `${fuelMentions24h}`);
}

function renderBreaking(items) {
  const el = document.getElementById('breakingQueue');
  if (!el) return;

  const rows = items.slice(0, BREAKING_LIMIT);
  if (!rows.length) {
    el.innerHTML = '<div class="breaking-item"><div class="breaking-title">No items</div></div>';
    return;
  }

  el.innerHTML = rows
    .map((n, idx) => {
      return `
        <a class="breaking-item" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">
          <div class="breaking-rank">${String(idx + 1).padStart(2, '0')}</div>
          <div>
            <div class="breaking-title">${escapeHtml(n.title)}</div>
            <div class="badges">
              <span class="badge ${escapeHtml(n.priority)}">${escapeHtml(n.priority)}</span>
              <span class="badge">${escapeHtml(n.scope)}</span>
              <span class="badge">${escapeHtml(n.category)}</span>
              <span class="badge">${escapeHtml(n.source)}</span>
            </div>
          </div>
          <div class="time-col">${relTime(n.publishedAt)}</div>
        </a>
      `;
    })
    .join('');
}

function renderCategories(items) {
  const el = document.getElementById('categorySections');
  if (!el) return;

  const byCat = new Map();
  for (const n of items) {
    if (!byCat.has(n.category)) byCat.set(n.category, []);
    byCat.get(n.category).push(n);
  }

  const ordered = [...byCat.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!ordered.length) {
    el.innerHTML = '<div class="lane-block"><div class="lane-head"><h2>No matching stories</h2></div></div>';
    return;
  }

  el.innerHTML = ordered
    .map(([cat, rows]) => {
      const cards = rows.slice(0, CARD_LIMIT);
      return `
        <section class="category-section">
          <div class="category-head">
            <span>${escapeHtml(cat)}</span>
            <span>${rows.length}</span>
          </div>
          <div class="cards-grid">
            ${cards
              .map(
                (n, i) => `
                <a class="news-card" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer" data-priority="${escapeHtml(n.priority)}">
                  ${i === 0 ? `<div class="card-priority-label">${escapeHtml(n.priority)}</div>` : ''}
                  <div class="card-headline">${escapeHtml(n.title)}</div>
                  <div class="card-foot">
                    <span class="card-source">${escapeHtml(n.source)}</span>
                    <span class="card-time">${relTime(n.publishedAt)}</span>
                  </div>
                </a>
              `
              )
              .join('')}
          </div>
        </section>
      `;
    })
    .join('');
}

function renderTrendRadar(items) {
  const el = document.getElementById('trendRadar');
  if (!el) return;

  const trend = aggregateCounts(items, (n) => n.category).slice(0, 8);
  el.innerHTML = `<ul class="trend-list">${trend
    .map(([name, count]) => `
      <li class="trend-item">
        <span class="trend-name">${escapeHtml(name)}</span>
        <span class="trend-meta">${count} stories</span>
      </li>
    `)
    .join('')}</ul>`;
}

function renderSourceDominance(items) {
  const el = document.getElementById('sourceDominance');
  if (!el) return;

  const sourceCounts = aggregateCounts(items, (n) => n.source).slice(0, 8);
  const total = sourceCounts.reduce((acc, [, c]) => acc + c, 0) || 1;

  el.innerHTML = sourceCounts
    .map(([source, count]) => {
      const share = (count / total) * 100;
      return `
        <div class="source-row">
          <div class="source-head">
            <span class="source-name">${escapeHtml(source)}</span>
            <span class="source-pct">${share.toFixed(1)}%</span>
          </div>
          <div class="source-bar"><span style="width:${share}%"></span></div>
        </div>
      `;
    })
    .join('');
}

function renderLiveFeed(items) {
  const el = document.getElementById('liveFeed');
  if (!el) return;

  el.innerHTML = `<div class="live-list">${items
    .slice(0, LIVE_LIMIT)
    .map(
      (n) => `
      <a href="${escapeHtml(n.url)}" class="live-item" target="_blank" rel="noopener noreferrer">
        <div class="live-title">${escapeHtml(n.title)}</div>
        <div class="live-meta">${escapeHtml(n.source)} · ${escapeHtml(n.scope)} · ${relTime(n.publishedAt)}</div>
      </a>
    `
    )
    .join('')}</div>`;
}

function renderLeftRail(items) {
  const catEl = document.getElementById('categoryNav');
  const srcEl = document.getElementById('sourceNav');

  if (catEl) {
    const rows = aggregateCounts(items, (n) => n.category).slice(0, 14);
    catEl.innerHTML = rows.map(([k, c]) => `
      <li>
        <span>${escapeHtml(k)}</span>
        <span class="count">${c}</span>
      </li>
    `).join('');
  }

  if (srcEl) {
    const rows = aggregateCounts(items, (n) => n.source).slice(0, 14);
    srcEl.innerHTML = rows.map(([k, c]) => `
      <li>
        <span>${escapeHtml(k)}</span>
        <span class="count">${c}</span>
      </li>
    `).join('');
  }
}

function renderPopularNews() {
  const el = document.getElementById('popularNews');
  if (!el) return;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  let pool = state.news;
  if (state.popPeriod === 'today') {
    pool = state.news.filter(n => (now - new Date(n.publishedAt).getTime()) < dayMs);
  } else if (state.popPeriod === 'yesterday') {
    pool = state.news.filter(n => {
      const diff = now - new Date(n.publishedAt).getTime();
      return diff >= dayMs && diff < 2 * dayMs;
    });
  } else if (state.popPeriod === '3d') {
    pool = state.news.filter(n => (now - new Date(n.publishedAt).getTime()) < 3 * dayMs);
  }
  const items = (pool.length > 0 ? pool : state.news).slice(0, 8);
  el.innerHTML = items.map(n => `
    <a href="${escapeHtml(n.url)}" class="pop-item" target="_blank">
      ${n.thumbnail ? `<img src="${escapeHtml(n.thumbnail)}" class="pop-img" onerror="this.src='/favicon.ico'"/>` : '<div class="pop-img"></div>'}
      <div class="pop-content">
        <div class="pop-title">${escapeHtml(n.title)}</div>
      </div>
    </a>
  `).join('');
}

function renderMarketSnapshot() {
  const el = document.getElementById('marketSnapshot');
  if (!el || !state.market) return;
  const m = state.market;
  const usdPkr = m?.fx?.usdPkr;
  const kse = m?.equities?.kse100;
  const gold = m?.commodities?.goldUsdPerOz;
  const brent = m?.commodities?.brentUsdPerBbl;

  const row = (label, value, chg, unit = '') => `
    <div class="mkt-row">
      <span class="mkt-label">${label}</span>
      <span class="mkt-val">${unit}${fmtNum(value)}</span>
      ${chg !== undefined && chg !== null ? `<span class="mkt-chg ${chgClass(chg)}">${chgLabel(chg)}</span>` : ''}
    </div>
  `;

  el.innerHTML = [
    row('USD/PKR', usdPkr, null),
    row('KSE-100', kse?.value, kse?.changePct),
    row('Gold', gold, null, '$'),
    row('Brent', brent, null, '$')
  ].join('');
}

function renderAll() {
  const items = filteredNews();
  renderMarketTicker();
  renderFlashTicker(items);
  renderHeaderSignals(items);
  renderPsxSignals();
  renderBreaking(items);
  renderCategories(items);
  renderPopularNews();
  renderTrendRadar(items);
  renderSourceDominance(items);
  renderMarketSnapshot();
  renderCategoryActivity(items);
  renderKeywordSignals(items);
  renderLiveFeed(items);
  renderLeftRail(items);

  const updated = document.getElementById('updatedAt');
  if (updated) updated.textContent = state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString() : '--';
}

async function fetchNews() {
  const res = await fetch('/api/news', { cache: 'no-store' });
  if (!res.ok) throw new Error(`news_http_${res.status}`);
  const data = await res.json();
  return data;
}

async function fetchMarket() {
  const res = await fetch('/api/market', { cache: 'no-store' });
  if (!res.ok) throw new Error(`market_http_${res.status}`);
  const data = await res.json();
  return data;
}

async function refreshData() {
  const [newsRes, marketRes] = await Promise.allSettled([fetchNews(), fetchMarket()]);

  if (newsRes.status === 'fulfilled') {
    state.news = Array.isArray(newsRes.value.articles) ? newsRes.value.articles : [];
    state.updatedAt = newsRes.value.updatedAt || new Date().toISOString();
  }

  if (marketRes.status === 'fulfilled') {
    state.market = marketRes.value;
    state.updatedAt = marketRes.value.updatedAt || state.updatedAt;
  }

  renderAll();
}

function bindEvents() {
  const scopeButtons = document.querySelectorAll('.scope-btn');
  scopeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const scope = btn.dataset.scope || 'all';
      state.scope = scope;
      scopeButtons.forEach((b) => b.classList.toggle('active', b === btn));
      renderAll();
    });
  });

  const focusToggle = document.getElementById('focusModeToggle');
  if (focusToggle) {
    focusToggle.checked = state.strictFocus;
    focusToggle.addEventListener('change', (e) => {
      state.strictFocus = Boolean(e.target.checked);
      renderAll();
    });
  }

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    let timer = null;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.search = String(e.target.value || '').trim();
        renderAll();
      }, 150);
    });
  }

  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      try { await refreshData(); } finally { refreshBtn.disabled = false; }
    });
  }

  const popTabs = document.querySelectorAll('.pop-tab');
  popTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      state.popPeriod = btn.dataset.period || 'today';
      popTabs.forEach(b => b.classList.toggle('active', b === btn));
      renderPopularNews();
    });
  });
}

async function init() {
  bindEvents();
  updateClock();
  setInterval(updateClock, 1000);
  await refreshData();
  setInterval(refreshData, REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', init);
