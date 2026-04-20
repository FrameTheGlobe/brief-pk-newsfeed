/** Poll every 10 minutes to reduce Railway server costs. */
const REFRESH_MS = 10 * 60 * 1000;

// API base URL: empty on localhost (Express serves both static + API),
// Railway URL on production (Vercel serves static only).
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? ''
  : 'https://brief-pk-newsfeed-production.up.railway.app';
const BREAKING_LIMIT = 16;
const CARD_LIMIT = 12;

const CACHE_KEY = 'brief-pk-data-v2';
const CACHE_TTL = 10 * 60 * 1000;

const state = {
  updatedAt: null,
  news: [],
  market: null,
  pakistanMap: null,
  strictFocus: true,
  popPeriod: 'today',
  mapLayer: 'weather',
  activeSource: null,
  searchQuery: '',
  lastMarketPulse: null
};

/** Narrative Clustering Engine: Groups similar headlines into tactical threads */
function clusterNews(articles) {
  const clusters = [];
  const handled = new Set();
  
  for (let i = 0; i < articles.length; i++) {
    if (handled.has(i)) continue;
    const core = articles[i];
    const group = [core];
    handled.add(i);
    
    for (let j = i + 1; j < articles.length; j++) {
      if (handled.has(j)) continue;
      const compare = articles[j];
      
      // Fuzzy match based on shared long-words
      const w1 = core.title.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const w2 = compare.title.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const intersect = w1.filter(w => w2.includes(w));
      
      if (intersect.length >= 3) {
        group.push(compare);
        handled.add(j);
      }
    }
    clusters.push({ primary: core, others: group.slice(1) });
  }
  return clusters;
}

/** Renders the top-level Digital Dossier (3 Tactical Bullets) */
function renderFlashDossier(articles) {
  const container = document.getElementById('flashDossierContainer');
  if (!container) return;

  const highlights = articles.filter(a => a.priority === 'high').slice(0, 3);
  if (!highlights.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="flash-dossier-widget">
      <div class="dossier-header">
        <span class="dossier-title">Digital Dossier</span>
        <div class="dossier-btn-group">
          <button class="dossier-btn" onclick="window.print()">⇩ PDF Export</button>
          <button class="dossier-btn" onclick="window.location.reload()">↺ Refresh Scan</button>
        </div>
      </div>
      <div class="dossier-bullets">
        ${highlights.map(h => `<div class="dossier-bullet">${escapeHtml(h.title)}</div>`).join('')}
      </div>
    </div>
  `;
}


// ── Utils ──────────────────────────────────────────────────────────────────

function publishedMs(iso) {
  if (iso == null || iso === '') return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function relTime(iso) {
  if (iso == null || iso === '') return '--';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '--';
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function relTimeClass(iso) {
  if (iso == null || iso === '') return 'time-stale';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'time-stale';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 60)  return 'time-fresh';
  if (mins < 360) return 'time-recent';
  return 'time-stale';
}

function relTimeBadge(iso) {
  return `<span class="${relTimeClass(iso)}">${relTime(iso)}</span>`;
}

function fmtNum(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** Snapshot numbers: avoid trailing zeros for large crypto / small FX moves */
function fmtSnapNumber(value, maxDigits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  const abs = Math.abs(n);
  const d = abs >= 10000 ? 0 : abs >= 100 ? maxDigits : abs >= 1 ? maxDigits : 4;
  return n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
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

// ── Filtering ──────────────────────────────────────────────────────────────

function filteredNews() {
  return state.news.filter((item) => {
    if (state.strictFocus) {
      if ((item.relevanceScore || 0) < 7) return false;
      if (item.scope === 'external' && !item.directPakistanSignal) return false;
    }
    if (state.activeSource && item.source !== state.activeSource) return false;
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const text = `${item.title} ${item.description || ''}`.toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
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
  const t = publishedMs(item.publishedAt);
  if (t == null) return false;
  return t >= (Date.now() - minutes * 60_000);
}

// ── Cache ──────────────────────────────────────────────────────────────────

function saveCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* quota or private mode */ }
}

function loadCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch { /* malformed */ }
  return null;
}

// ── Renderers ──────────────────────────────────────────────────────────────

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

function renderPsxPerformers(activeTab) {
  const el = document.getElementById('psxPerformers');
  if (!el) return;

  const performers = state.market?.performers;
  if (!performers) {
    el.innerHTML = '<div class="perf-empty">PSX data loading…</div>';
    return;
  }

  const tab = activeTab || document.querySelector('.perf-tab.active')?.dataset?.perf || 'gainers';
  const list = performers[tab] || [];

  if (!list.length) {
    const now = new Date();
    const pktHour = parseInt(now.toLocaleTimeString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Karachi' }), 10);
    const isMarketHours = pktHour >= 9 && pktHour < 16;
    const msg = isMarketHours
      ? `No ${tab} data yet — PSX feed updating`
      : 'PSX market closed · Showing last session';
    el.innerHTML = `<div class="perf-empty">${msg}</div>`;
    return;
  }

  el.innerHTML = `<div class="perf-list">${list.slice(0, 10).map(p => {
    const chg = Number(p.changePct ?? p.pctChange ?? p.change_pct);
    const price = p.price ?? p.value ?? p.last;
    const cls = Number.isFinite(chg) ? (chg >= 0 ? 'up' : 'down') : '';
    const sign = Number.isFinite(chg) && chg > 0 ? '+' : '';
    return `
      <div class="perf-row">
        <span class="perf-sym">${escapeHtml(p.symbol || '--')}</span>
        <span class="perf-val">${fmtNum(price, 2)}</span>
        <span class="perf-chg ${cls}">${Number.isFinite(chg) ? `${sign}${chg.toFixed(2)}%` : '--'}</span>
      </div>
    `;
  }).join('')}</div>`;
}

function renderTodaysBriefing(items) {
  const el = document.getElementById('todaysBriefing');
  if (!el) return;

  if (!items.length) {
    el.innerHTML = '<div class="briefing-empty">Awaiting feed data…</div>';
    return;
  }

  // Pick top unique-category items (prefer high priority)
  const high = items.filter(n => n.priority === 'high');
  const pool = high.length >= 3 ? high : items;
  const seenCats = new Set();
  const top = [];
  for (const item of pool) {
    if (!seenCats.has(item.category)) {
      seenCats.add(item.category);
      top.push(item);
    }
    if (top.length >= 5) break;
  }

  el.innerHTML = top.map(item => {
    const isRtl = /[\u0600-\u06FF]/.test(item.title);
    return `
      <a class="briefing-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
        <span class="briefing-cat">${escapeHtml(item.category)}</span>
        <span class="briefing-headline${isRtl ? ' rtl-text' : ''}">${escapeHtml(item.title)}</span>
        <span class="briefing-foot">
          <span class="briefing-source">${escapeHtml(item.source)}</span>
          <span class="briefing-time">${relTimeBadge(item.publishedAt)}</span>
        </span>
      </a>
    `;
  }).join('');
}

function renderFocusCount() {
  const badge = document.getElementById('focusCountBadge');
  if (!badge) return;
  const filtered = filteredNews().length;
  const total = state.news.length;
  if (state.strictFocus) {
    badge.textContent = `Showing ${filtered} of ${total} stories`;
  } else {
    badge.textContent = `Showing all ${total} stories`;
  }
}

function renderSearchResults() {
  const block = document.getElementById('searchResultsBlock');
  const resultsEl = document.getElementById('searchResults');
  const queryLabel = document.getElementById('searchQueryLabel');
  const breakingBlock = document.getElementById('breakingBlock');

  if (!block || !resultsEl) return;

  if (!state.searchQuery) {
    block.style.display = 'none';
    if (breakingBlock) breakingBlock.style.display = '';
    return;
  }

  block.style.display = '';
  if (breakingBlock) breakingBlock.style.display = 'none';

  if (queryLabel) queryLabel.textContent = `"${state.searchQuery}"`;

  const results = filteredNews();
  if (!results.length) {
    resultsEl.innerHTML = '<div class="breaking-item"><div class="breaking-title">No results found for that query.</div></div>';
    return;
  }

  resultsEl.innerHTML = results.slice(0, 30).map((n, idx) => `
    <a class="breaking-item" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">
      <div class="breaking-rank">${String(idx + 1).padStart(2, '0')}</div>
      <div>
        <div class="breaking-title">${escapeHtml(n.title)}</div>
        <div class="badges">
          <span class="badge ${escapeHtml(n.priority)}">${escapeHtml(n.priority)}</span>
          <span class="badge">${escapeHtml(n.category)}</span>
          <span class="badge">${escapeHtml(n.source)}</span>
        </div>
      </div>
      <div class="time-col">${relTimeBadge(n.publishedAt)}</div>
    </a>
  `).join('');
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
  const meta = m?.meta || {};

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
  chips.push(`<span class="ticker-chip">US gas (HH) <strong>$${fmtNum(c.naturalGasUsdPerMmbtu, 3)}</strong></span>`);
  chips.push(`<span class="ticker-chip">Gold <strong>$${fmtNum(c.goldUsdPerOz, 2)}</strong></span>`);
  chips.push(`<span class="ticker-chip">LNG Proxy <strong>$${fmtNum(c.lngProxy, 3)}</strong></span>`);
  chips.push(`<span class="ticker-chip">LPG Proxy <strong>$${fmtNum(c.lpgProxy, 3)}</strong></span>`);

  if (meta.commoditiesAsOf) {
    const pktTime = new Date(meta.commoditiesAsOf).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Karachi' });
    const age = Number.isFinite(meta.commoditiesAgeMinutes) ? `${meta.commoditiesAgeMinutes}m old` : 'age unknown';
    const status = meta.commoditiesStale ? 'STALE' : 'LIVE';
    chips.push(`<span class="ticker-chip">${status} Commodities <strong>${age}</strong> <span>${pktTime} PKT</span></span>`);
  }

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

  const clusters = clusterNews(items);
  const html = clusters
    .slice(0, 20)
    .map((c) => {
      const n = c.primary;
      const count = c.others.length;
      const pulse = n.priority === 'high' ? '<span class="pulse-alert"></span>' : '';
      const threadHint = count > 0 ? `<span class="thread-hint"> [+${count} sources]</span>` : '';
      return `<a class="flash-item" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">${pulse}${escapeHtml(n.title)}${threadHint}</a>`;
    })
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
  const commoditiesStale = Boolean(m.meta?.commoditiesStale);
  const commoditiesAgeMinutes = m.meta?.commoditiesAgeMinutes;

  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const items24h = items.filter((i) => {
    const t = publishedMs(i.publishedAt);
    return t != null && t >= oneDayAgo;
  });
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
  const kseEl = document.getElementById('hdrKse100');
  if (kseEl) {
    kseEl.innerHTML = Number.isFinite(kse?.value)
      ? `${fmtNum(kse.value, 0)} <span class="${chgClass(kse.changePct)}">(${chgLabel(kse.changePct)})</span>`
      : '--';
  }
  const staleChip = commoditiesStale ? `<span class="stale-chip">${Number.isFinite(commoditiesAgeMinutes) ? `${commoditiesAgeMinutes}m` : 'stale'}</span>` : '';
  const brentEl = document.getElementById('hdrBrent');
  if (brentEl) brentEl.innerHTML = Number.isFinite(brent) ? `$${fmtNum(brent, 2)}${staleChip}` : '--';
  setText('hdrGasoline', Number.isFinite(gasoline) ? `$${fmtNum(gasoline, 3)}` : '--');
  setText('hdrLngLpg', Number.isFinite(lng) && Number.isFinite(lpg) ? `$${fmtNum(lng, 2)} / $${fmtNum(lpg, 2)}` : '--');
  const fuelPressureLabel = Number.isFinite(fuelPressure) ? `${fuelPressure}/100` : '--/100';
  const fpEl = document.getElementById('hdrFuelPressure');
  if (fpEl) fpEl.innerHTML = fuelPressureLabel + (commoditiesStale ? staleChip : '');

  setText('hdrEnergy24h', `${energy24h}`);
  setText('hdrImf24h', `${imf24h}`);
  setText('hdrFuelMentions24h', `${fuelMentions24h}`);
}

