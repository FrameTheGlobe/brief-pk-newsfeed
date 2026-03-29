# brief.pk — Infrastructure & Cost Reduction Plan
**Status:** Planning — ready to implement
**Goal:** Move API backend to Railway, keep frontend on Vercel (or migrate to Cloudflare Pages for $0)
**Date:** March 2026

---

## How brief.pk Differs from a Typical Vercel App

brief.pk has one major structural advantage: the frontend is **pure static HTML/CSS/JS** — no Next.js, no React, no build step. This means:

- The frontend can be hosted **completely free** on Vercel's CDN or Cloudflare Pages
- There is **no server-side rendering** to worry about
- API calls come entirely from the browser — so the backend just needs CORS configured, and the browser can call Railway directly. **No proxy layer needed.**

This makes the migration significantly simpler than a Next.js app.

---

## Why the Bill Exists — Root Cause

Unlike FrameTheGlobe, brief.pk has no SSE (no persistent lambda connections). The cost driver here is different:

### The Core Problem: In-Memory Cache Is Broken on Vercel

Every API handler (`api/news.js`, `api/market.js`, `api/intelligence.js`, `api/pakistan-map.js`) uses module-level in-memory caching:

```js
let _newsCache = null;
let _newsCacheTs = 0;
const NEWS_CACHE_TTL = 5 * 60 * 1000;
```

On a persistent Node.js server (like Railway), this works exactly as intended — one warm process, cache accumulates, upstream APIs are called once per TTL. On Vercel serverless, it is **completely ineffective**:

- Each new request may spin up a **fresh cold lambda** with empty `_newsCache`
- Multiple warm lambda instances exist simultaneously, each with their own empty cache
- A visitor at 14:01 and a visitor at 14:02 both hit cold lambdas → both trigger full RSS fetches from 20 feeds

The `/api/news` and `/api/market` handlers do set `s-maxage=300` (CDN cache), which helps for CDN hits. But the `/api/intelligence` handler sets **`no-store`**, meaning Vercel's CDN never caches the intelligence response. Every intelligence call — which involves a slow Groq API round-trip — runs as a fresh lambda.

### Per-Visitor Invocation Map

| Endpoint | Client Polls Every | CDN Cache | Effective Lambda Frequency | Notes |
|---|---|---|---|---|
| `/api/news` | 4 minutes | `s-maxage=300` | Once per 5 min across all visitors | OK — CDN helps here |
| `/api/market` | 4 minutes | `s-maxage=300` | Once per 5 min across all visitors | OK — CDN helps here |
| `/api/pakistan-map` | 4 minutes | `s-maxage=600` | Once per 10 min across all visitors | Good — longer TTL |
| `/api/intelligence` | 30 minutes | **`no-store`** | Every visitor, every 30 min | **Main cost driver** |
| `/api/health` | Never (debug only) | `no-store` | On demand | Negligible |

With 50 daily active users on 20-minute sessions:
- 3 data endpoints × ~5 polls each = ~750 CDN-cached responses, ~15 actual lambda invocations (manageable)
- Intelligence: 50 sessions × 1 Groq call = 50 lambda invocations, each potentially running 5–28 seconds × 256MB = significant GB-seconds

---

## Architecture After Migration

```
BEFORE (everything serverless on Vercel, in-memory caches useless):
  Browser → Vercel → /api/news          → 20 RSS feeds (cold lambda each time)
                   → /api/market        → Yahoo Finance + PSX + Stooq (cold lambda)
                   → /api/intelligence  → Groq API (no CDN cache, every visitor)
                   → /api/pakistan-map  → AQI + weather sources
                   → static files       → public/ served by Vercel CDN

AFTER (clean separation, no proxy needed):
  Browser → Vercel/Cloudflare → static HTML/CSS/JS (pure CDN, zero functions)
          → Railway Express   → /api/news          → RSS (persistent cache works)
                              → /api/market        → Yahoo Finance (persistent cache)
                              → /api/intelligence  → Groq (true 30-min server cache)
                              → /api/pakistan-map  → AQI/weather (persistent cache)
```

**No proxy layer required.** Because the frontend is static (no SSR), the browser can call Railway's API directly. We just update the API base URL in `app.js` and add CORS to `server.js`.

---

