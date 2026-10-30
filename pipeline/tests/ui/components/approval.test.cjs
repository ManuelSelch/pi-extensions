const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../../pipeline-helpers.cjs');
const { validateConfig } = load();
const loadView = () => load('pipeline/ui/components/approval.ts');
const config = (suites, prepare) => validateConfig({ suites, ...(prepare ? { prepare } : {}) });
const step = (command, extra = {}) => ({ command, ...extra });

test('execution approval stacks plain-text entries and omits root cwd and automation footer', () => {
  const { executionSummary } = loadView();
  const text = executionSummary(config({ tests: step(['npm', 'test'], { timeoutSeconds: 120, auto: 'after-agent' }), typecheck: step(['npm', 'run', 'typecheck'], { timeoutSeconds: 60 }) }));
  assert.equal(text, 'tests · timeout 120s\nnpm test\n\ntypecheck · timeout 60s\nnpm run typecheck');
});

test('diff shows only changed fields and added suite details without patch boilerplate', () => {
  const { configurationReview } = loadView();
  const before = config({ tests: step(['npm', 'test'], { timeoutSeconds: 120 }), stable: step(['hidden']) });
  const after = config({ tests: step(['npm', 'test'], { timeoutSeconds: 180 }), stable: step(['hidden']), integration: step(['npm', 'run', 'test:integration'], { timeoutSeconds: 600 }) });
  assert.equal(configurationReview(before, after), 'tests\n- timeout: 120s\n+ timeout: 180s\n\nintegration (added)\n+ command: npm run test:integration\n+ timeout: 600s\n+ auto: manual');
});

test('diff exposes cwd, automation, preparation removals and suite reorder', () => {
  const { configurationReview } = loadView();
  const before = config({ first: step(['one']), second: step(['two']) }, step(['npm', 'ci']));
  const after = config({ second: step(['two']), first: step(['one'], { cwd: 'sub', auto: 'after-agent' }) });
  const text = configurationReview(before, after);
  assert.match(text, /prepare \(removed\)\n- command: npm ci\n- timeout: 300s/);
  assert.match(text, /first\n- cwd: \.\n\+ cwd: sub\n- auto: manual\n\+ auto: after-agent/);
  assert.match(text, /Execution order\n- first → second\n\+ second → first/);
});

test('literal argv boundaries and control characters are unambiguous', () => {
  const { executionSummary, configurationReview } = loadView();
  const before = config({ test: step(['echo', 'a b', '', 'line\nbreak', '\u001b[31m']) });
  const after = config({ test: step(['echo', 'a', 'b', '', 'line\nbreak', '\u001b[31m']) });
  assert.match(executionSummary(before), /echo "a b" "" "line\\nbreak" "\\u001b\[31m"/);
  assert.match(configurationReview(before, after), /- command: echo "a b"/);
  assert.match(configurationReview(before, after), /\+ command: echo a b/);
});

test('creation uses stacked summary; unchanged configuration says so', () => {
  const { configurationReview } = loadView();
  const c = config({ test: step(['npm', 'test']) });
  assert.equal(configurationReview(undefined, c), 'test · timeout 300s\nnpm test');
  assert.equal(configurationReview(c, c), 'No configuration changes.');
});

test('large config diffs omit unchanged suites and default expansion noise', () => {
  const { configurationReview } = loadView();
  const suites = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`suite${i}`, step([`unchanged${i}`])]));
  const before = config({ ...suites, target: step(['npm', 'test']) });
  const after = config({ ...suites, target: step(['npm', 'test'], { timeoutSeconds: 120 }) });

  assert.equal(configurationReview(before, after), 'target\n- timeout: 300s\n+ timeout: 120s');
  assert.equal(configurationReview(config({ test: step(['npm', 'test']) }), config({ test: step(['npm', 'test'], { cwd: '.', timeoutSeconds: 300, auto: 'manual' }) })), 'No configuration changes.');
});

test('removed suites show all execution settings; root cwd transitions stay explicit', () => {
  const { configurationReview } = loadView();
  const before = config({ removed: step(['npm', 'test'], { cwd: 'sub', auto: 'after-agent' }), test: step(['echo'], { cwd: 'sub' }) });
  const after = config({ test: step(['echo']) });

  assert.equal(configurationReview(before, after), 'removed (removed)\n- command: npm test\n- timeout: 300s\n- cwd: sub\n- auto: after-agent\n\ntest\n- cwd: sub\n+ cwd: .');
});

test('preparation and suite named prepare are distinct and non-root cwd is visible', () => {
  const { executionSummary, configurationReview } = loadView();
  const before = config({ prepare: step(['test']) }, step(['install']));
  const after = config({ prepare: step(['changed'], { cwd: 'sub' }) }, step(['updated']));
  assert.equal(executionSummary(after), 'prepare (setup) · timeout 300s\nupdated\n\nprepare (suite) · timeout 300s\nchanged\ncwd: sub');
  assert.match(configurationReview(before, after), /prepare \(setup\)/);
  assert.match(configurationReview(before, after), /prepare \(suite\)/);
});
