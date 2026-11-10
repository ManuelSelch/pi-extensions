const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { load, fixture, approve } = require('../pipeline-helpers.cjs');

test('job overrides survive round trips even when equal to shared defaults', async t => {
  const f = await fixture(t);
  const { Pipeline, effectiveJob } = load();
  const p = new Pipeline(f.root, f.cache);
  await p.configure({ suites: { checks: { timeoutSeconds: 20, jobs: {
    inherited: { command: ['node'] }, pinned: { command: ['node'], timeoutSeconds: 20 },
  } } } }, approve);

  const yaml = await fs.readFile(p.configPath, 'utf8');
  assert.match(yaml, /pinned:\n\s+command: \[node\]\n\s+timeoutSeconds: 20/);
  await fs.writeFile(p.configPath, yaml.replace('timeoutSeconds: 20', 'timeoutSeconds: 40'));
  const group = (await p.config()).suites.checks;
  assert.equal(effectiveJob(group, group.jobs.inherited).timeoutSeconds, 40);
  assert.equal(effectiveJob(group, group.jobs.pinned).timeoutSeconds, 20);
});

test('invalid job configurations fail closed', () => {
  const { validateConfig } = load();
  for (const suite of [
    { jobs: {} }, { command: ['x'], jobs: { test: { command: ['x'] } } },
    { jobs: { '../bad': { command: ['x'] } } }, { jobs: { test: { command: [] } } },
    { jobs: { test: { command: ['x'], cwd: '../outside' } } },
    { jobs: { test: { command: ['x'], timeoutSeconds: 0 } } },
    { jobs: { test: { command: ['x'], auto: 'always' } } },
    { jobs: { test: { command: ['x'], unknown: true } } },
  ]) assert.throws(() => validateConfig({ suites: { checks: suite } }));
});

test('each job enforces its own effective timeout and later jobs still run', async t => {
  const f = await fixture(t);
  const { Pipeline } = load();
  const p = new Pipeline(f.root, f.cache);
  await p.configure({ suites: { checks: { timeoutSeconds: 0.15, jobs: {
    slow: { command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'] },
    quick: { command: [process.execPath, '-e', ''], timeoutSeconds: 5 },
  } } } }, approve);

  const results = await p.run('checks');

  assert.deepEqual(Array.from(results, r => [r.job, r.outcome]), [['slow', 'timed-out'], ['quick', 'passed']]);
});

test('approval shows job commands, effective settings, overrides and job order changes', async t => {
  const f = await fixture(t);
  const { Pipeline } = load();
  const p = new Pipeline(f.root, f.cache);
  const initial = { suites: { checks: { auto: 'after-agent', jobs: {
    lint: { command: ['lint'] }, test: { command: ['test'], auto: 'manual' },
  } } } };
  await p.configure(initial, async text => {
    assert.match(text, /checks\/lint · timeout 300s\nlint\nauto: after-agent/);
    assert.match(text, /checks\/test · timeout 300s\ntest\nauto: manual/);
    return true;
  });
  const changed = { suites: { checks: { auto: 'after-agent', jobs: {
    test: { command: ['test'], auto: 'manual' }, lint: { command: ['lint'], auto: 'after-agent' },
  } } } };
  await p.configure(changed, async text => {
    assert.match(text, /checks\/lint inheritance\nauto: override/);
    assert.match(text, /checks job order\n- lint → test\n\+ test → lint/);
    return false;
  });
});
