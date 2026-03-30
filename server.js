/**
 * server.js — Local Development Server
 *
 * Serves the frontend (public/) and all API routes from backend/api/.
 * Used only for local development: `npm run dev`
 *
 * Production:
 *   Backend  → Railway   (root directory: backend/)
 *   Frontend → Vercel    (root directory: /, serves public/)
 */

// Load .env for local development
try { require('dotenv').config(); } catch (_) {}

const path    = require('path');
const express = require('express');

const newsHandler         = require('./backend/api/news');
const marketHandler       = require('./backend/api/market');
const pakistanMapHandler  = require('./backend/api/pakistan-map');
const intelligenceHandler = require('./backend/api/intelligence');
const healthHandler       = require('./backend/api/health');

const app  = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');

// ── API routes ────────────────────────────────────────────────────────────────
app.get('/api/health',       (req, res) => healthHandler(req, res));
app.get('/api/news',         (req, res) => newsHandler(req, res));
app.get('/api/market',       (req, res) => marketHandler(req, res));
app.get('/api/pakistan-map', (req, res) => pakistanMapHandler(req, res));
app.get('/api/intelligence', (req, res) => intelligenceHandler(req, res));

// ── Static frontend ───────────────────────────────────────────────────────────
const staticOpts = {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate')
};

app.use('/css', express.static(path.join(__dirname, 'public/css'), staticOpts));
app.use('/js',  express.static(path.join(__dirname, 'public/js'),  staticOpts));
app.use('/img', express.static(path.join(__dirname, 'public/img'), staticOpts));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'), { etag: false, lastModified: false });
});

app.get('*', (_req, res) => res.redirect('/'));

module.exports = app;

if (require.main === module) {
  app.listen(port, () => {
    console.log(`\n  brief.pk — Local Dev\n`);
    console.log(`  Frontend:  http://localhost:${port}`);
    console.log(`  API news:  http://localhost:${port}/api/news`);
    console.log(`  API mkt:   http://localhost:${port}/api/market`);
    console.log(`  Health:    http://localhost:${port}/api/health\n`);
  });
}
