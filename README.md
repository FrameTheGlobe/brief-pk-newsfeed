# brief.pk — Pakistan Intelligence Dashboard

Ultra-dense Pakistan-focused intelligence dashboard. Pure static frontend on Vercel, persistent Express backend on Railway.

## Architecture

```
Browser → Vercel CDN        → public/index.html + CSS + JS  (static, zero functions)
        → Railway Express   → /api/news          → aggregated RSS feeds
                            → /api/market        → USD/PKR, KSE, commodities
                            → /api/intelligence  → Groq AI digest
                            → /api/pakistan-map  → AQI + weather
                            → /api/health        → uptime check
```

**Frontend:** `https://briefpknews.xyz` (Vercel, free tier — static only)  
**Backend API:** `https://brief-pk-newsfeed-production.up.railway.app` (Railway, persistent Node.js)

## Run locally

```bash
# Install all dependencies
npm install && cd backend && npm install && cd ..

# Terminal 1 — full local server (serves static files + proxies API)
npm run dev          # → http://localhost:3000

# Terminal 2 — backend only (optional, for API testing)
npm run backend      # → http://localhost:4000
```

Local dev uses the same-origin setup — `app.js` detects `localhost` and skips the Railway URL.

## API routes

| Route | Description |
|---|---|
| `/api/health` | Server status + env check |
| `/api/news` | Aggregated Pakistan-focused RSS (cached 5 min) |
| `/api/market` | USD/PKR spot, KSE-100, commodities (cached 5 min) |
| `/api/intelligence` | Groq AI-generated Pakistan news digest (cached 30 min) |
| `/api/pakistan-map` | City-level AQI + weather data (cached 10 min) |

## Environment variables

### Railway (backend)
| Variable | Required | Notes |
|---|---|---|
| `GROQ_API_KEY` | Yes | Groq API key for intelligence endpoint |
| `PORT` | Auto | Set automatically by Railway |
| `NODE_ENV` | Recommended | Set to `production` |
| `ALLOWED_ORIGINS` | Optional | Comma-separated extra allowed CORS origins |

### Vercel (frontend)
None required. The frontend is pure static HTML/CSS/JS.

## Repository structure

```
/
├── public/             # Frontend — deployed to Vercel
│   ├── index.html
│   ├── css/main.css
│   └── js/app.js
├── backend/            # Backend — deployed to Railway
│   ├── server.js       # Express entry point
│   ├── package.json
│   ├── railway.json    # Railway deploy config
│   └── api/
│       ├── health.js
│       ├── news.js
│       ├── market.js
│       ├── intelligence.js
│       └── pakistan-map.js
├── server.js           # Local dev only (serves static + proxies to backend/api/)
├── vercel.json         # Vercel config (static routing only)
└── package.json        # Root — local dev deps
```

## Deploy

### Vercel (frontend)
- Connected to GitHub `main` branch
- Root directory: `/` (serves `public/` via `vercel.json`)
- No build step, no environment variables needed
- Auto-deploys on push to `main`

### Railway (backend)
- Connected to GitHub `main` branch
- Root directory: `/backend`
- Start command: `node server.js`
- Health check: `/api/health`
- Auto-deploys on push to `main`

## Design

- NYT/Bloomberg-inspired editorial design
- Design token system (CSS custom properties)
- Dark / light mode with `localStorage` persistence
- Responsive — sidebar collapses on mobile
- Fonts: Playfair Display (headlines) + Inter (body)

## Notes

- No NewsAPI or paid data subscriptions — all feeds are open/public
- In-memory caching works on Railway (persistent process) — not on Vercel serverless
- CORS is locked to `briefpknews.xyz` + `www.briefpknews.xyz` + localhost in `backend/server.js`
