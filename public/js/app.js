/**
 * public/js/app.js
 * brief.pk Pakistan Newsfeed — Frontend Application
 *
 * Architecture:
 *  - Fetches articles from /api/feeds (Node.js serverless)
 *  - Client-side caching (5 min) in sessionStorage
 *  - Renders: hero section, per-category sections, live feed, trending
 *  - State: active category, active sources, search query
 */

'use strict';

/* ═══════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════ */

const API_URL        = '/api/feeds';
const MARKET_URL     = '/api/market';
const CACHE_KEY      = 'briefpk_feeds_cache';
const CACHE_TTL      = 5 * 60 * 1000; // 5 min
const SECTION_COUNT  = 6; // cards per category section
const HERO_COUNT     = 4; // stories in hero

const CATEGORIES = [
  'All',
  'Politics',
  'Economy',
  'Geopolitics',
  'Foreign Policy',
  'Security',
  'Military',
  'Society',
  'Sports',
  'Technology',
];

const CAT_COLORS = {
  'Politics':       '#6D28D9',
  'Economy':        '#B45309',
  'Geopolitics':    '#1D4ED8',
  'Foreign Policy': '#0369A1',
  'Security':       '#B91C1C',
  'Military':       '#374151',
  'Society':        '#065F46',
  'Sports':         '#C2410C',
  'Technology':     '#5B21B6',
};

const CAT_ICONS = {
  'All':            '◉',
  'Politics':       '🏛',
  'Economy':        '📈',
  'Geopolitics':    '🌐',
  'Foreign Policy': '🤝',
  'Security':       '🛡',
  'Military':       '⚔',
  'Society':        '👥',
  'Sports':         '🏏',
  'Technology':     '💻',
};

/* ═══════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════ */

const State = {
  articles:       [],       // all fetched articles
  activeCategory: 'All',   // current category filter
  activeLang:     'en',   // 'all' | 'en' | 'ur'
  activeSources:  null,     // Set of source ids (null = all active)
  searchQuery:    '',
  lastFetch:      0,
  isLoading:      false,
};

/* ═══════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════ */

