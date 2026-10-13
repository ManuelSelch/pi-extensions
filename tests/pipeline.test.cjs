const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { load, fixture, config, approve, waitFor } = require('./pipeline-helpers.cjs');

test('validates command arrays, names, relative cwd and unknown configuration fields', () => {
  const { validateConfig } = load();
  assert.equal(validateConfig(config()).suites.unit.auto, 'manual');
  for (const value of [
    { version: 2, suites: {} }, { version: 1, suites: { '../evil': { command: ['x'] } } },
    { version: 1, suites: { unit: { command: 'npm test' } } },
    { version: 1, suites: { unit: { command: ['x'], cwd: '../outside' } } },
    { version: 1, suites: { unit: { command: ['x'], timeoutSeconds: 0 } } },
    { version: 1, suites: { unit: { command: ['x'], typo: true } } },
  ]) assert.throws(() => validateConfig(value));
});

test('confirmation rejection leaves absent/existing config unchanged; acceptance persists local approval', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  assert.equal(await p.configure(config(), async text => { assert.match(text, /Before:.*none/s); return false; }), false);
  await assert.rejects(fs.readFile(f.configPath), { code: 'ENOENT' });
  await p.configure(config(), approve);
  const before = await fs.readFile(f.configPath, 'utf8');
  assert.equal(await p.configure(config('process.exit(1)'), async () => false), false);
  assert.equal(await fs.readFile(f.configPath, 'utf8'), before);
  assert.equal(await new Pipeline(f.root, f.cache).isApproved(), true);
  await fs.writeFile(f.configPath, JSON.stringify(config('process.exit(2)')));
  assert.equal(await p.isApproved(), false);
});

test('requires UI and never approves a file modified during confirmation', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await assert.rejects(p.configure(config()), /approval.*required/i);
  await p.configure(config(), approve);
  await assert.rejects(p.configure(config('process.exit(1)'), async () => {
    await fs.writeFile(f.configPath, JSON.stringify(config('process.exit(2)'))); return true;
  }), /changed.*review/i);
  assert.equal(await p.isApproved(), false);
});

test('working-directory symlinks cannot escape the project', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await fs.symlink(f.cache.replace(/cache$/, ''), path.join(f.root, 'outside'));
  const c = config(); c.suites.unit.cwd = 'outside';
  await assert.rejects(p.configure(c, approve), /outside.*project/i);
});

test('runs suites serially, preserves full logs and bounded output, and persists results', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const c = config('console.log("x".repeat(40000)); console.log(process.cwd())');
  c.suites.integration = { command: [process.execPath, '-e', 'process.exit(3)'] };
  await p.configure(c, approve);
  const results = await p.run('all');
  assert.equal(results.length, 2);
  assert.equal(results.find(r => r.suite === 'integration').outcome, 'failed');
  const result = results.find(r => r.suite === 'unit');
  assert.equal(result.outcome, 'passed'); assert.equal(result.exitCode, 0);
  assert.ok(result.output.length <= 16384);
  assert.match(await fs.readFile(result.logPath, 'utf8'), /x{40000}/);
  assert.match(result.output, /project with spaces/);
  const status = await new Pipeline(f.root, f.cache).status();
  assert.equal(status.suites.unit.outcome, 'passed');
  assert.equal(status.suites.unit.stale, false);
  assert.ok(status.suites.unit.durationMs >= 0);
});

test('requires execution approval for external commands and refuses rejected changes', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await p.configure(config(), approve);
  const next = config('console.log("new")'); await fs.writeFile(f.configPath, JSON.stringify(next));
  await assert.rejects(p.run('unit'), /approval.*required/i);
  await assert.rejects(p.run('unit', { confirm: async () => false }), /rejected/i);
  assert.equal((await p.run('unit', { confirm: approve }))[0].outcome, 'passed');
});

