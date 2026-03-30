/**
 * Compile/syntax check every .js file under the repo (excluding node_modules, .git).
 * Exit non-zero on first parse error — use as `npm run build`.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'dist', 'build']);

function* walkJs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      yield* walkJs(p);
    } else if (e.isFile() && e.name.endsWith('.js')) {
      yield p;
    }
  }
}

let failed = false;
for (const file of walkJs(ROOT)) {
  const rel = path.relative(ROOT, file);
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed = true;
    console.error(`Syntax error: ${rel}`);
    if (r.stderr) console.error(r.stderr);
  }
}

if (failed) process.exit(1);
console.log('verify-build: all .js files parse OK');
