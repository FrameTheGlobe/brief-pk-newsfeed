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

// ── CORS ──────────────────────────────────────────────────────────────────────
// Core origins are always allowed — briefpknews.xyz (with and without www)
// plus localhost for local dev.
// Add extra origins via ALLOWED_ORIGINS env var (comma-separated) if needed.
const CORE_ORIGINS = [
  'https://briefpknews.xyz',
  'https://www.briefpknews.xyz',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const ALL_ORIGINS = [...new Set([...CORE_ORIGINS, ...EXTRA_ORIGINS])];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server, Railway health checks)
    if (!origin) return callback(null, true);
    if (ALL_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// Apply CORS to every request — including errors and 404s
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // pre-flight for all routes

// ── API routes ────────────────────────────────────────────────────────────────
app.get('/api/health',       (req, res) => healthHandler(req, res));
app.get('/api/news',         (req, res) => newsHandler(req, res));
app.get('/api/market',       (req, res) => marketHandler(req, res));
app.get('/api/pakistan-map', (req, res) => pakistanMapHandler(req, res));
app.get('/api/intelligence', (req, res) => intelligenceHandler(req, res));

// ── Root health ping ──────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ service: 'brief.pk API', status: 'ok', version: '5.0.3' });
});

// ── 404 catch-all — must come last ───────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(500).json({ error: err.message || 'internal_error' });
});

app.listen(port, () => {
  console.log(`brief.pk API backend running on http://localhost:${port}`);
  console.log(`Allowed origins: ${ALL_ORIGINS.join(', ')}`);
});
