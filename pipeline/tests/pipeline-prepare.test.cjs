const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { load, fixture, config, approve, waitFor } = require('./pipeline-helpers.cjs');
const command = script => ({ command: [process.execPath, '-e', script] });
function preparedConfig() {
  const c = config(`require('node:fs').appendFileSync('order.txt', 'test\\n')`);
  c.prepare = command(`require('node:fs').appendFileSync('order.txt', 'prepare\\n')`);
  return c;
}

test('prepare is optional, validates only command/cwd/timeout and remains in exact approval', async t => {
  const { validateConfig, Pipeline } = load();
  assert.equal(Object.hasOwn(validateConfig(config()), 'prepare'), false, 'omitting preparation must not add a preparation field');
  const normalized = validateConfig(preparedConfig());
  assert.equal(normalized.prepare.cwd, '.'); assert.equal(normalized.prepare.timeoutSeconds, 300);
  for (const prepare of [null, {}, { command: 'npm ci' }, { command: ['npm', 'ci'], cwd: '../outside' },
    { command: ['npm', 'ci'], timeoutSeconds: 0 }, { command: ['npm', 'ci'], auto: 'after-agent' },
    { command: ['npm', 'ci'], staleAfterMinutes: 30 }]) {
    assert.throws(() => validateConfig({ ...config(), prepare }));
  }
  const f = await fixture(t), p = new Pipeline(f.root, f.cache);
  await p.configure(preparedConfig(), async text => { assert.match(text, /prepare\s+.*timeout 300s/s); return true; });
  const next = preparedConfig(); next.prepare.command = [process.execPath, '-e', ''];
  await fs.writeFile(f.configPath, require('yaml').stringify(next));
  await assert.rejects(p.run('unit'), /approval.*required/i);
  assert.equal((await p.status()).prepare.outcome, 'never');
});

test('runs preparation before a selected suite once successfully across sessions, ignoring later changes', async t => {
  const f = await fixture(t), { Pipeline } = load(), p = new Pipeline(f.root, f.cache), c = preparedConfig();
  await p.configure(c, approve);
  assert.equal((await p.status()).prepare.outcome, 'never');
  assert.deepEqual(Array.from(await p.run('unit'), r => [r.suite, r.outcome]), [['prepare', 'passed'], ['unit', 'passed']]);
  assert.equal(await fs.readFile(path.join(f.root, 'order.txt'), 'utf8'), 'prepare\ntest\n');
  const other = new Pipeline(f.root, f.cache);
  assert.equal((await other.status()).prepare.outcome, 'passed');
  assert.deepEqual(Array.from(await other.run('all'), r => r.suite), ['unit']);
  await fs.writeFile(path.join(f.root, 'package-lock.json'), 'changed');
  c.prepare.command = [process.execPath, '-e', 'throw Error("must not prepare again")'];
  await p.configure(c, approve);
  assert.deepEqual(Array.from(await p.run('unit'), r => r.suite), ['unit']);
  delete c.prepare; await p.configure(c, approve); assert.equal((await p.status()).prepare, undefined);
  c.prepare = command('process.exit(9)'); await p.configure(c, approve);
  assert.equal((await p.run('unit'))[0].suite, 'unit', 'removing/readding prepare does not clear success');
});

test('failed preparation blocks every selected suite and retries on the next manual run', async t => {
  const f = await fixture(t), { Pipeline } = load(), p = new Pipeline(f.root, f.cache), c = preparedConfig();
  c.prepare = command('console.error("install failed"); process.exit(7)');
  c.suites.integration = command('throw Error("must not run")');
  await p.configure(c, approve);
  const first = await p.run('all');
  assert.equal(first.length, 1); assert.equal(first[0].suite, 'prepare'); assert.equal(first[0].outcome, 'failed');
  assert.equal(first[0].exitCode, 7); assert.match(await fs.readFile(first[0].logPath, 'utf8'), /install failed/);
  assert.equal((await p.status()).suites.unit.outcome, 'never');
  assert.equal((await p.status()).suites.integration.outcome, 'never');
  assert.equal((await p.run('unit'))[0].outcome, 'failed');
  c.prepare = command(''); await p.configure(c, approve);
  assert.deepEqual(Array.from(await p.run('unit'), r => r.outcome), ['passed', 'passed']);
});

