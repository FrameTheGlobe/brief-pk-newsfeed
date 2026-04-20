/**
 * GET /api/pakistan-macro
 * Serves pre-built WDI snapshot JSON from disk. Cheap: one read per request;
 * rely on CDN/browser caching — data is refreshed only when you re-run the fetch script.
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '../data/pakistan-macro.json');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

  try {
    const raw = fs.readFileSync(DATA, 'utf8');
    const json = JSON.parse(raw);
    return res.status(200).json(json);
  } catch (e) {
    return res.status(500).json({
      error: 'pakistan_macro_unavailable',
      detail: e instanceof Error ? e.message : String(e)
    });
  }
};
