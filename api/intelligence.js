// ── Server-side cache ─────────────────────────────────────────────────────────
let _intelCache = null;
let _intelCacheTs = 0;
const INTEL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';

// Fast Pakistan news feeds for context injection
const NEWS_FEEDS = [
  'https://www.dawn.com/feeds/home',
  'https://geo.tv/rss/top-stories',
  'https://arynews.tv/en/feed/',
  'https://www.brecorder.com/feed'
];

async function fetchFeed(url, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; brief.pk/1.0)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (_) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function extractTitles(xml, max = 10) {
  const titles = [];
  // Match both plain and CDATA-wrapped titles, skip feed/channel titles
  const re = /<item[\s\S]*?<title>(?:<!\[CDATA\[)?\s*([\s\S]*?)\s*(?:\]\]>)?<\/title>/gi;
  let m;
  while ((m = re.exec(xml)) !== null && titles.length < max) {
    const t = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (t && t.length > 12) titles.push(t);
  }
  return titles;
}

async function getHeadlines() {
  const results = await Promise.allSettled(NEWS_FEEDS.map(f => fetchFeed(f)));
  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      all.push(...extractTitles(r.value, 8));
    }
  }
  return [...new Set(all)].slice(0, 28); // dedupe, cap at 28
}

function buildPrompt(headlines) {
  const today = new Date().toUTCString().split(' ').slice(0, 4).join(' ');
  const headlineBlock = headlines.length > 0
    ? `Latest Pakistan news headlines (past 48 hours):\n${headlines.map(h => `• ${h}`).join('\n')}\n\n`
    : '';

  return `You are a senior Pakistan intelligence analyst. Today is ${today}.

${headlineBlock}Analyze Pakistan's current situation and return a single JSON object. Use the headlines as primary context; supplement with your knowledge of Pakistan's ongoing situation.

SCORING GUIDE (apply consistently):
• 75–100 = Strong / Favorable condition
• 50–74  = Moderate / Mixed signals
• 25–49  = Concerning / Under stress
• 0–24   = Critical / Severe deterioration
• For "Inflation Pressure": HIGH score = LOW inflation (favorable). LOW score = HIGH inflation (bad).

Return ONLY a valid JSON object, no markdown fences, no explanation:

{
  "dailyBrief": [
    {"headline":"<6-8 word story label>","detail":"<2 sentences, plain English, max 160 chars>"},
    {"headline":"<6-8 word story label>","detail":"<2 sentences, plain English, max 160 chars>"},
    {"headline":"<6-8 word story label>","detail":"<2 sentences, plain English, max 160 chars>"}
  ],
  "watchFor": [
    "<1 forward-looking signal to monitor in next 24-48h, max 100 chars>",
    "<1 forward-looking signal to monitor in next 24-48h, max 100 chars>"
  ],
  "indicators": [
    {"id":"economy","label":"Economic Health","score":<0-100>,"trend":"<improving|declining|stable>","signal":"<3-5 word headline>","brief":"<1 sentence, max 95 chars>"},
    {"id":"security","label":"Security Climate","score":<0-100>,"trend":"<improving|declining|stable>","signal":"<3-5 word headline>","brief":"<1 sentence, max 95 chars>"},
    {"id":"politics","label":"Political Stability","score":<0-100>,"trend":"<improving|declining|stable>","signal":"<3-5 word headline>","brief":"<1 sentence, max 95 chars>"},
    {"id":"inflation","label":"Inflation Pressure","score":<0-100>,"trend":"<improving|declining|stable>","signal":"<3-5 word headline>","brief":"<1 sentence, max 95 chars>"},
    {"id":"diplomacy","label":"Geopolitical Standing","score":<0-100>,"trend":"<improving|declining|stable>","signal":"<3-5 word headline>","brief":"<1 sentence, max 95 chars>"},
    {"id":"governance","label":"Governance Index","score":<0-100>,"trend":"<improving|declining|stable>","signal":"<3-5 word headline>","brief":"<1 sentence, max 95 chars>"}
  ],
  "synthesis":"<2–3 sentence executive assessment of Pakistan's overall trajectory and the most important near-term risks or opportunities>"
}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.GROQ_API_KEY || process.env.Groq;
  if (!apiKey) {
    return res.status(503).json({ error: 'GROQ_API_KEY not configured on server' });
  }

  const force = req.query?.force === '1';
  if (!force && _intelCache && Date.now() - _intelCacheTs < INTEL_CACHE_TTL) {
    return res.status(200).json({ ..._intelCache, cached: true });
  }

  try {
    const headlines = await getHeadlines();
    const prompt    = buildPrompt(headlines);

    const groqRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.25,
        max_tokens: 1900,
        response_format: { type: 'json_object' }
      }),
      signal: AbortSignal.timeout(28000)
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text().catch(() => '');
      throw new Error(`Groq ${groqRes.status}: ${errText.slice(0, 200)}`);
    }

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content;
    if (!raw) throw new Error('Empty response from Groq');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      // Try stripping accidental markdown fences
      const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '');
      parsed = JSON.parse(cleaned);
    }

    if (!Array.isArray(parsed?.indicators) || parsed.indicators.length < 6) {
      throw new Error('Groq response missing required indicators array');
    }

    // Clamp scores to 0-100 and normalise trend values
    const VALID_TRENDS = new Set(['improving', 'declining', 'stable']);
    parsed.indicators = parsed.indicators.slice(0, 6).map(ind => ({
      ...ind,
      score: Math.max(0, Math.min(100, Math.round(Number(ind.score) || 50))),
      trend: VALID_TRENDS.has(ind.trend) ? ind.trend : 'stable'
    }));

    // Normalise dailyBrief
    const dailyBrief = Array.isArray(parsed.dailyBrief)
      ? parsed.dailyBrief.slice(0, 3).map(b => ({
          headline: String(b.headline || '').slice(0, 80),
          detail:   String(b.detail   || '').slice(0, 200)
        }))
      : [];

    // Normalise watchFor
    const watchFor = Array.isArray(parsed.watchFor)
      ? parsed.watchFor.slice(0, 2).map(w => String(w || '').slice(0, 120))
      : [];

    const payload = {
      generatedAt:    new Date().toISOString(),
      model:          GROQ_MODEL,
      headlineCount:  headlines.length,
      dailyBrief,
      watchFor,
      indicators:     parsed.indicators,
      synthesis:      String(parsed.synthesis || '').slice(0, 500)
    };

    _intelCache   = payload;
    _intelCacheTs = Date.now();
    return res.status(200).json(payload);

  } catch (err) {
    // Serve stale cache on any error rather than breaking the page
    if (_intelCache) {
      return res.status(200).json({ ..._intelCache, cached: true, stale: true });
    }
    return res.status(500).json({ error: err instanceof Error ? err.message : 'intelligence_fetch_failed' });
  }
};
