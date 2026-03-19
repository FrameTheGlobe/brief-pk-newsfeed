// Mock rss-parser
jest.mock('rss-parser', () => {
  return function() {
    return {
      parseURL: () => Promise.resolve({
        items: [
          {
            title: 'Imran Khan news',
            link: 'http://example.com/1',
            pubDate: new Date().toISOString(),
            contentSnippet: 'Politics in Pakistan'
          }
        ]
      })
    };
  };
});



// Mock fetch for market API
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ chart: { result: [{ meta: { regularMarketPrice: 280 } }] } }),
  })
);

const request = require('supertest');
const app = require('../../server');


describe('API Endpoints Integration Tests', () => {
  describe('GET /api/feeds', () => {
    test('should return news articles', async () => {
      const response = await request(app).get('/api/feeds');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('title');
    });

    test('should apply category filter', async () => {
      const response = await request(app).get('/api/feeds?category=Politics');
      expect(response.status).toBe(200);
      // Our mock returns 'Imran Khan news' which is Politics
      expect(response.body.every(a => a.category === 'Politics')).toBe(true);
    });
  });

  describe('GET /api/market', () => {
    test('should return market data', async () => {
      const response = await request(app).get('/api/market');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('usd');
      expect(response.body).toHaveProperty('petrol');
    });
  });
});
