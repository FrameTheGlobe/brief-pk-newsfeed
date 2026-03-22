#!/usr/bin/env node
/**
 * stamp-version.js
 * Rewrites ?v=X.X.X query strings in index.html to match package.json version.
 * Run automatically via `npm run predeploy` before `vercel deploy`.
 */
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const version = pkg.version;

const htmlPath = path.join(__dirname, '../public/index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Replace all occurrences of ?v=X.X.X on .css and .js hrefs/srcs
html = html.replace(/(\.css|\.js)\?v=[\d.]+/g, `$1?v=${version}`);

fs.writeFileSync(htmlPath, html);
console.log(`✓ index.html stamped with v${version}`);
