# brief.pk — Infrastructure Reference

**Status:** Live in production  
**Last updated:** March 2026

---

## Live URLs

| Service | URL | Platform |
|---|---|---|
| Frontend | `https://briefpknews.xyz` | Vercel |
| Frontend (www) | `https://www.briefpknews.xyz` | Vercel |
| Backend API | `https://brief-pk-newsfeed-production.up.railway.app` | Railway |
| API health | `https://brief-pk-newsfeed-production.up.railway.app/api/health` | Railway |

---

## Architecture

```
Browser → Vercel CDN      → static HTML/CSS/JS (public/)     zero serverless functions
        → Railway Express → /api/news          → 20 RSS feeds (persistent 5-min cache)
                          → /api/market        → Yahoo Finance + PSX (persistent 5-min cache)
                          → /api/intelligence  → Groq API (persistent 30-min cache)
                          → /api/pakistan-map  → AQI + weather (persistent 10-min cache)
                          → /api/health        → uptime ping
```

**Key principle:** Frontend is pure static — no SSR, no build step, no serverless functions. The browser calls Railway directly. No proxy layer needed.

---

## Why Railway Instead of Vercel Functions

Vercel serverless functions spin up cold for every request. The backend uses module-level in-memory caches (`_newsCache`, `_marketCache`, etc.) that require a persistent process to work. On Railway, one process runs continuously — cache fills on first request, all subsequent requests within the TTL are served in ~1ms with no upstream API calls.

| Endpoint | Cache TTL | Upstream |
|---|---|---|
| `/api/news` | 5 min | ~20 Pakistani RSS feeds |
| `/api/market` | 5 min | Yahoo Finance, Stooq |
| `/api/intelligence` | 30 min | Groq API (gsk_...) |
| `/api/pakistan-map` | 10 min | AQI + weather APIs |

---

## CORS Configuration

Allowed origins are hardcoded in `backend/server.js` as `CORE_ORIGINS`. Additional origins can be appended at runtime via the `ALLOWED_ORIGINS` environment variable (comma-separated).

```
CORE_ORIGINS:
  https://briefpknews.xyz
  https://www.briefpknews.xyz
  http://localhost:3000
  http://127.0.0.1:3000
```

CORS middleware is applied globally before all routes so that 404 and error responses also carry the correct headers.

---

## Deployment Configuration

### Vercel (`vercel.json`)
- Serves everything from `public/`
- All paths rewrite to `index.html` (SPA-style)
- No API functions, no environment variables required

### Railway (`backend/railway.json`)
```json
{
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node server.js",
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

Railway auto-detects Node 20, runs `npm install` in `/backend`, then `node server.js`.

---

## Environment Variables

### Railway (required)
| Variable | Value | Notes |
|---|---|---|
| `GROQ_API_KEY` | `gsk_...` | Groq key for intelligence endpoint |
| `NODE_ENV` | `production` | |
| `PORT` | auto | Railway injects this; server binds to it |
| `ALLOWED_ORIGINS` | optional | Extra CORS origins beyond the core list |

### Vercel
None. The frontend is static.

---

## Branch Strategy

| Branch | Purpose |
|---|---|
| `master` | Primary development branch |
| `main` | Production branch — Vercel and Railway both deploy from `main` |

Workflow: commit to `master` → merge into `main` → both Vercel and Railway auto-redeploy.

---

## Release History

| Tag | Description |
|---|---|
| `v5.0.0` | Major redesign — NYT/Bloomberg editorial design system, dark mode, design tokens |
| `v5.0.1` | Additional design refinements |
| `v5.0.2` | Frontend/backend split — backend to `backend/`, root cleaned up for Vercel |
| `v5.0.3` | Robust CORS fix — `CORE_ORIGINS` hardcoded, CORS applied globally to catch 404s |
| `v5.0.4` | Fix: Railway domain updated to `brief-pk-newsfeed-production.up.railway.app` in `app.js` |

---

## Local Development

```bash
# Install dependencies
npm install && cd backend && npm install && cd ..

# Run everything locally (single terminal)
npm run dev      # Express on :3000 — serves public/ and proxies API from backend/api/

# Run backend only
npm run backend  # Express on :4000 — API only
```

`app.js` detects `localhost` and uses same-origin paths — no need to configure a separate API base URL locally.

---

## Troubleshooting

**"Application not found" from Railway URL**  
The service doesn't have a public domain configured. Go to Railway → service → Settings → Networking → Generate Domain.

**CORS errors + 404 from browser**  
When Railway's infrastructure (not Express) returns 404, there are no CORS headers. Root causes:
1. No public domain assigned to the Railway service (see above)
2. Express crashed on startup — check Railway deploy logs
3. Wrong port — ensure `process.env.PORT` is used (Railway sets this automatically)

**Feed loads locally but not on production**  
Check `API_BASE` in `public/js/app.js` — must match the live Railway domain exactly.

**Intelligence widget shows "Load failed"**  
`GROQ_API_KEY` env var not set on Railway, or key is invalid. Check `/api/health` — it reports `groq_key_set: true/false`.
