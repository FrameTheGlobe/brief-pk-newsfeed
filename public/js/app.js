/**
 * public/js/app.js
 * brief.pk Pakistan News Intelligence — v3.0.0
 * Ground-up rewrite: ultra-dense 3-col terminal layout
 */

'use strict';

/* ═══════════════════════════════════════════════════
   CONSTANTS & CONFIG
═══════════════════════════════════════════════════ */
const CACHE_KEY     = 'brief_pk_cache_v3';
const CACHE_TTL_MS  = 5 * 60 * 1000;  // 5 minutes
const REFRESH_MS    = 4 * 60 * 1000;  // auto-refresh every 4 min
const BQ_LIMIT      = 10;              // breaking queue items
const LF_LIMIT      = 30;             // live feed items per tab
const COMPACT_LIMIT = 8;              // compact cards per category section
const TREND_LIMIT   = 8;              // trend radar items
const SOURCE_LIMIT  = 7;              // source breakdown items

const INTERNAL_CATS = new Set(['Politics','Economy','Society','Sports','Tech','Business','Health','Education','Environment','Science']);
const EXTERNAL_CATS = new Set(['Geopolitics','Foreign Policy','Security','Military','Diplomacy','Regional','World']);
const HIGH_PRIORITY  = new Set(['Politics','Security','Military','Geopolitics','Economy']);
const MED_PRIORITY   = new Set(['Foreign Policy','Diplomacy','Regional','Business']);

/* ═══════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════ */
const State = {
  articles:       [],
  marketData:     null,
  activeCategory: 'All',
  activeSources:  new Set(),
  activeScope:    'all',
  activeLang:     'en',
  searchQuery:    '',
  loadMoreOffset: 0,
  loadMoreStep:   20,
  refreshTimer:   null,
};

/* ═══════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════ */
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (isNaN(diff)) return '—';
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

function isRTL(s) {
  return /[\u0600-\u06FF\u0750-\u077F]/.test(s || '');
}

function isBreaking(dateStr) {
  if (!dateStr) return false;
  return (Date.now() - new Date(dateStr).getTime()) < 60 * 60 * 1000;
}

function getScopeByCategory(cat) {
  if (EXTERNAL_CATS.has(cat)) return 'external';
  return 'internal';
}

function getPriority(article) {
  const cat = article.category || '';
  if (HIGH_PRIORITY.has(cat)) return 'high';
  if (MED_PRIORITY.has(cat))  return 'medium';
  return 'low';
}

function fmt(v, dec = 0) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-PK', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function chgClass(v) {
  if (v == null) return 'neu';
  return v >= 0 ? 'pos' : 'neg';
}

function chgArrow(v) {
  if (v == null) return '';
  return v >= 0 ? '▲' : '▼';
}

/* ═══════════════════════════════════════════════════
   CACHE
═══════════════════════════════════════════════════ */
const Cache = {
  get() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
      return obj;
    } catch { return null; }
  },
  set(articles, marketData) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ articles, marketData, ts: Date.now() }));
    } catch {}
  },
  clear() {
    try { sessionStorage.removeItem(CACHE_KEY); } catch {}
  },
};

/* ═══════════════════════════════════════════════════
   DATA FETCH
═══════════════════════════════════════════════════ */
async function fetchData(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = Cache.get();
    if (cached) {
      State.articles   = cached.articles   || [];
      State.marketData = cached.marketData || null;
      return;
    }
  }
  Cache.clear();

  const [feedsRes, marketRes] = await Promise.allSettled([
    fetch('/api/feeds').then(r => r.ok ? r.json() : Promise.reject(r.status)),
    fetch('/api/market').then(r => r.ok ? r.json() : Promise.reject(r.status)),
  ]);

  State.articles   = feedsRes.status   === 'fulfilled' ? (feedsRes.value?.articles   || []) : [];
  State.marketData = marketRes.status  === 'fulfilled' ? (marketRes.value            || null) : null;

  Cache.set(State.articles, State.marketData);
}