function timeAgo(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function escHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCatColor(cat) {
  return CAT_COLORS[cat] || '#555';
}

function getCatBg(cat) {
  const hex = getCatColor(cat);
  // Convert hex to rgba with low opacity
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.09)`;
}

function getInitials(name = '') {
  return name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

/* ═══════════════════════════════════════════════
   CACHE
═══════════════════════════════════════════════ */

function saveCache(articles) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      data: articles,
    }));
  } catch (e) {
    // sessionStorage might be full or unavailable
  }
}

function loadCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts < CACHE_TTL) return data;
  } catch (e) {}
  return null;
}

/* ═══════════════════════════════════════════════
   DATA FETCHING
═══════════════════════════════════════════════ */

async function fetchArticles(force = false) {
  if (!force) {
    const cached = loadCache();
    if (cached) {
      State.articles = cached;
      State.lastFetch = Date.now();
      return;
    }
  }

  try {
    const url = new URL(API_URL, window.location.origin);
    if (force) {
      url.searchParams.set('force', '1');
      url.searchParams.set('_t', Date.now()); // Hard cache buster
    }

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid response');

    State.articles  = data;
    State.lastFetch = Date.now();
    saveCache(data);
  } catch (err) {
    console.error('[App] Fetch failed:', err);
    throw err;
  }
}

/* ═══════════════════════════════════════════════
   FILTERING
═══════════════════════════════════════════════ */

function getFiltered() {
  let arts = State.articles;

  // Source filter
  if (State.activeSources && State.activeSources.size > 0) {
    arts = arts.filter(a => State.activeSources.has(a.source.id));
  }

  // Language filter
  if (State.activeLang !== 'all') {
    arts = arts.filter(a => a.source.lang === State.activeLang);
  }

  // Category filter
  if (State.activeCategory !== 'All') {
    arts = arts.filter(a => a.category === State.activeCategory);
  }

  // Search filter
  if (State.searchQuery) {
    const q = State.searchQuery.toLowerCase();
    arts = arts.filter(a =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q)
    );
  }

  return arts;
}

function getByCategory(cat) {
  return State.articles.filter(a => {
    if (State.activeSources && !State.activeSources.has(a.source.id)) return false;
    if (State.activeLang !== 'all' && a.source.lang !== State.activeLang) return false;
    return a.category === cat;
  });
}

/* ═══════════════════════════════════════════════
   CARD HTML BUILDERS
═══════════════════════════════════════════════ */

/** Returns true if article is < 60 minutes old */
function isBreaking(pubDate) {
  if (!pubDate) return false;
  const age = Date.now() - new Date(pubDate).getTime();
  return age > 0 && age < 60 * 60 * 1000;
}

function buildTags(article) {
  const s    = article.source;
  const cc   = getCatColor(article.category);
  const brk  = isBreaking(article.pubDate);

  return `
    <div class="card-tags">
      <span class="tag-cat" style="color:var(--accent)">${escHtml(article.category).toUpperCase()}</span>
      <span class="tag-sep">|</span>
      <span class="tag-source">${escHtml(s.name)}</span>
      ${brk ? '<span class="tag-breaking" style="color:var(--accent);margin-left:8px;font-weight:900">BREAKING</span>' : ''}
    </div>`;
}

function buildCardImage(article, height = 155) {
  if (article.image) {
    // On error: swap the <img> for a colour placeholder without relying on a global fn call
    const ph = escHtml(buildPlaceholder(article.source.name, article.source.color, height));
    return `<img class="card-image"
      src="${escHtml(article.image)}"
      alt=""
      loading="lazy"
      onerror="this.outerHTML='${ph}'">`;
  }
  return buildPlaceholder(article.source.name, article.source.color, height);
}

function buildPlaceholder(name, color, height) {
  const init = getInitials(name);
  return `<div class="card-image-placeholder" style="height:${height}px;background:linear-gradient(135deg,${color} 0%,${color}cc 100%);">${init}</div>`;
}

function cardFooter(article) {
  const shareText = encodeURIComponent(`Check out this story on brief.pk: ${article.title} - ${article.link}`);
  return `
    <div class="card-footer" style="border:none; padding:0; margin-top:8px;">
      <span class="card-meta">${escHtml(article.source.name)} · ${timeAgo(article.pubDate)}</span>
      <div class="card-actions">
        <button class="btn-share" onclick="event.preventDefault();window.open('https://wa.me/?text=${shareText}','_blank')" aria-label="Share on WhatsApp" style="padding:0">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12.031 6.062c-3.414 0-6.188 2.774-6.188 6.189 0 1.085.285 2.103.784 2.982l-.834 3.045 3.116-.817c.854.464 1.83.729 2.872.729 3.414 0 6.188-2.774 6.188-6.189s-2.774-6.189-6.338-6.189zM12.031 16.5c-.947 0-1.834-.239-2.607-.659l-.187-.101-1.942.51.523-1.905-.112-.178c-.461-.735-.729-1.604-.729-2.54 0-2.5 2.038-4.538 4.538-4.538s4.538 2.038 4.538 4.538-2.038 4.538-5.022 4.538z"></path></svg>
        </button>
      </div>
    </div>`;
}

/* ── Hero main card ─────────────────────────── */
function buildHeroMain(article) {
  if (!article) return '';
  const img = article.image
    ? `<img class="card-image" src="${escHtml(article.image)}" alt="" loading="eager" onerror="this.style.display='none'">`
    : buildPlaceholder(article.source.name, article.source.color, 240);

  return `
    <a class="hero-main" href="${escHtml(article.link)}" target="_blank" rel="noopener noreferrer">
      ${img}
      <div class="card-body">
        ${buildTags(article)}
        <div class="card-headline${article.rtl ? ' rtl' : ''}">${escHtml(article.title)}</div>
        ${article.description ? `<p class="card-excerpt">${escHtml(article.description)}</p>` : ''}
        ${cardFooter(article)}
      </div>
    </a>`;
}

/* ── Side card ──────────────────────────────── */
/* ── Side card (Hero Right) ──────────────────── */
function buildSideCard(article) {
  if (!article) return '';
  return `
    <a class="side-card" href="${escHtml(article.link)}" target="_blank" rel="noopener noreferrer">
      ${buildCardImage(article)}
      <div class="card-body">
        <div class="card-headline${article.rtl ? ' rtl' : ''}">${escHtml(article.title)}</div>
        <div class="card-meta">${escHtml(article.source.name)} · ${timeAgo(article.pubDate)}</div>
      </div>
    </a>`;
}

/* ── Regular news card ──────────────────────── */
function buildNewsCard(article) {
  const img = article.image
    ? `<img class="card-image" src="${escHtml(article.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : buildPlaceholder(article.source.name, article.source.color, 155);

  return `
    <a class="news-card" href="${escHtml(article.link)}" target="_blank" rel="noopener noreferrer">
      ${img}
      <div class="card-body">
        ${buildTags(article)}
        <div class="card-headline${article.rtl ? ' rtl' : ''}">${escHtml(article.title)}</div>
        ${article.description ? `<p class="card-excerpt">${escHtml(article.description)}</p>` : ''}
        ${cardFooter(article)}
      </div>
    </a>`;
}

