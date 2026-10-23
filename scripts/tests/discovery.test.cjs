const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discoverTests, verifyInventory } = require('../test-discovery.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extensions-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const add = file => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), ''); };
  return { root, add };
}
test('discovers sorted module tests at any depth, excluding helpers and dependencies', t => {
  const { root, add } = fixture(t);
  for (const file of ['beta/tests/Integration/b.test.cjs', 'alpha/tests/a.test.cjs',
    'alpha/tests/Support/helper.cjs', 'node_modules/ignored/tests/no.test.cjs',
    'alpha/tests/node_modules/no.test.cjs', 'mockups/demo/tests/no.test.cjs',
    'alpha/src/no.test.cjs']) add(file);
  assert.deepEqual(discoverTests(root), ['alpha/tests/a.test.cjs', 'beta/tests/Integration/b.test.cjs']);
  assert.deepEqual(discoverTests(root, 'beta'), ['beta/tests/Integration/b.test.cjs']);
  assert.throws(() => discoverTests(root, '../alpha'), /Invalid module/);
  assert.throws(() => discoverTests(root, 'missing'), /No tests/);
});
test('checks missing, extra and duplicate suite identities after relocation', () => {
  const expected = ['a.test.cjs', 'b.test.cjs'];
  assert.doesNotThrow(() => verifyInventory(['alpha/tests/a.test.cjs', 'beta/tests/b.test.cjs'], expected));
  assert.throws(() => verifyInventory(['alpha/tests/a.test.cjs'], expected), /Missing.*b.test.cjs/);
  assert.throws(() => verifyInventory(['alpha/tests/a.test.cjs', 'beta/tests/b.test.cjs', 'gamma/tests/c.test.cjs'], expected), /Unexpected.*c.test.cjs/);
  assert.throws(() => verifyInventory(['alpha/tests/a.test.cjs', 'beta/tests/a.test.cjs', 'beta/tests/b.test.cjs'], expected), /Duplicate/);
});
