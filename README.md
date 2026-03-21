# brief. Pakistan Intelligence Dashboard

Ultra-dense Pakistan-focused intelligence dashboard built from scratch with:
- Open RSS news feeds (Pakistani + international Pakistan coverage)
- Open market/commodity feeds (no API keys)
- Bloomberg-style data-dense UI while preserving brief. brand language

## Run locally

```bash
npm install
PORT=3010 npm run dev
```

Then open `http://localhost:3010`

(Use any free port if `3000` is already in use.)

## API routes
- `/api/news` => aggregated + normalized Pakistan-related RSS items
- `/api/market` => USD/PKR + KSE (if available) + commodity references/proxies

## Notes
- No NewsAPI/private paid keys used.
- Data comes only from open/public feeds.
