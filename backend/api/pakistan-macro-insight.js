/**
 * GET /api/pakistan-macro-insight
 * Optional Groq synthesis of the static macro JSON. Heavily cached in-process on Railway
 * (one explanation shared by all visitors for ~21 days) to keep token cost near zero.
 * Without GROQ_API_KEY, returns staticInsight from the JSON only.
 */

const fs = require('fs');
const path = require('path');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const DATA = path.join(__dirname, '../data/pakistan-macro.json');
const CACHE_TTL_MS = 21 * 24 * 60 * 60 * 1000;

let _cache = null;
let _cacheTs = 0;

function loadMacro() {
  const raw = fs.readFileSync(DATA, 'utf8');
  return JSON.parse(raw);
}

function summarizeForPrompt(macro) {
  const lines = [];
  for (const s of macro.series || []) {
    const pts = s.points || [];
    const last = pts[pts.length - 1];
    const first = pts[0];
    lines.push(
      `- ${s.shortLabel || s.id}: ${pts.length} obs, first ${first ? `${first.v} (${first.y})` : '—'}, latest ${last ? `${last.v} (${last.y})` : '—'}`
    );
  }
  return lines.join('\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

  const force = req.query?.force === '1';
  let macro;
  try {
    macro = loadMacro();
  } catch (e) {
    return res.status(500).json({ error: 'macro_data_missing', detail: String(e) });
  }

  const staticInsight = String(macro.staticInsight || '');
  const apiKey = process.env.GROQ_API_KEY || process.env.Groq;

  if (!apiKey) {
    return res.status(200).json({
      source: 'static',
      text: staticInsight,
      cached: false,
      groq: false
    });
  }

  if (!force && _cache && Date.now() - _cacheTs < CACHE_TTL_MS) {
    return res.status(200).json({ ..._cache, cached: true });
  }

  const summary = summarizeForPrompt(macro);
  const prompt = `You are a neutral economic analyst. Using ONLY the statistics summarized below (World Bank–style series for Pakistan), write a clear explanation for a general audience.

Rules:
- Four short paragraphs max. Plain English. No partisan blame.
- Mention that poverty observations are not annual and debt shown is external debt relative to GNI, not the same as total government debt/GDP.
- End with one sentence on data limitations.

Statistics:
${summary}

Meta: ${macro.meta?.disclaimer || ''}`;

  try {
    const groqRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.35,
        max_tokens: 900
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text().catch(() => '');
      throw new Error(`Groq ${groqRes.status}: ${errText.slice(0, 200)}`);
    }

    const groqData = await groqRes.json();
    const text = String(groqData.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('Empty Groq response');

    const payload = {
      source: 'ai',
      text,
      model: GROQ_MODEL,
      generatedAt: new Date().toISOString(),
      groq: true,
      cached: false
    };
    _cache = payload;
    _cacheTs = Date.now();
    return res.status(200).json(payload);
  } catch (err) {
    const fallback = {
      source: 'static',
      text: staticInsight,
      cached: false,
      groq: false,
      error: err instanceof Error ? err.message : 'insight_failed'
    };
    if (_cache) {
      return res.status(200).json({ ..._cache, cached: true, stale: true });
    }
    return res.status(200).json(fallback);
  }
};