test('preparation respects timeout, cancellation, worktree locking and retry', async t => {
  const f = await fixture(t), { Pipeline } = load(), p = new Pipeline(f.root, f.cache), c = preparedConfig();
  c.prepare = { ...command('setInterval(() => {}, 1000)'), timeoutSeconds: 0.1 };
  await p.configure(c, approve);
  assert.equal((await p.run('unit'))[0].outcome, 'timed-out');
  c.prepare.timeoutSeconds = 10; await p.configure(c, approve);
  const controller = new AbortController(), run = p.run('unit', { signal: controller.signal });
  await waitFor(async () => (await p.status()).prepare.outcome === 'running');
  await assert.rejects(new Pipeline(f.root, f.cache).run('unit'), /busy/i);
  controller.abort(); assert.equal((await run)[0].outcome, 'cancelled');
  assert.equal((await p.status()).suites.unit.outcome, 'never');
  c.prepare = command(''); await p.configure(c, approve);
  assert.equal((await p.run('unit'))[0].outcome, 'passed');
});

test('automatic suites prepare first without repeating unchanged failed preparation or prompting', async t => {
  const f = await fixture(t), { Pipeline } = load(), p = new Pipeline(f.root, f.cache), c = preparedConfig();
  c.suites.unit.auto = 'after-agent'; c.prepare = command('process.exit(1)');
  await p.configure(c, approve);
  assert.equal((await p.run('all', { automatic: true, cooldownMs: 0 }))[0].outcome, 'failed');
  assert.equal((await p.run('all', { automatic: true, cooldownMs: 0 })).length, 0);
  c.prepare = command(''); await fs.writeFile(f.configPath, require('yaml').stringify(c));
  assert.equal((await p.run('all', { automatic: true, cooldownMs: 0, confirm: () => { throw Error('no popup'); } })).length, 0);
  await p.configure(c, approve);
  assert.deepEqual(Array.from(await p.run('all', { automatic: true, cooldownMs: 0 }), r => r.suite), ['prepare', 'unit']);
  await fs.writeFile(path.join(f.root, 'source.txt'), 'changed');
  assert.deepEqual(Array.from(await p.run('all', { automatic: true, cooldownMs: 0 }), r => r.suite), ['unit']);
});

test('failed preparation that writes files still cannot create an unchanged automatic retry loop', async t => {
  const f = await fixture(t), { Pipeline } = load(), p = new Pipeline(f.root, f.cache), c = preparedConfig();
  c.suites.unit.auto = 'after-agent';
  c.prepare = command(`require('node:fs').writeFileSync('partial.txt', String(Date.now())); process.exit(1)`);
  await p.configure(c, approve);
  assert.equal((await p.run('all', { automatic: true, cooldownMs: 0 }))[0].outcome, 'failed');
  assert.equal((await p.run('all', { automatic: true, cooldownMs: 0 })).length, 0);
  assert.equal((await p.run('unit'))[0].outcome, 'failed', 'explicit request retries');
});

test('automatic suites execute after preparation changes source inputs', async t => {
  const f = await fixture(t), { Pipeline } = load(), p = new Pipeline(f.root, f.cache), c = preparedConfig();
  c.suites.unit.auto = 'after-agent';
  await p.configure(c, approve);
  assert.deepEqual(Array.from(await p.run('all', { automatic: true, cooldownMs: 0 }), r => r.suite), ['prepare', 'unit']);
});

test('preparation uses confined cwd and approval before execution; invalid selections cannot prepare', async t => {
  const f = await fixture(t), { Pipeline } = load(), p = new Pipeline(f.root, f.cache), c = preparedConfig();
  await fs.mkdir(path.join(f.root, 'sub')); c.prepare.cwd = 'sub';
  await fs.mkdir(path.dirname(f.configPath)); await fs.writeFile(f.configPath, require('yaml').stringify(c));
  await assert.rejects(p.run('unit'), /approval.*required/i);
  await assert.rejects(p.run('missing', { confirm: approve }), /Unknown/);
  await assert.rejects(fs.readFile(path.join(f.root, 'sub', 'order.txt')), { code: 'ENOENT' });
  await p.run('unit', { confirm: approve });
  assert.equal(await fs.readFile(path.join(f.root, 'sub', 'order.txt'), 'utf8'), 'prepare\n');
  await fs.symlink(f.cache, path.join(f.root, 'outside'));
  c.prepare.cwd = 'outside'; await assert.rejects(p.configure(c, approve), /outside.*project/i);
});

