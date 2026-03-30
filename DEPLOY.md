# Separating Frontend (Vercel) + Backend (Railway)
### A complete, replicable guide for vanilla JS + Express apps

This documents exactly what was done to split brief.pk from a single monolithic Express server (everything on Vercel) into a clean frontend/backend separation. Every step is reproducible for any similar project.

---

## The Problem We Solved

**Before:** One Express server handled everything — it served static HTML/CSS/JS files AND handled all API routes. This was deployed entirely on Vercel as serverless functions.

**Why that was bad:**
- Vercel serverless functions are stateless — a new instance spins up per request
- In-memory caches (`let _cache = null`) accumulated nothing — each lambda started cold
- The intelligence endpoint (Groq API) was called fresh by every visitor every 30 minutes
- Costs grew with traffic; no persistent server = no persistent cache

**After:** Clean split.
- **Vercel** serves only `public/` — three static files, zero functions, zero cost at scale
- **Railway** runs one persistent Express process — caches warm on first request, serve in ~1ms thereafter

```
BEFORE:
  Browser → Vercel (serverless) → serves HTML + handles API → cold lambda every time

AFTER:
  Browser → Vercel CDN   → public/index.html, public/css/*, public/js/*  (static only)
          → Railway       → /api/news, /api/market, /api/intelligence, ...  (persistent)
```

---

## Starting Point — What the Codebase Looked Like

```
/
├── api/                    ← Vercel serverless functions (one file per route)
│   ├── health.js
│   ├── news.js
│   ├── market.js
│   ├── intelligence.js
│   └── pakistan-map.js
├── public/
│   ├── index.html
│   ├── css/main.css
│   └── js/app.js           ← all fetch() calls used same-origin paths (/api/news)
├── server.js               ← monolithic Express: served static + API (local dev only)
├── package.json
└── vercel.json             ← routed /api/* to the api/ functions
```

All `fetch()` calls in `app.js` used relative paths like `/api/news` — they worked because Vercel routed `/api/*` to the serverless functions automatically.

---

## Step 1 — Create the `backend/` folder

Create a self-contained backend package. Railway will be pointed at this folder — it must be able to run completely independently.

```
backend/
├── server.js        ← Railway's entry point (node server.js)
├── package.json     ← backend-only dependencies
├── railway.json     ← Railway deploy config
├── .env.example     ← documents required env vars (never commit .env)
└── api/
    ├── health.js
    ├── news.js
    ├── market.js
    ├── intelligence.js
    └── pakistan-map.js
```

### 1a. Copy API handlers into `backend/api/`

Copy every file from `api/` into `backend/api/`. No changes to the handler files themselves — they just move locations.

```bash
mkdir -p backend/api
cp api/health.js       backend/api/health.js
cp api/news.js         backend/api/news.js
cp api/market.js       backend/api/market.js
cp api/intelligence.js backend/api/intelligence.js
cp api/pakistan-map.js backend/api/pakistan-map.js
```

### 1b. Create `backend/package.json`

This is the backend's own dependency manifest. Railway runs `npm install` inside `/backend`, so this must be self-contained.

```json
{
  "name": "brief-pk-backend",
  "version": "1.0.0",
  "private": true,
  "description": "Express API backend — runs on Railway",
  "scripts": {
    "dev":   "node server.js",
    "start": "node server.js"
  },
  "dependencies": {
    "cors":    "^2.8.6",
    "dotenv":  "^16.0.0",
    "express": "^4.21.2"
  },
  "engines": {
    "node": "20.x"
  }
}
```

### 1c. Create `backend/server.js` — the Railway entry point

This is the heart of the backend. Key requirements:
- Must bind to `process.env.PORT` (Railway injects this — if you hardcode a port, Railway can't reach the process)
- Must configure CORS — the browser will call this server cross-origin from the Vercel domain
- CORS middleware must be applied **before all routes** so that even 404 and error responses carry CORS headers

```js
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
// Hardcode your production frontend origins here — do NOT rely on env vars alone.
// If ALLOWED_ORIGINS env var changes or is missing, CORE_ORIGINS always work.
const CORE_ORIGINS = [
  'https://yourdomain.com',
  'https://www.yourdomain.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

// Optional: additive extra origins from env var (comma-separated)
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

// CRITICAL: apply before routes so CORS headers appear on ALL responses (including 404)
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // handle pre-flight OPTIONS for all routes

// ── API routes ────────────────────────────────────────────────────────────────
app.get('/api/health',       (req, res) => healthHandler(req, res));
app.get('/api/news',         (req, res) => newsHandler(req, res));
app.get('/api/market',       (req, res) => marketHandler(req, res));
app.get('/api/pakistan-map', (req, res) => pakistanMapHandler(req, res));
app.get('/api/intelligence', (req, res) => intelligenceHandler(req, res));

// Root ping — useful to quickly confirm the server is alive
app.get('/', (_req, res) => {
  res.json({ service: 'my-app API', status: 'ok' });
});

// ── 404 catch-all — must be LAST ─────────────────────────────────────────────
// Without this, unmatched routes return Express's default HTML 404 with no CORS headers.
// The browser then reports it as a CORS error — masking the real 404.
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// ── Generic error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(500).json({ error: err.message || 'internal_error' });
});

app.listen(port, () => {
  console.log(`API backend running on http://localhost:${port}`);
  console.log(`Allowed origins: ${ALL_ORIGINS.join(', ')}`);
});
```

### 1d. Create `backend/railway.json` — Railway deploy config

Railway reads this file to know how to build and run the service.

```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "node server.js",
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