function renderBreaking(items) {
  const el = document.getElementById('breakingQueue');
  if (!el) return;

  const rows = items.slice(0, BREAKING_LIMIT);
  if (!rows.length) {
    el.innerHTML = '<div class="breaking-item"><div class="breaking-title">No items matching current filters</div></div>';
    return;
  }

  el.innerHTML = rows
    .map((n, idx) => {
      const relScore = n.relevanceScore || 0;
      const relClass = relScore >= 12 ? 'rel-critical' : relScore >= 8 ? 'rel-high' : 'rel-normal';
      return `
        <a class="breaking-item" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer" data-priority="${escapeHtml(n.priority)}">
          <div class="breaking-rank">${String(idx + 1).padStart(2, '0')}</div>
          <div>
            <div class="breaking-title">${escapeHtml(n.title)}</div>
            <div class="badges">
              <span class="badge ${escapeHtml(n.priority)}">${escapeHtml(n.priority)}</span>
              <span class="badge rel-badge ${relClass}">${relScore} INTEL</span>
              <span class="badge">${escapeHtml(n.category)}</span>
              <span class="badge">${escapeHtml(n.source)}</span>
            </div>
          </div>
          <div class="time-col">${relTimeBadge(n.publishedAt)}</div>
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
                    <span class="card-time">${relTimeBadge(n.publishedAt)}</span>
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

function renderLeftRail() {
  const srcEl = document.getElementById('sourceNav');
  const pulseEl = document.getElementById('pulseBoard');
  const clearSrcBtn = document.getElementById('clearSourceBtn');

  // All items (unfiltered by source) for nav counts
  const allFiltered = state.news.filter((item) => {
    if (state.strictFocus) {
      if ((item.relevanceScore || 0) < 7) return false;
      if (item.scope === 'external' && !item.directPakistanSignal) return false;
    }
    return true;
  });

  if (srcEl) {
    const rows = aggregateCounts(allFiltered, (n) => n.source).slice(0, 14);
    srcEl.innerHTML = rows.map(([k, c]) => `
      <li class="nav-item${state.activeSource === k ? ' active' : ''}" data-src="${escapeHtml(k)}">
        <span>${escapeHtml(k)}</span>
        <span class="count">${c}</span>
      </li>
    `).join('');

    srcEl.querySelectorAll('.nav-item').forEach(li => {
      li.addEventListener('click', () => {
        const src = li.dataset.src;
        state.activeSource = state.activeSource === src ? null : src;
        if (clearSrcBtn) clearSrcBtn.style.display = state.activeSource ? '' : 'none';
        renderAll();
      });
    });

    if (clearSrcBtn) clearSrcBtn.style.display = state.activeSource ? '' : 'none';
  }

  if (pulseEl) {
    const now = Date.now();
    const hr = 60 * 60 * 1000;
    const window6h = allFiltered.filter((n) => {
      const t = publishedMs(n.publishedAt);
      return t != null && now - t <= 6 * hr;
    });
    const highPriority = allFiltered.filter((n) => n.priority === 'high').length;
    const internalShare = allFiltered.length ? Math.round((allFiltered.filter((n) => n.scope === 'internal').length / allFiltered.length) * 100) : 0;
    const energyShare = allFiltered.length ? Math.round((allFiltered.filter((n) => n.category === 'Energy' || n.category === 'Markets').length / allFiltered.length) * 100) : 0;

    pulseEl.innerHTML = `
      <div class="pulse-grid">
        <div class="pulse-metric"><span>Live 6h</span><strong>${window6h.length}</strong></div>
        <div class="pulse-metric"><span>High Priority</span><strong>${highPriority}</strong></div>
        <div class="pulse-metric"><span>Internal Share</span><strong>${internalShare}%</strong></div>
        <div class="pulse-metric"><span>Energy Heat</span><strong>${energyShare}%</strong></div>
      </div>
    `;
  }
}

function renderPopularNews() {
  const el = document.getElementById('popularNews');
  if (!el) return;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  let pool = state.news;
  if (state.popPeriod === 'today') {
    pool = state.news.filter((n) => {
      const t = publishedMs(n.publishedAt);
      return t != null && now - t < dayMs;
    });
  } else if (state.popPeriod === 'yesterday') {
    pool = state.news.filter((n) => {
      const t = publishedMs(n.publishedAt);
      if (t == null) return false;
      const diff = now - t;
      return diff >= dayMs && diff < 2 * dayMs;
    });
  } else if (state.popPeriod === '3d') {
    pool = state.news.filter((n) => {
      const t = publishedMs(n.publishedAt);
      return t != null && now - t < 3 * dayMs;
    });
  }
  const items = (pool.length > 0 ? pool : state.news).slice(0, 8);
  el.innerHTML = items.map((n) => {
    const srcName = (n.source || 'Source').trim();
    const src = escapeHtml(srcName);
    const initial = escapeHtml(srcName.charAt(0).toUpperCase() || '·');
    const hue = popSourceHue(srcName);
    const img = n.thumbnail
      ? `<img src="${escapeHtml(n.thumbnail)}" class="pop-thumb-img" alt="" loading="lazy" decoding="async" width="64" height="48" onerror="this.onerror=null;this.style.display='none'"/>`
      : '';
    return `
    <a href="${escapeHtml(n.url)}" class="pop-item" target="_blank" rel="noopener noreferrer">
      <div class="pop-thumb" style="--pop-hue:${hue}">
        <div class="pop-thumb-fallback" aria-hidden="true"><span class="pop-thumb-initial">${initial}</span></div>
        ${img}
      </div>
      <div class="pop-content">
        <div class="pop-title">${escapeHtml(n.title)}</div>
        <div class="pop-meta"><span class="pop-src">${src}</span><span class="pop-meta-sep" aria-hidden="true">·</span>${relTimeBadge(n.publishedAt)}</div>
      </div>
    </a>`;
  }).join('');
}

function popSourceHue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function renderMarketSnapshot() {
  const el = document.getElementById('marketSnapshot');
  if (!el || !state.market) return;
  const m = state.market;
  const snap = m.marketSnapshot;

  if (snap && Array.isArray(snap.panels)) {
    const staleNote = m.meta?.commoditiesStale
      ? '<div class="mkt-snap-stale">Commodity leg stale (&gt;3h) — directional only.</div>'
      : '';
    const foot = snap.disclaimer
      ? `<p class="mkt-snap-foot">${escapeHtml(snap.disclaimer)}</p>`
      : '';

    const rowHtml = (r) => {
      const ref = r.reference ? ' mkt-row--ref' : '';
      const val =
        r.textValue != null
          ? `<span class="mkt-val mkt-val--text">${escapeHtml(r.textValue)}</span>`
          : `<span class="mkt-val">${escapeHtml(r.prefix || '')}${fmtSnapNumber(r.value)}${escapeHtml(r.suffix || '')}</span>`;
      const chg =
        !r.reference && r.changePct != null && Number.isFinite(r.changePct)
          ? `<span class="mkt-chg ${chgClass(r.changePct)}">${chgLabel(r.changePct)}</span>`
          : '';
      const hint = r.hint ? `<span class="mkt-row-hint" title="${escapeHtml(r.hint)}">ⓘ</span>` : '';
      return `<div class="mkt-row${ref}"><span class="mkt-label">${escapeHtml(r.label)}</span>${val}${chg}${hint}</div>`;
    };

    const panels = snap.panels
      .map((p) => {
        const hint = p.hint
          ? `<div class="mkt-subhint">${escapeHtml(p.hint)}</div>`
          : '';
        const rows = (p.rows || []).map(rowHtml).join('');
        return `<section class="mkt-panel"><h3 class="mkt-panel-title">${escapeHtml(p.title)}</h3>${hint}<div class="mkt-panel-rows">${rows}</div></section>`;
      })
      .join('');

    el.classList.add('market-snapshot--extended');
    el.innerHTML = `${staleNote}<div class="mkt-panels">${panels}</div>${foot}`;
    return;
  }

  el.classList.remove('market-snapshot--extended');
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

function setPakistanMapLayer(layer) {
  const L =
    layer === 'aqi' || layer === 'agri' || layer === 'flights' ? layer : 'weather';
  state.mapLayer = L;
  document.querySelectorAll('.pk-layer-btn').forEach((b) => {
    b.classList.toggle('active', (b.dataset.layer || 'weather') === L);
  });
  renderPakistanNerveCenter();
}

function renderPakistanNerveCenter() {
  const mapEl = document.getElementById('pkMapCanvas');
  const hotspotsEl = document.getElementById('pkMapHotspots');
  const kpisEl = document.getElementById('pkTelKpis');
  if (!mapEl || !hotspotsEl) return;

  const payload = state.pakistanMap;
  if (!payload || !Array.isArray(payload.points)) {
    if (kpisEl) kpisEl.innerHTML = '';
    mapEl.innerHTML = '<div class="pk-map-empty">Telemetry is loading…</div>';
    hotspotsEl.innerHTML = '<div class="pk-hotspot-empty">No detail yet.</div>';
    return;
  }

  const layer = state.mapLayer === 'aqi' || state.mapLayer === 'agri' || state.mapLayer === 'flights' ? state.mapLayer : 'weather';
  const points = payload.points;

  const toneClass = (score, kind) => {
    if (!Number.isFinite(score)) return 'muted';
    if (kind === 'flights') {
      if (score >= 70) return 'critical';
      if (score >= 45) return 'elevated';
      if (score >= 20) return 'watch';
      return 'normal';
    }
    if (kind === 'aqi') {
      if (score >= 70) return 'critical';
      if (score >= 45) return 'elevated';
      if (score >= 20) return 'watch';
      return 'normal';
    }
    if (score >= 75) return 'critical';
    if (score >= 50) return 'elevated';
    if (score >= 25) return 'watch';
    return 'normal';
  };

  const layerRiskKey = layer === 'aqi' ? 'aqi' : (layer === 'agri' ? 'agri' : (layer === 'flights' ? 'flights' : 'weather'));
  const sortedPoints = [...points].sort((a, b) => {
    const sa = Number.isFinite(a[layerRiskKey]?.score) ? a[layerRiskKey].score : -1;
    const sb = Number.isFinite(b[layerRiskKey]?.score) ? b[layerRiskKey].score : -1;
    if (sb !== sa) return sb - sa;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  const s = payload.summary || {};
  const kpiVal = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');

  if (kpisEl) {
    const kpiBtn = (ly, label, abbrev) => {
      const v =
        ly === 'weather' ? s.weatherAverage
          : ly === 'aqi' ? s.aqiAverage
            : ly === 'agri' ? s.agriAverage
              : s.flightsAverage;
      const active = layer === ly ? ' pk-kpi--active' : '';
      const suff = Number.isFinite(v) ? '<span class="pk-kpi-suffix">/100</span>' : '';
      return `
        <button type="button" class="pk-kpi${active}" data-layer="${ly}" aria-pressed="${layer === ly ? 'true' : 'false'}">
          <span class="pk-kpi-abbr">${abbrev}</span>
          <span class="pk-kpi-l">${label}</span>
          <span class="pk-kpi-v">${kpiVal(v)}${suff}</span>
        </button>`;
    };
    kpisEl.innerHTML = `
      <div class="pk-kpi-row">
        ${kpiBtn('weather', 'Weather risk', 'Wx')}
        ${kpiBtn('aqi', 'AQI pressure', 'AQ')}
        ${kpiBtn('agri', 'Crop stress', 'Ag')}
        ${kpiBtn('flights', 'Airspace', 'Fl')}
      </div>`;
  }

  const thClass = (ly) => (layer === ly ? ' class="pk-col-em"' : '');
  const cell = (score, kind, inner) => {
    const t = toneClass(score, kind);
    return `<td class="pk-cell tone-${t}">${inner}</td>`;
  };

  mapEl.innerHTML = `
    <table class="pk-tel-table">
      <thead>
        <tr>
          <th scope="col">City</th>
          <th scope="col"${thClass('weather')}>°C</th>
          <th scope="col"${thClass('aqi')}>AQI</th>
          <th scope="col"${thClass('agri')}>Agri</th>
          <th scope="col"${thClass('flights')}>Flt</th>
        </tr>
      </thead>
      <tbody>
        ${sortedPoints
          .map((p) => {
            const temp = Number.isFinite(p.weather?.temperatureC)
              ? `${Math.round(p.weather.temperatureC)}°`
              : '—';
            const aqiNum = Number.isFinite(p.aqi?.usAqi) ? String(Math.round(p.aqi.usAqi)) : '—';
            const agri = Number.isFinite(p.agri?.score) ? String(p.agri.score) : '—';
            const fl = Number.isFinite(p.flights?.count) ? String(p.flights.count) : '—';
            return `<tr>
              <th scope="row" class="pk-city">${escapeHtml(p.name)}</th>
              ${cell(p.weather?.score, 'weather', `<span class="pk-num">${temp}</span>`)}
              ${cell(p.aqi?.score, 'aqi', `<span class="pk-num">${aqiNum}</span>`)}
              ${cell(p.agri?.score, 'agri', `<span class="pk-num">${agri}</span>`)}
              ${cell(p.flights?.score, 'flights', `<span class="pk-num">${fl}</span>`)}
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>`;

  const hotspots = layer === 'aqi'
    ? payload.summary?.aqiHotspots
    : (layer === 'agri'
      ? payload.summary?.agriHotspots
      : (layer === 'flights' ? payload.summary?.flightsHotspots : payload.summary?.weatherHotspots));
  const avg = layer === 'aqi'
    ? payload.summary?.aqiAverage
    : (layer === 'agri'
      ? payload.summary?.agriAverage
      : (layer === 'flights' ? payload.summary?.flightsAverage : payload.summary?.weatherAverage));
  const avgLabel = layer === 'aqi'
    ? 'AQI Pressure'
    : (layer === 'agri' ? 'Agri Stress' : (layer === 'flights' ? 'Airspace Pressure' : 'Weather Risk'));

  const rows = Array.isArray(hotspots) ? hotspots : [];
  const layerSource = payload.meta?.sources?.[layer] || 'unknown_source';
  const observedAt = payload.meta?.observedAtLatest || payload.updatedAt || null;
  const observedLabel = observedAt
    ? new Date(observedAt).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Karachi' })
    : '--';
  const flightsMeta = layer === 'flights'
    ? {
        airborne: payload.summary?.flightsAirborne,
        onGround: payload.summary?.flightsOnGround,
        approach: payload.summary?.flightsApproachPressure,
        corridors: payload.summary?.flightsCorridors || {}
      }
    : null;

  hotspotsEl.innerHTML = `
    <div class="pk-hotspot-head">
      <span>${avgLabel}</span>
      <strong>${Number.isFinite(avg) ? `${avg}/100` : '--'}</strong>
    </div>
    ${flightsMeta ? `
      <div class="pk-flight-metrics">
        <div class="pk-flight-row"><span>Airborne</span><strong>${Number.isFinite(flightsMeta.airborne) ? flightsMeta.airborne : '--'}</strong></div>
        <div class="pk-flight-row"><span>On Ground</span><strong>${Number.isFinite(flightsMeta.onGround) ? flightsMeta.onGround : '--'}</strong></div>
        <div class="pk-flight-row"><span>Approach Pressure</span><strong>${Number.isFinite(flightsMeta.approach) ? flightsMeta.approach : '--'}</strong></div>
        <div class="pk-flight-row"><span>KHI/LHE/ISB</span><strong>${Number.isFinite(flightsMeta.corridors.KHI) ? flightsMeta.corridors.KHI : 0} / ${Number.isFinite(flightsMeta.corridors.LHE) ? flightsMeta.corridors.LHE : 0} / ${Number.isFinite(flightsMeta.corridors.ISB) ? flightsMeta.corridors.ISB : 0}</strong></div>
      </div>
      <div class="pk-flight-explain">
        <p>Pressure score reflects city flight share vs the busiest corridor in Pakistan airspace right now.</p>
        <div class="pk-flight-legend">
          <span><i class="dot normal"></i>Normal</span>
          <span><i class="dot watch"></i>Watch</span>
          <span><i class="dot elevated"></i>Elevated</span>
          <span><i class="dot critical"></i>Critical</span>
        </div>
      </div>
    ` : ''}
    <div class="pk-hotspot-list">
      ${rows
        .map((row) => `
          <div class="pk-hotspot-row">
            <span>${escapeHtml(row.city)}</span>
            <span>${Number.isFinite(row.score) ? row.score : '--'}</span>
          </div>
        `)
        .join('') || '<div class="pk-hotspot-empty">No hotspots available.</div>'}
    </div>
    <div class="pk-hotspot-footnote">Source: ${escapeHtml(layerSource)} · Updated: ${escapeHtml(observedLabel)} PKT</div>
  `;
}

function renderFooter(news) {
  const footerSourceEl = document.getElementById('footerSourceList');
  if (!footerSourceEl) return;

  if (!Array.isArray(news)) {
    footerSourceEl.textContent = 'No source data';
    return;
  }

  const sources = [...new Set(news.map((item) => item.source).filter(Boolean))];
  const formatted = sources.length ? sources.join(' · ') : 'No sources detected';
  footerSourceEl.textContent = formatted;
}

function renderKseCard() {
  const valueEl = document.getElementById('kseCardValue');
  const changeEl = document.getElementById('kseCardChange');
  if (!valueEl || !changeEl) return;

  const kse = state.market?.equities?.kse100;
  if (!Number.isFinite(kse?.value)) {
    valueEl.textContent = '--';
    changeEl.className = 'kse-local-change flat';
    changeEl.textContent = 'Live index unavailable';
    return;
  }

  const pct = Number(kse.changePct);
  const isPct = Number.isFinite(pct);
  const cls = isPct ? (pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat') : 'flat';
  const sign = isPct && pct > 0 ? '+' : '';

  valueEl.textContent = fmtNum(kse.value, 0);
  changeEl.className = `kse-local-change ${cls}`;
  changeEl.textContent = isPct ? `${sign}${pct.toFixed(2)}%` : '--';
}

// ── renderAll ──────────────────────────────────────────────────────────────

function renderAll() {
  const items = filteredNews();
  renderKseCard();
  renderMarketTicker();
  renderFlashTicker(items);
  renderHeaderSignals(items);
  renderPsxSignals();
  renderBreaking(items);
  renderCategories(items);
  renderPopularNews();
  renderPakistanNerveCenter();
  renderMarketSnapshot();
  renderLeftRail();
  renderTodaysBriefing(items);
  renderPsxPerformers();
  renderFocusCount();
  renderSearchResults();

  const updated = document.getElementById('updatedAt');
  if (updated) updated.textContent = state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString() : '--';
}

// ── Data fetching ──────────────────────────────────────────────────────────

async function fetchNews() {
  const res = await fetch(`${API_BASE}/api/news`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`news_http_${res.status}`);
  return await res.json();
}

async function fetchMarket() {
  const res = await fetch(`${API_BASE}/api/market`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`market_http_${res.status}`);
  return await res.json();
}

async function fetchPakistanMap() {
  const res = await fetch(`${API_BASE}/api/pakistan-map`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`pk_map_http_${res.status}`);
  return await res.json();
}

/** Bump counter when each parallel feed request finishes (success or failure). */
let _feedLoadGen = 0;

const FEED_LOAD_STEPS = [
  { id: 'news', label: 'RSS news' },
  { id: 'market', label: 'Markets' },
  { id: 'map', label: 'Telemetry' }
];

function setFeedLoadBarVisible(visible) {
  const bar = document.getElementById('feedLoadBar');
  if (!bar) return;
  bar.hidden = !visible;
  bar.setAttribute('aria-busy', visible ? 'true' : 'false');
}

function updateFeedLoadProgress(completed, total, stepStates) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const fill = document.getElementById('feedLoadFill');
  const progress = document.getElementById('feedLoadProgress');
  const pctEl = document.getElementById('feedLoadPct');
  const stepsEl = document.getElementById('feedLoadSteps');
  if (fill) fill.style.width = `${pct}%`;
  if (progress) progress.setAttribute('aria-valuenow', String(pct));
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (stepsEl) {
    stepsEl.textContent = FEED_LOAD_STEPS.map(({ id, label }) => {
      const s = stepStates[id] || 'pending';
      if (s === 'ok') return `${label} ✓`;
      if (s === 'err') return `${label} ✗`;
      return `${label} …`;
    }).join(' · ');
  }
}

async function refreshData() {
  const gen = ++_feedLoadGen;
  setFeedLoadBarVisible(true);

  const stepStates = Object.fromEntries(FEED_LOAD_STEPS.map(({ id }) => [id, 'pending']));
  let completed = 0;
  const total = FEED_LOAD_STEPS.length;

  const bump = (id, ok) => {
    if (gen !== _feedLoadGen) return;
    stepStates[id] = ok ? 'ok' : 'err';
    completed += 1;
    updateFeedLoadProgress(completed, total, stepStates);
  };

  updateFeedLoadProgress(0, total, stepStates);

  const results = await Promise.all([
    fetchNews().then(
      (v) => { bump('news', true); return { key: 'news', status: 'fulfilled', value: v }; },
      (e) => { bump('news', false); return { key: 'news', status: 'rejected', reason: e }; }
    ),
    fetchMarket().then(
      (v) => { bump('market', true); return { key: 'market', status: 'fulfilled', value: v }; },
      (e) => { bump('market', false); return { key: 'market', status: 'rejected', reason: e }; }
    ),
    fetchPakistanMap().then(
      (v) => { bump('map', true); return { key: 'map', status: 'fulfilled', value: v }; },
      (e) => { bump('map', false); return { key: 'map', status: 'rejected', reason: e }; }
    )
  ]);

  if (gen !== _feedLoadGen) return;

  const newsRes = results.find((r) => r.key === 'news');
  const marketRes = results.find((r) => r.key === 'market');
  const mapRes = results.find((r) => r.key === 'map');

  if (newsRes.status === 'fulfilled') {
    state.news = Array.isArray(newsRes.value.articles) ? newsRes.value.articles : [];
    state.updatedAt = newsRes.value.updatedAt || new Date().toISOString();
  }

  if (marketRes.status === 'fulfilled') {
    state.market = marketRes.value;
    state.updatedAt = marketRes.value.updatedAt || state.updatedAt;
  }

  if (mapRes.status === 'fulfilled') {
    state.pakistanMap = mapRes.value;
    state.updatedAt = mapRes.value.updatedAt || state.updatedAt;
  }

  saveCache({
    news: state.news,
    newsUpdatedAt: state.updatedAt,
    market: state.market,
    map: state.pakistanMap
  });

  renderAll();
  renderFooter(state.news);

  window.setTimeout(() => {
    if (gen !== _feedLoadGen) return;
    setFeedLoadBarVisible(false);
  }, 480);
}

// ── Event binding ──────────────────────────────────────────────────────────

function bindEvents() {
  // Focus toggle
  const focusToggle = document.getElementById('focusModeToggle');
  if (focusToggle) {
    focusToggle.checked = state.strictFocus;
    focusToggle.addEventListener('change', (e) => {
      state.strictFocus = Boolean(e.target.checked);
      renderAll();
    });
  }

  // Refresh button
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      try { await refreshData(); } finally { refreshBtn.disabled = false; }
    });
  }

  // Popular period tabs
  const popTabs = document.querySelectorAll('.pop-tab');
  popTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.popPeriod = btn.dataset.period || 'today';
      popTabs.forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderPopularNews();
    });
  });

  const telWidget = document.querySelector('.pk-tel-widget');
  if (telWidget) {
    telWidget.addEventListener('click', (e) => {
      const kpi = e.target.closest('.pk-kpi');
      if (kpi && kpi.dataset.layer) {
        e.preventDefault();
        setPakistanMapLayer(kpi.dataset.layer);
      }
    });
  }

  const layerBtns = document.querySelectorAll('.pk-layer-btn');
  layerBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setPakistanMapLayer(btn.dataset.layer || 'weather');
    });
  });

  // Dark mode toggle
  const darkToggle = document.getElementById('darkToggle');
  if (darkToggle) {
    const savedTheme = sessionStorage.getItem('brief-pk-theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    darkToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      sessionStorage.setItem('brief-pk-theme', next);
    });
  }

  // Search input with debounce
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');
  let searchDebounce;

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        state.searchQuery = e.target.value.trim();
        if (searchClear) searchClear.style.display = state.searchQuery ? '' : 'none';
        renderAll();
      }, 250);
    });
  }

  if (searchClear) {
    searchClear.style.display = 'none';
    searchClear.addEventListener('click', () => {
      state.searchQuery = '';
      if (searchInput) searchInput.value = '';
      searchClear.style.display = 'none';
      renderAll();
    });
  }

  // Clear search from results block
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      state.searchQuery = '';
      if (searchInput) searchInput.value = '';
      if (searchClear) searchClear.style.display = 'none';
      renderAll();
    });
  }

  // PSX Performers tabs
  const perfTabs = document.querySelectorAll('.perf-tab');
  perfTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      perfTabs.forEach(b => b.classList.toggle('active', b === btn));
      renderPsxPerformers(btn.dataset.perf);
    });
  });

  // Clear source filter
  const clearSrcBtn = document.getElementById('clearSourceBtn');
  if (clearSrcBtn) {
    clearSrcBtn.addEventListener('click', () => {
      state.activeSource = null;
      clearSrcBtn.style.display = 'none';
      renderAll();
    });
  }
}

