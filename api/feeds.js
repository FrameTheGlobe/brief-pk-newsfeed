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

const { 
  clean, 
  getImage, 
  truncate, 
  isRtl, 
  isPakistanRelevant, 
  applyFilters 
} = require('../lib/feed-utils');

const Parser             = require('rss-parser');
const SOURCES            = require('../lib/sources');
const { detectCategory } = require('../lib/categorizer');

// ── In-memory warm cache ─────────────────────────────────────────────
let _cache   = null;
let _cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── RSS parser instance ──────────────────────────────────────────────
const parser = new Parser({
  timeout: 5000,  // 5s — safe margin under Vercel's 10s function limit
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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


// ── Fetch a single source ────────────────────────────────────────────

async function fetchSource(source) {
  try {
    const feed  = await parser.parseURL(source.url);
    const items = (feed.items || []).slice(0, 25);

    const posts = items
      .filter(item => {
        // Sources explicitly marked false are Pakistan-only feeds — no filter needed
        if (source.pakistanFilter === false) return true;
        // Everything else is filtered for Pakistan relevance by default
        return isPakistanRelevant(item.title, item.contentSnippet || item.summary);
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
        category: detectCategory(item.title),
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

async function getCachedFeeds(options = {}) {
  const { force = false } = options;

  if (!force && _cache && Date.now() - _cacheTs < CACHE_TTL) {
    return _cache;
  }

  const articles = await fetchAll();
  _cache   = articles;
  _cacheTs = Date.now();
  return articles;
}

// ── Vercel / Express handler ─────────────────────────────────────────

async function handler(req, res) {
  // CORS + caching headers
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type',                 'application/json; charset=utf-8');
  res.setHeader('Cache-Control',                's-maxage=300, stale-while-revalidate=60');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const articles = await getCachedFeeds({ force: !!req.query?.force });
    return res.status(200).json(applyFilters(articles, req.query));
  } catch (err) {
    console.error('[feeds] Handler error:', err);
    return res.status(500).json({ error: 'Failed to fetch feeds', message: err.message });
  }
}

module.exports = handler;
module.exports.getCachedFeeds = getCachedFeeds;
module.exports.applyFilters   = applyFilters;


