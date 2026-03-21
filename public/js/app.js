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

// Categories shown in the intelligence lens (Entertainment is intentionally excluded)
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

// Entertainment articles are categorised but suppressed from all intelligence views
const EXCLUDED_CATS = new Set(['Entertainment']);

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

const INTERNAL_SCOPE_CATS = new Set([
  'Politics',
  'Economy',
  'Society',
  'Sports',
  'Technology',
]);

const EXTERNAL_SCOPE_CATS = new Set([
  'Geopolitics',
  'Foreign Policy',
  'Security',
  'Military',
]);

/* ═══════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════ */

const State = {
  articles:       [],       // all fetched articles
  activeCategory: 'All',   // current category filter
  activeLang:     'en',   // 'all' | 'en' | 'ur'
  activeScope:    'all',   // 'all' | 'internal' | 'external'
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

function applyScopeFilter(articles = []) {
  if (State.activeScope === 'internal') {
    return articles.filter(a => INTERNAL_SCOPE_CATS.has(a.category));
  }
  if (State.activeScope === 'external') {
    return articles.filter(a => EXTERNAL_SCOPE_CATS.has(a.category));
  }
  return articles;
}

function setMarqueeDuration(trackEl, cssVar, baselineSeconds = 70) {
  if (!trackEl) return;

  const viewport = trackEl.parentElement?.clientWidth || 0;
  const width = trackEl.scrollWidth || 0;
  if (!viewport || !width) return;

  const ratio = Math.max(1, width / viewport);
  const duration = Math.min(220, Math.max(45, Math.round(baselineSeconds * ratio)));

  trackEl.style.setProperty(cssVar, `${duration}s`);
  trackEl.style.animation = 'none';
  void trackEl.offsetHeight;
  trackEl.style.animation = '';
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

  // Suppress entertainment from all intelligence views
  arts = arts.filter(a => !EXCLUDED_CATS.has(a.category));

  // Pakistan scope filter (internal/external)
  arts = applyScopeFilter(arts);

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
    if (EXCLUDED_CATS.has(a.category)) return false;
    if (State.activeScope === 'internal' && !INTERNAL_SCOPE_CATS.has(a.category)) return false;
    if (State.activeScope === 'external' && !EXTERNAL_SCOPE_CATS.has(a.category)) return false;
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

function getScopeByCategory(category) {
  if (INTERNAL_SCOPE_CATS.has(category)) return 'internal';
  if (EXTERNAL_SCOPE_CATS.has(category)) return 'external';
  return 'internal';
}

function getPriority(article) {
  if (isBreaking(article.pubDate)) return 'high';
  if (EXTERNAL_SCOPE_CATS.has(article.category)) return 'high';
  if (article.category === 'Politics' || article.category === 'Economy') return 'medium';
  return 'normal';
}

function buildTags(article) {
  const s    = article.source;
  const scope = getScopeByCategory(article.category);
  const priority = getPriority(article);
  const brk  = isBreaking(article.pubDate);

  return `
    <div class="card-tags">
      <span class="tag-scope ${scope === 'external' ? 'scope-external' : 'scope-internal'}">${scope === 'external' ? 'EXTERNAL' : 'INTERNAL'}</span>
      <span class="tag-priority p-${priority}">${priority.toUpperCase()}</span>
      <span class="tag-cat">${escHtml(article.category).toUpperCase()}</span>
      <span class="tag-sep">|</span>
      <span class="tag-source">${escHtml(s.name)}</span>
      ${brk ? '<span class="tag-breaking">BREAKING</span>' : ''}
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
  const scope = getScopeByCategory(article.category);
  const priority = getPriority(article);
  const img = article.image
    ? `<img class="card-image" src="${escHtml(article.image)}" alt="" loading="eager" onerror="this.style.display='none'">`
    : buildPlaceholder(article.source.name, article.source.color, 240);

  const heroMeta = `${escHtml(article.source.name)} · ${timeAgo(article.pubDate)}`;

  return `
    <a class="hero-main" href="${escHtml(article.link)}" target="_blank" rel="noopener noreferrer">
      ${img}
      <div class="card-body">
        <div class="hero-kicker-row">
          <span class="hero-kicker-left">
            <span class="hero-kicker-scope ${scope === 'external' ? 'scope-external' : 'scope-internal'}">${scope === 'external' ? 'EXT' : 'INT'}</span>
            <span class="hero-kicker-priority p-${priority}">${priority.toUpperCase()}</span>
            <span class="hero-kicker-cat">${escHtml(article.category).toUpperCase()}</span>
          </span>
          <span class="hero-kicker-meta">${heroMeta}</span>
        </div>
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
  const scope = getScopeByCategory(article.category);
  return `
    <a class="side-card" href="${escHtml(article.link)}" target="_blank" rel="noopener noreferrer">
      ${buildCardImage(article)}
      <div class="card-body">
        <div class="side-card-topline">
          <span class="side-scope ${scope === 'external' ? 'scope-external' : 'scope-internal'}">${scope === 'external' ? 'EXT' : 'INT'}</span>
          <span>${escHtml(article.category)}</span>
        </div>
        <div class="card-headline${article.rtl ? ' rtl' : ''}">${escHtml(article.title)}</div>
        <div class="card-meta">${escHtml(article.source.name)} · ${timeAgo(article.pubDate)}</div>
      </div>
    </a>`;
}

/* ── Regular news card ──────────────────────── */
function buildNewsCard(article) {
  const scope = getScopeByCategory(article.category);
  const img = article.image
    ? `<img class="card-image" src="${escHtml(article.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : buildPlaceholder(article.source.name, article.source.color, 155);

  return `
    <a class="news-card ${scope === 'external' ? 'scope-external' : 'scope-internal'}" href="${escHtml(article.link)}" target="_blank" rel="noopener noreferrer">
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
        ${articles.map(buildNewsCard).join('') || '<div class="empty-state"><h3>No stories in this topic yet</h3></div>'}
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
        <span class="panel-title">Search: Found ${articles.length} Stories</span>
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

function renderActiveFilters() {
  const container = document.getElementById('activeFiltersChips');
  if (!container) return;

  const chips = [];
  if (State.activeLang !== 'en') chips.push(`Lang: ${State.activeLang.toUpperCase()}`);
  if (State.activeScope !== 'all') chips.push(`Scope: ${State.activeScope}`);
  if (State.activeCategory !== 'All') chips.push(`Topic: ${State.activeCategory}`);
  if (State.searchQuery) chips.push(`Search: ${State.searchQuery}`);
  if (State.activeSources && State.activeSources.size > 0) {
    const totalSources = new Set(State.articles.map(a => a.source.id)).size;
    chips.push(`Sources: ${State.activeSources.size}/${totalSources}`);
  }

  if (!chips.length) {
    container.innerHTML = '<span class="filter-chip empty">No active filters</span>';
    return;
  }

  container.innerHTML = chips.map(chip => `<span class="filter-chip">${escHtml(chip)}</span>`).join('');
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
   TOP WIDGET RENDERERS
═══════════════════════════════════════════════ */

function renderBreakingQueue() {
  const list = document.getElementById('breakingQueue');
  if (!list) return;

  const arts = getFiltered();
  const breaking = arts.filter(a => isBreaking(a.pubDate)).slice(0, 6);
  const items = breaking.length ? breaking : arts.slice(0, 6);

  if (!items.length) {
    list.innerHTML = `<li class="widget-item empty">No active alerts</li>`;
    return;
  }

  list.innerHTML = items.map((a, i) => `
    <li class="widget-item" onclick="window.open('${escHtml(a.link)}','_blank')">
      <span class="widget-rank">${String(i + 1).padStart(2, '0')}</span>
      <span class="widget-text">${escHtml(a.title)}</span>
      <span class="widget-time">${timeAgo(a.pubDate)}</span>
    </li>`).join('');
}

function renderBreakingDeck() {
  const deck = document.getElementById('breakingDeck');
  if (!deck) return;

  const arts = getFiltered();
  const lead = arts.filter(a => isBreaking(a.pubDate)).slice(0, 4);
  const items = lead.length ? lead : arts.slice(0, 4);

  if (!items.length) {
    deck.innerHTML = `<div class="empty-state"><h3>No active breaking stories</h3></div>`;
    return;
  }

  deck.innerHTML = items.map(a => {
    const scope = getScopeByCategory(a.category);
    return `
      <a class="breaking-card ${scope === 'external' ? 'scope-external' : 'scope-internal'}" href="${escHtml(a.link)}" target="_blank" rel="noopener noreferrer">
        <div class="breaking-card-head">
          <span class="breaking-cat">${escHtml(a.category)}</span>
          <span class="breaking-time">${timeAgo(a.pubDate)}</span>
        </div>
        <div class="breaking-title${a.rtl ? ' rtl' : ''}">${escHtml(a.title)}</div>
        <div class="breaking-source">${escHtml(a.source.name)}</div>
      </a>`;
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

  list.innerHTML = recent.map(a => {
    const scope = getScopeByCategory(a.category);
    const priority = getPriority(a);
    return `
    <li class="feed-item ${scope === 'external' ? 'scope-external' : 'scope-internal'}" onclick="window.open('${escHtml(a.link)}','_blank')">
      <div class="feed-title${a.rtl ? ' rtl' : ''}">${escHtml(a.title)}</div>
      <div class="feed-meta">
        <span class="feed-pill ${scope === 'external' ? 'scope-external' : 'scope-internal'}">${scope === 'external' ? 'EXT' : 'INT'}</span>
        <span class="feed-pill p-${priority}">${priority.toUpperCase()}</span>
        <span style="color:var(--accent); font-weight:800">${escHtml(a.source.name)}</span>
        <span>·</span>
        <span>${timeAgo(a.pubDate)}</span>
      </div>
    </li>`;
  }).join('');
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

  list.innerHTML = relevant.map(a => {
    const priority = getPriority(a);
    return `
    <li class="feed-item scope-external" onclick="window.open('${escHtml(a.link)}','_blank')">
      <div class="feed-title${a.rtl ? ' rtl' : ''}">${escHtml(a.title)}</div>
      <div class="feed-meta">
        <span class="feed-pill scope-external">EXT</span>
        <span class="feed-pill p-${priority}">${priority.toUpperCase()}</span>
        <span style="color:var(--gold); font-weight:800">${escHtml(a.source.name)}</span>
        <span>·</span>
        <span>${timeAgo(a.pubDate)}</span>
      </div>
    </li>`;
  }).join('');
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
  setMarqueeDuration(track, '--ticker-scroll-duration', 70);
}

/* ═══════════════════════════════════════════════
   HEADER STATS
═══════════════════════════════════════════════ */

function updateHeaderStats() {
  const count   = document.getElementById('headerStatCount');
  const sources = document.getElementById('headerStatSources');
  const scopeChip = document.getElementById('headerScopeChip');
  const updatedAt = document.getElementById('headerUpdatedAt');
  if (!count || !sources) return;

  count.textContent   = State.articles.length;
  const uniqueSources = new Set(State.articles.map(a => a.source.id)).size;
  sources.textContent = uniqueSources;

  if (scopeChip) {
    const scopeLabel = State.activeScope === 'all'
      ? 'ALL PAKISTAN'
      : State.activeScope === 'internal'
        ? 'INTERNAL'
        : 'EXTERNAL';
    scopeChip.textContent = scopeLabel;
  }

  if (updatedAt) {
    updatedAt.textContent = State.lastFetch ? `updated ${timeAgo(new Date(State.lastFetch).toISOString())}` : 'syncing…';
  }

  // Translation
  const ui = {
    lblHeroTitle: State.activeLang === 'ur' ? 'اہم خبریں' : 'Top Stories',
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
  renderActiveFilters();

  // Widgets
  renderBreakingQueue();
  renderBreakingDeck();
  renderTrending();
  renderSourceBreakdown();
  renderLiveFeed();
  renderConflictWatch();

  // Header + ticker
  updateHeaderStats();
  renderTicker(applyScopeFilter(State.articles.filter(a => !EXCLUDED_CATS.has(a.category))).slice(0, 30));

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

  const valueCell = (label, val, change, unit = '', dec = 0, currency = true) => {
    const cls = change > 0 ? 'm-up' : change < 0 ? 'm-down' : '';
    const prefix = currency ? 'Rs ' : '';
    const body = val != null ? `${prefix}${fmt(val, dec)}${unit ? ` ${unit}` : ''}` : '—';
    const changeCell = change != null
      ? `<span class="mw-row-pct ${cls}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}%</span>`
      : '';

    return `
      <div class="mw-row">
        <div class="mw-row-label">${label}</div>
        <div class="mw-row-val ${cls}">${body}</div>
        <div class="mw-row-change" style="text-align:right;">${changeCell}</div>
      </div>`;
  };

  const tileCell = (label, val, unit, dec = 0) => `
    <div class="mw-tile">
      <div class="mw-tile-label">${label}</div>
      <div class="mw-tile-val">${fmt(val, dec)} <span class="mw-tile-unit">${unit}</span></div>
    </div>`;

  const trans = {
    'USD/PKR':'ڈالر/روپیہ','KSE-100':'کے ایس ای 100','Gold':'سونا (تولہ)',
    'Petrol':'پیٹرول','Diesel':'ڈیزل','LPG':'ایل پی جی','Electricity':'بجلی',
    'Atta':'آٹا','Sugar':'چینی','Rice':'چاول','Chicken':'مرغی',
  };
  const lbl = (l) => State.activeLang === 'ur' ? (trans[l] || l) : l;

  const headlineItems = [
    { label: lbl('USD/PKR'), val: m.usd.val != null ? `Rs ${fmt(m.usd.val, 2)}` : '—', change: m.usd.change },
    { label: lbl('KSE-100'), val: m.kse.val != null ? fmt(m.kse.val) : '—', change: m.kse.change },
    { label: lbl('Gold'), val: m.gold.val != null ? `Rs ${fmt(m.gold.val)}` : '—', change: null },
  ];

  container.innerHTML = `
    <div class="mw-headline-strip">
      ${headlineItems.map(it => {
        const cls = it.change > 0 ? 'm-up' : it.change < 0 ? 'm-down' : '';
        return `
          <div class="mw-headline-item">
            <div class="mw-headline-label">${it.label}</div>
            <div class="mw-headline-val ${cls}">${it.val}</div>
          </div>`;
      }).join('')}
    </div>

    <div class="mw-left-panel">
      <div class="mw-section-header">Pakistan Macro Board</div>
      ${valueCell(lbl('USD/PKR'), m.usd.val, m.usd.change, '', 2)}
      ${valueCell(lbl('KSE-100'), m.kse.val, m.kse.change, '', 0, false)}
      ${valueCell(lbl('Gold / Tola'), m.gold.val, null, '', 0)}
      ${valueCell(lbl('Petrol'), m.petrol.val, null, '/L', 2)}
      ${valueCell(lbl('Diesel'), m.diesel.val, null, '/L', 2)}
    </div>

    <div class="mw-right-panel">
      <div class="mw-section-header">Daily Essentials</div>
      <div class="mw-tile-grid">
        ${tileCell(lbl('LPG'),         m.lpg.val,         '/KG',   2)}
        ${tileCell(lbl('Electricity'), m.electricity.val, '/unit', 2)}
        ${tileCell(lbl('Atta'),        m.atta.val,        '/10KG'   )}
        ${tileCell(lbl('Sugar'),       m.sugar.val,       '/KG'     )}
        ${tileCell(lbl('Rice'),        m.rice.val,        '/KG'     )}
        ${tileCell(lbl('Chicken'),     m.chicken.val,     '/KG'     )}
      </div>
    </div>
  `;

  // ── Market Bar: ALL 11 items, duplicated for seamless loop ─
  if (bar) {
    const sep = `<span class="m-sep">◆</span>`;
    const usdLbl = m.usd.val != null ? `Rs ${fmt(m.usd.val,2)}` : '—';
    const kseLbl = m.kse.val != null ? fmt(m.kse.val) : '—';
    const items = [
      { l:'USD/PKR',   d: usdLbl,                              c: m.usd.change  },
      { l:'KSE-100',   d: kseLbl,                              c: m.kse.change  },
      { l:'GOLD/TOLA', d:`Rs ${fmt(m.gold.val)}`,             c: null          },
      { l:'PETROL',    d:`Rs ${fmt(m.petrol.val,2)}/L`,       c: null          },
      { l:'DIESEL',    d:`Rs ${fmt(m.diesel.val,2)}/L`,       c: null          },
      { l:'LPG',       d:`Rs ${fmt(m.lpg.val,2)}/KG`,         c: null          },
      { l:'ELEC',      d:`Rs ${fmt(m.electricity.val,2)}/unit`, c: null        },
      { l:'ATTA',      d:`Rs ${fmt(m.atta.val)}/10KG`,        c: null          },
      { l:'SUGAR',     d:`Rs ${fmt(m.sugar.val)}/KG`,         c: null          },
      { l:'RICE',      d:`Rs ${fmt(m.rice.val)}/KG`,          c: null          },
      { l:'CHICKEN',   d:`Rs ${fmt(m.chicken.val)}/KG`,       c: null          },
    ];
    const renderItem = it => {
      const arr = it.c != null
        ? ` <span class="${it.c >= 0 ? 'm-up' : 'm-down'}">${it.c >= 0 ? '▲' : '▼'} ${Math.abs(it.c).toFixed(2)}%</span>`
        : '';
      return `<span class="m-item"><span class="m-label">${it.l}</span><span class="m-val">${it.d}</span>${arr}</span>${sep}`;
    };
    bar.innerHTML = [...items, ...items].map(renderItem).join('');
    setMarqueeDuration(bar, '--market-scroll-duration', 65);
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

    // Unified Signals Tabs
    const signalTabs = document.querySelectorAll('.signals-tab');
    const signalPanels = document.querySelectorAll('.signals-panel');
    signalTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-signal');
        signalTabs.forEach(t => t.classList.remove('active'));
        signalPanels.forEach(panel => panel.classList.remove('active'));
        tab.classList.add('active');

        const panelId = target === 'security' ? 'conflictReports' : 'liveFeedList';
        document.getElementById(panelId)?.classList.add('active');
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

  setScope(scope) {
    State.activeScope = scope;
    updateScopeButtons();
    fullRender();
  },

  clearSearch() {
    State.searchQuery = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').style.display = 'none';
    fullRender();
  },

  resetFilters() {
    State.activeCategory = 'All';
    State.activeLang = 'en';
    State.activeScope = 'all';
    State.activeSources = null;
    State.searchQuery = '';

    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    if (searchInput) searchInput.value = '';
    if (searchClear) searchClear.style.display = 'none';

    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === 'en');
    });

    updateScopeButtons();

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

function updateScopeButtons() {
  document.querySelectorAll('.scope-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.scope === State.activeScope);
  });
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
  document.getElementById('resetFiltersBtn')?.addEventListener('click', () => App.resetFilters());

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

  // Scope switch (All/Internal/External)
  document.getElementById('scopeSwitch')?.addEventListener('click', e => {
    const btn = e.target.closest('.scope-btn');
    if (!btn) return;
    App.setScope(btn.dataset.scope);
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
  updateScopeButtons();

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