// ── AI Intelligence Strip ──────────────────────────────────────────────────

const INTEL_CLIENT_TTL = 30 * 60 * 1000;
const SPARKLINE_KEY = 'brief-pk-sparklines-v1';
const SPARKLINE_MAX = 5;
let _intelLastFetch = 0;

function saveSparklineSnapshot(indicators) {
  try {
    const raw = localStorage.getItem(SPARKLINE_KEY);
    const history = raw ? JSON.parse(raw) : [];
    const snap = { ts: Date.now(), scores: {} };
    for (const ind of indicators) snap.scores[ind.id] = ind.score;
    history.push(snap);
    if (history.length > SPARKLINE_MAX) history.splice(0, history.length - SPARKLINE_MAX);
    localStorage.setItem(SPARKLINE_KEY, JSON.stringify(history));
  } catch { /* quota / private */ }
}

function loadSparklineHistory() {
  try {
    const raw = localStorage.getItem(SPARKLINE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function buildSparklineSVG(history, id) {
  const W = 56, H = 22, PAD = 2;
  const vals = history.map(s => Number.isFinite(s.scores[id]) ? s.scores[id] : null).filter(v => v !== null);
  if (vals.length < 2) return '';
  const xs = vals.map((_, i) => PAD + ((W - PAD * 2) / (vals.length - 1)) * i);
  const ys = vals.map(v => H - PAD - ((v / 100) * (H - PAD * 2)));
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const last = vals[vals.length - 1];
  const col = last >= 65 ? '#16a34a' : last >= 40 ? '#d97706' : '#dc2626';
  const dotX = xs[xs.length - 1].toFixed(1);
  const dotY = ys[ys.length - 1].toFixed(1);
  return `<svg class="ai-sparkline" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${dotX}" cy="${dotY}" r="2" fill="${col}"/></svg>`;
}

function scoreColor(score) {
  if (score >= 65) return '#16a34a';   // green — favorable
  if (score >= 40) return '#d97706';   // amber — moderate
  return '#dc2626';                    // red   — critical
}

function trendIcon(trend) {
  if (trend === 'improving') return '<span class="ai-trend ai-trend-up">↑</span>';
  if (trend === 'declining') return '<span class="ai-trend ai-trend-down">↓</span>';
  return '<span class="ai-trend ai-trend-flat">→</span>';
}

function renderIntelligence(data) {
  const briefEl = document.getElementById('aiDailyBrief');
  const rowEl   = document.getElementById('aiIndicatorsRow');
  const watchEl = document.getElementById('aiWatchFor');
  const synthEl = document.getElementById('aiSynthesisWrap');
  const ageEl   = document.getElementById('aiIntelAge');
  if (!rowEl || !synthEl) return;

  // Age label
  if (ageEl && data.generatedAt) {
    const mins = Math.round((Date.now() - new Date(data.generatedAt).getTime()) / 60000);
    const staleTag = data.stale ? ' <span class="stale-chip">stale</span>' : '';
    ageEl.innerHTML = `Generated ${mins < 1 ? 'just now' : `${mins}m ago`} · ${data.headlineCount || 0} headlines · Groq${staleTag}`;
  }

  // ── Priority 1: Daily Brief ────────────────────────────────────────────
  if (briefEl) {
    const bullets = Array.isArray(data.dailyBrief) ? data.dailyBrief : [];
    if (bullets.length) {
      briefEl.innerHTML = `
        <div class="ai-brief-label">Today in Pakistan</div>
        ${bullets.map((b, i) => `
          <div class="ai-brief-bullet">
            <span class="ai-brief-num">${i + 1}</span>
            <div class="ai-brief-content">
              <div class="ai-brief-headline">${escapeHtml(b.headline)}</div>
              <div class="ai-brief-detail">${escapeHtml(b.detail)}</div>
            </div>
          </div>
        `).join('')}
      `;
    } else {
      briefEl.innerHTML = '';
    }
  }

  // ── Priority 2: Save sparkline snapshot then render ────────────────────
  if (Array.isArray(data.indicators) && data.indicators.length) {
    saveSparklineSnapshot(data.indicators);
  }
  const sparkHistory = loadSparklineHistory();

  // ── Indicator cards with sparklines ───────────────────────────────────
  rowEl.innerHTML = (data.indicators || []).map(ind => {
    const col   = scoreColor(ind.score);
    const score = Number.isFinite(ind.score) ? ind.score : 50;
    const spark = buildSparklineSVG(sparkHistory, ind.id);
    return `
      <div class="ai-ind-card" data-id="${escapeHtml(ind.id)}">
        <div class="ai-ind-border" style="background:${col}"></div>
        <div class="ai-ind-body">
          <div class="ai-ind-label">${escapeHtml(ind.label)}</div>
          <div class="ai-ind-score-row">
            <span class="ai-ind-score" style="color:${col}">${score}</span>
            ${trendIcon(ind.trend)}
            ${spark}
          </div>
          <div class="ai-gauge-wrap">
            <div class="ai-gauge-fill" style="width:${score}%;background:${col}"></div>
          </div>
          <div class="ai-ind-signal">${escapeHtml(ind.signal || '')}</div>
          <div class="ai-ind-brief">${escapeHtml(ind.brief || '')}</div>
        </div>
      </div>
    `;
  }).join('');

  // ── Priority 3: What to Watch ──────────────────────────────────────────
  if (watchEl) {
    const watches = Array.isArray(data.watchFor) ? data.watchFor.filter(Boolean) : [];
    watchEl.innerHTML = watches.length ? `
      <div class="ai-watch-label">What to Watch</div>
      <div class="ai-watch-list">
        ${watches.map((w, i) => `
          <div class="ai-watch-item">
            <span class="ai-watch-num">${['①','②'][i] || (i+1)}</span>
            <span>${escapeHtml(w)}</span>
          </div>
        `).join('')}
      </div>
    ` : '';
  }

  // Synthesis
  synthEl.innerHTML = data.synthesis
    ? `<p class="ai-synthesis-text">${escapeHtml(data.synthesis)}</p>`
    : '';
}

function renderIntelligenceError(msg) {
  const rowEl   = document.getElementById('aiIndicatorsRow');
  const ageEl   = document.getElementById('aiIntelAge');
  if (rowEl) rowEl.innerHTML = `<div class="ai-intel-err">${escapeHtml(msg)}</div>`;
  if (ageEl)  ageEl.textContent = 'Unavailable';
}

/** Server has no Groq key — calm empty state instead of a red error wall */
function renderIntelligenceOffline() {
  const rowEl   = document.getElementById('aiIndicatorsRow');
  const ageEl   = document.getElementById('aiIntelAge');
  const briefEl = document.getElementById('aiDailyBrief');
  const watchEl = document.getElementById('aiWatchFor');
  const synthEl = document.getElementById('aiSynthesisWrap');
  if (ageEl) ageEl.textContent = 'Not configured';
  if (briefEl) {
    briefEl.innerHTML = `
      <div class="ai-offline-panel">
        <p class="ai-offline-title">Intelligence scan is off</p>
        <p class="ai-offline-body">Set <code>GROQ_API_KEY</code> in the server environment to enable the AI briefing. The rest of the dashboard works without it.</p>
      </div>`;
  }
  if (rowEl) rowEl.innerHTML = '';
  if (watchEl) watchEl.innerHTML = '';
  if (synthEl) synthEl.innerHTML = '';
}

async function fetchIntelligence(force = false) {
  // Client-side rate limit — don't hammer the endpoint
  if (!force && Date.now() - _intelLastFetch < INTEL_CLIENT_TTL) return;
  _intelLastFetch = Date.now();

  try {
    const url = `${API_BASE}/api/intelligence${force ? '?force=1' : ''}`;
    const res  = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      const msg = String(err.error || `HTTP ${res.status}`);
      if (res.status === 503 && /GROQ|not configured/i.test(msg)) {
        renderIntelligenceOffline();
        return;
      }
      throw new Error(msg);
    }
    const data = await res.json();
    renderIntelligence(data);
  } catch (err) {
    renderIntelligenceError(`Analysis unavailable: ${err.message}`);
  }
}

function initIntelligence() {
  fetchIntelligence(); // initial load

  // Refresh button
  const btn = document.getElementById('aiRefreshBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      const rowEl = document.getElementById('aiIndicatorsRow');
      if (rowEl) {
        rowEl.innerHTML = Array(6).fill('<div class="ai-ind-skel skel"></div>').join('');
      }
      _intelLastFetch = 0; // reset client throttle
      fetchIntelligence(true);
    });
  }

  // Re-run every 30 min, aligned with server cache
  setInterval(() => fetchIntelligence(), INTEL_CLIENT_TTL);
}

