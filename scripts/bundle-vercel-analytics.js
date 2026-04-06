const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const outfile = path.join(root, 'public', 'js', 'va-analytics.js');

esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'vercel-analytics-entry.js')],
  bundle: true,
  format: 'iife',
  outfile,
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
});

console.log('bundle-vercel-analytics: wrote', path.relative(root, outfile));
