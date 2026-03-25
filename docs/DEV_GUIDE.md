# brief.pk Dev Guide (Super Extensive)

This document covers:
1. Dev guide (how to run, how to work safely)
2. Design guide (visual system rules and UX patterns)
3. App philosophy (why it is built this way)
4. What the app does (feature-by-feature)
5. How the app was built (architecture and implementation notes)

---

## 1. Dev Guide

### 1.1 What this repo is
`brief-pk-newsfeed` is a plain Node.js + Express backend serving a vanilla front-end:
- No React/Vue/Svelte frontend framework
- No build step (the UI is static HTML/CSS/JS)
- Data aggregation is done by server routes in `api/*.js`

This is intentionally simple operationally: edit, refresh, and redeploy.

### 1.2 Run locally

```bash
npm install
PORT=3010 npm run dev
```

Then open:
- `http://localhost:3010`

The Express server in `server.js` redirects unknown routes back to `/` so the app behaves like an SPA shell.

### 1.3 Routes (data APIs)

The server registers:
- `GET /api/news`       (news aggregation + normalization)
- `GET /api/market`     (FX, equities snapshot, commodities proxies)
- `GET /api/pakistan-map` (Pakistan telemetry layers for the nerve center)
- `GET /api/intelligence` (optional Groq-powered AI scan)

These routes are connected in the client `public/js/app.js`.

### 1.4 Environment variables

The only required environment variable for full functionality is:
- `GROQ_API_KEY` (or `Groq`)

If it is missing:
- `/api/intelligence` returns `503` with an error message
- the UI enters a non-destructive offline state (the rest of the dashboard remains usable)

Other routes (`/api/news`, `/api/market`, `/api/pakistan-map`) do not require API keys.

### 1.5 Caching behavior (important for dev)

The app uses multiple cache layers, which affects how quickly UI changes can appear:

Client-side:
- `sessionStorage` cache key: `brief-pk-data-v2`
- TTL: 5 minutes

Server-side:
- `api/market.js`: in-memory cache TTL: 5 minutes
- `api/pakistan-map.js`: in-memory cache TTL: 10 minutes
- `api/intelligence.js`: in-memory cache TTL: 30 minutes

Practical dev tip:
- If a UI change depends on new server behavior, use the dashboard's “Refresh” button to trigger fresh requests.

### 1.6 Development mental model (debug order)

When debugging a UI issue, follow this order:

1. API payload: verify the shape your renderer expects
2. DOM wiring: confirm the element ID/class exists in `public/index.html`
3. Rendering function: confirm the renderer is called from `renderAll()`
4. Filter logic: confirm your item is not being excluded by `strictFocus`, category/source, or search query

Because renderers use `document.getElementById(...)` and generally fail silently, missing DOM IDs can look like “data is missing” even when the endpoint is working.

---

## 2. Design Guide

### 2.1 Design goals

This app is designed for “fast scanning under uncertainty”:
- maximize density without turning everything into noise
- preserve clear hierarchy so users can answer: “what changed?” and “what matters?” quickly
- maintain a consistent data language (time badges, source/category labels, severity tones)

### 2.2 Visual system tokens

Core design tokens are defined in `public/css/main.css` under `:root`:
- brand colors: `--brand-navy`, `--brand-red`, `--brand-navy-2`, `--brand-red-2`
- UI accents: `--accent-green`, `--accent-amber`, `--accent-blue`
- surfaces: `--surface`, `--surface-2`, `--surface-3`, and `--bg-app`
- borders: `--panel-border`
- typography:
  - `--ui-font`: Inter
  - `--mono-font`: JetBrains Mono

Rule:
- When adding UI, prefer using the tokens above rather than hardcoding new colors.

### 2.3 Typography rules

Use Inter for readable text and section headings.
Use Mono for:
- metrics labels
- compact “data chips”
- time badges and structured row metadata

Keep line-length readable:
- cards and lists should have enough padding for scanning
- do not rely solely on color to communicate meaning

### 2.4 Modules and hierarchy pattern

The UI is built from “modules”:
- module title bar (e.g. `rail-label`, `lane-head`, `widget-head`)
- content area (list, grid, feed, map)
- optional meta footer (updated time, sources)

Consistency principle:
- if a module updates dynamically, it should have an obvious empty state or skeleton loading state

### 2.5 Motion and readability

The dashboard includes marquee tickers and animated risk cues.

Readability requirements:
- motion should be “optional”
- animations should not block comprehension
- when the platform requests reduced motion (`prefers-reduced-motion`), the UI should behave more statically

### 2.6 UX patterns you should preserve

1. Strict focus toggle:
   - it materially changes which items appear
   - it should always be visible and clearly labeled
2. Filter integrity:
   - the same filtered set is used by multiple modules
   - avoid creating “filter drift” where nav counts differ from what the feed shows
3. Fail-open intelligence:
   - the AI scan is optional
   - UI should degrade gracefully when Groq is not configured

---

## 3. App Philosophy

### 3.1 “Brief” means editorial, not entertainment

The dashboard is not built to maximize clicks. It is built to:
- provide credible structure on top of public signals
- keep the operator oriented
- reduce cognitive overhead through consistent formatting

### 3.2 Signal density with meaning

Density can be useful only if:
- categories exist
- time is always visible (relative time chips)
- source attribution exists (sources and categories are rendered everywhere)
- severity tones exist (risk layers and “priority” badges)

### 3.3 Fail-open, never fail-closed

If a provider fails:
- `/api/news` returns whatever it can
- `/api/market` returns stale cache (best effort) if live fetch fails
- `/api/pakistan-map` returns last-known computed map data if live fetch fails
- `/api/intelligence` goes offline without breaking the dashboard