// ── Pakistan Trajectory (WDI macro panel) ───────────────────────────────────

const PJT_COLORS = {
  gdpGrowth: '#0369a1',
  inflation: '#b45309',
  extDebtGni: '#7c3aed',
  poverty: '#dc2626'
};

/** Plain English context for each indicator (shown under the chart title). */
const PJT_LABELS = {
  gdpGrowth: { title: 'GDP growth', sub: 'Annual % change in real GDP · WDI' },
  inflation: { title: 'CPI inflation', sub: 'Annual % change in consumer prices · WDI' },
  extDebtGni: { title: 'External debt / GNI', sub: 'External debt stocks as % of GNI · WDI' },
  poverty: { title: 'Poverty headcount', sub: 'Share of population below the World Bank poverty line (survey years)' }
};

let _pjtMacro = null;
const _pjtState = {
  focused: 'gdpGrowth',
  range: 'all',
  hoverIdx: -1
};

function pjtYRange(points) {
  const vs = points.map((p) => p.v).filter(Number.isFinite);
  if (!vs.length) return { min: 0, max: 1 };
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.12 || 0.5;
  return { min: lo - pad, max: hi + pad };
}

/** Build a set of "nice" y-axis tick values covering [min, max]. */
function pjtNiceTicks(min, max, count = 4) {
  const span = max - min;
  if (span <= 0) return [min];
  const rough = span / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const m = rough / pow;
  let step;
  if (m < 1.5) step = 1 * pow;
  else if (m < 3) step = 2 * pow;
  else if (m < 7) step = 5 * pow;
  else step = 10 * pow;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + 1e-9; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
    if (ticks.length > 10) break;
  }
  return ticks;
}

