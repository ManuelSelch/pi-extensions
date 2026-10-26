const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, config, waitFor } = require('./pipeline-helpers.cjs');

test('real Pi loader integrates config approval, hidden/populated widgets and silent after-agent execution', async t => {
  const f = await fixture(t);
  const before = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = f.cache;
  t.after(() => { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; });
  const { loadExtensions } = await import('../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js');
  const result = await loadExtensions([path.resolve(__dirname, '..', 'index.ts')], f.root);
  assert.deepEqual(result.errors, []); assert.equal(result.extensions.length, 1);
  const ext = result.extensions[0], widgets = [];
  assert.deepEqual([...ext.tools.keys()].sort(), ['pipeline_configure', 'pipeline_run', 'pipeline_status']);
  assert.ok(ext.commands.has('pipeline'));
  let confirmations = 0, notifications = 0;
  const ctx = { cwd: f.root, mode: 'rpc', hasUI: true, isIdle: () => true, ui: {
    theme: { fg: (_color, text) => text }, setWidget: (_key, content) => widgets.push(content),
    confirm: async () => { confirmations++; return true; }, notify: () => { notifications++; },
  } };
  async function event(name) { for (const handler of ext.handlers.get(name) ?? []) await handler({ type: name }, ctx); }
  t.after(() => event('session_shutdown'));
  await event('session_start'); assert.equal(widgets.at(-1), undefined);
  const c = config('console.log("actual Pi loader auto passed")'); c.suites.unit.auto = 'after-agent';
  c.prepare = { command: [process.execPath, '-e', 'console.log("actual Pi loader preparation passed")'] };
  const saved = await ext.tools.get('pipeline_configure').definition.execute('config', { config: c }, undefined, undefined, ctx);
  assert.equal(saved.details.saved, true);
  await event('agent_start'); await event('agent_settled');
  await waitFor(() => widgets.some(lines => lines?.join('\n').includes('✓ Local 1/1')));
  const status = await ext.tools.get('pipeline_status').definition.execute('status', {}, undefined, undefined, ctx);
  assert.equal(status.details.suites.unit.outcome, 'passed'); assert.equal(status.details.suites.unit.stale, false);
  assert.equal(status.details.prepare.outcome, 'passed');
  assert.ok(widgets.every(lines => !lines?.join('\n').includes('✓ prepare')), 'successful preparation stays hidden');
  const rerun = await ext.tools.get('pipeline_run').definition.execute('run', { suite: 'unit' }, undefined, undefined, ctx);
  assert.equal(rerun.isError, false);
  assert.deepEqual(rerun.details.map(result => result.suite), ['unit']);
  assert.equal(confirmations, 1); assert.equal(notifications, 0);
  await event('session_shutdown'); assert.equal(widgets.at(-1), undefined);
});