## Tier 1 — Immediate Fixes (Zero Infrastructure Change)

Commit and push today. Reduces the Vercel bill without touching any infrastructure.

### Fix 1: Cache the Intelligence Response at CDN Level

**File:** `api/intelligence.js`

The 30-minute server-side cache inside the function already works correctly. The problem is the `no-store` header tells Vercel's CDN to never serve a cached copy. Changing this means the first visitor triggers the Groq call; all subsequent visitors within 30 minutes get the CDN-cached response instantly.

```js
// Before:
res.setHeader('Cache-Control', 'no-store');

// After:
res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
```

The `?force=1` bypass already exists — force-refresh still hits the lambda directly.

**Expected saving:** 80–90% reduction in intelligence lambda invocations.

### Fix 2: Extend Map Cache TTL

**File:** `api/pakistan-map.js`

The map data (city AQI, weather) doesn't change more than once per hour. The current `s-maxage=600` (10 min) is conservative. Bump to 30 minutes.

```js
// Before:
res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');

// After:
res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
```

### Fix 3: Slow the Client Refresh Cycle

**File:** `public/js/app.js`, line 1

The client polls news + market + map every **4 minutes** (`REFRESH_MS = 240_000`). The server caches these for **5 minutes**. This mismatch means some polls arrive just before the CDN TTL expires — hitting a lambda rather than the CDN. Aligning the client to 5 minutes eliminates this gap.

```js
// Before:
const REFRESH_MS = 240_000; // 4 minutes

// After:
const REFRESH_MS = 300_000; // 5 minutes — matches server cache TTL
```

**Tier 1 estimated outcome:** Cuts lambda invocations by roughly 60–70%, mainly from fixing the intelligence no-store header.

---

## Tier 2 — Move Backend to Railway (The Proper Fix)

This is the real solution. The brief.pk `server.js` is already a complete Express server that routes all API handlers. Moving it to Railway requires minimal code changes.

### What Moves Where

**Stays on Vercel (static, always free):**
- `public/index.html`
- `public/css/main.css`
- `public/js/app.js`
- All other static assets

**Moves to Railway (persistent Node.js, fixed $5/month):**
- `server.js` — the Express entry point (already exists)
- `api/news.js`
- `api/market.js`
- `api/intelligence.js`
- `api/pakistan-map.js`
- `api/health.js`
- `.env` / environment variables

**Vercel keeps:** Just static file hosting. Zero API functions. Zero GB-seconds billed.

### Why In-Memory Caches Work on Railway

On Railway, there is **one persistent process**. When `server.js` starts, it stays running. The module-level variables (`_newsCache`, `_marketCache`, `_intelCache`, `_mapCache`) accumulate and persist across all requests:

- Visitor at 14:01 → cache cold → fetches 20 RSS feeds → stores in `_newsCache`
- Visitor at 14:02 → cache warm → returns cached response in ~1ms → no upstream call
- At 14:06 (5 min TTL expired) → next visitor triggers one fresh fetch → re-warms cache

This is exactly what the code was designed for. It just doesn't work on serverless.

### Code Changes Required

**`server.js` — add CORS:**
```js
const cors = require('cors');
app.use(cors({
  origin: [
    'https://briefpknews.xyz',
    'https://www.briefpknews.xyz',
    'http://localhost:3000'
  ]
}));
```

**`public/js/app.js` — point API calls at Railway:**
```js
// Add at top of file (line 1 area):
const API_BASE = window.location.hostname === 'localhost'
  ? ''                                              // local: same-origin via Express
  : 'https://brief-pk-api.up.railway.app';         // prod: Railway backend

// Then replace all fetch('/api/...') with fetch(`${API_BASE}/api/...`)
```

**`package.json` — add cors dependency:**
```json
"dependencies": {
  "cors": "^2.8.5",
  "express": "^4.21.2"
}
```

