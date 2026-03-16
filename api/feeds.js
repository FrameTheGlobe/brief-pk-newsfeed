/**
 * api/feeds.js — Vercel Serverless Function
 *
 * GET /api/feeds
 *   Returns a JSON array of Pakistan news articles fetched
 *   server-side from all configured RSS sources.
 *
 * Query params (optional):
 *   ?category=Politics  — filter by category
 *   ?source=dawn        — filter by source id
 *   ?limit=50           — max articles to return (default: 200)
 *
 * Caching:
 *   In-memory cache per warm Lambda container (5 min TTL).
 *   Vercel CDN cache via Cache-Control header (5 min).
 */

const Parser           = require('rss-parser');
const SOURCES          = require('../lib/sources');
const { detectCategory } = require('../lib/categorizer');

// ── In-memory warm cache ─────────────────────────────────────────────
let _cache   = null;
let _cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── RSS parser instance ──────────────────────────────────────────────
const parser = new Parser({
  timeout: 8000,  // Increased to 8s for local stability
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) brief.pk/1.0',
    'Accept':     'application/rss+xml, application/xml, text/xml, */*',
  },
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['enclosure',      'enclosure'],
    ],
  },
});

// ── Helpers ──────────────────────────────────────────────────────────

/** Strip HTML tags and decode common entities */
function clean(str = '') {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g,    ' ')
    .trim();
}

/** Extract first <img> src from HTML string */
function extractImage(html = '') {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

/** Resolve best available image from an RSS item */
function getImage(item) {
  // rss-parser puts enclosure url here for image enclosures
  if (item.enclosure?.url && /\.(jpg|jpeg|png|webp|gif)/i.test(item.enclosure.url)) {
    return item.enclosure.url;
  }
  if (item.mediaThumbnail?.['$']?.url) return item.mediaThumbnail['$'].url;
  if (item.mediaContent?.['$']?.url)   return item.mediaContent['$'].url;

  // Fall back to first <img> in content
  const html = item['content:encoded'] || item.content || item.summary || '';
  return extractImage(html);
}

/** Truncate string to n chars at word boundary */
function truncate(str = '', n = 160) {
  const s = clean(str);
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s\S*$/, '') + '…';
}

/** Detect RTL / Urdu text */
function isRtl(str = '') {
  return /[\u0600-\u06FF\u0750-\u077F]/.test(str);
}

// Keywords used to filter international feeds for Pakistan relevance
const PK_KEYWORDS = [
  'pakistan', 'pakistani', 'islamabad', 'karachi', 'lahore',
  'peshawar', 'quetta', 'rawalpindi', 'multan', 'faisalabad',
  'imran khan', 'shehbaz', 'nawaz', 'pti', 'pml-n', 'ppp',
  'isi', 'pakistan army', 'ispr', 'cpec', 'imf pakistan',
  'kashmir', 'balochistan', 'khyber', 'sindh', 'punjab',
  'kse', 'pak rupee', 'sbp', 'state bank of pakistan',
];

function isPakistanRelevant(title = '', desc = '') {
  const text = (title + ' ' + desc).toLowerCase();
  return PK_KEYWORDS.some(kw => text.includes(kw));
}

// ── Fetch a single source ────────────────────────────────────────────

async function fetchSource(source) {
  try {
    const feed  = await parser.parseURL(source.url);
    const items = (feed.items || []).slice(0, 25);

    const posts = items
      .filter(item => {
        if (source.pakistanFilter) {
          return isPakistanRelevant(item.title, item.contentSnippet || item.summary);
        }
        return true;
      })
      .map(item => ({
        id:          item.guid || item.link || `${source.id}-${Date.now()}-${Math.random()}`,
        title:       clean(item.title || ''),
        description: truncate(item.contentSnippet || item.summary || '', 200),
        link:        item.link || '',
        pubDate:     item.pubDate || item.isoDate || new Date().toISOString(),
        image:       getImage(item),
        source: {
          id:    source.id,
          name:  source.name,
          color: source.color,
          type:  source.type,
          lang:  source.lang,
        },
        category: detectCategory(item.title, item.contentSnippet || item.summary),
        rtl:      isRtl(item.title || ''),
      }));
    
    console.log(`[feeds] ✅ Loaded ${posts.length} from ${source.name}`);
    return posts;
  } catch (err) {
    console.error(`[feeds] ❌ Failed ${source.name}: ${err.message}`);
    return [];
  }
}

// ── Fetch all sources in parallel ────────────────────────────────────

async function fetchAll() {
  const settled = await Promise.allSettled(SOURCES.map(fetchSource));

  let articles = [];
  settled.forEach(r => {
    if (r.status === 'fulfilled') articles.push(...r.value);
  });

  // Sort newest first
  articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // Deduplicate on title prefix
  const seen = new Set();
  articles = articles.filter(a => {
    const key = a.title.slice(0, 70).toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[feeds] 📊 Total: ${articles.length} articles from ${settled.filter(s => s.status === 'fulfilled' && s.value.length > 0).length} sources`);
  return articles;
}

// ── Vercel handler ───────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS + caching headers
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type',                 'application/json; charset=utf-8');
  res.setHeader('Cache-Control',                's-maxage=300, stale-while-revalidate=60');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Serve from warm cache if available
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) {
    return res.status(200).json(applyFilters(_cache, req.query));
  }

  try {
    const articles = await fetchAll();
    _cache   = articles;
    _cacheTs = Date.now();
    return res.status(200).json(applyFilters(articles, req.query));
  } catch (err) {
    console.error('[feeds] Handler error:', err);
    return res.status(500).json({ error: 'Failed to fetch feeds', message: err.message });
  }
};

function applyFilters(articles, query = {}) {
  let result = articles;

  if (query.source)   result = result.filter(a => a.source.id === query.source);
  if (query.category) result = result.filter(a => a.category.toLowerCase() === query.category.toLowerCase());

  const limit = parseInt(query.limit, 10) || 200;
  return result.slice(0, limit);
}