/* ═══════════════════════════════════════════════
   SECTION RENDERERS
═══════════════════════════════════════════════ */

function renderHero(articles) {
  const heroGrid = document.getElementById('heroGrid');
  if (!heroGrid) return;

  const top = articles.slice(0, HERO_COUNT);
  if (!top.length) {
    heroGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><h3>No stories yet</h3><p>Pull to refresh.</p></div>`;
    return;
  }

  const [main, ...sides] = top;

  heroGrid.innerHTML = `
    ${buildHeroMain(main)}
    <div class="hero-side">
      ${sides.map(buildSideCard).join('')}
    </div>`;

  // Update timestamp
  const updated = document.getElementById('heroUpdated');
  if (updated && main) {
    updated.textContent = `Updated ${timeAgo(main.pubDate)}`;
  }
}

function renderCategorySection(cat, articles) {
  if (!articles.length) return '';
  const cc      = getCatColor(cat);
  const visible = articles.slice(0, SECTION_COUNT);
  const label   = State.activeLang === 'ur' ? (State.activeLang === 'ur' ? escHtml(cat) : escHtml(cat)) : escHtml(cat); 

  return `
    <section class="panel-block" id="section-${cat.toLowerCase().replace(/\s+/g, '-')}" style="border-top:3px solid ${cc};">
      <div class="panel-header">
        <h2 class="panel-title" style="font-size:13px;letter-spacing:0.04em;color:${cc};">${label}</h2>
        <a class="section-header-link" href="#" onclick="App.filterCategory('${escHtml(cat)}');return false;">
          All ${label} →
        </a>
      </div>
      <div class="cards-row">
        ${visible.map(buildNewsCard).join('')}
      </div>
    </section>`;
}

function renderAllSections(articles) {
  const container = document.getElementById('categorySections');
  if (!container) return;

  if (State.searchQuery) {
    renderSearchResults(articles);
    return;
  }

  if (State.activeCategory !== 'All') {
    renderSingleCategory(articles);
    return;
  }

  // All mode: hero + per-category sections
  renderHero(articles.slice(0, 6));

  const sections = CATEGORIES.filter(c => c !== 'All').map(cat => {
    const catArts = getByCategory(cat);
    return renderCategorySection(cat, catArts);
  }).join('');

  container.innerHTML = sections || `<div class="empty-state"><h3>No articles found</h3></div>`;
  document.getElementById('loadMoreRow').style.display = 'none';
}

function renderSingleCategory(articles) {
  const container = document.getElementById('categorySections');
  const heroSection = document.getElementById('heroSection');
  if (heroSection) heroSection.style.display = 'none';

  const cc = getCatColor(State.activeCategory);

  container.innerHTML = `
    <section class="panel-block" style="border-top:3px solid ${cc};">
      <div class="panel-header">
        <div style="display:flex; align-items:center; gap:12px;">
          <h2 class="panel-title" style="font-size:13px;color:${cc};">${escHtml(State.activeCategory)}</h2>
          <span style="font-size:10px; font-weight:600; color:var(--text-4); font-family:var(--font-data);">${articles.length} reports</span>
        </div>
        <button class="section-header-link" style="background:none; border:none;" onclick="App.filterCategory('All')">← Back</button>
      </div>
      <div class="cards-row">
        ${articles.map(buildNewsCard).join('') || '<div class="empty-state"><h3>No reports in this lens yet</h3></div>'}
      </div>
    </section>`;
}

function renderSearchResults(articles) {
  const heroSection = document.getElementById('heroSection');
  if (heroSection) heroSection.style.display = 'none';

  const container = document.getElementById('categorySections');
  container.innerHTML = `
    <section class="panel-block editorial-col" style="margin-top:0;">
      <div class="panel-header" style="background:var(--accent)">
        <span class="panel-title">Search: Found ${articles.length} Intel Reports</span>
        <button class="btn-refresh" style="background:rgba(255,255,255,0.2);margin:-8px;" onclick="App.clearSearch()">✕ CLEAR</button>
      </div>
      <div class="cards-row" style="padding:24px;">
        ${articles.length
          ? articles.map(buildNewsCard).join('')
          : `<div class="empty-state"><h3>No results found</h3><p>Try a different keyword.</p></div>`
        }
      </div>
    </section>`;
}

/* ═══════════════════════════════════════════════
   SIDEBAR RENDERERS
═══════════════════════════════════════════════ */

function renderSidebarCategories() {
  const list = document.getElementById('catNavList');
  if (!list) return;

  const arts = State.activeLang === 'all' 
    ? State.articles 
    : State.articles.filter(a => a.source.lang === State.activeLang);

  const allCount = arts.length;

  list.innerHTML = CATEGORIES.map(cat => {
    const count  = cat === 'All' ? allCount : arts.filter(a => a.category === cat).length;
    const active = State.activeCategory === cat ? 'active' : '';
    const cc     = getCatColor(cat);

    return `
      <li>
        <button class="nav-item ${active}" onclick="App.filterCategory('${escHtml(cat)}')">
          <span class="nav-item-dot" style="width:6px;height:6px;border-radius:50%;background:${cc};margin-right:12px;flex-shrink:0;"></span>
          ${escHtml(cat)}
          ${count > 0 ? `<span class="nav-item-count">${count}</span>` : ''}
        </button>
      </li>`;
  }).join('');
}

function getCatColors(cat) {
  if (cat === 'All') return 'var(--teal)';
  return getCatColor(cat);
}

function renderSidebarSources() {
  const list = document.getElementById('sourceNavList');
  if (!list || !State.articles.length) return;

  const arts = State.activeLang === 'all' 
    ? State.articles 
    : State.articles.filter(a => a.source.lang === State.activeLang);

  // Count articles per source
  const counts = {};
  arts.forEach(a => {
    counts[a.source.id] = (counts[a.source.id] || 0) + 1;
  });

  // Get unique sources from filtered articles
  const sources = [];
  const seen    = new Set();
  arts.forEach(a => {
    if (!seen.has(a.source.id)) {
      seen.add(a.source.id);
      sources.push(a.source);
    }
  });

  list.innerHTML = sources.map(src => {
    const active   = !State.activeSources || State.activeSources.has(src.id) ? 'active' : 'inactive';
    const count    = counts[src.id] || 0;

    return `
      <li>
        <button class="source-item ${active}" onclick="App.toggleSource('${escHtml(src.id)}')" data-source="${escHtml(src.id)}">
          <span class="source-pip" style="background:${src.color};"></span>
          ${escHtml(src.name)}
          <span class="source-item-count">${count}</span>
        </button>
      </li>`;
  }).join('');
}

/* ═══════════════════════════════════════════════
   RIGHT PANEL RENDERERS
═══════════════════════════════════════════════ */

function renderLiveFeed() {
  const list = document.getElementById('liveFeedList');
  if (!list) return;

  const arts = getFiltered();
  const recent = arts.slice(0, 15);
  if (!recent.length) {
    list.innerHTML = `<li class="feed-item"><div class="feed-title">No recent updates</div></li>`;
    return;
  }

  list.innerHTML = recent.map(a => `
    <li class="feed-item" onclick="window.open('${escHtml(a.link)}','_blank')">
      <div class="feed-title${a.rtl ? ' rtl' : ''}">${escHtml(a.title)}</div>
      <div class="feed-meta">
        <span style="color:var(--accent); font-weight:800">${escHtml(a.source.name)}</span>
        <span>·</span>
        <span>${timeAgo(a.pubDate)}</span>
      </div>
    </li>`).join('');
}

function renderConflictWatch() {
  const list = document.getElementById('conflictReports');
  if (!list) return;

  const keywordsEn = ['afghan', 'taliban', 'border', 'ttp', 'conflict', 'security', 'chaman', 'torkham', 'militant', 'insurgent', 'cross-border'];
  const keywordsUr = ['افغان', 'طالبان', 'سرحد', 'ٹی ٹی پی', 'سیکیورٹی', 'چمن', 'تورخم', 'عسکریت پسند', 'شورش', 'دھماکہ'];
  const conflictSources = ['khorasandiary', 'tolonews', 'khaama', 'pajhwok'];
  
  const arts = getFiltered();
  const relevant = arts.filter(a => {
    const fromConflictSrc = conflictSources.includes(a.source.id);
    const title = (a.title || '').toLowerCase();
    const engMatch = keywordsEn.some(k => title.includes(k));
    const urMatch  = keywordsUr.some(k => title.includes(k));
    return fromConflictSrc || engMatch || urMatch;
  }).slice(0, 12);

  if (!relevant.length) {
    list.innerHTML = `<li class="feed-item"><div class="feed-title">No recent intelligence</div></li>`;
    return;
  }

  list.innerHTML = relevant.map(a => `
    <li class="feed-item" onclick="window.open('${escHtml(a.link)}','_blank')">
      <div class="feed-title${a.rtl ? ' rtl' : ''}">${escHtml(a.title)}</div>
      <div class="feed-meta">
        <span style="color:var(--gold); font-weight:800">${escHtml(a.source.name)}</span>
        <span>·</span>
        <span>${timeAgo(a.pubDate)}</span>
      </div>
    </li>`).join('');
}

function renderTrending() {
  const list = document.getElementById('trendingList');
  if (!list || !State.articles.length) return;

  // Simple trending: most-covered categories
  const freq = {};
  State.articles.forEach(a => {
    freq[a.category] = (freq[a.category] || 0) + 1;
  });

  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  list.innerHTML = sorted.map(([cat, count], i) => {
    const cc = getCatColor(cat);
    return `
      <li class="trend-item" onclick="App.filterCategory('${escHtml(cat)}')">
        <span class="trend-rank">${i + 1}</span>
        <span class="trend-text" style="color:${cc};">${escHtml(cat)}</span>
        <span class="trend-count">${count} stories</span>
      </li>`;
  }).join('');
}

function renderSourceBreakdown() {
  const list = document.getElementById('sourceBreakdown');
  if (!list || !State.articles.length) return;

  const counts = {};
  State.articles.forEach(a => {
    const k = a.source.id;
    if (!counts[k]) counts[k] = { src: a.source, n: 0 };
    counts[k].n++;
  });

  const total  = State.articles.length;
  const sorted = Object.values(counts).sort((a, b) => b.n - a.n).slice(0, 8);

  list.innerHTML = sorted.map(({ src, n }) => {
    const pct = Math.round((n / total) * 100);
    return `
      <div class="source-row">
        <span class="source-label">${escHtml(src.name)}</span>
        <div class="source-bar-wrap">
          <div class="source-bar-fill" style="width:${pct}%;background:${src.color};"></div>
        </div>
        <span class="source-count">${n}</span>
      </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════
   TICKER
═══════════════════════════════════════════════ */

function renderTicker(articles) {
  const track = document.getElementById('tickerTrack');
  if (!track) return;

  const arts = articles || getFiltered();
  if (!arts.length) return;

  const items = arts
    .slice(0, 30)
    .map(a => `
      <span class="ticker-item" onclick="window.open('${escHtml(a.link)}','_blank')">
        ${escHtml(a.title)}
      </span>
      <span class="ticker-sep">◆</span>`).join('');

  track.innerHTML = items + items; // duplicate for seamless loop
}

/* ═══════════════════════════════════════════════
   HEADER STATS
═══════════════════════════════════════════════ */

function updateHeaderStats() {
  const count   = document.getElementById('headerStatCount');
  const sources = document.getElementById('headerStatSources');
  if (!count || !sources) return;

  count.textContent   = State.articles.length;
  const uniqueSources = new Set(State.articles.map(a => a.source.id)).size;
  sources.textContent = uniqueSources;

  // Translation
  const ui = {
    lblHeroTitle: State.activeLang === 'ur' ? 'اہم انٹیلی جنس' : 'Top Intelligence',
  };
  
  for (const id in ui) {
    const el = document.getElementById(id);
    if (el) el.textContent = ui[id];
  }
}

/* ═══════════════════════════════════════════════
   FOOTER
═══════════════════════════════════════════════ */

function renderFooter() {
  const el = document.getElementById('footerSourcesList');
  if (!el) return;

  const sources = [];
  const seen    = new Set();
  State.articles.forEach(a => {
    if (!seen.has(a.source.id)) {
      seen.add(a.source.id);
      sources.push(a.source.name);
    }
  });

  el.textContent = 'Sources: ' + sources.join(' · ');
}

/* ═══════════════════════════════════════════════
   FULL RENDER PASS
═══════════════════════════════════════════════ */

function fullRender() {
  const filtered = getFiltered();
  const isDashboardMode = (State.activeCategory === 'All' && !State.searchQuery);

  // Dashboard Grid Toggle
  const grid = document.querySelector('.dashboard-grid');
  if (grid) grid.style.display = isDashboardMode ? '' : 'none';

  const intelDash = document.getElementById('intelDashboard');
  if (intelDash) intelDash.style.display = isDashboardMode ? 'grid' : 'none';

  // Main sections
  renderAllSections(filtered);

  // Sidebar
  renderSidebarCategories();
  renderSidebarSources();

  // Widgets
  renderLiveFeed();
  renderConflictWatch();

  // Header + ticker
  updateHeaderStats();
  renderTicker(State.articles.slice(0, 30));

  // Footer
  renderFooter();
}

/* ═══════════════════════════════════════════════
   MARKET DATA
═══════════════════════════════════════════════ */

async function fetchMarket() {
  try {
    const res  = await fetch(MARKET_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderMarket(data);
  } catch (err) {
    console.warn('[Market] Fetch failed:', err.message);
  }
}

/** Format a PKR number with thousands separator */
function pkrFmt(val, decimals = 0) {
  if (val == null) return '—';
  return 'Rs. ' + Number(val).toLocaleString('en-PK', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Build a small up/down arrow span */
function changeArrow(change) {
  if (change == null) return '';
  const cls  = change >= 0 ? 'm-up' : 'm-down';
  const sym  = change >= 0 ? '▲' : '▼';
  return ` <span class="${cls}">${sym}</span>`;
}

function renderMarket(m) {
  const container = document.getElementById('marketWidgetContainer');
  const bar       = document.getElementById('marketTrack');
  if (!container || !m) return;

  const fmt = (v, dec = 0) =>
    v != null ? Number(v).toLocaleString('en-PK', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—';

  // ── LIVE MARKET rows (top section) ────────────────────────
  const buildLiveRow = (label, val, change, isCurrency = false) => {
    const value = val != null ? (isCurrency ? fmt(val, 2) : fmt(val)) : '—';
    const cls   = change > 0 ? 'm-up' : change < 0 ? 'm-down' : '';
    const pct   = change != null ? `<span class="mw-row-pct ${cls}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}%</span>` : '';
    return `
      <div class="mw-row">
        <div class="mw-row-label">${label}</div>
        <div class="mw-row-val ${cls}">${isCurrency ? 'Rs ' : ''}${value}</div>
        <div class="mw-row-change">${pct}</div>
      </div>`;
  };

  // ── ESSENTIAL price tiles (bottom grid) ───────────────────
  const buildTile = (label, val, unit, dec = 0) => `
    <div class="mw-tile">
      <div class="mw-tile-label">${label}</div>
      <div class="mw-tile-val">Rs ${fmt(val, dec)}<span class="mw-tile-unit"> ${unit}</span></div>
    </div>`;

  const trans = {
    'USD/PKR':'ڈالر/روپیہ','KSE-100':'کے ایس ای 100','Gold':'سونا (تولہ)',
    'Petrol':'پیٹرول','Diesel':'ڈیزل','LPG':'ایل پی جی','Electricity':'بجلی',
    'Atta':'آٹا','Sugar':'چینی','Rice':'چاول','Chicken':'مرغی',
  };
  const lbl = (l) => State.activeLang === 'ur' ? (trans[l] || l) : l;

  container.innerHTML = `
    <div class="mw-section-header">Live Markets</div>
    ${buildLiveRow(lbl('USD/PKR'), m.usd.val,  m.usd.change,  true)}
    ${buildLiveRow(lbl('KSE-100'), m.kse.val,  m.kse.change)}
    ${buildLiveRow(lbl('Gold'),    m.gold.val, null)}
    <div class="mw-section-header">Daily Essentials</div>
    <div class="mw-tile-grid">
      ${buildTile(lbl('Petrol'),      m.petrol.val,      '/L',    2)}
      ${buildTile(lbl('Diesel'),      m.diesel.val,      '/L',    2)}
      ${buildTile(lbl('LPG'),         m.lpg.val,         '/KG',   2)}
      ${buildTile(lbl('Electricity'), m.electricity.val, '/unit', 2)}
      ${buildTile(lbl('Atta'),        m.atta.val,        '/10KG'   )}
      ${buildTile(lbl('Sugar'),       m.sugar.val,       '/KG'     )}
      ${buildTile(lbl('Rice'),        m.rice.val,        '/KG'     )}
      ${buildTile(lbl('Chicken'),     m.chicken.val,     '/KG'     )}
    </div>
  `;

  // ── Market Bar: ALL 11 items, duplicated for seamless loop ─
  if (bar) {
    const sep = `<span class="m-sep">◆</span>`;
    const items = [
      { l:'USD/PKR',  d:`${fmt(m.usd.val,2)}`,                c: m.usd.change },
      { l:'KSE-100',  d:`${fmt(m.kse.val)}`,                  c: m.kse.change },
      { l:'GOLD/TOLA',d:`Rs ${fmt(m.gold.val)}`,              c: null },
      { l:'PETROL',   d:`Rs ${fmt(m.petrol.val,2)}/L`,        c: null },
      { l:'DIESEL',   d:`Rs ${fmt(m.diesel.val,2)}/L`,        c: null },
      { l:'LPG',      d:`Rs ${fmt(m.lpg.val,2)}/KG`,          c: null },
      { l:'ELEC',     d:`Rs ${fmt(m.electricity.val,2)}/unit`, c: null },
      { l:'ATTA',     d:`Rs ${fmt(m.atta.val)}/10KG`,         c: null },
      { l:'SUGAR',    d:`Rs ${fmt(m.sugar.val)}/KG`,          c: null },
      { l:'RICE',     d:`Rs ${fmt(m.rice.val)}/KG`,           c: null },
      { l:'CHICKEN',  d:`Rs ${fmt(m.chicken.val)}/KG`,        c: null },
    ];
    const renderItem = it => {
      const arr = it.c != null
        ? ` <span class="${it.c >= 0 ? 'm-up' : 'm-down'}">${it.c >= 0 ? '▲' : '▼'} ${Math.abs(it.c).toFixed(2)}%</span>`
        : '';
      return `<span class="m-item"><span class="m-label">${it.l}</span><span class="m-val">${it.d}</span>${arr}</span>${sep}`;
    };
    bar.innerHTML = [...items, ...items].map(renderItem).join('');
  }
}

/* ═══════════════════════════════════════════════
   PUBLIC API  (window.App)
═══════════════════════════════════════════════ */

const App = {

  async init() {
    State.isLoading = true;
    setRefreshLoading(true);

    try {
      await Promise.all([
        fetchArticles(),
        fetchMarket()
      ]);
      fullRender();
    } catch (err) {
      showError('Failed to load news feeds. Check your connection and try again.');
    } finally {
      State.isLoading = false;
      setRefreshLoading(false);
    }

    // Auto-refresh news every 5 min
    setInterval(() => App.refresh(false), 5 * 60 * 1000);
    // Auto-refresh market every 15 min
    setInterval(() => fetchMarket(), 15 * 60 * 1000);

    // Initialize Conflict Tabs
    const conflictTabs = document.querySelectorAll('.conflict-tab');
    conflictTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.getAttribute('data-tab');
        conflictTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        document.getElementById('conflictReports').style.display = tabId === 'reports' ? '' : 'none';
        document.getElementById('conflictSocial').style.display = tabId === 'social' ? '' : 'none';
      });
    });
  },

  async refresh(force = true) {
    if (State.isLoading) return;
    State.isLoading = true;
    setRefreshLoading(true);

    try {
      await fetchArticles(force);
      fullRender();
    } catch (err) {
      console.warn('[App] Refresh failed:', err);
    } finally {
      State.isLoading = false;
      setRefreshLoading(false);
    }
  },

  filterCategory(cat) {
    State.activeCategory = cat;
    State.searchQuery    = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').style.display = 'none';
    closeSidebar();
    fullRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  toggleSource(id) {
    if (!State.activeSources) {
      // First toggle: create set with all except this one
      const allIds = [...new Set(State.articles.map(a => a.source.id))];
      State.activeSources = new Set(allIds.filter(sid => sid !== id));
    } else if (State.activeSources.has(id)) {
      State.activeSources.delete(id);
      if (State.activeSources.size === 0) State.activeSources = null;
    } else {
      State.activeSources.add(id);
    }
    fullRender();
  },

  clearSearch() {
    State.searchQuery = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').style.display = 'none';
    fullRender();
  },

  loadMoreSection() {
    // Placeholder — future feature
  },
};

window.App = App;

/* ═══════════════════════════════════════════════
   UI HELPERS
═══════════════════════════════════════════════ */

function setRefreshLoading(on) {
  document.getElementById('refreshBtn')?.classList.toggle('loading', on);
}

function showError(msg) {
  const main = document.getElementById('mainContent');
  if (!main) return;
  main.innerHTML = `
    <div class="empty-state" style="padding:80px 20px;">
      <h3>Something went wrong</h3>
      <p style="margin-top:8px;">${escHtml(msg)}</p>
      <button class="btn-load-more" style="margin-top:20px;" onclick="App.refresh()">Try Again</button>
    </div>`;
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('visible');
}

/* ═══════════════════════════════════════════════
   EVENT LISTENERS
═══════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  // Search
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');
  let searchTimer;

  searchInput?.addEventListener('input', e => {
    clearTimeout(searchTimer);
    const val = e.target.value.trim();
    searchClear.style.display = val ? 'block' : 'none';

    searchTimer = setTimeout(() => {
      State.searchQuery    = val;
      State.activeCategory = 'All';
      fullRender();
    }, 300);
  });

  searchClear?.addEventListener('click', () => App.clearSearch());

  // Language Switcher (header + sidebar both sync)
  function handleLangSwitch(lang) {
    document.querySelectorAll('.lang-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === lang);
    });
    State.activeLang = lang;
    fullRender();
  }

  document.getElementById('headerLangSwitcher')?.addEventListener('click', e => {
    const btn = e.target.closest('.lang-btn');
    if (btn) handleLangSwitch(btn.dataset.lang);
  });
  document.getElementById('sidebarLangSwitcher')?.addEventListener('click', e => {
    const btn = e.target.closest('.lang-btn');
    if (btn) handleLangSwitch(btn.dataset.lang);
  });

  // Refresh
  document.getElementById('refreshBtn')?.addEventListener('click', () => {
    App.refresh();
  });

  // Sidebar toggle (mobile) + overlay
  const sidebarEl  = document.getElementById('sidebar');
  const toggleBtn  = document.getElementById('sidebarToggle');
  const overlayEl  = document.getElementById('sidebarOverlay');

  function openSidebar() {
    sidebarEl?.classList.add('open');
    overlayEl?.classList.add('visible');
  }
  function closeSidebarMobile() {
    sidebarEl?.classList.remove('open');
    overlayEl?.classList.remove('visible');
  }

  toggleBtn?.addEventListener('click', () => {
    sidebarEl?.classList.contains('open') ? closeSidebarMobile() : openSidebar();
  });
  overlayEl?.addEventListener('click', closeSidebarMobile);

  // Override closeSidebar global to also hide overlay
  window._closeSidebarMobile = closeSidebarMobile;

  // Mobile bottom nav: active state + search toggle
  const mnavBtns = document.querySelectorAll('.mnav-btn');
  function setMnavActive(id) {
    mnavBtns.forEach(b => b.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
  }

  document.getElementById('mnavFeed')?.addEventListener('click',     () => setMnavActive('mnavFeed'));
  document.getElementById('mnavPolitics')?.addEventListener('click',  () => setMnavActive('mnavPolitics'));
  document.getElementById('mnavMarkets')?.addEventListener('click',   () => setMnavActive('mnavMarkets'));
  document.getElementById('mnavSecurity')?.addEventListener('click',  () => setMnavActive('mnavSecurity'));

  document.getElementById('mnavSearchToggle')?.addEventListener('click', () => {
    setMnavActive('mnavSearchToggle');
    const inp = document.getElementById('searchInput');
    inp?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Set Feed active on start
  setMnavActive('mnavFeed');

  // Scroll progress & FAB
  window.addEventListener('scroll', () => {
    // Progress
    const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
    const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrolled = (winScroll / height) * 100;
    const progress = document.getElementById('scrollProgress');
    if (progress) progress.style.width = scrolled + "%";

    // FAB
    document.getElementById('fab')?.classList.toggle('show', scrollY > 600);
  });

  // Boot
  App.init();
});
