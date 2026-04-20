/**
 * Non-visual E2E: HTTP shape and status codes only (no browsers, no snapshots).
 * Hits live upstreams where applicable — use generous timeouts in CI.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const app = require('../../server');

const LONG = 120_000;

function assertNewsShape(body) {
  assert.strictEqual(typeof body.updatedAt, 'string');
  assert.ok(Array.isArray(body.articles));
  assert.ok(body.total >= 0);
  for (const a of body.articles.slice(0, 5)) {
    assert.strictEqual(typeof a.title, 'string');
    assert.ok(a.title.length > 0);
    assert.strictEqual(typeof a.url, 'string');
    if (a.publishedAt != null) assert.strictEqual(typeof a.publishedAt, 'string');
  }
}

describe('static routes', () => {
  test('GET / serves HTML', async () => {
    const res = await request(app).get('/').expect(200);
    assert.match(
      res.headers['content-type'] || '',
      /text\/html/i,
      'index should be HTML'
    );
    const body = res.text;
    assert.ok(body.includes('<html'), 'document has html tag');
    assert.ok(body.includes('app.js'), 'page references app bundle');
    assert.ok(body.includes('va-analytics.js'), 'page references Vercel Analytics bundle');
  });

  test('GET /js/app.js', async () => {
    const res = await request(app).get('/js/app.js').expect(200);
    assert.match(res.headers['content-type'] || '', /javascript/);
    assert.ok(res.text.includes('const ') || res.text.includes('function '), 'looks like JS');
  });

  test('GET /js/va-analytics.js (Vercel Web Analytics inject bundle)', async () => {
    const res = await request(app).get('/js/va-analytics.js').expect(200);
    assert.match(res.headers['content-type'] || '', /javascript/);
    assert.ok(
      res.text.includes('insights') || res.text.includes('vercel') || res.text.includes('_vercel'),
      'bundle should reference Vercel analytics wiring'
    );
  });

  test('GET /css/main.css', async () => {
    const res = await request(app).get('/css/main.css').expect(200);
    assert.match(res.headers['content-type'] || '', /css/);
    assert.ok(res.text.includes('{'), 'looks like CSS');
  });

  test('GET /data/pakistan-macro.json', async () => {
    const res = await request(app).get('/data/pakistan-macro.json').expect(200);
    assert.match(res.headers['content-type'] || '', /json/);
    const b = JSON.parse(res.text);
    assert.ok(Array.isArray(b.series));
  });
});

describe('JSON APIs', () => {
  test(
    'GET /api/news returns article list',
    { timeout: LONG },
    async () => {
      const res = await request(app).get('/api/news').expect(200);
      assert.strictEqual(res.headers['cache-control'], 'no-store, must-revalidate');
      assertNewsShape(res.body);
    }
  );

  test(
    'GET /api/market returns payload',
    { timeout: LONG },
    async () => {
      const res = await request(app).get('/api/market').expect(200);
      const b = res.body;
      assert.strictEqual(typeof b.updatedAt, 'string');
      assert.ok(b.fx != null || b.commodities != null || b.indices != null, 'expected market fields');
      assert.ok(Array.isArray(b.marketSnapshot?.panels) && b.marketSnapshot.panels.length >= 5, 'market snapshot panels');
    }
  );

  test(
    'GET /api/pakistan-map returns payload',
    { timeout: LONG },
    async () => {
      const res = await request(app).get('/api/pakistan-map').expect(200);
      const b = res.body;
      assert.strictEqual(typeof b.updatedAt, 'string');
      assert.ok(Array.isArray(b.points), 'expected points[] from map API');
    }
  );

  test('GET /api/pakistan-macro returns WDI snapshot', async () => {
    const res = await request(app).get('/api/pakistan-macro').expect(200);
    const b = res.body;
    assert.strictEqual(typeof b.meta?.updatedAt, 'string');
    assert.ok(Array.isArray(b.series) && b.series.length >= 2);
  });

  test('GET /api/pakistan-macro-insight returns explanation text', async () => {
    const res = await request(app).get('/api/pakistan-macro-insight').expect(200);
    assert.strictEqual(typeof res.body.text, 'string');
    assert.ok(res.body.text.length > 40);
  });

  test('GET /api/intelligence — 503 without Groq key or 200 with service', async () => {
    const res = await request(app).get('/api/intelligence');
    assert.ok(
      res.status === 503 || res.status === 200,
      `unexpected status ${res.status}`
    );
    if (res.status === 503) {
      assert.strictEqual(typeof res.body.error, 'string');
    } else {
      assert.ok(Array.isArray(res.body.indicators));
    }
  });
});
