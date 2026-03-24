// Lightweight health / env-check endpoint
// Safe to expose: shows key presence and prefix only, never the full value
module.exports = function handler(req, res) {
  const key = process.env.GROQ_API_KEY || process.env.Groq || '';
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok:           true,
    node:         process.version,
    env:          process.env.NODE_ENV || 'unknown',
    groq_key_set: key.length > 0,
    groq_key_len: key.length,
    groq_key_pfx: key.length > 8 ? key.slice(0, 8) + '…' : '(empty)',
    ts:           new Date().toISOString()
  });
};
