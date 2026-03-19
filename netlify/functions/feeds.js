'use strict';

const { getCachedFeeds, applyFilters } = require('../../api/feeds');

exports.handler = async (event) => {
  const query = event.queryStringParameters || {};

  try {
    const articles = await getCachedFeeds({ force: !!query.force });
    const filtered = applyFilters(articles, query);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 's-maxage=300, stale-while-revalidate=60'
      },
      body: JSON.stringify(filtered)
    };
  } catch (err) {
    console.error('[netlify] feeds error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch feeds', details: err.message })
    };
  }
};
