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
const CACHE_KEY      = 'briefpk_feeds_cache';
const CACHE_TTL      = 5 * 60 * 1000; // 5 min
const SECTION_COUNT  = 5; // cards per category section
const HERO_COUNT     = 3; // stories in hero (1 main + 2 side)

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
    const res  = await fetch(API_URL);
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
    return a.category === cat;
  });
}

/* ═══════════════════════════════════════════════
   CARD HTML BUILDERS
═══════════════════════════════════════════════ */

function buildTags(article, options = {}) {
  const s    = article.source;
  const cc   = getCatColor(article.category);
  const cbg  = getCatBg(article.category);
  const rtl  = article.rtl;

  return `
    <div class="card-tags">
      <span class="tag-source" style="color:${s.color};border-color:${s.color}33;background:${s.color}0d;">
        ${escHtml(s.name)}
      </span>
      <span class="tag-cat" style="color:${cc};background:${cbg};">
        ${escHtml(article.category)}
      </span>
      ${rtl ? '<span class="tag-rtl">اردو</span>' : ''}
    </div>`;
}

function buildCardImage(article, height = 155) {
  if (article.image) {
    return `<img class="card-image"
      src="${escHtml(article.image)}"
      alt=""
      loading="lazy"
      onerror="this.parentElement.innerHTML=buildPlaceholder('${escHtml(article.source.name)}','${article.source.color}',${height})">`;
  }
  return buildPlaceholder(article.source.name, article.source.color, height);
}

function buildPlaceholder(name, color, height) {
  const init = getInitials(name);
  return `<div class="card-image-placeholder" style="height:${height}px;background:linear-gradient(135deg,${color} 0%,${color}cc 100%);">
    ${init}
  </div>`;
}

function cardFooter(article) {
  return `
    <div class="card-footer">
      <span class="card-time">${escHtml(article.source.name)} · ${timeAgo(article.pubDate)}</span>
      <span class="card-arrow">→</span>
    </div>`;
}

