// Load .env for local development (safe no-op if dotenv isn't installed)
try { require('dotenv').config(); } catch (_) {}

const express = require('express');
const cors    = require('cors');

const healthHandler       = require('./api/health');
const newsHandler         = require('./api/news');
const marketHandler       = require('./api/market');
const pakistanMapHandler  = require('./api/pakistan-map');
const intelligenceHandler = require('./api/intelligence');

const app  = express();
const port = Number(process.env.PORT || 4000);

app.disable('x-powered-by');

// CORS — only allow requests from the Vercel frontend (or localhost in dev)
// Override via ALLOWED_ORIGINS env var (comma-separated) if needed
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

const DEFAULT_ORIGINS = [
  'https://briefpknews.xyz',
  'https://www.briefpknews.xyz',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

app.use(cors({
  origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_ORIGINS,
  methods: ['GET']
}));

// ── API routes ────────────────────────────────────────────────────────────────
app.get('/api/health',       (req, res) => healthHandler(req, res));
app.get('/api/news',         (req, res) => newsHandler(req, res));
app.get('/api/market',       (req, res) => marketHandler(req, res));
app.get('/api/pakistan-map', (req, res) => pakistanMapHandler(req, res));
app.get('/api/intelligence', (req, res) => intelligenceHandler(req, res));

// ── Root health ping ──────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ service: 'brief.pk API', status: 'ok', version: '5.0.0' });
});

app.listen(port, () => {
  console.log(`brief.pk API backend running on http://localhost:${port}`);
});