- `NIXPACKS` — Railway's auto-builder; detects Node.js, runs `npm install` automatically
- `startCommand` — runs relative to the Root Directory you set in Railway (i.e., `backend/`)
- `healthcheckPath` — Railway polls this after deploy; if it returns non-200, the deploy fails
- `restartPolicyType: ON_FAILURE` — auto-restarts the process if it crashes

### 1e. Create `backend/.env.example`

Never commit real secrets. This file documents what Railway variables to set.

```bash
# Copy to .env for local development
# On Railway: set these in the Variables tab — never commit .env

GROQ_API_KEY=your_key_here
NODE_ENV=production

# Optional: comma-separated extra CORS origins beyond the hardcoded defaults
# ALLOWED_ORIGINS=https://staging.yourdomain.com
```

---

## Step 2 — Update the frontend to call Railway

The frontend's `fetch()` calls were all relative paths (`/api/news`). On Vercel, these hit the Vercel serverless functions. Now they need to hit Railway — but only in production. Locally, keep using the relative paths so local dev stays simple.

**`public/js/app.js` — add at the very top:**

```js
// In production (Vercel), fetch from Railway. Locally, use same-origin (Express serves both).
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? ''
  : 'https://your-service-name-production.up.railway.app';
```

**Then update every `fetch('/api/...')` call to use `API_BASE`:**

```js
// Before:
const res = await fetch('/api/news', { cache: 'no-store' });

// After:
const res = await fetch(`${API_BASE}/api/news`, { cache: 'no-store' });
```

Do this for every API endpoint: `/api/news`, `/api/market`, `/api/intelligence`, `/api/pakistan-map`, etc.

> **Note on the Railway URL:** You don't know this URL until after Step 4 (Railway setup). Use a placeholder for now and come back to update it.

---

## Step 3 — Update `vercel.json` — remove all API routing

The old `vercel.json` routed `/api/*` to the serverless functions. Remove all of that. Vercel now only serves static files.

```json
{
  "headers": [
    {
      "source": "/",
      "headers": [
        { "key": "Cache-Control", "value": "no-store, must-revalidate" }
      ]
    },
    {
      "source": "/css/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, must-revalidate" },
        { "key": "Vary",          "value": "Accept-Encoding" }
      ]
    },
    {
      "source": "/js/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, must-revalidate" },
        { "key": "Vary",          "value": "Accept-Encoding" }
      ]
    }
  ],
  "rewrites": [
    { "source": "/",         "destination": "/public/index.html" },
    { "source": "/css/(.*)", "destination": "/public/css/$1" },
    { "source": "/js/(.*)",  "destination": "/public/js/$1" }
  ]
}
```

No `routes` block pointing to `api/`. No `functions` block. Vercel sees no serverless functions to bill.

---

## Step 4 — Update root `server.js` for local dev only

The root `server.js` now serves as a local development convenience — it serves the static frontend AND proxies API requests to the backend handlers, so you only need one terminal locally.

