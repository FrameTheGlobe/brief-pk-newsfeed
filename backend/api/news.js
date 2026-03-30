const FEEDS = [
  { name: 'Dawn', url: 'https://www.dawn.com/feeds/home', scope: 'internal' },
  { name: 'Dawn Pakistan', url: 'https://www.dawn.com/feed/pakistan', scope: 'internal' },
  { name: 'Dawn Business', url: 'https://www.dawn.com/feed/business', scope: 'internal' },
  { name: 'The News', url: 'https://www.thenews.com.pk/rss/1/10', scope: 'internal' },
  { name: 'Express Tribune', url: 'https://tribune.com.pk/feed', scope: 'internal' },
  { name: 'ARY News', url: 'https://arynews.tv/feed/', scope: 'internal' },
  { name: 'Geo News', url: 'https://www.geo.tv/rss/1/1', scope: 'internal' },
  { name: 'Business Recorder', url: 'https://www.brecorder.com/feeds/latest-news', scope: 'internal' },
  { name: 'Profit Pakistan Today', url: 'https://profit.pakistantoday.com.pk/feed/', scope: 'internal' },
  { name: 'Pakistan Observer', url: 'https://pakobserver.net/feed/', scope: 'internal' },
  { name: 'The Nation', url: 'https://nation.com.pk/feed/', scope: 'internal' },
  { name: 'Samaa TV', url: 'https://www.samaa.tv/feed/', scope: 'internal' },
  { name: 'ProPakistani', url: 'https://propakistani.pk/feed/', scope: 'internal' },
  { name: 'Daily Times', url: 'https://dailytimes.com.pk/feed/', scope: 'internal' },
  { name: 'Radio Pakistan', url: 'https://www.radio.gov.pk/rss/news', scope: 'internal' },
  { name: 'BBC Asia', url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml', scope: 'external' },
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', scope: 'external' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', scope: 'external' },
  { name: 'The Guardian World', url: 'https://www.theguardian.com/world/rss', scope: 'external' },
  { name: 'Reuters World', url: 'https://www.reutersagency.com/feed/?best-topics=world&post_type=best', scope: 'external' }
];

const PAKISTAN_TERMS = [
  'pakistan',
  'pakistani',
  'islamabad',
  'karachi',
  'lahore',
  'rawalpindi',
  'balochistan',
  'khyber',
  'punjab',
  'sindh',
  'peshawar',
  'gilgit',
  'kashmir',
  'imf',
  'rupee',
  'kse',
  'psx',
  'gilani',
  'quetta',
  'multan',
  'hyderabad',
  'faisalabad',
  'pak-afghan',
  'line of control'
];

const PAKISTAN_ENTITY_TERMS = [
  'sbp',
  'state bank',
  'fbr',
  'secp',
  'nepra',
  'ogra',
  'ispr',
  'ndma',
  'ecc',
  'finance ministry',
  'economic coordination committee',
  'pmo',
  'prime minister office',
  'national assembly',
  'senate of pakistan',
  'psx',
  'kse-100',
  'kse100'
];

const NOISE_TERMS = [
  'celebrity',
  'showbiz',
  'entertainment',
  'movie',
  'film',
  'actor',
  'actress',
  'trailer',
  'box office',
  'fashion',
  'lifestyle',
  'gossip',
  'cricket highlights',
  'football highlights'
];

function getCategory(text) {
  const t = text.toLowerCase();
  if (/\b(election|cabinet|prime minister|parliament|pti|pmln|ppp|assembly|senate)\b/.test(t)) return 'Politics';
  if (/\b(inflation|interest rates?|gdp|budget|trade|tax|fbr|economy|rupee|exports?|imports?|imf)\b/.test(t)) return 'Economy';
  if (/\b(security|terror|military|army|air force|navy|border|isi|attack|police)\b/.test(t)) return 'Security';
  if (/\b(oil|gas|lng|lpg|petrol|diesel|energy|power|electricity|solar|ipps)\b/.test(t)) return 'Energy';
  if (/\b(market|stocks?|kse|psx|bank|business|corporate|earnings)\b/.test(t)) return 'Markets';
  if (/\b(diplomacy|foreign|india|china|afghanistan|iran|saudi|uae|usa|u\.s\.|united states|regional)\b/.test(t)) return 'Geopolitics';
  if (/\b(court|supreme court|constitutional|judiciary|chief justice|verdict)\b/.test(t)) return 'Justice';
  if (/\b(federal|province|balochistan|sindh|punjab|kp|khyber pakhtunkhwa|gb|ajk)\b/.test(t)) return 'Governance';
  if (/\b(health|hospital|disease|dengue|polio|education|school|university)\b/.test(t)) return 'Society';
  if (/\b(flood|climate|water|heatwave|earthquake|weather)\b/.test(t)) return 'Environment';
  return 'General';
}