test('tracks never-run, source changes, generated artifacts, and changes during execution', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await fs.writeFile(path.join(f.root, 'source.txt'), 'before');
  await p.configure(config('setTimeout(() => {}, 150)'), approve);
  assert.equal((await p.status()).suites.unit.outcome, 'never');
  const run = p.run('unit');
  await waitFor(async () => (await p.status()).suites.unit.outcome === 'running');
  await fs.writeFile(path.join(f.root, 'source.txt'), 'after');
  await run;
  assert.equal((await p.status()).suites.unit.stale, true);
  await p.run('unit');
  await fs.mkdir(path.join(f.root, 'coverage'));
  await fs.writeFile(path.join(f.root, 'coverage', 'generated.txt'), 'output');
  assert.equal((await p.status()).suites.unit.stale, false);
  await fs.writeFile(path.join(f.root, 'source.txt'), 'later');
  assert.equal((await p.status()).suites.unit.stale, true);
});

test('enforces timeout, cancellation and exclusive worktree locks', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const c = config('setTimeout(() => {}, 10000)'); c.suites.unit.timeoutSeconds = 0.1;
  await p.configure(c, approve);
  assert.equal((await p.run('unit'))[0].outcome, 'timed-out');
  c.suites.unit.timeoutSeconds = 10; await p.configure(c, approve);
  const controller = new AbortController();
  const run = p.run('unit', { signal: controller.signal });
  await waitFor(async () => (await p.status()).suites.unit.outcome === 'running');
  await assert.rejects(new Pipeline(f.root, f.cache).run('unit'), /busy/i);
  await assert.rejects(p.configure(config(), approve), /busy/i);
  controller.abort(); assert.equal((await run)[0].outcome, 'cancelled');
  await p.configure(config(), approve); // lock released
  assert.equal((await p.run('unit'))[0].outcome, 'passed');
});

test('reports spawn errors as failed runs and isolates worktrees', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const c = config(); c.suites.unit.command = ['definitely-not-a-real-pi-test-executable'];
  await p.configure(c, approve);
  assert.equal((await p.run('unit'))[0].outcome, 'failed');
  const other = path.join(f.root, 'other'); await fs.mkdir(other);
  assert.notEqual(new Pipeline(other, f.cache).storage, p.storage);
  assert.equal((await new Pipeline(other, f.cache).status()).configured, false);
});

test('freshness includes git uncommitted/untracked files, but ignores generated files and respects gitignore', async t => {
  const f = await fixture(t); const { Pipeline, projectRoot } = load(); const p = new Pipeline(f.root, f.cache);
  const { execFileSync } = require('node:child_process');
  execFileSync('git', ['init', '-q', f.root]);
  await fs.writeFile(path.join(f.root, '.gitignore'), 'ignored.txt\ncoverage/\n');
  await fs.writeFile(path.join(f.root, 'tracked.txt'), 'original');
  execFileSync('git', ['add', '.'], { cwd: f.root });
  await p.configure(config(), approve); await p.run('unit');
  await fs.writeFile(path.join(f.root, 'ignored.txt'), 'ignored');
  assert.equal((await p.status()).suites.unit.stale, false);
  await fs.writeFile(path.join(f.root, 'tracked.txt'), 'modified');
  assert.equal((await p.status()).suites.unit.stale, true);
  await p.run('unit'); await fs.writeFile(path.join(f.root, 'untracked.txt'), 'new');
  assert.equal((await p.status()).suites.unit.stale, true);
  await fs.mkdir(path.join(f.root, 'nested'));
  assert.equal(await projectRoot(path.join(f.root, 'nested')), f.root);
});

test('already-aborted runs do not ask for approval or execute commands', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await p.configure(config(), approve);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(p.run('unit', { signal: controller.signal }), /cancelled/i);
  assert.equal((await p.status()).suites.unit.outcome, 'never');
});

test('refuses config changed during execution approval and invalid selections', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await p.configure(config(), approve);
  await fs.writeFile(f.configPath, JSON.stringify(config('process.exit(1)')));
  await assert.rejects(p.run('unit', { confirm: async () => {
    await fs.writeFile(f.configPath, JSON.stringify(config('process.exit(2)'))); return true;
  } }), /changed.*review/);
  await assert.rejects(p.run('missing'), /Unknown/);
  assert.equal(await p.isApproved(), false);
});

test('honours suite cwd, log retrieval and freshness expiry', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await fs.mkdir(path.join(f.root, 'sub'));
  const c = config('console.log(process.cwd())'); c.suites.unit.cwd = 'sub'; c.suites.unit.staleAfterMinutes = 0.000001;
  await p.configure(c, approve); await p.run('unit');
  const logs = await p.logs('unit'); assert.match(logs.output, /\/sub/);
  await new Promise(r => setTimeout(r, 10));
  assert.equal((await p.status()).suites.unit.stale, true);
  await assert.rejects(p.logs('missing'), /No run/);
});

