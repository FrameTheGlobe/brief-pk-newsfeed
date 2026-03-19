'use strict';

const serverless = require('serverless-http');
const app = require('../../server'); // the Express app from server.js

// This exports the handler needed for Netlify Functions
module.exports.handler = serverless(app);
