const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const feedsHandler = require('./api/feeds');
const marketHandler = require('./api/market');

const app = express();
const PORT = 3006;

// 1. PERFORMANCE: Gzip compression
app.use(compression());

// 2. SECURITY: Helmet for secure headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "*"], // allow images from any source for news
      connectSrc: ["'self'", "*"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

// 3. SECURITY: Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100 
});
app.use('/api/', limiter);

// Serve static files from public
app.use(express.static(path.join(__dirname, 'public')));

// Mock Vercel response object for handlers
const wrapHandler = (handler) => async (req, res) => {
  const vercelRes = {
    status: (code) => ({
      json: (data) => res.status(code).json(data),
      end: () => res.status(code).end(),
      send: (data) => res.status(code).send(data)
    }),
    setHeader: (key, val) => res.setHeader(key, val)
  };
  try {
    await handler(req, vercelRes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// API Routes
app.get('/api/feeds', wrapHandler(feedsHandler));
app.get('/api/market', wrapHandler(marketHandler));

app.listen(PORT, () => {
  console.log(`\n🚀 brief.pk Local Dev Server\n`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`API Feeds: http://localhost:${PORT}/api/feeds`);
  console.log(`API Market: http://localhost:${PORT}/api/market\n`);
});
