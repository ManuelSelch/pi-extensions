const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../pipeline-helpers.cjs');
const { validateConfig } = load();
const { parseConfigYaml, formatConfigYaml, configurationReview } = load('pipeline/infra/config-format.ts');
const normalized = (suites = {}, prepare) => validateConfig({ suites, ...(prepare ? { prepare } : {}) });
const step = (command = ['npm', 'test'], extra = {}) => ({ command, ...extra });

test('YAML round trips literal argv, special strings and suite order without a version', () => {
  const input = normalized({
    second: step(['npm', 'test', 'true', '123', '# comment', 'a: b', '', 'line\nbreak', 'C:\\work\\file', '[x]', '"quoted"', '\u001b[31m']),
    first: step(['echo', 'null']),
  }, step(['npm', 'ci']));

  const yaml = formatConfigYaml(input);
  const output = validateConfig(parseConfigYaml(yaml));

  assert.equal(JSON.stringify(output), JSON.stringify(input));
  assert.match(yaml, /^prepare:\n  command: \[npm, ci\]/);
  assert.doesNotMatch(yaml, /version:/);
  assert.deepEqual(Object.keys(output.suites), ['second', 'first']);
});

test('invalid YAML, duplicate keys, custom tags, aliases and multiple documents fail closed', () => {
  for (const yaml of [
    'suites: [',
    'suites: {}\nsuites: {}',
    'suites:\n  test:\n    command: [npm, test]\n    command: [evil]',
    'suites: !custom {}',
    'suites: &s {}\nprepare: *s',
    'suites: {}\n---\nsuites: {}',
  ]) assert.throws(() => parseConfigYaml(yaml));
});

test('default expansion and YAML formatting are absent from normalized diffs', () => {
  const before = validateConfig(parseConfigYaml('suites: {test: {command: [npm, test]}}'));
  const after = normalized({ test: step(['npm', 'test'], { cwd: '.', timeoutSeconds: 300, auto: 'manual' }) });

  assert.equal(configurationReview(before, after), 'No configuration changes.');
});

test('approval diff names added and removed suites and preparation without unrelated content', () => {
  const before = normalized({ removed: step(['old']), stable: step(['do-not-show']) }, step(['npm', 'ci']));
  const after = normalized({ stable: step(['do-not-show']), added: step(['new']) });

  const diff = configurationReview(before, after);

  assert.match(diff, /\(prepare\)/);
  assert.match(diff, /-prepare:/);
  assert.match(diff, /-  command: \[npm, ci\]/);
  assert.match(diff, /suites.removed/);
  assert.match(diff, /-    command: \[old\]/);
  assert.match(diff, /suites.added/);
  assert.match(diff, /\+    command: \[new\]/);
  assert.doesNotMatch(diff, /do-not-show/);
});

test('preparation additions and edits use a focused diff', () => {
  const empty = normalized();
  const prepared = normalized({}, step(['npm', 'ci']));
  const changed = normalized({}, step(['npm', 'install']));

  assert.match(configurationReview(empty, prepared), /\+  command: \[npm, ci\]/);
  assert.match(configurationReview(prepared, changed), /-  command: \[npm, ci\]\n\+  command: \[npm, install\]/);
});

test('reordering suites remains visible because it changes execution order', () => {
  const before = normalized({ first: step(), second: step() });
  const after = normalized({ second: step(), first: step() });

  const diff = configurationReview(before, after);

  assert.match(diff, /suite execution order/);
  assert.match(diff, /[-+]- first/);
  assert.doesNotMatch(diff, /command:|suites.first|suites.second/);
});

test('a command and automation change in a large config stays focused and complete', () => {
  const suites = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`suite${i}`, step([`unchanged${i}`])]));
  const before = normalized({ ...suites, target: step() });
  const after = normalized({ ...suites, target: step(['npm', 'run', 'integration'], { auto: 'after-agent' }) });

  const diff = configurationReview(before, after);

  assert.match(diff, /suites.target/);
  assert.match(diff, /-    command: \[npm, test\]/);
  assert.match(diff, /\+    command: \[npm, run, integration\]/);
  assert.match(diff, /-    auto: manual/);
  assert.match(diff, /\+    auto: after-agent/);
  assert.doesNotMatch(diff, /unchanged|suite99/);
  assert.ok(diff.length < 800);
});
