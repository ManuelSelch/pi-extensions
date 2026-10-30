const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../pipeline-helpers.cjs');
const { validateConfig } = load();
const { parseConfigYaml, formatConfigYaml } = load('pipeline/infra/config-format.ts');
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
