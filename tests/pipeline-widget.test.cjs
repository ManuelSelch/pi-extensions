const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { load, fixture, config, approve } = require('./pipeline-helpers.cjs');
const plain = { fg: (_color, text) => text };
const now = Date.parse('2026-10-14T12:00:00Z');
const result = (outcome, minutes = 3, stale = false) => ({ outcome, stale, startedAt: new Date(now - minutes * 60000).toISOString(), finishedAt: new Date(now - minutes * 60000).toISOString() });

test('widget hides completely for absent or empty configuration', () => {
  const { renderWidget } = load('pipeline/widget.ts');
  assert.equal(renderWidget({ configured: false, suites: {} }, plain, 80, now).length, 0);
  assert.equal(renderWidget({ configured: true, suites: {} }, plain, 80, now).length, 0);
});

test('remote-only widget shows latest outcomes without local configuration or freshness warnings', () => {
  const { renderWidget } = load('pipeline/widget.ts');
  const status = { configured: false, suites: {}, github: { repository: 'owner/repo', branch: 'main', checkedAt: new Date(now).toISOString(), workflows: [
    { name: 'Tests', status: 'completed', conclusion: 'success', updatedAt: new Date(now - 3600000).toISOString() },
    { name: 'Build', status: 'in_progress' }, { name: 'Lint', status: 'queued' }, { name: 'Unused', status: 'never' },
  ] } };
  const text = renderWidget(status, plain, 120, now).join('\n');
  assert.match(text, /✓ GitHub · Tests passed 1h ago/);
  assert.match(text, /› GitHub · Build running/);
  assert.match(text, /GitHub · Lint queued/);
  assert.match(text, /GitHub · Unused never/);
  assert.doesNotMatch(text, /stale|HEAD|local changes/);
  status.github.workflows = [];
  assert.equal(renderWidget(status, plain, 120, now).length, 0);
});

test('remote errors do not hide local suites and unknown conclusions never use success color', () => {
  const { renderWidget } = load('pipeline/widget.ts');
  const colors = [];
  const theme = { fg: (color, text) => { colors.push(color); return text; } };
  const status = { configured: true, suites: { unit: result('passed') }, github: { workflows: [], error: 'GitHub Actions unavailable: check gh auth login.' } };
  assert.match(renderWidget(status, theme, 120, now).join('\n'), /✓ unit.*\n.*GitHub Actions unavailable/s);
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'action_required', 'unknown']) {
    colors.length = 0;
    const remote = { configured: false, suites: {}, github: { workflows: [{ name: 'Tests', status: 'completed', conclusion }] } };
    assert.ok(renderWidget(remote, theme, 120, now)[0].includes('GitHub · Tests'));
    assert.equal(colors.includes('success'), false);
    assert.ok(renderWidget(remote, theme, 5, now).every(line => require('@earendil-works/pi-tui').visibleWidth(line) <= 5));
  }
});

test('each suite gets its own line with age, outcome and stale previous pass', () => {
  const { renderWidget } = load('pipeline/widget.ts');
  const status = { configured: true, suites: { unit: result('passed'), integration: result('failed', 12), e2e: { outcome: 'never', stale: false } } };
  assert.equal(renderWidget(status, plain, 120, now).join('\n'), '✓ unit 3m ago\n✗ integration 12m ago\n○ e2e never');
  status.suites.unit.stale = true;
  const colors = [];
  const theme = { fg: (color, text) => { colors.push([color, text]); return text; } };
  const text = renderWidget(status, theme, 120, now).join('\n');
  assert.match(text, /⚠ unit stale \(✓ 3m ago\)/);
  assert.equal(colors.some(([color, text]) => color === 'success' && text.includes('unit')), false);
  assert.doesNotMatch(text, /approval|configur/i);
});

test('completed runs show just now below a minute, then coarse ages, including stale results', () => {
  const { renderWidget } = load('pipeline/widget.ts');
  for (const outcome of ['passed', 'failed', 'cancelled', 'timed-out']) {
    const status = { configured: true, suites: { unit: result(outcome, 52 / 60) } };
    assert.match(renderWidget(status, plain, 120, now).join('\n'), /just now/);
    assert.doesNotMatch(renderWidget(status, plain, 120, now).join('\n'), /52s|just now ago/);
    status.suites.unit.stale = true;
    assert.match(renderWidget(status, plain, 120, now).join('\n'), /stale .*just now/);
  }
  for (const [seconds, expected] of [[0, 'just now'], [59, 'just now'], [60, '1m ago'], [120, '2m ago'], [3600, '1h ago']]) {
    const status = { configured: true, suites: { unit: result('passed', seconds / 60) } };
    assert.ok(renderWidget(status, plain, 120, now).join('\n').endsWith(expected));
  }
});

