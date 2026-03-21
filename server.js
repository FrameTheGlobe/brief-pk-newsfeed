const path = require('path');
const express = require('express');

const newsHandler = require('./api/news');
const marketHandler = require('./api/market');

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');

app.get('/api/news', (req, res) => newsHandler(req, res));
app.get('/api/market', (req, res) => marketHandler(req, res));

app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('*', (req, res) => {
  res.redirect('/');
});

app.listen(port, () => {
  console.log(`brief.pk dashboard running on http://localhost:${port}`);
});
