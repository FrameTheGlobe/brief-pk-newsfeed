// Load .env for local development (safe no-op if dotenv isn't installed)
try { require('dotenv').config(); } catch (_) {}

const path    = require('path');
const express = require('express');
const cors    = require('cors');

const newsHandler         = require('./api/news');
const marketHandler       = require('./api/market');
const pakistanMapHandler  = require('./api/pakistan-map');
const intelligenceHandler = require('./api/intelligence');

const app  = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');

// CORS — allows the Vercel-hosted frontend to call this Railway backend
app.use(cors({
  origin: [
    'https://briefpknews.xyz',
    'https://www.briefpknews.xyz',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  methods: ['GET']
}));

const healthHandler = require('./api/health');

app.get('/api/health',       (req, res) => healthHandler(req, res));
app.get('/api/news',         (req, res) => newsHandler(req, res));
app.get('/api/market',       (req, res) => marketHandler(req, res));
app.get('/api/pakistan-map', (req, res) => pakistanMapHandler(req, res));
app.get('/api/intelligence', (req, res) => intelligenceHandler(req, res));

// No-cache for CSS/JS — matches Vercel's headers so local dev behaves identically
const staticOpts = {
  etag: false,
  lastModified: false,
  setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache, must-revalidate'); }
};
app.use('/css', express.static(path.join(__dirname, 'public/css'), staticOpts));
app.use('/js',  express.static(path.join(__dirname, 'public/js'),  staticOpts));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'), { etag: false, lastModified: false });
});

app.get('*', (req, res) => {
  res.redirect('/');
});

app.listen(port, () => {
  console.log(`brief.pk dashboard running on http://localhost:${port}`);
});