test('new suites named constructor are never-run rather than inherited result properties', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await p.configure(config(), approve); await p.run('unit');
  const c = config(); c.suites.constructor = { command: [process.execPath, '-e', ''] };
  await p.configure(c, approve);
  assert.equal((await p.status()).suites.constructor.outcome, 'never');
});

test('timeout kills the process group including a child that ignores SIGTERM', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const pidFile = path.join(f.root, 'child.pid');
  const childScript = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
  const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], {stdio:'ignore'}); setInterval(() => {}, 1000);`;
  const c = config(parent); c.suites.unit.timeoutSeconds = 0.3;
  await p.configure(c, approve);
  assert.equal((await p.run('unit'))[0].outcome, 'timed-out');
  const pid = Number(await fs.readFile(pidFile, 'utf8'));
  await waitFor(() => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
});

test('extension registers tools and command, uses native approval, and shuts down background runs', async t => {
  const f = await fixture(t);
  const Type = (await import('typebox')).Type;
  const { default: extension } = load('pipeline.ts', {
    typebox: { Type }, '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_path, fn) => fn() },
  });
  const tools = {}, events = {}, commands = {}, notices = [], confirmations = [];
  extension({ registerTool(spec) { tools[spec.name] = spec; }, registerCommand(name, spec) { commands[name] = spec; }, on(name, fn) { events[name] = fn; } });
  assert.deepEqual(Object.keys(tools).sort(), ['pipeline_configure', 'pipeline_run', 'pipeline_status']);
  const ctx = { cwd: f.root, hasUI: true, ui: { confirm: async (...args) => { confirmations.push(args); return true; }, notify: (...args) => notices.push(args) } };
  // Isolate extension state under the fixture cache by redirecting the host agent directory.
  const before = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = f.cache;
  t.after(() => { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; });
  const c = config('setTimeout(() => {}, 10000)');
  const saved = await tools.pipeline_configure.execute('id', { config: c }, undefined, undefined, ctx);
  assert.equal(saved.details.saved, true); assert.equal(confirmations.length, 1);
  assert.match(confirmations[0][1], /Before:.*After:/s);
  await commands.pipeline.handler('run unit', ctx);
  await waitFor(async () => (await tools.pipeline_status.execute('id', {}, undefined, undefined, ctx)).details.suites.unit.outcome === 'running');
  await events.session_shutdown({}, ctx);
  const status = await tools.pipeline_status.execute('id', {}, undefined, undefined, ctx);
  assert.equal(status.details.suites.unit.outcome, 'cancelled');
  assert.equal(confirmations.length, 1);
  assert.equal(commands.pipeline.description.includes('pipeline'), true);
  const completion = notices.find(([text]) => text.includes('unit: cancelled'));
  assert.ok(completion);
  assert.match(completion[0], /^unit: cancelled \(\d+ms\)$/);
  assert.doesNotMatch(completion[0], /Log:|\.log/);
});

test('shutdown dismisses a pending execution approval popup', async t => {
  const f = await fixture(t); const Type = (await import('typebox')).Type;
  const { default: extension } = load('pipeline.ts', {
    typebox: { Type }, '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_path, fn) => fn() },
  });
  const events = {}, commands = {};
  extension({ registerTool() {}, registerCommand(name, spec) { commands[name] = spec; }, on(name, fn) { events[name] = fn; } });
  const before = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = f.cache;
  t.after(() => { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; });
  await fs.mkdir(path.dirname(f.configPath)); await fs.writeFile(f.configPath, JSON.stringify(config()));
  let popupSignal;
  const ctx = { cwd: f.root, hasUI: true, ui: { notify() {}, confirm: (_title, _text, opts) => {
    popupSignal = opts?.signal;
    assert.ok(popupSignal, 'approval dialog must receive cancellation signal');
    return new Promise(resolve => popupSignal.addEventListener('abort', () => resolve(false), { once: true }));
  } } };
  await commands.pipeline.handler('run unit', ctx);
  await waitFor(() => popupSignal !== undefined);
  await events.session_shutdown({}, ctx);
  assert.equal(popupSignal.aborted, true);
});