**`railway.json` — Railway deploy config (new file):**
```json
{
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node server.js",
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

### Railway Setup Steps

1. Sign up at [railway.app](https://railway.app) — Hobby plan is $5/month
2. New project → "Deploy from GitHub repo" → select `brief-pk-newsfeed`
3. In Railway environment variables, add:
   ```
   GROQ_API_KEY=gsk_...   (your Groq key)
   PORT=3000               (Railway sets this automatically)
   NODE_ENV=production
   ```
4. Railway auto-runs `npm install` → `node server.js` → assigns a URL like `brief-pk-api.up.railway.app`
5. Verify: `https://brief-pk-api.up.railway.app/api/health` returns `{ ok: true, groq_key_set: true }`
6. Update `API_BASE` in `app.js` with the Railway URL
7. Push → Vercel deploys updated `app.js` with new API base URL
8. Test end-to-end: news feed, market data, intelligence widget, Pakistan map

### Frontend Hosting — Vercel vs Cloudflare Pages

Once the API moves to Railway, Vercel only serves three static files. Both options are free:

| Option | Cost | CDN | Deploy |
|---|---|---|---|
| **Vercel (keep)** | Free (no functions = well within free tier) | Global | Auto on git push |
| **Cloudflare Pages** | Free forever, no limits | 200+ PoPs globally | Auto on git push |

Recommendation: **Stay on Vercel** for now — zero effort. If you ever want to remove Vercel entirely, Cloudflare Pages is a drop-in replacement for static hosting.

### Local Development After Migration

Both services run together locally:

```bash
# Terminal 1 — backend (same as today)
npm run dev          # Express on localhost:3000, serves static + API

# No change to local dev workflow needed.
# app.js detects localhost → uses same-origin paths → server.js handles everything
```

The `window.location.hostname === 'localhost'` check in `app.js` means local development is identical to today — no separate frontend/backend terminals required locally.

---

## Environment Variables After Split

| Variable | Vercel | Railway |
|---|---|---|
| `GROQ_API_KEY` | ❌ Remove | ✅ Add |
| `NODE_ENV` | `production` | `production` |
| `PORT` | — | Auto-set by Railway |

No secrets live on Vercel after the migration. Vercel only serves static files.

---

## Cost Projections

| Scenario | Vercel/month | Railway/month | Total |
|---|---|---|---|
| Current (no changes) | Varies (bill growing) | $0 | Varies |
| After Tier 1 only | ~60-70% reduction | $0 | Lower |
| After Tier 1 + 2 | ~$0 (static only) | $5 | **~$5** |

Railway Hobby plan includes $5 of free credit monthly — effective cost can be **$0** for a small app with light traffic. Check railway.app for current pricing before committing.

---

## Implementation Checklist

### Tier 1 (Commit Today — ~15 min)
- [ ] `api/intelligence.js` — change `no-store` → `s-maxage=1800, stale-while-revalidate=300`
- [ ] `api/pakistan-map.js` — change `s-maxage=600` → `s-maxage=1800`
- [ ] `public/js/app.js` — change `REFRESH_MS = 240_000` → `300_000`
- [ ] Bump version to `4.2.2`, stamp, commit, push

### Tier 2 (This Week — ~2 hours)
- [ ] Sign up for Railway (railway.app)
- [ ] Add `cors` to `package.json` dependencies
- [ ] Add CORS middleware to `server.js`
- [ ] Create `railway.json` deploy config
- [ ] Add `API_BASE` constant to `public/js/app.js`
- [ ] Replace all `fetch('/api/...')` calls with `fetch(\`${API_BASE}/api/...\`)`
- [ ] Push to GitHub — Railway auto-deploys
- [ ] Set `GROQ_API_KEY` and other env vars on Railway
- [ ] Verify `/api/health` on Railway URL
- [ ] Update `API_BASE` constant with live Railway URL
- [ ] Push final version — Vercel serves updated `app.js`
- [ ] Remove `GROQ_API_KEY` from Vercel env vars (no longer needed)
- [ ] Tag release `v4.3.0`
- [ ] Monitor Railway logs for 24 hours

---

## Files Changed Summary

### Tier 1
```
api/intelligence.js     — Cache-Control: no-store → s-maxage=1800
api/pakistan-map.js     — s-maxage=600 → s-maxage=1800
public/js/app.js        — REFRESH_MS: 240_000 → 300_000
package.json            — version bump 4.2.1 → 4.2.2
```

### Tier 2
```
server.js               — add cors middleware
public/js/app.js        — add API_BASE, update all fetch() calls
package.json            — add cors dependency
railway.json            — NEW: Railway deploy config
vercel.json             — optional: simplify (no API routes to configure)
```