function pjtFormatAxisTick(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 100) return String(Math.round(v));
  return (Math.round(v * 10) / 10).toFixed(1);
}

/**
 * Turn bundled / AI text into readable HTML. Within a paragraph single newlines
 * are treated as part of flowing text (joined with a space). Paragraphs are
 * separated by blank lines. Bulleted blocks are rendered as <ul>. The
 * dev-only `npm run update-macro` hint is moved into a collapsed details block.
 */
function pjtFormatInsightToHtml(raw) {
  let t = (raw || '').replace(/\s*To refresh numbers, run:\s*npm run update-macro\s*/gi, '').trim();
  if (!t) return '<p class="pjt-insight-p pjt-insight-p--muted">No analysis text yet.</p>';
  const paras = t.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const body = paras
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      const bulletRe = /^(?:[-•*]|\u2013|\u2014)\s+/;
      const allBullets = lines.length > 1 && lines.every((l) => bulletRe.test(l));
      if (allBullets) {
        const items = lines
          .map((l) => `<li>${escapeHtml(l.replace(bulletRe, ''))}</li>`)
          .join('');
        return `<ul class="pjt-insight-ul">${items}</ul>`;
      }
      return `<p class="pjt-insight-p">${escapeHtml(lines.join(' '))}</p>`;
    })
    .join('');
  const dev =
    '<details class="pjt-dev-hint"><summary>Developer</summary><p class="pjt-insight-p pjt-insight-p--small">Regenerate static JSON: <code>npm run update-macro</code></p></details>';
  return body + dev;
}

