const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, fixture } = require('./pipeline-helpers.cjs');

async function driver(t, Reader) {
  const f = await fixture(t);
  const tools = {}, events = {}, commands = {}, widgets = [], notices = [];
  const Type = (await import('typebox')).Type;
  const { default: extension } = load('pipeline.ts', {
    typebox: { Type }, './pipeline/github.ts': { GitHubActions: Reader },
    '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_path, fn) => fn() },
  });
  extension({ registerTool(tool) { tools[tool.name] = tool; }, registerCommand(name, command) { commands[name] = command; }, on(name, fn) { events[name] = fn; } });
  const ctx = { cwd: f.root, mode: 'rpc', hasUI: true, isIdle: () => true, ui: { theme: { fg: (_color, text) => text }, setWidget: (_key, value) => widgets.push(value), notify: text => notices.push(text) } };
  t.after(() => events.session_shutdown({}, ctx));
  return { tools, events, commands, widgets, notices, ctx };
}
const remote = { repository: 'owner/repo', branch: 'main', checkedAt: '2026-01-01T00:00:00Z', workflows: [{ name: 'Tests', status: 'in_progress', url: 'https://github.com/owner/repo/actions/runs/1', jobs: [{ name: 'e2e', status: 'completed', conclusion: 'failure', url: 'https://github.com/owner/repo/actions/runs/1/job/2' }] }] };

test('remote-only project exposes status via tool, command and widget using a shared reader', async t => {
  let instances = 0, stopped = 0;
  class Reader { constructor() { instances++; } async read() { return remote; } stop() { stopped++; } }
  const d = await driver(t, Reader);
  await d.events.session_start({}, d.ctx);
  assert.match(d.widgets.at(-1).join('\n'), /## GitHub\n› Tests running/);
  const result = await d.tools.pipeline_status.execute('id', {}, undefined, undefined, d.ctx);
  assert.equal(result.details.configured, false);
  assert.equal(result.details.github.workflows[0].url, remote.workflows[0].url);
  assert.equal(result.details.github.workflows[0].jobs[0].url, remote.workflows[0].jobs[0].url);
  assert.match(d.widgets.at(-1).join('\n'), /\n  ✗ e2e failed/);
  await d.commands.pipeline.handler('status', d.ctx);
  assert.match(d.notices.at(-1), /## GitHub\n› Tests running/);
  assert.match(d.notices.at(-1), /\n  ✗ e2e failed/);
  assert.equal(instances, 1);
  await d.events.session_shutdown({}, d.ctx);
  assert.equal(d.widgets.at(-1), undefined);
  assert.equal(stopped, 1);
});

test('shutdown cancels an awaited remote refresh and cannot resurrect the widget', async t => {
  let resolveRead;
  class Reader { read() { return new Promise(resolve => { resolveRead = resolve; }); } stop() { resolveRead?.(remote); } }
  const d = await driver(t, Reader);
  const starting = d.events.session_start({}, d.ctx);
  for (let i = 0; i < 100 && !resolveRead; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(resolveRead);
  await d.events.session_shutdown({}, d.ctx);
  await starting;
  assert.ok(d.widgets.every(value => value === undefined));
});

test('status arriving after shutdown cannot start a new remote reader', async t => {
  let created = 0;
  class Reader { constructor() { created++; } async read() { return remote; } stop() {} }
  const d = await driver(t, Reader);
  await d.events.session_shutdown({}, d.ctx);
  await d.tools.pipeline_status.execute('id', {}, undefined, undefined, d.ctx);
  assert.equal(created, 0);
});

test('non-UI status still reads GitHub without starting monitor timers', async t => {
  class Reader { async read() { return remote; } stop() {} }
  const d = await driver(t, Reader);
  const ctx = { ...d.ctx, hasUI: false };
  await d.events.session_start({}, ctx);
  assert.equal(d.widgets.length, 0);
  const result = await d.tools.pipeline_status.execute('id', {}, undefined, undefined, ctx);
  assert.equal(result.details.github.repository, 'owner/repo');
});
