const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { discoverTests, verifyInventory } = require('./test-discovery.cjs');
const root = resolve(__dirname, '..');
try {
  const all = discoverTests(root);
  verifyInventory(all, require('./test-inventory.json'));
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error('Usage: npm test -- [module]');
  const files = args.length ? discoverTests(root, args[0]) : all;
  console.log('Running ' + files.length + ' test files');
  const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
