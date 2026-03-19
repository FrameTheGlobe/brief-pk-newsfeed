'use strict';

const { getMarketData, STATIC } = require('../../api/market');

exports.handler = async (event) => {
  try {
    const data = await getMarketData();

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 's-maxage=300, stale-while-revalidate=60'
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.error('[netlify] market fatal error:', err.message);
    
    // Fallback data in case of failure
    const fallback = {
      usd:         { val: null,             change: null },
      kse:         { val: null,             change: null },
      gold:        { val: null                           },
      petrol:      { val: STATIC.petrol                 },
      diesel:      { val: STATIC.diesel                 },
      lpg:         { val: STATIC.lpg,       change: 0   },
      electricity: { val: STATIC.electricity,change: 0  },
      atta:        { val: STATIC.atta,       change: 0   },
      sugar:       { val: STATIC.sugar,      change: 0   },
      rice:        { val: STATIC.rice,       change: 0   },
      chicken:     { val: STATIC.chicken,    change: 0   },
      _error:      err.message,
      _updated:    new Date().toISOString(),
    };

    return {
      statusCode: 200,
      body: JSON.stringify(fallback)
    };
  }
};