function getPriority(text) {
  const t = text.toLowerCase();
  if (/\b(breaking|urgent|explosion|attack|war|default|imf|devaluation|emergency)\b/.test(t)) return 'high';
  if (/\b(cabinet|policy|budget|inflation|market|security|energy|election|court|rates?|rupee|border|ceasefire)\b/.test(t)) return 'medium';
  return 'normal';
}

function containsAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function computeRelevance(article, combinedText, hasDirectPakistanSignal) {
  let score = 0;

  if (hasDirectPakistanSignal) score += 4;
  if (article.scope === 'internal') score += 3;
  if (article.sourceTier === 'core') score += 2;
  else if (article.sourceTier === 'context') score -= 1;

  if (article.priority === 'high') score += 2;
  else if (article.priority === 'medium') score += 1;

  if (article.category === 'Economy' || article.category === 'Security' || article.category === 'Governance') score += 2;
  if (article.category === 'Politics' || article.category === 'Markets' || article.category === 'Geopolitics') score += 1;

  let ageHours = NaN;
  if (article.publishedAt) {
    const t = new Date(article.publishedAt).getTime();
    if (Number.isFinite(t)) ageHours = (Date.now() - t) / 3_600_000;
  }
  if (Number.isFinite(ageHours) && ageHours >= 0) {
    if (ageHours <= 6) score += 2;
    else if (ageHours <= 24) score += 1;
  }

  if (containsAny(combinedText, NOISE_TERMS)) score -= 4;

  return score;
}

function cleanHtml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractItems(xml) {
  const itemMatches = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  if (itemMatches.length) return itemMatches;
  return [...xml.matchAll(/<entry[\s\S]*?<\/entry>/gi)].map((m) => m[0]);
}

function extractField(block, tag) {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  ];
  for (const p of patterns) {
    const m = block.match(p);
    if (m && m[1]) return cleanHtml(m[1]);
  }
  return '';
}

