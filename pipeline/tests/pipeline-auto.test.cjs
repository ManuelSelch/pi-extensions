const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { load, fixture, config, approve, waitFor } = require('./pipeline-helpers.cjs');
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function fakeClock() {
  let now = 100000, next = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    size: () => timers.size,
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
      }
      now = end; await flush();
    },
  };
}
function autoStatus() {
  const { validateConfig, digest } = load();
  const c = config(); c.suites.unit.auto = 'after-agent';
  const normalized = validateConfig(c);
  return { configured: true, config: normalized, sourceFingerprint: 'code-v1', configFingerprint: digest(JSON.stringify(normalized)), suites: { unit: { outcome: 'never', stale: false } } };
}
function finished(status, clock, outcome = 'passed') {
  status.suites.unit = { suite: 'unit', outcome, sourceFingerprint: status.sourceFingerprint, configFingerprint: status.configFingerprint, changedDuringRun: false, startedAt: new Date(clock.now()).toISOString(), finishedAt: new Date(clock.now()).toISOString(), stale: false };
}

test('only approved opt-in suites run automatically; unchanged outcomes are skipped regardless of age', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const c = config('process.exit(1)'); c.suites.unit.auto = 'after-agent';
  c.suites.e2e = { command: [process.execPath, '-e', 'throw Error("must stay manual")'] };
  await p.configure(c, approve);
  const first = await p.run('all', { automatic: true, cooldownMs: 0 });
  assert.equal(first.length, 1); assert.equal(first[0].suite, 'unit'); assert.equal(first[0].outcome, 'failed');
  assert.equal((await p.run('all', { automatic: true, cooldownMs: 0 })).length, 0);
  assert.equal((await p.status()).suites.e2e.outcome, 'never');
  await fs.writeFile(path.join(f.root, 'source.txt'), 'changed');
  assert.equal((await p.run('all', { automatic: true })).length, 0, 'persisted cooldown suppresses immediate rerun');
  assert.equal((await p.run('all', { automatic: true, cooldownMs: 0 })).length, 1);
  c.suites.unit.command = [process.execPath, '-e', 'console.log("unapproved")'];
  await fs.writeFile(f.configPath, require('yaml').stringify(c));
  let popups = 0;
  assert.equal((await p.run('all', { automatic: true, confirm: async () => { popups++; return true; } })).length, 0);
  assert.equal(popups, 0);
});

test('results/logs stored inside the project never count as source changes or cause automatic reruns', async t => {
  const f = await fixture(t); const { Pipeline } = load();
  const p = new Pipeline(f.root, path.join(f.root, '.pi', 'pipeline-cache'));
  const c = config(); c.suites.unit.auto = 'after-agent'; await p.configure(c, approve);
  const before = (await p.status()).sourceFingerprint;
  await p.run('all', { automatic: true, cooldownMs: 0 });
  assert.equal((await p.status()).sourceFingerprint, before);
  assert.equal((await p.status()).suites.unit.stale, false);
  assert.equal((await p.run('all', { automatic: true, cooldownMs: 0 })).length, 0);
});

test('generated Playwright and Python test reports do not trigger stale results or automatic reruns', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const c = config(); c.suites.unit.auto = 'after-agent'; await p.configure(c, approve);
  await p.run('all', { automatic: true, cooldownMs: 0 });
  for (const dir of ['test-results', 'playwright-report', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.turbo']) {
    await fs.mkdir(path.join(f.root, dir)); await fs.writeFile(path.join(f.root, dir, 'report.json'), '{}');
  }
  assert.equal((await p.status()).suites.unit.stale, false);
  assert.equal((await p.run('all', { automatic: true, cooldownMs: 0 })).length, 0);
});

test('automatic runners recheck source and latest persisted results under the worktree lock', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const c = config(); c.suites.unit.auto = 'after-agent'; await p.configure(c, approve);
  const snapshot = (await p.status()).sourceFingerprint;
  await fs.writeFile(path.join(f.root, 'source.txt'), 'new code');
  assert.equal((await p.run('all', { automatic: true, expectedSourceFingerprint: snapshot, cooldownMs: 0 })).length, 0);
  const current = (await p.status()).sourceFingerprint;
  await p.run('all', { automatic: true, expectedSourceFingerprint: current, cooldownMs: 0 });
  assert.equal((await new Pipeline(f.root, f.cache).run('all', { automatic: true, expectedSourceFingerprint: current, cooldownMs: 0 })).length, 0);
});

test('a newly approved configuration still waits for its own quiet snapshot before automatic execution', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const c = config(); c.suites.unit.auto = 'after-agent'; await p.configure(c, approve);
  const before = await p.status();
  c.suites.unit.command = [process.execPath, '-e', 'console.log("changed config")']; await p.configure(c, approve);
  assert.equal((await p.run('all', { automatic: true, cooldownMs: 0, expectedSourceFingerprint: before.sourceFingerprint, expectedConfigFingerprint: before.configFingerprint })).length, 0);
  const current = await p.status();
  assert.equal((await p.run('all', { automatic: true, cooldownMs: 0, expectedSourceFingerprint: current.sourceFingerprint, expectedConfigFingerprint: current.configFingerprint })).length, 1);
});

test('simultaneous automatic requests in separate sessions cannot duplicate execution', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const c = config('setTimeout(() => {}, 100)'); c.suites.unit.auto = 'after-agent'; await p.configure(c, approve);
  const other = new Pipeline(f.root, f.cache);
  const outcomes = await Promise.allSettled([p.run('all', { automatic: true }), other.run('all', { automatic: true })]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled' && r.value.length === 1).length, 1);
  assert.equal(outcomes.filter(r => r.status === 'rejected' && /busy/.test(String(r.reason))).length, 1);
  assert.equal((await fs.readdir(p.storage)).filter(name => name.endsWith('.log')).length, 1);
  assert.equal((await other.run('all', { automatic: true, cooldownMs: 0 })).length, 0);
});