test('running, cancelled and timeout stay distinct; elapsed time and theme are evaluated on rendering', () => {
  const { renderWidget } = load('pipeline/widget.ts');
  const status = { configured: true, suites: { unit: { outcome: 'running', stale: false, startedAt: new Date(now - 24000).toISOString() }, integration: result('cancelled'), e2e: result('timed-out') } };
  const text = renderWidget(status, plain, 180, now).join('\n');
  assert.match(text, /› unit running 24s/); assert.match(text, /integration cancelled/); assert.match(text, /e2e timed out/);
  assert.match(renderWidget(status, plain, 180, now + 1000).join('\n'), /running 25s/);
});

test('narrow widths and wide characters never overflow terminal columns', () => {
  const { renderWidget } = load('pipeline/widget.ts');
  const { visibleWidth } = require('@earendil-works/pi-tui');
  const status = { configured: true, suites: { 'unit漢字': result('passed'), 'long-suite-name': result('failed'), e2e: result('timed-out') } };
  const theme = { fg: (_color, text) => `\x1b[31m${text}\x1b[0m` };
  for (const width of [1, 5, 12, 30, 80, 200]) {
    const lines = renderWidget(status, theme, width, now);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    assert.ok(lines.every(line => visibleWidth(line) > 0));
  }
});

test('extension restores persisted results, refreshes stale code and clears hidden widget at shutdown', async t => {
  const f = await fixture(t); const { Pipeline } = load();
  const before = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = f.cache;
  t.after(() => { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; });
  const p = new Pipeline(f.root);
  await p.configure(config(), approve); await p.run('unit');
  const Type = (await import('typebox')).Type;
  const { default: extension } = load('pipeline.ts', { typebox: { Type }, '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_p, fn) => fn() } });
  const events = {}, widgets = [];
  extension({ registerTool() {}, registerCommand() {}, on(name, fn) { events[name] = fn; } });
  const ctx = { cwd: f.root, mode: 'rpc', hasUI: true, isIdle: () => true, ui: { theme: plain, setWidget: (_key, content) => widgets.push(content) } };
  t.after(() => events.session_shutdown({}, ctx));
  await events.session_start({}, ctx);
  assert.match(widgets.at(-1).join('\n'), /✓ unit/);
  await fs.writeFile(path.join(f.root, 'source.txt'), 'changed');
  await events.tool_execution_end({ toolName: 'write' }, ctx);
  assert.match(widgets.at(-1).join('\n'), /unit stale/);
  await fs.rm(f.configPath);
  await events.tool_execution_end({ toolName: 'bash' }, ctx);
  assert.equal(widgets.at(-1), undefined);
  await events.session_shutdown({}, ctx);
  assert.equal(widgets.at(-1), undefined);
});

test('TUI widget factory uses current theme and terminal width; non-UI sessions stay inactive', async t => {
  const f = await fixture(t); const Type = (await import('typebox')).Type;
  await fs.mkdir(path.dirname(f.configPath)); await fs.writeFile(f.configPath, JSON.stringify(config()));
  const { default: extension } = load('pipeline.ts', { typebox: { Type }, '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_p, fn) => fn() } });
  const events = {}, widgets = [];
  extension({ registerTool() {}, registerCommand() {}, on(name, fn) { events[name] = fn; } });
  const ctx = { cwd: f.root, mode: 'tui', hasUI: true, isIdle: () => true, ui: { theme: plain, setWidget: (_key, value) => widgets.push(value) } };
  t.after(() => events.session_shutdown({}, ctx));
  await events.session_start({}, ctx);
  const factory = widgets.at(-1); assert.equal(typeof factory, 'function');
  let colors = [];
  const component = factory({}, { fg: (color, text) => { colors.push(color); return text; } });
  assert.match(component.render(80).join('\n'), /○ unit never/);
  assert.ok(colors.includes('muted'));
  assert.ok(component.render(10).every(line => require('@earendil-works/pi-tui').visibleWidth(line) <= 10));
  component.invalidate();
  await events.session_shutdown({}, ctx);
  const count = widgets.length;
  await events.session_start({}, { ...ctx, hasUI: false });
  await events.agent_settled({}, { ...ctx, hasUI: false });
  assert.equal(widgets.length, count);
});

test('shutdown during async session initialization never creates a late widget or polling timer', async t => {
  const f = await fixture(t); const Type = (await import('typebox')).Type;
  const { default: extension } = load('pipeline.ts', { typebox: { Type }, '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_p, fn) => fn() } });
  const events = {}, widgets = [];
  extension({ registerTool() {}, registerCommand() {}, on(name, fn) { events[name] = fn; } });
  const ctx = { cwd: f.root, mode: 'rpc', hasUI: true, isIdle: () => true, ui: { theme: plain, setWidget: (_key, value) => widgets.push(value) } };
  const starting = events.session_start({}, ctx);
  await events.session_shutdown({}, ctx);
  await starting;
  assert.equal(widgets.length, 0, 'shutdown must invalidate the awaited initialization');
});