test('configuration changed during preparation cannot launch a suite without fresh approval', async t => {
  const f = await fixture(t), { Pipeline } = load(), p = new Pipeline(f.root, f.cache), c = preparedConfig();
  c.prepare = command('setTimeout(() => {}, 150)');
  await p.configure(c, approve);
  const run = p.run('unit');
  await waitFor(async () => (await p.status()).prepare.outcome === 'running');
  c.suites.unit = command('throw Error("unapproved test")');
  await fs.writeFile(f.configPath, require('yaml').stringify(c));
  await assert.rejects(run, /changed.*execution/i);
  assert.equal((await p.status()).suites.unit.outcome, 'never');
  assert.equal((await p.status()).prepare.outcome, 'passed', 'successful preparation is not invalidated');
});

test('linked worktrees share approval but never share preparation success', async t => {
  const f = await fixture(t), { Pipeline } = load();
  execFileSync('git', ['init', '-q', f.root]);
  await fs.writeFile(path.join(f.root, '.gitignore'), 'order.txt\n');
  const p = new Pipeline(f.root, f.cache), c = preparedConfig();
  await p.configure(c, approve);
  execFileSync('git', ['add', '.'], { cwd: f.root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: f.root });
  const root = path.join(path.dirname(f.root), 'linked');
  execFileSync('git', ['worktree', 'add', '-qb', 'linked', root], { cwd: f.root });
  assert.equal((await p.run('unit'))[0].suite, 'prepare');
  const other = new Pipeline(root, f.cache);
  assert.equal(await other.isApproved(), true);
  assert.equal((await other.status()).prepare.outcome, 'never');
  assert.equal((await other.run('unit'))[0].suite, 'prepare');
  assert.equal((await other.run('unit'))[0].suite, 'unit');
});

test('tool schema exposes optional preparation, guidance, and visible blocking status', async () => {
  const Type = (await import('typebox')).Type, tools = {};
  const { default: extension } = load('pipeline/index.ts', {
    typebox: { Type }, '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_p, fn) => fn() },
  });
  extension({ registerTool(spec) { tools[spec.name] = spec; }, registerCommand() {}, on() {} });
  const schema = tools.pipeline_configure.parameters.properties.config;
  assert.ok(schema.properties.prepare);
  assert.ok(!schema.required.includes('prepare'));
  assert.match(tools.pipeline_configure.description, /fresh.*worktree/i);
  assert.match(tools.pipeline_configure.description, /npm ci/);
  const { renderWidget } = load('pipeline/widget.ts');
  const status = { configured: true, suites: { unit: { outcome: 'never', stale: false } },
    prepare: { outcome: 'failed', stale: false, startedAt: new Date().toISOString() } };
  const lines = renderWidget(status, { fg: (_color, text) => text }, 100);
  assert.match(lines.join('\n'), /✗ prepare/);
  assert.match(lines.join('\n'), /○ unit never/);
});

test('preparation failure is a structured tool error with suites still blocked', async t => {
  const f = await fixture(t), Type = (await import('typebox')).Type, tools = {};
  const { default: extension } = load('pipeline/index.ts', {
    typebox: { Type }, '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_p, fn) => fn() },
  });
  extension({ registerTool(spec) { tools[spec.name] = spec; }, registerCommand() {}, on() {} });
  const before = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = f.cache;
  t.after(() => { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; });
  const ctx = { cwd: f.root, hasUI: true, ui: { confirm: approve } }, c = preparedConfig();
  c.prepare = command('process.exit(4)');
  await tools.pipeline_configure.execute('configure', { config: c }, undefined, undefined, ctx);
  const result = await tools.pipeline_run.execute('run', { suite: 'unit' }, undefined, undefined, ctx);
  assert.equal(result.isError, true); assert.equal(result.details.length, 1);
  assert.equal(result.details[0].suite, 'prepare'); assert.equal(result.details[0].exitCode, 4);
  const status = await tools.pipeline_status.execute('status', {}, undefined, undefined, ctx);
  assert.equal(status.details.prepare.outcome, 'failed'); assert.equal(status.details.suites.unit.outcome, 'never');
});

test('prepare does not overwrite an ordinary suite named prepare', async t => {
  const f = await fixture(t), { Pipeline } = load(), p = new Pipeline(f.root, f.cache), c = preparedConfig();
  c.suites.prepare = command('console.log("ordinary suite")');
  await p.configure(c, approve); await p.run('prepare');
  assert.match((await p.status()).suites.prepare.output, /ordinary suite/);
  assert.equal((await p.status()).prepare.outcome, 'passed');
});
