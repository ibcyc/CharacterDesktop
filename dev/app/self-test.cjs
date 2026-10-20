// Self-tests (--self-test plus one flag). Every test runs with hidden windows; an unknown or missing flag is refused.
// --extension-test=<id> runs that extension's own test, tests/self-test.cjs in its folder under --extensions-dir.
const fs = require('node:fs');
const path = require('node:path');

const TESTS = {
  '--fresh-library-test': './fresh-self-test.cjs',
  '--preview-controls-test': './preview-self-test.cjs',
  '--character-test': './character-self-test.cjs'
};

async function run(ctx) {
  const flag = Object.keys(TESTS).find(name => process.argv.includes(name));
  if (flag) return require(TESTS[flag]).run(ctx);
  const extension = process.argv.find(arg => arg.startsWith('--extension-test='))?.slice('--extension-test='.length);
  const file = /^[a-z0-9-]{1,32}$/.test(extension || '') && path.join(ctx.extensionsRoot, extension, 'tests', 'self-test.cjs');
  if (file && fs.existsSync(file)) return require(file).run(ctx);
  fs.mkdirSync(path.dirname(ctx.report), { recursive: true });
  fs.writeFileSync(ctx.report, JSON.stringify({ ok: false, error: 'Unknown or missing test flag: ' + [...Object.keys(TESTS), '--extension-test=<id>'].join(', ') }));
  ctx.app.exit(2);
}

module.exports = { run };