/* ── Hero main card ─────────────────────────── */
function buildHeroMain(article) {
  if (!article) return '';
  const img = article.image
    ? `<img class="card-image" src="${escHtml(article.image)}" alt="" loading="eager" style="height:300px;object-fit:cover;" onerror="this.style.display='none'">`
    : buildPlaceholder(article.source.name, article.source.color, 300);

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
function buildSideCard(article) {
  if (!article) return '';
  const img = article.image
    ? `<img class="card-image" src="${escHtml(article.image)}" alt="" loading="lazy" style="height:120px;object-fit:cover;" onerror="this.style.display='none'">`
    : buildPlaceholder(article.source.name, article.source.color, 120);

  return `
    <a class="side-card" href="${escHtml(article.link)}" target="_blank" rel="noopener noreferrer">
      ${img}
      <div class="card-body">
        ${buildTags(article)}
        <div class="card-headline${article.rtl ? ' rtl' : ''}">${escHtml(article.title)}</div>
        ${cardFooter(article)}
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
  const icon    = CAT_ICONS[cat] || '●';
  const visible = articles.slice(0, SECTION_COUNT);

  return `
    <section class="category-section" id="section-${cat.toLowerCase().replace(/\s+/g, '-')}">
      <div class="section-header">
        <div class="section-title-group">
          <span class="section-dot" style="background:${cc};"></span>
          <h2 class="section-title">${escHtml(cat)}</h2>
        </div>
        <a class="section-see-all" href="#" onclick="App.filterCategory('${escHtml(cat)}');return false;">
          All ${escHtml(cat)} →
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
  const heroGrid = document.getElementById('heroGrid');
  const container = document.getElementById('categorySections');

  // Hide hero section completely in category view
  const heroSection = document.getElementById('heroSection');
  if (heroSection) heroSection.style.display = 'none';

  const cc   = getCatColor(State.activeCategory);
  const icon = CAT_ICONS[State.activeCategory] || '●';

  container.innerHTML = `
    <section class="category-section">
      <div class="section-header">
        <div class="section-title-group">
          <span class="section-dot" style="background:${cc};"></span>
          <h2 class="section-title">${escHtml(State.activeCategory)}</h2>
          <span style="font-size:12px;color:var(--text-3);margin-left:4px;">${articles.length} stories</span>
        </div>
        <button class="section-see-all" onclick="App.filterCategory('All')">← All topics</button>
      </div>
      <div class="cards-row">
        ${articles.map(buildNewsCard).join('') || '<div class="empty-state"><h3>No stories in this category yet</h3></div>'}
      </div>
    </section>`;
}

function renderSearchResults(articles) {
  const heroSection = document.getElementById('heroSection');
  if (heroSection) heroSection.style.display = 'none';

  const container = document.getElementById('categorySections');
  container.innerHTML = `
    <section class="category-section">
      <div class="section-header">
        <div class="section-title-group">
          <span class="section-dot teal"></span>
          <h2 class="section-title">Search results for "${escHtml(State.searchQuery)}"</h2>
          <span style="font-size:12px;color:var(--text-3);margin-left:6px;">${articles.length} found</span>
        </div>
        <button class="section-see-all" onclick="App.clearSearch()">✕ Clear</button>
      </div>
      ${articles.length
        ? `<div class="cards-row">${articles.map(buildNewsCard).join('')}</div>`
        : `<div class="empty-state"><h3>No results found</h3><p>Try a different search term.</p></div>`
      }
    </section>`;
}

/* ═══════════════════════════════════════════════
   SIDEBAR RENDERERS
═══════════════════════════════════════════════ */

function renderSidebarCategories() {
  const list = document.getElementById('catNavList');
  if (!list) return;

  const allCount = State.articles.length;

  list.innerHTML = CATEGORIES.map(cat => {
    const count  = cat === 'All' ? allCount : getByCategory(cat).length;
    const active = State.activeCategory === cat ? 'active' : '';
    const cc     = getCatColors(cat);

    return `
      <li>
        <button class="nav-item ${active}" onclick="App.filterCategory('${escHtml(cat)}')">
          <span class="nav-item-dot" style="background:${cc};"></span>
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

  // Count articles per source
  const counts = {};
  State.articles.forEach(a => {
    counts[a.source.id] = (counts[a.source.id] || 0) + 1;
  });

  // Get unique sources from articles
  const sources = [];
  const seen    = new Set();
  State.articles.forEach(a => {
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

  const recent = State.articles.slice(0, 15);
  if (!recent.length) return;

  list.innerHTML = recent.map(a => `
    <li class="feed-item" onclick="window.open('${escHtml(a.link)}','_blank')">
      <div class="feed-title${a.rtl ? ' rtl' : ''}">${escHtml(a.title)}</div>
      <div class="feed-meta">
        <span class="feed-source-dot" style="background:${a.source.color};"></span>
        <span>${escHtml(a.source.name)}</span>
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
  if (!track || !articles.length) return;

  const items = articles
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

  // Show hero section for 'All' only
  const heroSection = document.getElementById('heroSection');
  if (heroSection) {
    heroSection.style.display = (State.activeCategory === 'All' && !State.searchQuery) ? '' : 'none';
  }

  // Main sections
  renderAllSections(filtered);

  // Sidebar
  renderSidebarCategories();
  renderSidebarSources();

  // Right panel
  renderLiveFeed();
  renderTrending();
  renderSourceBreakdown();

  // Header + ticker
  updateHeaderStats();
  renderTicker(State.articles.slice(0, 30));

  // Footer
  renderFooter();
}

/* ═══════════════════════════════════════════════
   PUBLIC API  (window.App)
═══════════════════════════════════════════════ */

const App = {

  async init() {
    State.isLoading = true;
    setRefreshLoading(true);

    try {
      await fetchArticles();
      fullRender();
    } catch (err) {
      showError('Failed to load news feeds. Check your connection and try again.');
    } finally {
      State.isLoading = false;
      setRefreshLoading(false);
    }

    // Auto-refresh every 5 min
    setInterval(() => App.refresh(false), 5 * 60 * 1000);
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

  // Sidebar toggle (mobile)
  document.getElementById('sidebarToggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('open');
  });

  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', e => {
    const sidebar = document.getElementById('sidebar');
    const toggle  = document.getElementById('sidebarToggle');
    if (sidebar?.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        !toggle.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });

  // Scroll to top FAB
  window.addEventListener('scroll', () => {
    document.getElementById('fab')?.classList.toggle('show', scrollY > 600);
  });

  // Boot
  App.init();
});