function pjtFmtValue(v, unit) {
  if (!Number.isFinite(v)) return '—';
  const rounded = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
  return unit === '%' ? `${rounded}%` : rounded;
}

/** Tiny sparkline SVG for KPI cards. */
function pjtRenderSparkline(points, color, W = 120, H = 28) {
  const pts = (points || []).filter((p) => Number.isFinite(p.v));
  if (!pts.length) return '';
  const vs = pts.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const spanY = Math.max(hi - lo, 1e-9);
  const years = pts.map((p) => p.y);
  const ymin = Math.min(...years);
  const ymax = Math.max(...years);
  const spanX = Math.max(ymax - ymin, 1);
  const pad = 3;
  const xScale = (y) => pad + ((y - ymin) / spanX) * (W - pad * 2);
  const yScale = (v) => pad + (1 - (v - lo) / spanY) * (H - pad * 2);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.y).toFixed(1)} ${yScale(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const lx = xScale(last.y).toFixed(1);
  const ly = yScale(last.v).toFixed(1);
  return `<svg class="pjt-spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lx}" cy="${ly}" r="2.25" fill="${color}"/></svg>`;
}

/**
 * Build 4 KPI cards that act as single-select tabs: clicking one focuses that
 * metric in the big chart below. Exactly one card is active at a time.
 */
function pjtBuildKpis() {
  const el = document.getElementById('pjtKpis');
  if (!el || !_pjtMacro) return;
  el.innerHTML = _pjtMacro.series
    .map((s) => {
      const pts = (s.points || []).filter((p) => Number.isFinite(p.v));
      const first = pts[0];
      const last = pts[pts.length - 1];
      const col = PJT_COLORS[s.id] || '#64748b';
      const active = _pjtState.focused === s.id;
      const latestVal = last ? pjtFmtValue(last.v, s.unit) : '—';
      const latestYear = last ? last.y : '';
      const deltaV = first && last ? last.v - first.v : null;
      const dir = deltaV == null ? '' : deltaV > 0.05 ? 'up' : deltaV < -0.05 ? 'down' : 'flat';
      const deltaArrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
      const deltaText =
        deltaV == null
          ? ''
          : `${deltaV > 0 ? '+' : ''}${Math.abs(deltaV) >= 100 ? deltaV.toFixed(0) : deltaV.toFixed(1)}${s.unit === '%' ? 'pp' : ''} vs ${first.y}`;
      const spark = pjtRenderSparkline(pts, col, 128, 30);
      return `
        <button type="button" class="pjt-kpi${active ? ' is-active' : ''}" data-pjt-id="${escapeHtml(s.id)}" style="--pjt-accent:${col}" role="tab" aria-selected="${active ? 'true' : 'false'}" tabindex="${active ? '0' : '-1'}">
          <span class="pjt-kpi-accent" aria-hidden="true"></span>
          <div class="pjt-kpi-header">
            <span class="pjt-kpi-label">${escapeHtml(s.shortLabel || s.id)}</span>
            <span class="pjt-kpi-year">${latestYear}</span>
          </div>
          <div class="pjt-kpi-value"><span class="pjt-kpi-num">${latestVal}</span></div>
          ${deltaText ? `<div class="pjt-kpi-delta pjt-kpi-delta--${dir}"><span class="pjt-kpi-arrow">${deltaArrow}</span>${deltaText}</div>` : ''}
          <div class="pjt-kpi-spark">${spark}</div>
        </button>
      `;
    })
    .join('');

  const buttons = el.querySelectorAll('button.pjt-kpi');
  buttons.forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      pjtSetFocused(btn.dataset.pjtId);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = buttons[(idx + 1) % buttons.length];
        next.focus();
        pjtSetFocused(next.dataset.pjtId);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = buttons[(idx - 1 + buttons.length) % buttons.length];
        prev.focus();
        pjtSetFocused(prev.dataset.pjtId);
      }
    });
  });
}

function pjtSetFocused(id) {
  if (!id || _pjtState.focused === id) return;
  _pjtState.focused = id;
  _pjtState.hoverIdx = -1;
  document.querySelectorAll('#pjtKpis .pjt-kpi').forEach((b) => {
    const on = b.dataset.pjtId === id;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.setAttribute('tabindex', on ? '0' : '-1');
  });
  pjtRenderFocusChart(true);
  pjtRenderStats();
}