/* ═══════════════════════════════════════════════════
   FILTER PIPELINE
═══════════════════════════════════════════════════ */
function filteredArticles() {
  let list = State.articles;

  // Language filter
  if (State.activeLang === 'en') {
    list = list.filter(a => !isRTL(a.title));
  } else if (State.activeLang === 'ur') {
    list = list.filter(a => isRTL(a.title));
  }

  // Scope filter
  if (State.activeScope === 'internal') {
    list = list.filter(a => !EXTERNAL_CATS.has(a.category));
  } else if (State.activeScope === 'external') {
    list = list.filter(a => EXTERNAL_CATS.has(a.category));
  }

  // Category filter
  if (State.activeCategory !== 'All') {
    list = list.filter(a => a.category === State.activeCategory);
  }

  // Source filter
  if (State.activeSources.size > 0) {
    list = list.filter(a => State.activeSources.has(a.source?.name));
  }

  return list;
}

function searchArticles(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return State.articles.filter(a =>
    (a.title || '').toLowerCase().includes(q) ||
    (a.category || '').toLowerCase().includes(q) ||
    (a.source?.name || '').toLowerCase().includes(q)
  );
}

/* ═══════════════════════════════════════════════════
   RENDER — MARKET BOARD
═══════════════════════════════════════════════════ */
function renderMarketBoard(m) {
  const board = document.getElementById('marketBoard');
  if (!board) return;
  if (!m) {
    board.innerHTML = '';
    return;
  }

  const majorItem = (label, valStr, chgVal, chgPct) => {
    const cls = chgClass(chgVal);
    const chgStr = chgVal != null
      ? `${chgArrow(chgVal)} ${Math.abs(chgPct).toFixed(2)}%`
      : '—';
    return `<div class="mb-major-item">
      <span class="mb-label">${escHtml(label)}</span>
      <span class="mb-val">${escHtml(valStr)}</span>
      <span class="mb-chg ${cls}">${chgStr}</span>
    </div>`;
  };

  const commodityItem = (label, value, unit) => `
    <div class="mb-commodity">
      <span class="mb-com-label">${escHtml(label)}</span>
      <span class="mb-com-val">${escHtml(value)}</span>
      <span class="mb-com-unit">${escHtml(unit)}</span>
    </div>`;

  const usd  = m.usd  || {};
  const kse  = m.kse  || {};
  const gold = m.gold || {};
  const c    = m.commodities || {};

  board.innerHTML = `<div class="mb-inner">
    <div class="mb-major">
      ${majorItem('USD/PKR',  usd.val  != null ? `Rs ${fmt(usd.val, 2)}`  : '—', usd.change,  usd.changePct)}
      ${majorItem('KSE-100',  kse.val  != null ? fmt(kse.val)             : '—', kse.change,  kse.changePct)}
      ${majorItem('Gold/oz',  gold.val != null ? `$${fmt(gold.val, 0)}`   : '—', gold.change, gold.changePct)}
    </div>
    <div class="mb-commodities">
      ${commodityItem('Petrol',    c.petrol    ?? '279.75', 'Rs/L')}
      ${commodityItem('Diesel',    c.diesel    ?? '287.33', 'Rs/L')}
      ${commodityItem('LPG',       c.lpg       ?? '247.50', 'Rs/kg')}
      ${commodityItem('Elec',      c.elec      ?? '42.50',  'Rs/kWh')}
      ${commodityItem('Atta',      c.atta      ?? '1,050',  'Rs/10kg')}
      ${commodityItem('Sugar',     c.sugar     ?? '135',    'Rs/kg')}
      ${commodityItem('Rice',      c.rice      ?? '270',    'Rs/kg')}
      ${commodityItem('Chicken',   c.chicken   ?? '590',    'Rs/kg')}
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════
   RENDER — MARKET BAR (top scrolling ticker)
═══════════════════════════════════════════════════ */
function renderMarketBar(m) {
  const track = document.getElementById('marketTrack');
  if (!track) return;
  if (!m) { track.innerHTML = '<span class="m-item">Market data unavailable</span>'; return; }

  const item = (label, val, chgPct) => {
    const cls = chgClass(chgPct);
    const chgStr = chgPct != null ? `<span class="m-chg ${cls}">${chgArrow(chgPct)} ${Math.abs(chgPct).toFixed(2)}%</span>` : '';
    return `<span class="m-item"><span class="m-label">${label}</span><span class="m-val">${val}</span>${chgStr}</span>`;
  };

  const usd  = m.usd  || {};
  const kse  = m.kse  || {};
  const gold = m.gold || {};
  const c    = m.commodities || {};

  const content = [
    item('USD/PKR',  usd.val  != null ? `Rs ${fmt(usd.val, 2)}`  : '—', usd.changePct),
    item('KSE-100',  kse.val  != null ? fmt(kse.val)             : '—', kse.changePct),
    item('GOLD',     gold.val != null ? `$${fmt(gold.val, 0)}`   : '—', gold.changePct),
    item('PETROL',   `Rs ${c.petrol ?? '279.75'}/L`,  null),
    item('DIESEL',   `Rs ${c.diesel ?? '287.33'}/L`,  null),
    item('LPG',      `Rs ${c.lpg ?? '247.50'}/kg`,    null),
    item('ATTA',     `Rs ${c.atta ?? '1,050'}/10kg`,  null),
    item('SUGAR',    `Rs ${c.sugar ?? '135'}/kg`,     null),
    item('RICE',     `Rs ${c.rice ?? '270'}/kg`,      null),
    item('CHICKEN',  `Rs ${c.chicken ?? '590'}/kg`,   null),
  ].join('');

  // Duplicate for seamless scroll
  track.innerHTML = content + content;
}

/* ═══════════════════════════════════════════════════
   RENDER — NEWS TICKER
═══════════════════════════════════════════════════ */
function renderTicker(articles) {
  const track = document.getElementById('tickerTrack');
  if (!track) return;
  const items = articles.slice(0, 20);
  if (!items.length) { track.innerHTML = '<span>No stories available</span>'; return; }
  const content = items.map(a =>
    `<a href="${escHtml(a.link)}" target="_blank" rel="noopener noreferrer">${escHtml(a.title)}</a>`
  ).join('<span style="padding:0 8px;opacity:.3;">|</span>');
  track.innerHTML = content + '<span style="padding:0 20px;opacity:.2;">···</span>' + content;
}

/* ═══════════════════════════════════════════════════
   RENDER — BREAKING QUEUE
═══════════════════════════════════════════════════ */
function renderBreakingQueue(articles) {
  const list = document.getElementById('breakingQueue');
  if (!list) return;

  const items = articles.slice(0, BQ_LIMIT);
  if (!items.length) {
    list.innerHTML = '<div class="bq-item"><span style="color:var(--text-dim);font-size:11px;padding:8px">No stories available</span></div>';
    return;
  }

  list.innerHTML = items.map((a, i) => {
    const scope = getScopeByCategory(a.category);
    const brk   = isBreaking(a.pubDate);
    const rtl   = isRTL(a.title);
    const num   = String(i + 1).padStart(2, '0');
    const scopeLabel = scope === 'external' ? 'EXT' : 'INT';
    return `<div class="bq-item" onclick="window.open('${escHtml(a.link)}','_blank','noopener')">
      <span class="bq-num">${num}</span>
      <div class="bq-body">
        <div class="bq-tags">
          <span class="bq-cat">${escHtml(a.category)}</span>
          <span class="bq-scope scope-${scope}">${scopeLabel}</span>
          ${brk ? '<span class="bq-breaking">BREAKING</span>' : ''}
        </div>
        <div class="bq-headline${rtl ? ' rtl' : ''}">${escHtml(a.title)}</div>
        <div class="bq-meta">
          <span class="bq-source">${escHtml(a.source?.name ?? '')}</span>
          <span>·</span>
          <span>${timeAgo(a.pubDate)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════
   RENDER — COMPACT CARD
═══════════════════════════════════════════════════ */
function buildCompactCard(article) {
  const scope    = getScopeByCategory(article.category);
  const priority = getPriority(article);
  const brk      = isBreaking(article.pubDate);
  const rtl      = isRTL(article.title);
  return `<a class="compact-card scope-${scope}" href="${escHtml(article.link)}" target="_blank" rel="noopener noreferrer">
    <div class="cc-tags">
      <span class="cc-cat">${escHtml(article.category)}</span>
      <span class="cc-scope scope-${scope}">${scope === 'external' ? 'EXT' : 'INT'}</span>
      <span class="cc-priority p-${priority}">${priority.toUpperCase()}</span>
      ${brk ? '<span class="cc-breaking">BREAKING</span>' : ''}
    </div>
    <div class="cc-headline${rtl ? ' rtl' : ''}">${escHtml(article.title)}</div>
    <div class="cc-footer">
      <span class="cc-source">${escHtml(article.source?.name ?? '')}</span>
      <span class="cc-dot">·</span>
      <span>${timeAgo(article.pubDate)}</span>
    </div>
  </a>`;
}

/* ═══════════════════════════════════════════════════
   RENDER — CATEGORY SECTIONS
═══════════════════════════════════════════════════ */
function renderCategorySection(cat, articles) {
  const items = articles.slice(0, COMPACT_LIMIT);
  const remaining = articles.length - items.length;
  return `<section class="category-section" data-cat="${escHtml(cat)}">
    <div class="section-header">
      <span class="section-title">
        <span>${escHtml(cat)}</span>
        <span style="font-weight:400;opacity:.5;">${articles.length}</span>
      </span>
      <span class="section-meta">${remaining > 0 ? `+${remaining} more` : 'all shown'}</span>
    </div>
    <div class="compact-cards-grid">
      ${items.map(buildCompactCard).join('')}
    </div>
  </section>`;
}

function renderAllSections(articles) {
  const container = document.getElementById('categorySections');
  if (!container) return;

  // Group by category, preserve order of first appearance
  const catMap = new Map();
  for (const a of articles) {
    const c = a.category || 'Other';
    if (!catMap.has(c)) catMap.set(c, []);
    catMap.get(c).push(a);
  }

  let html = '';
  for (const [cat, items] of catMap) {
    if (items.length > 0) html += renderCategorySection(cat, items);
  }
  container.innerHTML = html || '<div style="padding:20px;color:var(--text-dim);font-size:11px;">No stories match the current filters.</div>';
}

/* ═══════════════════════════════════════════════════
   RENDER — SINGLE CATEGORY (filter mode)
═══════════════════════════════════════════════════ */
function renderSingleCategory(cat, articles) {
  const container = document.getElementById('categorySections');
  if (!container) return;
  if (!articles.length) {
    container.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:11px;">No stories in this category.</div>';
    return;
  }
  container.innerHTML = `<section class="category-section">
    <div class="section-header">
      <span class="section-title">${escHtml(cat)} <span style="font-weight:400;opacity:.5;">${articles.length}</span></span>
      <span class="section-meta">all stories</span>
    </div>
    <div class="compact-cards-grid">
      ${articles.map(buildCompactCard).join('')}
    </div>
  </section>`;
}

/* ═══════════════════════════════════════════════════
   RENDER — SEARCH RESULTS
═══════════════════════════════════════════════════ */
function renderSearchResults(query) {
  const container = document.getElementById('categorySections');
  if (!container) return;
  const results = searchArticles(query);

  if (!results.length) {
    container.innerHTML = `<section class="search-results-section">
      <div class="section-header">
        <span class="section-title">Search: "${escHtml(query)}"</span>
        <span class="section-meta">0 results</span>
      </div>
      <div class="no-results">
        <div class="no-results-title">No results found</div>
        <div class="no-results-sub">Try different keywords or clear the search</div>
      </div>
    </section>`;
    return;
  }

  container.innerHTML = `<section class="search-results-section">
    <div class="section-header">
      <span class="section-title">Search: "${escHtml(query)}" <span style="font-weight:400;opacity:.5;">${results.length}</span></span>
      <span class="section-meta">results</span>
    </div>
    <div class="compact-cards-grid">
      ${results.map(buildCompactCard).join('')}
    </div>
  </section>`;
}

/* ═══════════════════════════════════════════════════
   RENDER — RIGHT RAIL: TREND RADAR
═══════════════════════════════════════════════════ */
function renderTrendRadar(articles) {
  const list = document.getElementById('trendingList');
  if (!list) return;

  const counts = {};
  for (const a of articles) {
    const c = a.category || 'Other';
    counts[c] = (counts[c] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, TREND_LIMIT);
  if (!sorted.length) { list.innerHTML = ''; return; }
  const max = sorted[0][1];

  list.innerHTML = sorted.map(([topic, count], i) => {
    const pct = Math.round((count / max) * 100);
    return `<li class="trend-item" onclick="App.filterCategory('${escHtml(topic)}')">
      <span class="trend-rank">${i + 1}</span>
      <div class="trend-body">
        <div class="trend-topic">${escHtml(topic)}</div>
        <div class="trend-count">${count} stories</div>
      </div>
      <div class="trend-bar-wrap">
        <div class="trend-bar-bg"><div class="trend-bar-fill" style="width:${pct}%"></div></div>
      </div>
    </li>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════
   RENDER — RIGHT RAIL: SOURCE DOMINANCE
═══════════════════════════════════════════════════ */
function renderSourceBreakdown(articles) {
  const container = document.getElementById('sourceBreakdown');
  if (!container) return;

  const counts = {};
  let total = 0;
  for (const a of articles) {
    const s = a.source?.name || 'Unknown';
    counts[s] = (counts[s] || 0) + 1;
    total++;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, SOURCE_LIMIT);
  if (!sorted.length) { container.innerHTML = ''; return; }

  container.innerHTML = sorted.map(([name, count]) => {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return `<div class="sb-item">
      <div class="sb-row">
        <span class="sb-name">${escHtml(name)}</span>
        <span class="sb-pct">${pct}%</span>
      </div>
      <div class="sb-bar-bg"><div class="sb-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════
   RENDER — RIGHT RAIL: LIVE FEED & SECURITY
═══════════════════════════════════════════════════ */
function renderLiveFeed(articles) {
  const list = document.getElementById('liveFeedList');
  if (!list) return;

  const items = articles.slice(0, LF_LIMIT);
  list.innerHTML = items.map(a => {
    const rtl = isRTL(a.title);
    return `<li class="lf-item" onclick="window.open('${escHtml(a.link)}','_blank','noopener')">
      <div class="lf-meta">
        <span class="lf-source">${escHtml(a.source?.name ?? '')}</span>
        <span class="lf-time">${timeAgo(a.pubDate)}</span>
      </div>
      <div class="lf-title${rtl ? ' rtl' : ''}">${escHtml(a.title)}</div>
      <span class="lf-cat">${escHtml(a.category)}</span>
    </li>`;
  }).join('');
}

function renderConflictFeed(articles) {
  const list = document.getElementById('conflictReports');
  if (!list) return;

  const secCats = new Set(['Security','Military','Geopolitics','Foreign Policy','Diplomacy','Regional']);
  const items = articles.filter(a => secCats.has(a.category)).slice(0, LF_LIMIT);
  list.innerHTML = items.map(a => {
    const rtl = isRTL(a.title);
    return `<li class="lf-item" onclick="window.open('${escHtml(a.link)}','_blank','noopener')">
      <div class="lf-meta">
        <span class="lf-source">${escHtml(a.source?.name ?? '')}</span>
        <span class="lf-time">${timeAgo(a.pubDate)}</span>
      </div>
      <div class="lf-title${rtl ? ' rtl' : ''}">${escHtml(a.title)}</div>
      <span class="lf-cat">${escHtml(a.category)}</span>
    </li>`;
  }).join('') || '<li style="padding:12px 10px;font-size:11px;color:var(--text-dim);">No security reports</li>';
}

/* ═══════════════════════════════════════════════════
   RENDER — SIDEBAR NAVIGATION
═══════════════════════════════════════════════════ */
function renderSidebar(articles) {
  renderCatNav(articles);
  renderSourceNav(articles);
}

function renderCatNav(articles) {
  const list = document.getElementById('catNavList');
  if (!list) return;

  const counts = {};
  let total = 0;
  for (const a of articles) {
    const c = a.category || 'Other';
    counts[c] = (counts[c] || 0) + 1;
    total++;
  }

  const cats = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const allActive   = State.activeCategory === 'All' ? 'active' : '';

  list.innerHTML = `<li><a href="#" class="${allActive}" onclick="App.filterCategory('All');return false;">
    <span>All</span><span class="nav-count">${total}</span>
  </a></li>` + cats.map(([cat, count]) => {
    const active = State.activeCategory === cat ? 'active' : '';
    return `<li><a href="#" class="${active}" onclick="App.filterCategory('${escHtml(cat)}');return false;">
      <span>${escHtml(cat)}</span>
      <span class="nav-count">${count}</span>
    </a></li>`;
  }).join('');
}

function renderSourceNav(articles) {
  const list = document.getElementById('sourceNavList');
  if (!list) return;

  const counts = {};
  for (const a of articles) {
    const s = a.source?.name || 'Unknown';
    counts[s] = (counts[s] || 0) + 1;
  }
  const sources = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);

  list.innerHTML = sources.map(([name, count]) => {
    const active = State.activeSources.has(name) ? 'active' : '';
    return `<li><a href="#" class="${active}" onclick="App.toggleSource('${escHtml(name)}');return false;">
      <span>${escHtml(name)}</span>
      <span class="source-count">${count}</span>
    </a></li>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════
   RENDER — ACTIVE FILTER CHIPS
═══════════════════════════════════════════════════ */
function renderFilterChips() {
  const container = document.getElementById('activeFiltersChips');
  if (!container) return;

  const chips = [];
  if (State.activeCategory !== 'All') {
    chips.push(`<span class="filter-chip">${escHtml(State.activeCategory)}<span class="filter-chip-x" onclick="App.filterCategory('All')">×</span></span>`);
  }
  for (const s of State.activeSources) {
    chips.push(`<span class="filter-chip">${escHtml(s)}<span class="filter-chip-x" onclick="App.toggleSource('${escHtml(s)}')">×</span></span>`);
  }
  container.innerHTML = chips.join('');
}

/* ═══════════════════════════════════════════════════
   RENDER — HEADER STATS
═══════════════════════════════════════════════════ */
function updateHeaderStats(articles) {
  const sources = new Set(articles.map(a => a.source?.name).filter(Boolean));
  const now = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('headerStatCount',   articles.length);
  set('headerStatSources', sources.size);
  set('headerUpdatedAt',   now);
  set('footerSourcesList', [...sources].join(' · '));
}

/* ═══════════════════════════════════════════════════
   FULL RENDER
═══════════════════════════════════════════════════ */
function fullRender() {
  const all      = filteredArticles();
  const breaking = [...State.articles]
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .slice(0, BQ_LIMIT * 2);

  // Market board + bar
  renderMarketBoard(State.marketData);
  renderMarketBar(State.marketData);

  // Ticker: uses latest articles regardless of filter
  renderTicker(breaking);

  // Breaking queue: latest articles matching current filters
  renderBreakingQueue(all.slice(0, BQ_LIMIT));

  // Main content: search or category/all
  if (State.searchQuery) {
    renderSearchResults(State.searchQuery);
  } else if (State.activeCategory === 'All') {
    renderAllSections(all);
  } else {
    renderSingleCategory(State.activeCategory, all);
  }

  // Right rail
  renderTrendRadar(all);
  renderSourceBreakdown(all);
  renderLiveFeed(all);
  renderConflictFeed(State.articles); // security always uses all articles

  // Sidebar
  renderSidebar(State.articles);
  renderFilterChips();

  // Header stats
  updateHeaderStats(all);
}

/* ═══════════════════════════════════════════════════
   LOADING
═══════════════════════════════════════════════════ */
function showLoading() {
  const o = document.getElementById('loadingOverlay');
  if (o) o.classList.add('active');
}
function hideLoading() {
  const o = document.getElementById('loadingOverlay');
  if (o) o.classList.remove('active');
}

/* ═══════════════════════════════════════════════════
   SCROLL PROGRESS
═══════════════════════════════════════════════════ */
function initScrollProgress() {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;
  window.addEventListener('scroll', () => {
    const h = document.documentElement;
    const pct = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
    bar.style.width = `${Math.min(pct, 100)}%`;
  }, { passive: true });
}

/* ═══════════════════════════════════════════════════
   SIDEBAR TOGGLE
═══════════════════════════════════════════════════ */
function initSidebar() {
  const toggle  = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!toggle || !sidebar) return;

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('open');
  });
  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
    });
  }
}

/* ═══════════════════════════════════════════════════
   SEARCH
═══════════════════════════════════════════════════ */
function initSearch() {
  const input = document.getElementById('searchInput');
  const clear = document.getElementById('searchClear');
  if (!input) return;

  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      State.searchQuery = input.value.trim();
      fullRender();
    }, 250);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      input.value = '';
      State.searchQuery = '';
      fullRender();
    }
  });
  if (clear) {
    clear.addEventListener('click', () => {
      input.value = '';
      State.searchQuery = '';
      fullRender();
    });
  }
}

/* ═══════════════════════════════════════════════════
   SIGNALS TABS
═══════════════════════════════════════════════════ */
function initSignalsTabs() {
  const tabs = document.querySelectorAll('.signals-tab');
  const panels = document.querySelectorAll('.signals-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.signal === 'security' ? 'conflictReports' : 'liveFeedList';
      const panel = document.getElementById(target);
      if (panel) panel.classList.add('active');
    });
  });
}

/* ═══════════════════════════════════════════════════
   SCOPE SWITCH
═══════════════════════════════════════════════════ */
function initScopeSwitch() {
  document.querySelectorAll('.scope-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scope-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.activeScope = btn.dataset.scope || 'all';
      fullRender();
    });
  });
}

/* ═══════════════════════════════════════════════════
   LANG SWITCHER
═══════════════════════════════════════════════════ */
function initLangSwitcher() {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lang-btn').forEach(b => {
        if (b.dataset.lang === btn.dataset.lang) b.classList.add('active');
        else b.classList.remove('active');
      });
      State.activeLang = btn.dataset.lang || 'en';
      fullRender();
    });
  });
}

/* ═══════════════════════════════════════════════════
   REFRESH
═══════════════════════════════════════════════════ */
async function doRefresh(force = false) {
  const btn = document.getElementById('refreshBtn');
  if (btn) btn.classList.add('spinning');
  try {
    await fetchData(force);
    fullRender();
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function initRefreshBtn() {
  const btn = document.getElementById('refreshBtn');
  if (btn) btn.addEventListener('click', () => doRefresh(true));
}

function startAutoRefresh() {
  if (State.refreshTimer) clearInterval(State.refreshTimer);
  State.refreshTimer = setInterval(() => doRefresh(false), REFRESH_MS);
}

/* ═══════════════════════════════════════════════════
   PUBLIC API (called from HTML onclick)
═══════════════════════════════════════════════════ */
const App = {
  filterCategory(cat) {
    State.activeCategory = cat;
    State.searchQuery    = '';
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    // Close sidebar on mobile
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('open');
    fullRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  toggleSource(name) {
    if (State.activeSources.has(name)) {
      State.activeSources.delete(name);
    } else {
      State.activeSources.add(name);
    }
    fullRender();
  },

  resetFilters() {
    State.activeCategory = 'All';
    State.activeSources  = new Set();
    State.activeScope    = 'all';
    State.activeLang     = 'en';
    State.searchQuery    = '';
    document.querySelectorAll('.scope-btn').forEach(b => b.classList.toggle('active', b.dataset.scope === 'all'));
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === 'en'));
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    fullRender();
  },
};

/* ═══════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════ */
async function init() {
  // Wire up reset button
  const resetBtn = document.getElementById('resetFiltersBtn');
  if (resetBtn) resetBtn.addEventListener('click', App.resetFilters.bind(App));

  initScrollProgress();
  initSidebar();
  initSearch();
  initSignalsTabs();
  initScopeSwitch();
  initLangSwitcher();
  initRefreshBtn();

  showLoading();
  try {
    await fetchData(false);
    fullRender();
  } finally {
    hideLoading();
  }

  startAutoRefresh();
}

document.addEventListener('DOMContentLoaded', init);

// Expose App globally for onclick attributes
window.App = App;
