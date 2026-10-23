const { readdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const ignored = new Set(['node_modules', '.git', 'mockups']);
function discoverTests(root, moduleName) {
  if (moduleName && !/^[a-z0-9][a-z0-9-]*$/.test(moduleName)) throw new Error('Invalid module name');
  const files = [];
  function walk(relative) {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const file = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith('.test.cjs')) files.push(file);
    }
  }
  // Transitional root suites remain supported until all extensions are moved.
  if (!moduleName && existsSync(join(root, 'tests'))) walk('tests');
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || ignored.has(entry.name) || (moduleName && entry.name !== moduleName)) continue;
    const tests = entry.name + '/tests';
    if (existsSync(join(root, tests))) walk(tests);
  }
  if (moduleName && !files.length) throw new Error('No tests for module: ' + moduleName);
  return files.sort();
}
function verifyInventory(files, expected) {
  const names = files.map(file => file.slice(file.indexOf('tests/') + 'tests/'.length));
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
  const missing = expected.filter(name => !names.includes(name));
  const extra = names.filter(name => !expected.includes(name));
  const errors = [];
  if (duplicates.length) errors.push('Duplicate: ' + duplicates.join(', '));
  if (missing.length) errors.push('Missing: ' + missing.join(', '));
  if (extra.length) errors.push('Unexpected: ' + extra.join(', '));
  if (errors.length) throw new Error(errors.join('\n'));
}
module.exports = { discoverTests, verifyInventory };