test('scheduler waits for agent settlement and quiet code, then skips unchanged code silently', async () => {
  const { PipelineMonitor } = load('pipeline/widget.ts');
  const clock = fakeClock(), status = autoStatus(), rendered = []; let runs = 0;
  const monitor = new PipelineMonitor(async () => status, s => rendered.push(s), clock, {
    idle: () => true, cancel() {}, run: async () => { runs++; finished(status, clock); },
  });
  await monitor.start(); await clock.advance(10000); assert.equal(runs, 0);
  await monitor.agentSettled(); await clock.advance(1000); assert.equal(runs, 0);
  status.sourceFingerprint = 'code-v2'; await monitor.refresh();
  await clock.advance(1999); assert.equal(runs, 0);
  await clock.advance(1); assert.equal(runs, 1);
  await clock.advance(120000); assert.equal(runs, 1);
  assert.ok(rendered.length > 1);
  await monitor.stop(); assert.equal(clock.size(), 0);
});

test('scheduler respects cooldown, cancels on a new turn, and does not repeatedly retry a failed unchanged run', async () => {
  const { PipelineMonitor } = load('pipeline/widget.ts'); const clock = fakeClock(), status = autoStatus();
  let runs = 0, cancels = 0;
  const monitor = new PipelineMonitor(async () => status, () => {}, clock, {
    idle: () => true, cancel() { cancels++; }, run: async () => { runs++; finished(status, clock, 'failed'); },
  });
  await monitor.start(); await monitor.agentSettled(); await clock.advance(2000); assert.equal(runs, 1);
  status.sourceFingerprint = 'code-v2'; await monitor.refresh();
  await clock.advance(10000); assert.equal(runs, 1);
  monitor.agentStarted(); assert.equal(cancels, 1);
  await clock.advance(60000); assert.equal(runs, 1);
  await monitor.agentSettled(); await clock.advance(2000); assert.equal(runs, 2);
  await clock.advance(120000); assert.equal(runs, 2);
  await monitor.stop();
});

test('shutdown cancels automatic work, stops all timers and rejects late read resurrection', async () => {
  const { PipelineMonitor } = load('pipeline/widget.ts'); const clock = fakeClock();
  let completeRead; const render = [];
  const monitor = new PipelineMonitor(() => new Promise(resolve => { completeRead = resolve; }), status => render.push(status), clock);
  const starting = monitor.start(); const stopping = monitor.stop();
  completeRead(autoStatus()); await starting; await stopping;
  assert.equal(render.filter(Boolean).length, 0); assert.equal(clock.size(), 0);
  await clock.advance(60000); assert.equal(clock.size(), 0);
});

test('automatic errors are silent and retried with backoff; an active agent prevents execution', async () => {
  const { PipelineMonitor } = load('pipeline/widget.ts'); const clock = fakeClock(), status = autoStatus();
  let runs = 0, idle = false;
  const monitor = new PipelineMonitor(async () => status, () => {}, clock, {
    idle: () => idle, cancel() {}, run: async () => { runs++; throw new Error('busy or unapproved'); },
  });
  await monitor.start(); await monitor.agentSettled(); await clock.advance(10000); assert.equal(runs, 0);
  idle = true; await monitor.refresh(); await flush(); assert.equal(runs, 1);
  await clock.advance(4999); assert.equal(runs, 1); await clock.advance(1); assert.equal(runs, 2);
  await monitor.stop(); assert.equal(clock.size(), 0);
});

// Integration: real fixture process, Pi UI spies, and the actual lifecycle event handlers.
test('after-agent automatic execution refreshes widgets only and shutdown cleans its run', async t => {
  const f = await fixture(t); const { Pipeline } = load();
  const before = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = f.cache;
  t.after(() => { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; });
  const p = new Pipeline(f.root), c = config('setTimeout(() => {}, 10000)'); c.suites.unit.auto = 'after-agent';
  await p.configure(c, approve);
  const Type = (await import('typebox')).Type;
  const { default: extension } = load('pipeline/index.ts', { typebox: { Type }, '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_p, fn) => fn() } });
  const events = {}, widgets = []; let notifications = 0, confirmations = 0;
  extension({ registerTool() {}, registerCommand() {}, on(name, fn) { events[name] = fn; }, sendMessage() { throw new Error('must not send agent messages'); } });
  const ctx = { cwd: f.root, mode: 'rpc', hasUI: true, isIdle: () => true, ui: {
    theme: { fg: (_c, text) => text }, setWidget: (_key, value) => widgets.push(value),
    notify() { notifications++; }, confirm() { confirmations++; throw new Error('automatic run cannot prompt'); },
  } };
  t.after(() => events.session_shutdown({}, ctx));
  await events.session_start({}, ctx);
  await events.agent_start({}, ctx); await events.agent_settled({}, ctx);
  await waitFor(async () => (await p.status()).suites.unit.outcome === 'running');
  await waitFor(() => widgets.some(lines => lines?.join('\n').includes('running')));
  await events.session_shutdown({}, ctx);
  assert.equal((await p.status()).suites.unit.outcome, 'cancelled');
  assert.equal(notifications, 0); assert.equal(confirmations, 0); assert.equal(widgets.at(-1), undefined);
});
