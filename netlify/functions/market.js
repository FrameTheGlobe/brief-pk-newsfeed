'use strict';

const handler = require('../../api/market');

exports.handler = async (event) => {
  // Simulating Vercel's req/res objects for the handler
  const req = {
    method: event.httpMethod,
    headers: event.headers,
    query: event.queryStringParameters || {},
    body: event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : {}
  };
  
  let statusCode = 200;
  let responseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };
  let responseBody = '';

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    setHeader: (key, val) => {
      responseHeaders[key.toLowerCase()] = val;
      return res;
    },
    json: (data) => {
      responseBody = JSON.stringify(data);
      return res;
    },
    end: (data) => {
      if (data) responseBody = data;
      return res;
    },
    send: (data) => {
      responseBody = data;
      return res;
    }
  };

  try {
    await handler(req, res);
    return {
      statusCode,
      headers: responseHeaders,
      body: responseBody
    };
  } catch (err) {
    console.error('[netlify] market error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error', details: err.message })
    };
  }
};