This ensures the user is never left with a dead interface.

---

## 4. What the App Does (Feature-by-Feature)

### 4.1 News aggregation (`/api/news`)

`api/news.js` defines:
- a list of RSS feeds (`FEEDS`) with a `scope` field
- keyword-based heuristics:
  - `getCategory(text)` classifies into: Politics, Economy, Security, Energy, Markets, Geopolitics, Justice, Governance, Society, Environment, General
  - `getPriority(text)` classifies into: high, medium, normal
  - `computeRelevance(...)` combines scoring signals (Pakistan signal, feed scope, tier, priority, category weighting, age weighting, noise penalties)

Pakistan relevance logic includes:
- direct Pakistan term detection (`PAKISTAN_TERMS`)
- entity detection for institutions and common abbreviations (`PAKISTAN_ENTITY_TERMS`)
- negative noise penalties (`NOISE_TERMS`)

The endpoint returns a normalized JSON payload with `articles` and `updatedAt`.

### 4.2 Market and commodity proxies (`/api/market`)

`api/market.js` fetches and resolves:
- USD/PKR (open.er-api)
- PSX indices and performers (PSX DPS endpoints)
- Brent and other commodities:
  - Stooq daily CSV parsing
  - Yahoo chart/spark via query2 endpoints
  - FRED Brent as fallback (recent-only)

Commodities are resolved via a priority chain:
1. Yahoo chart
2. Yahoo spark
3. Stooq daily
4. FRED daily (Brent only, recency guarded)

The response also includes:
- `commoditiesAsOf` (max “freshness” timestamp)
- `commoditiesStale` boolean (age > 180 minutes)

The frontend uses these to display “LIVE” vs “STALE” cues in the market ticker.

#### PSX announcement parsing note

PSX announcements often repeat the ticker at the beginning of the subject line.
The parser removes a leading duplicate ticker pattern so subjects do not look redundant.

### 4.3 Pakistan Nerve Center (`/api/pakistan-map`)

`api/pakistan-map.js` generates a structured visualization payload:
- fixed city nodes (lat/lon + map coordinates)
- telemetry overlays:
  - `weather` (Open-Meteo forecast)
  - `aqi` (Open-Meteo air-quality)
  - `agri` (agriculture stress derived from weather)
  - `flights` (OpenSky-based flight pressure heuristic)

For each layer, it outputs:
- per-city risk score (0-100)
- severity level labels
- a summary and averages used by the UI’s map footer and hotspot list

### 4.4 AI intelligence scan (`/api/intelligence`)

`api/intelligence.js` is an optional module:
- It depends on `GROQ_API_KEY`
- It injects “latest headlines” from fast Pakistan RSS feeds into a strict JSON prompt
- It calls Groq with:
  - model: `llama-3.3-70b-versatile`
  - response_format: JSON object
- It parses the result and normalizes:
  - scores to 0-100
  - trend to improving/declining/stable
  - daily brief to exactly 3 bullets (when present)

If the endpoint returns 503 due to missing key/config:
- the UI shows an offline panel (“Intelligence scan is off”)
- no blocking errors are displayed

### 4.5 Front-end rendering and filtering (`public/js/app.js`)

The entire front-end is driven by:
- `state` object
- `renderAll()` which calls all renderers
- `refreshData()` loop which fetches all endpoints and updates state

Key front-end behaviors:
- `strictFocus` gating:
  - relevanceScore threshold
  - external stories require a direct Pakistan signal
- category and source filters:
  - nav lists update counts based on the filtered dataset
- search:
  - filters by substring match in `title + description`

---

## 5. How the App Was Built

### 5.1 Architecture: “single page, many renderers”

The app uses a classic vanilla approach:
- `public/index.html` defines the DOM structure
- `public/js/app.js` is both:
  - the state container
  - the controller (fetch + events)
  - the view renderer (DOM updates)
- `public/css/main.css` defines the entire design system

There is no routing beyond server-side route forwarding to `/`.

### 5.2 Render lifecycle

1. `DOMContentLoaded` triggers `init()`
2. `bindEvents()` wires UI controls
3. `refreshData()` fetches news/market/map and updates `state`
4. `renderAll()` redraws the dashboard modules based on state
5. Timers:
   - market/news/map refresh every ~4 minutes
   - intelligence refresh every 30 minutes (client-side throttled)

### 5.3 Security posture (basic safety)

Since the app inserts remote strings into HTML:
- it uses `escapeHtml(...)` before rendering text fields
- it uses `rel="noopener noreferrer"` on external links

This reduces XSS exposure from remote feed content.

### 5.4 Performance considerations

Primary strategies:
- `Promise.allSettled` so one endpoint failing does not block other modules
- caching in API modules reduces provider load
- sessionStorage cache provides a fast initial paint

---

## 6. Where to Change What (Quick Developer Map)

- Add/adjust news categories or relevance:
  - `api/news.js`
- Add/adjust market proxies:
  - `api/market.js`
- Add/adjust telemetry layers or map nodes:
  - `api/pakistan-map.js`
- Add/adjust AI scan prompt and schema:
  - `api/intelligence.js`
- Change UI rendering:
  - `public/js/app.js`
- Change visuals:
  - `public/css/main.css`
- Change layout/DOM targets:
  - `public/index.html`

---

## Appendix: Rendering Data Contracts (Practical Notes)

The UI relies on stable element IDs.
If you rename a DOM ID in `public/index.html`, you must update the corresponding call in `public/js/app.js`.

Because renderers are defensive (they usually check for missing elements), mistakes can appear as “empty UI” rather than a crash.

Use devtools:
- look for console errors
- verify each endpoint response shape
- verify `state` is being updated in `refreshData()`

