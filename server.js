const path = require('path');
const express = require('express');

const newsHandler = require('./api/news');
const marketHandler = require('./api/market');
const pakistanMapHandler = require('./api/pakistan-map');

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');

app.get('/api/news', (req, res) => newsHandler(req, res));
app.get('/api/market', (req, res) => marketHandler(req, res));
app.get('/api/pakistan-map', (req, res) => pakistanMapHandler(req, res));

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