```js
/**
 * server.js — Local Development Only
 * Serves public/ static files + all API routes from backend/api/
 * Production: Vercel serves public/, Railway runs backend/server.js
 */
try { require('dotenv').config(); } catch (_) {}

const path    = require('path');
const express = require('express');

// Load handlers from backend/api/ (same files Railway uses)
const newsHandler         = require('./backend/api/news');
const marketHandler       = require('./backend/api/market');
const pakistanMapHandler  = require('./backend/api/pakistan-map');
const intelligenceHandler = require('./backend/api/intelligence');
const healthHandler       = require('./backend/api/health');

const app  = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');

// API routes (no CORS needed — same origin as static files)
app.get('/api/health',       (req, res) => healthHandler(req, res));
app.get('/api/news',         (req, res) => newsHandler(req, res));
app.get('/api/market',       (req, res) => marketHandler(req, res));
app.get('/api/pakistan-map', (req, res) => pakistanMapHandler(req, res));
app.get('/api/intelligence', (req, res) => intelligenceHandler(req, res));

// Static files
const staticOpts = {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate')
};
app.use('/css', express.static(path.join(__dirname, 'public/css'), staticOpts));
app.use('/js',  express.static(path.join(__dirname, 'public/js'),  staticOpts));
app.use('/img', express.static(path.join(__dirname, 'public/img'), staticOpts));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('*', (_req, res) => res.redirect('/'));

app.listen(port, () => console.log(`Local dev: http://localhost:${port}`));
```

---

## Step 5 — Update root `package.json`

The root `package.json` is for local dev only. Add a `backend` script for running just the API server if needed.

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": {
    "dev":     "node server.js",
    "start":   "node server.js",
    "backend": "node backend/server.js"
  },
  "dependencies": {
    "cors":    "^2.8.6",
    "dotenv":  "^16.0.0",
    "express": "^4.21.2"
  },
  "engines": {
    "node": "20.x"
  }
}
```

---

## Step 6 — Clean up — delete the old `api/` folder

The old root `api/` folder was the Vercel serverless functions. It's now replaced by `backend/api/`. Delete it to avoid confusion.

```bash
rm -rf api/
```

Also delete any root-level `railway.json` if one exists — Railway should only read `backend/railway.json` (via the Root Directory setting).

---

## Step 7 — Update `.gitignore`

Make sure `.env` files are ignored everywhere:

```
node_modules
.vercel
.DS_Store
.env
backend/.env
npm-debug.log*
```

---

## Step 8 — Commit everything

```bash
git add -A
git commit -m "refactor: split frontend (Vercel) and backend (Railway)"
git push origin main
```

---

## Step 9 — Set up Railway

### 9a. Create a Railway account and project