function pjtSetRange(range) {
  const r = range === 'all' ? 'all' : parseInt(range, 10);
  if (_pjtState.range === r) return;
  _pjtState.range = r;
  document.querySelectorAll('.pjt-range-tab').forEach((b) => {
    const on = b.dataset.range === String(range);
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  _pjtState.hoverIdx = -1;
  pjtRenderFocusChart(true);
  pjtRenderStats();
}

/** Filter a series' points to the current range window. */
function pjtFilterByRange(points) {
  if (_pjtState.range === 'all' || !points.length) return points.slice();
  const last = points[points.length - 1];
  const from = last.y - _pjtState.range;
  return points.filter((p) => p.y >= from);
}

function pjtFocusedSeries() {
  if (!_pjtMacro) return null;
  return _pjtMacro.series.find((s) => s.id === _pjtState.focused) || _pjtMacro.series[0];
}

/**
 * Single focused chart for the currently selected indicator. Fixed height — no
 * layout jumping when the user switches metric. Includes area gradient,
 * peak / low / latest markers, and a live hover crosshair that is wired up in
 * pjtWireChartHover().
 */
const PJT_CHART_VB = { W: 800, H: 340 };
const PJT_PAD = { L: 50, R: 28, T: 16, B: 32 };

/** Store scales / points so the hover handler can look them up without recomputing. */
let _pjtChartCtx = null;

function pjtRenderFocusChart(animate = false) {
  const svg = document.getElementById('pjtChart');
  const skel = document.getElementById('pjtChartSkel');
  const titleEl = document.getElementById('pjtFocusTitle');
  const subEl = document.getElementById('pjtFocusSub');
  if (!svg || !_pjtMacro) return;

  const s = pjtFocusedSeries();
  if (!s) return;
  const col = PJT_COLORS[s.id] || '#64748b';
  const label = PJT_LABELS[s.id] || { title: s.shortLabel || s.id, sub: '' };

  if (titleEl) titleEl.textContent = label.title;
  if (subEl) subEl.textContent = label.sub;

  const allPts = (s.points || []).filter((p) => Number.isFinite(p.v));
  const pts = pjtFilterByRange(allPts);

  const { W, H } = PJT_CHART_VB;
  const { L: padL, R: padR, T: padT, B: padB } = PJT_PAD;
  const plotL = padL;
  const plotR = W - padR;
  const plotT = padT;
  const plotB = H - padB;
  const plotW = plotR - plotL;
  const plotH = plotB - plotT;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  if (!pts.length) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" dominant-baseline="middle" fill="currentColor" fill-opacity="0.5" font-family="Inter,system-ui,sans-serif" font-size="13">No observations in this range.</text>`;
    _pjtChartCtx = null;
    if (skel) skel.hidden = true;
    return;
  }

  const years = pts.map((p) => p.y);
  const xMin = years[0];
  const xMax = years[years.length - 1];
  const xSpan = Math.max(xMax - xMin, 1);
  const { min: yMin, max: yMax } = pjtYRange(pts);
  const ySpan = Math.max(yMax - yMin, 1e-9);

  const xScale = (y) => plotL + ((y - xMin) / xSpan) * plotW;
  const yScale = (v) => plotT + ((yMax - v) / ySpan) * plotH;

  const parts = [];

  const gradId = `pjt-grad-${s.id}`;
  parts.push(
    `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${col}" stop-opacity="0.32"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>`
  );

  const yTicks = pjtNiceTicks(yMin, yMax, 4);
  const pctSuf = s.unit === '%' ? '%' : '';
  for (const t of yTicks) {
    const y = yScale(t);
    if (y < plotT - 0.5 || y > plotB + 0.5) continue;
    parts.push(
      `<line class="pjt-grid-h" x1="${plotL}" y1="${y}" x2="${plotR}" y2="${y}" stroke="currentColor" stroke-opacity="0.09" stroke-dasharray="2 4" stroke-width="0.75"/>`
    );
    parts.push(
      `<text x="${plotL - 10}" y="${y}" dominant-baseline="middle" text-anchor="end" font-family="JetBrains Mono,monospace" font-size="10.5" fill="currentColor" fill-opacity="0.55">${pjtFormatAxisTick(t)}${escapeHtml(pctSuf)}</text>`
    );
  }

  const yearStep = xSpan > 35 ? 10 : xSpan > 15 ? 5 : xSpan > 8 ? 2 : 1;
  const firstTick = Math.ceil(xMin / yearStep) * yearStep;
  for (let y = firstTick; y <= xMax; y += yearStep) {
    const x = xScale(y);
    parts.push(
      `<line x1="${x}" y1="${plotT}" x2="${x}" y2="${plotB}" stroke="currentColor" stroke-opacity="0.05" stroke-width="0.75"/>`
    );
    parts.push(
      `<text x="${x}" y="${plotB + 18}" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="10.5" fill="currentColor" fill-opacity="0.55">${y}</text>`
    );
  }

  parts.push(
    `<line x1="${plotL}" y1="${plotB}" x2="${plotR}" y2="${plotB}" stroke="currentColor" stroke-opacity="0.25" stroke-width="1"/>`
  );

  const linePath = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.y).toFixed(2)} ${yScale(p.v).toFixed(2)}`)
    .join(' ');
  const areaPath =
    `M ${xScale(pts[0].y).toFixed(2)} ${plotB} ` +
    pts.map((p) => `L ${xScale(p.y).toFixed(2)} ${yScale(p.v).toFixed(2)}`).join(' ') +
    ` L ${xScale(pts[pts.length - 1].y).toFixed(2)} ${plotB} Z`;

  parts.push(
    `<path class="pjt-area${animate ? ' pjt-anim' : ''}" fill="url(#${gradId})" stroke="none" d="${areaPath}"/>`
  );
  parts.push(
    `<path class="pjt-line${animate ? ' pjt-anim' : ''}" stroke="${col}" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="${linePath}"/>`
  );

  let maxI = 0;
  let minI = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].v > pts[maxI].v) maxI = i;
    if (pts[i].v < pts[minI].v) minI = i;
  }
  const lastI = pts.length - 1;

  const annotate = (idx, kind, txt) => {
    const p = pts[idx];
    const cx = xScale(p.y);
    const cy = yScale(p.v);
    const above = cy > plotT + 32;
    const labelY = above ? cy - 14 : cy + 20;
    const textAnchor = cx < plotL + 60 ? 'start' : cx > plotR - 60 ? 'end' : 'middle';
    parts.push(
      `<circle class="pjt-marker pjt-marker--${kind}" cx="${cx}" cy="${cy}" r="4.5" fill="${col}" stroke="var(--surface, #fff)" stroke-width="2"/>`
    );
    parts.push(
      `<text x="${cx}" y="${labelY}" text-anchor="${textAnchor}" font-family="Inter,system-ui,sans-serif" font-size="10.5" font-weight="600" fill="${col}">${escapeHtml(txt)}</text>`
    );
  };
  if (pts.length > 1 && maxI !== lastI) {
    annotate(maxI, 'peak', `Peak ${pjtFmtValue(pts[maxI].v, s.unit)} (${pts[maxI].y})`);
  }
  if (pts.length > 2 && minI !== lastI && minI !== maxI) {
    annotate(minI, 'low', `Low ${pjtFmtValue(pts[minI].v, s.unit)} (${pts[minI].y})`);
  }
  annotate(lastI, 'now', `${pjtFmtValue(pts[lastI].v, s.unit)} · ${pts[lastI].y}`);

  parts.push(
    `<line class="pjt-crosshair" id="pjtCross" x1="0" y1="${plotT}" x2="0" y2="${plotB}" stroke="${col}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>`
  );
  parts.push(
    `<circle class="pjt-hover-dot" id="pjtHoverDot" r="5" cx="0" cy="0" fill="${col}" stroke="var(--surface, #fff)" stroke-width="2" visibility="hidden"/>`
  );

  svg.innerHTML = parts.join('');
  svg.setAttribute('class', 'pjt-chart pjt-chart--focus');
  svg.setAttribute('aria-label', `${label.title} — ${label.sub}`);
  if (skel) skel.hidden = true;

  _pjtChartCtx = {
    W,
    H,
    plotL,
    plotR,
    plotT,
    plotB,
    plotW,
    plotH,
    xMin,
    xMax,
    xSpan,
    pts,
    color: col,
    unit: s.unit,
    xScale,
    yScale
  };
}