function extractLink(block) {
  const fromTag = extractField(block, 'link');
  if (fromTag && /^https?:\/\//i.test(fromTag)) return fromTag;

  const hrefMatch = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (hrefMatch && hrefMatch[1]) return hrefMatch[1].trim();
  return '';
}

function extractImage(block) {
  const catchUrl = (tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*url=["']([^"']+)["'][^>]*>`, 'i'));
    return m ? m[1] : null;
  };
  let url = catchUrl('media:content') || catchUrl('media:thumbnail') || catchUrl('enclosure');
  if (url) return url;

  const cdataMatch = block.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  const content = cdataMatch ? cdataMatch[1] : block;
  const imgMatch = content.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
  if (imgMatch && imgMatch[1]) return imgMatch[1];
  return null;
}

function parseFeed(xml, feed) {
  const blocks = extractItems(xml);
  const out = [];

  for (const block of blocks) {
    const title = extractField(block, 'title');
    const description = extractField(block, 'description') || extractField(block, 'summary');
    const link = extractLink(block);
    const pubDateRaw =
      extractField(block, 'pubDate') ||
      extractField(block, 'updated') ||
      extractField(block, 'published') ||
      extractField(block, 'dc:date');

    if (!title || !link) continue;

    const combined = `${title} ${description}`.toLowerCase();
    const hasDirectPakistanSignal =
      containsAny(combined, PAKISTAN_TERMS) || containsAny(combined, PAKISTAN_ENTITY_TERMS);
    const hasPakistanSignal = feed.scope === 'internal' || hasDirectPakistanSignal;
    if (!hasPakistanSignal) continue;

    let publishedAt = null;
    if (pubDateRaw) {
      const parsed = new Date(pubDateRaw);
      if (!Number.isNaN(parsed.getTime())) publishedAt = parsed.toISOString();
    }

    const article = {
      id: `${feed.name}-${link}`,
      title,
      description,
      url: link,
      thumbnail: extractImage(block),
      source: feed.name,
      scope: feed.scope,
      sourceTier: feed.scope === 'internal' ? 'core' : 'context',
      directPakistanSignal: hasDirectPakistanSignal,
      category: getCategory(combined),
      priority: getPriority(combined),
      // Never default to "now" — that falsely ranks undated items as newest.
      publishedAt: publishedAt || null
    };

    article.relevanceScore = computeRelevance(article, combined, hasDirectPakistanSignal);

    if (article.relevanceScore < 3) continue;
    if (containsAny(combined, NOISE_TERMS) && article.relevanceScore < 7) continue;

    out.push(article);
  }
  return out;
}

async function fetchText(url, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'brief-pk-newsfeed/1.0 (+open-feeds)'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── Server-side in-memory cache ──────────────────────────────────────────────
let _newsCache = null;
let _newsCacheTs = 0;
const NEWS_CACHE_TTL = 90 * 1000; // 90s — fresher headlines; still amortizes RSS fan-out

async function buildArticles() {
  const responses = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const xml = await fetchText(feed.url);
      return parseFeed(xml, feed);
    })
  );

  const merged = [];
  for (const r of responses) {
    if (r.status === 'fulfilled') merged.push(...r.value);
  }

  const dedup = new Map();
  for (const article of merged) {
    const key = article.url || article.title;
    const existing = dedup.get(key);
    if (!existing) { dedup.set(key, article); continue; }
    const scoreDiff = (article.relevanceScore || 0) - (existing.relevanceScore || 0);
    if (scoreDiff > 0) { dedup.set(key, article); continue; }
    if (scoreDiff === 0) {
      const tNew = article.publishedAt ? new Date(article.publishedAt).getTime() : 0;
      const tOld = existing.publishedAt ? new Date(existing.publishedAt).getTime() : 0;
      const aOk = Number.isFinite(tNew);
      const bOk = Number.isFinite(tOld);
      if (aOk && bOk && tNew > tOld) dedup.set(key, article);
      else if (aOk && !bOk) dedup.set(key, article);
    }
  }

  const pubMs = (a) => {
    if (!a.publishedAt) return 0;
    const t = new Date(a.publishedAt).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const pri = (p) => (p === 'high' ? 3 : p === 'medium' ? 2 : 1);

  // Newest first (primary), then relevance, then priority — keeps the feed time-accurate.
  return [...dedup.values()].sort((a, b) => {
    const byTime = pubMs(b) - pubMs(a);
    if (byTime !== 0) return byTime;
    const byRelevance = (b.relevanceScore || 0) - (a.relevanceScore || 0);
    if (byRelevance !== 0) return byRelevance;
    return pri(b.priority) - pri(a.priority);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, must-revalidate');

  const force = req.query?.force === '1';

  try {
    if (!force && _newsCache && Date.now() - _newsCacheTs < NEWS_CACHE_TTL) {
      return res.status(200).json({
        updatedAt: new Date(_newsCacheTs).toISOString(),
        total: _newsCache.length,
        articles: _newsCache.slice(0, 250),
        cached: true
      });
    }

    const articles = await buildArticles();
    _newsCache = articles;
    _newsCacheTs = Date.now();

    return res.status(200).json({
      updatedAt: new Date().toISOString(),
      total: articles.length,
      articles: articles.slice(0, 250)
    });
  } catch (err) {
    // Return stale cache if available rather than hard-failing
    if (_newsCache) {
      return res.status(200).json({
        updatedAt: new Date(_newsCacheTs).toISOString(),
        total: _newsCache.length,
        articles: _newsCache.slice(0, 250),
        stale: true
      });
    }
    res.status(500).json({
      updatedAt: new Date().toISOString(),
      total: 0,
      articles: [],
      error: err instanceof Error ? err.message : 'news_fetch_failed'
    });
  }
};