1. Go to [railway.app](https://railway.app) → sign up (GitHub login recommended)
2. New Project → **Deploy from GitHub repo**
3. Select your repository

### 9b. Configure the service — CRITICAL settings

In Railway, click your service → **Settings** tab:

| Setting | Value | Why |
|---|---|---|
| **Root Directory** | `/backend` | Railway runs `npm install` and `node server.js` inside this folder |
| **Branch** | `main` | Or whichever branch you deploy from |
| **Start command** | `node server.js` | Reads from `railway.json` automatically if present |
| **Health check path** | `/api/health` | Railway polls this; must return 200 for deploy to succeed |

> **Root Directory is the most important setting.** Without it, Railway runs from the repo root and may pick up the wrong `server.js` or `package.json`.

### 9c. Add environment variables

Go to **Variables** tab → add each one:

```
GROQ_API_KEY    = gsk_your_actual_key
NODE_ENV        = production
```

Do NOT add `PORT` — Railway injects it automatically. Your server must read it via `process.env.PORT`.

### 9d. Generate a public domain

Go to **Settings** → **Networking** → **Public Networking** → click **Generate Domain**.

Railway gives you a URL like:
```
your-service-production.up.railway.app
```

You can click the edit icon to customize the subdomain prefix if the name you want is available.

> **Common mistake:** Without this step the service runs but has NO public URL. Every request returns Railway's own `{"status":"error","code":404,"message":"Application not found"}` — which the browser reports as a CORS error because there are no CORS headers. This is not a code bug — it's a networking configuration step.

### 9e. Verify the deploy

```bash
curl https://your-service-production.up.railway.app/api/health
# Expected: {"ok":true,"node":"v20.x.x","env":"production","groq_key_set":true,...}
```

If you see `{"status":"error","code":404,"message":"Application not found"}` — the domain is not generated yet (go back to 9d).

If you see a connection error — the service hasn't finished deploying yet, wait 30 seconds.

---

## Step 10 — Update `API_BASE` in the frontend

Now that you have the real Railway URL, update `public/js/app.js`:

```js
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? ''
  : 'https://your-service-production.up.railway.app';   // ← real URL here
```

Commit and push:

```bash
git add public/js/app.js
git commit -m "fix: update Railway API base URL"
git push origin main
```

Vercel picks up the change and redeploys automatically (usually under 60 seconds).

---

## Step 11 — Set up Vercel

If not already connected:

1. Go to [vercel.com](https://vercel.com) → New Project → Import Git Repository
2. Select your repo
3. **Framework Preset:** Other (or leave blank — no build step)
4. **Root Directory:** leave as `/` (Vercel reads `vercel.json` from the root)
5. **Build Command:** leave empty
6. **Output Directory:** leave empty
7. No environment variables needed — the frontend is static

Vercel will deploy. The `vercel.json` rewrites handle routing everything from `public/`.

> **Do NOT add `GROQ_API_KEY` or any secrets to Vercel.** The frontend is public JavaScript — anything you put in a Vercel env var that gets embedded in JS is visible to everyone.

---

## Final File Structure

```
/
├── public/                     ← Vercel: static files only
│   ├── index.html
│   ├── css/
│   │   └── main.css
│   └── js/
│       └── app.js              ← API_BASE set to Railway URL for production
│
├── backend/                    ← Railway: Root Directory set to this
│   ├── server.js               ← Express entry point (node server.js)
│   ├── package.json            ← backend dependencies (cors, express, dotenv)
│   ├── railway.json            ← Railway deploy config
│   ├── .env.example            ← documents required env vars
│   └── api/
│       ├── health.js
│       ├── news.js
│       ├── market.js
│       ├── intelligence.js
│       └── pakistan-map.js
│
├── server.js                   ← Local dev only (serves public/ + proxies backend/api/)
├── package.json                ← Root: local dev deps + scripts
├── vercel.json                 ← Static routing config for Vercel (no API routes)
├── .gitignore                  ← node_modules, .env, .vercel
└── .env                        ← Local secrets (gitignored)
```

---

## Local Development After the Split

Nothing changes for local development. One terminal, one command:

```bash
npm install          # install root deps (express, cors, dotenv)
npm run dev          # runs server.js → http://localhost:3000
```

`server.js` serves `public/` as static files and registers all API routes by requiring from `backend/api/`. The `API_BASE` in `app.js` detects `localhost` and uses `''` (empty string) — so all `fetch()` calls go to the same Express server.

To test the backend in isolation:

```bash
cd backend && npm install    # install backend deps separately
npm run backend              # runs backend/server.js → http://localhost:4000
```

---

## Debugging Checklist

### "Application not found" from Railway URL

Railway's infrastructure is returning 404 — Express is NOT handling the request.

- [ ] Did you generate a public domain in Railway → Settings → Networking?
- [ ] Is the domain assigned to the right service?

### CORS errors in the browser on top of 404s

This is almost always caused by Railway (or any proxy) returning 404 before Express handles the request — with no CORS headers. The browser sees a cross-origin response with no `Access-Control-Allow-Origin` header and reports it as a CORS error.

Fix: resolve the underlying 404 first. CORS errors disappear automatically once Express is the one responding.

### CORS errors with 200 status

Express IS responding but rejecting the origin.

- [ ] Is your production domain (`https://yourdomain.com` AND `https://www.yourdomain.com`) in `CORE_ORIGINS`?
- [ ] Note: `yourdomain.com` and `www.yourdomain.com` are treated as different origins — both must be listed
- [ ] If you use `ALLOWED_ORIGINS` env var on Railway, make sure it's set and spelled correctly

### Routes return 404 but health check passes

Express started but some routes aren't registering. Most likely a `require()` at the top of `backend/server.js` threw an error, causing Express to start but skip the route registration below it.

- [ ] Check Railway deploy logs for startup errors
- [ ] Make sure all files in `backend/api/` exist and have no syntax errors
- [ ] Run `node backend/server.js` locally to reproduce the crash

### Feed works locally but not on `briefpknews.xyz`

- [ ] Check `API_BASE` in `public/js/app.js` — must match the Railway domain exactly (no trailing slash)
- [ ] Did the Vercel redeploy pick up the updated `app.js`? Check Vercel dashboard → Deployments

### Railway shows "Online" but requests still fail

Railway marks a service "Online" when the health check path returns 200. This doesn't guarantee all routes work — it only means `/api/health` responded correctly. A crash during route registration after the health check registered could still leave other routes broken.

---

## Key Lessons

1. **Hardcode your frontend origins in `CORE_ORIGINS`** — never rely solely on an env var that could be missing or wrong in production.

2. **Apply CORS middleware before registering any routes** — including the 404 catch-all. If the middleware comes after, 404 responses go out without CORS headers and the browser reports them as CORS errors.

3. **Always add a 404 catch-all and error handler in Express** — without them, unmatched routes return an HTML page with no CORS headers, confusing the browser.

4. **Railway's `PORT` env var is injected automatically** — your server must use `process.env.PORT`. Never hardcode a port for Railway.

5. **Generating a public domain in Railway is a separate step** — deploying a service does NOT automatically expose it on the internet. You must go to Settings → Networking → Generate Domain.

6. **`www.yourdomain.com` and `yourdomain.com` are different CORS origins** — always list both.

7. **Local dev can stay as a single server** — the `window.location.hostname === 'localhost'` check in the frontend means you never need two terminals for local development.