function pjtRenderStats() {
  const el = document.getElementById('pjtStats');
  if (!el || !_pjtMacro) return;
  const s = pjtFocusedSeries();
  if (!s) return;
  const allPts = (s.points || []).filter((p) => Number.isFinite(p.v));
  if (!allPts.length) {
    el.innerHTML = '';
    return;
  }
  let maxI = 0;
  let minI = 0;
  for (let i = 1; i < allPts.length; i++) {
    if (allPts[i].v > allPts[maxI].v) maxI = i;
    if (allPts[i].v < allPts[minI].v) minI = i;
  }
  const first = allPts[0];
  const last = allPts[allPts.length - 1];
  const delta = last.v - first.v;
  const deltaSign = delta > 0 ? '+' : '';
  const deltaStr = `${deltaSign}${Math.abs(delta) >= 100 ? delta.toFixed(0) : delta.toFixed(1)}${s.unit === '%' ? 'pp' : ''}`;
  const deltaDir = delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat';

  el.innerHTML = `
    <div class="pjt-stat">
      <span class="pjt-stat-label">Latest</span>
      <span class="pjt-stat-value">${pjtFmtValue(last.v, s.unit)}</span>
      <span class="pjt-stat-meta">${last.y}</span>
    </div>
    <div class="pjt-stat">
      <span class="pjt-stat-label">Peak</span>
      <span class="pjt-stat-value">${pjtFmtValue(allPts[maxI].v, s.unit)}</span>
      <span class="pjt-stat-meta">${allPts[maxI].y}</span>
    </div>
    <div class="pjt-stat">
      <span class="pjt-stat-label">Low</span>
      <span class="pjt-stat-value">${pjtFmtValue(allPts[minI].v, s.unit)}</span>
      <span class="pjt-stat-meta">${allPts[minI].y}</span>
    </div>
    <div class="pjt-stat">
      <span class="pjt-stat-label">Change since ${first.y}</span>
      <span class="pjt-stat-value pjt-stat-value--${deltaDir}">${deltaStr}</span>
      <span class="pjt-stat-meta">${last.y - first.y} yrs</span>
    </div>
  `;
}

function pjtWireChartHover() {
  const wrap = document.getElementById('pjtChartWrap');
  const svg = document.getElementById('pjtChart');
  const tooltip = document.getElementById('pjtTooltip');
  if (!wrap || !svg || !tooltip || wrap.dataset.wired === '1') return;
  wrap.dataset.wired = '1';

  const hideHover = () => {
    const cross = svg.querySelector('#pjtCross');
    const dot = svg.querySelector('#pjtHoverDot');
    if (cross) cross.setAttribute('visibility', 'hidden');
    if (dot) dot.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
    _pjtState.hoverIdx = -1;
  };

  const onMove = (clientX, clientY) => {
    const ctx = _pjtChartCtx;
    if (!ctx || !ctx.pts.length) return;
    const rect = svg.getBoundingClientRect();
    const relX = clientX - rect.left;
    const svgX = (relX / rect.width) * ctx.W;
    if (svgX < ctx.plotL - 8 || svgX > ctx.plotR + 8) {
      hideHover();
      return;
    }
    const targetYear = ctx.xMin + ((svgX - ctx.plotL) / ctx.plotW) * ctx.xSpan;
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < ctx.pts.length; i++) {
      const d = Math.abs(ctx.pts[i].y - targetYear);
      if (d < best) { best = d; idx = i; }
    }
    if (idx === _pjtState.hoverIdx) {
      const p = ctx.pts[idx];
      const cx = ctx.xScale(p.y);
      const cy = ctx.yScale(p.v);
      pjtPositionTooltip(wrap, svg, cx, cy, rect);
      return;
    }
    _pjtState.hoverIdx = idx;

    const p = ctx.pts[idx];
    const cx = ctx.xScale(p.y);
    const cy = ctx.yScale(p.v);
    const cross = svg.querySelector('#pjtCross');
    const dot = svg.querySelector('#pjtHoverDot');
    if (cross) {
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.setAttribute('visibility', 'visible');
    }
    if (dot) {
      dot.setAttribute('cx', cx);
      dot.setAttribute('cy', cy);
      dot.setAttribute('visibility', 'visible');
    }

    const prev = idx > 0 ? ctx.pts[idx - 1] : null;
    const yoy = prev ? p.v - prev.v : null;
    const first = ctx.pts[0];
    const sinceFirst = p.v - first.v;
    const sign = (n) => (n > 0 ? '+' : '');
    const pp = ctx.unit === '%' ? 'pp' : '';
    const fmt = (n) => `${sign(n)}${Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)}${pp}`;
    tooltip.innerHTML = `
      <div class="pjt-tt-year">${p.y}</div>
      <div class="pjt-tt-value" style="color:${ctx.color}">${pjtFmtValue(p.v, ctx.unit)}</div>
      <div class="pjt-tt-deltas">
        ${yoy != null ? `<span class="pjt-tt-d">YoY ${fmt(yoy)}</span>` : ''}
        <span class="pjt-tt-d">vs ${first.y} ${fmt(sinceFirst)}</span>
      </div>
    `;
    tooltip.hidden = false;
    pjtPositionTooltip(wrap, svg, cx, cy, rect);
  };

  svg.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
  svg.addEventListener('mouseleave', hideHover);
  svg.addEventListener('touchstart', (e) => {
    if (e.touches.length) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  svg.addEventListener('touchmove', (e) => {
    if (e.touches.length) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  svg.addEventListener('touchend', hideHover);
}

function pjtPositionTooltip(wrap, svg, svgX, svgY, rect) {
  const tooltip = document.getElementById('pjtTooltip');
  if (!tooltip) return;
  const ctx = _pjtChartCtx;
  if (!ctx) return;
  const px = (svgX / ctx.W) * rect.width;
  const py = (svgY / ctx.H) * rect.height;
  const wrapRect = wrap.getBoundingClientRect();
  const offsetX = rect.left - wrapRect.left;
  const offsetY = rect.top - wrapRect.top;
  const tw = tooltip.offsetWidth || 140;
  const th = tooltip.offsetHeight || 60;
  let left = offsetX + px + 14;
  if (left + tw > wrap.clientWidth - 6) left = offsetX + px - tw - 14;
  if (left < 6) left = 6;
  let top = offsetY + py - th - 10;
  if (top < 6) top = offsetY + py + 14;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function pjtWireRangeTabs() {
  document.querySelectorAll('.pjt-range-tab').forEach((btn) => {
    if (btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      pjtSetRange(btn.dataset.range);
    });
  });
}

async function initPakistanTrajectory() {
  const section = document.getElementById('pakistanTrajectorySection');
  if (!section) return;

  let macro;
  try {
    const r = await fetch('/data/pakistan-macro.json', { cache: 'default' });
    if (!r.ok) throw new Error(String(r.status));
    macro = await r.json();
  } catch {
    try {
      const r2 = await fetch(`${API_BASE}/api/pakistan-macro`);
      if (!r2.ok) throw new Error(String(r2.status));
      macro = await r2.json();
    } catch {
      section.style.display = 'none';
      return;
    }
  }

  _pjtMacro = macro;
  if (!macro.series.some((s) => s.id === _pjtState.focused)) {
    _pjtState.focused = macro.series[0]?.id || 'gdpGrowth';
  }

  const updatedEl = document.getElementById('pjtUpdated');
  if (updatedEl && macro.meta?.updatedAt) {
    const yTo = macro.meta.range?.to;
    updatedEl.textContent = `WDI · Bundle ${macro.meta.updatedAt.slice(0, 10)}${yTo != null ? ` · query to ${yTo}` : ''}`;
  }
  const disc = document.getElementById('pjtDisclaimer');
  if (disc) disc.textContent = macro.meta?.disclaimer || '';

  const insightEl = document.getElementById('pjtInsightText');
  if (insightEl) insightEl.innerHTML = pjtFormatInsightToHtml(macro.staticInsight || '');

  pjtBuildKpis();
  pjtRenderFocusChart(false);
  pjtRenderStats();
  pjtWireChartHover();
  pjtWireRangeTabs();

  const btn = document.getElementById('pjtAiBtn');
  const hint = document.getElementById('pjtAiHint');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      if (hint) hint.textContent = 'Loading…';
      try {
        const res = await fetch(`${API_BASE}/api/pakistan-macro-insight`);
        const j = await res.json();
        if (insightEl) insightEl.innerHTML = pjtFormatInsightToHtml(j.text || '');
        if (hint) {
          hint.textContent =
            j.source === 'ai'
              ? (j.cached ? 'Served from shared server cache (low cost).' : 'Fresh AI text; cached for all visitors.')
              : 'Bundled analysis (set GROQ_API_KEY on the API server for AI).';
        }
      } catch {
        if (hint) hint.textContent = 'Insight API unreachable — static text above remains.';
      } finally {
        btn.disabled = false;
      }
    });
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────

function initScrollToTop() {
  const btn = document.createElement('button');
  btn.id = 'scrollTopBtn';
  btn.className = 'scroll-top-btn';
  btn.setAttribute('aria-label', 'Scroll to top');
  btn.innerHTML = '↑';
  document.body.appendChild(btn);

  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 300);
  }, { passive: true });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

async function init() {
  bindEvents();
  initScrollToTop();
  initIntelligence();
  updateClock();
  setInterval(updateClock, 1000);

  // Try to render from sessionStorage cache for fast initial paint
  const cached = loadCache();
  if (cached) {
    if (cached.news) { state.news = cached.news; state.updatedAt = cached.newsUpdatedAt; }
    if (cached.market) state.market = cached.market;
    if (cached.map) state.pakistanMap = cached.map;
    renderAll();
    renderFooter(state.news);
  }

  // Always do a fresh network fetch (cache is just for fast initial paint)
  await Promise.all([refreshData(), initPakistanTrajectory()]);
  setInterval(refreshData, REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', init);
