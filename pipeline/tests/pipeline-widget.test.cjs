const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { load, fixture, config, approve, waitFor } = require('./pipeline-helpers.cjs');
const plain = { fg: (_color, text) => text };
const now = Date.parse('2026-10-14T12:00:00Z');
const result = (outcome, minutes = 3, stale = false) => ({ outcome, stale, startedAt: new Date(now - minutes * 60000).toISOString(), finishedAt: new Date(now - minutes * 60000).toISOString() });

test('compact widget collapses healthy suites, preparation and jobs into two lines', () => {
  const { renderWidget } = load('pipeline/widget.ts');
  const status = { configured: true, prepare: result('passed', 7200), suites: {
    build: result('passed'), unit: result('passed'), e2e: result('passed', 2), smoke: result('passed', 2),
  }, github: { workflows: [{ name: 'Tests', status: 'completed', conclusion: 'success',
    updatedAt: new Date(now - 86400000).toISOString(),
    jobs: ['build', 'unit', 'e2e', 'sonar'].map(name => ({ name, status: 'completed', conclusion: 'success' })),
  }] } };
  assert.deepEqual(Array.from(renderWidget(status, plain, 120, now)), [
    '✓ Local 4/4 · 2m ago', '✓ GitHub Tests · 4/4 · 1d ago',
  ]);
});

test('compact widget expands only attention-needed local results and hides idle preparation', () => {
  const { renderWidget } = load('pipeline/widget.ts');
  const status = { configured: true, prepare: { outcome: 'never', stale: false }, suites: {
    unit: result('passed'), e2e: result('failed', 2),
  } };
  assert.deepEqual(Array.from(renderWidget(status, plain, 120, now)), [
    '✗ Local 1/2 · 2m ago', '  ✗ e2e 2m ago',
  ]);
  status.prepare = result('failed');
  assert.match(renderWidget(status, plain, 120, now).join('\n'), /  ✗ prepare/);
  status.prepare = result('running');
  assert.match(renderWidget(status, plain, 120, now).join('\n'), /  › prepare running/);
  status.prepare = result('passed');
  status.suites.e2e = result('passed', 2, true);
  assert.deepEqual(Array.from(renderWidget(status, plain, 120, now)), [
    '⚠ Local 1/2 · stale · 2m ago', '  ⚠ e2e stale (✓ 2m ago)',
  ]);
});

test('compact remote progress hides completed jobs and preserves non-success conclusions', () => {
  const { renderWidget } = load('pipeline/widget.ts');
  const workflow = { name: 'Tests', status: 'in_progress', jobs: [
    { name: 'unit', status: 'completed', conclusion: 'success' },
    { name: 'build', status: 'completed', conclusion: 'skipped' },
    { name: 'sonar', status: 'in_progress' },
  ] };
  const status = { configured: false, suites: {}, github: { workflows: [workflow] } };
  assert.deepEqual(Array.from(renderWidget(status, plain, 120, now)), [
    '◐ GitHub Tests · 2/3 complete', '  ├─ ○ build skipped', '  └─ › sonar running',
  ]);
  workflow.status = 'completed'; workflow.conclusion = 'failure';
  workflow.jobs[2] = { name: 'sonar', status: 'completed', conclusion: 'failure' };
  assert.deepEqual(Array.from(renderWidget(status, plain, 120, now)), [
    '✗ GitHub Tests · 1/3', '  ├─ ○ build skipped', '  └─ ✗ sonar failed',
  ]);
});

test('compact warnings stay on workflow summaries and cached results are muted', () => {
  const { renderWidget } = load('pipeline/widget.ts');
  const styled = [], theme = { fg: (color, text) => { styled.push([color, text]); return text; } };
  const status = { configured: false, suites: {}, github: {
    stale: true, lastSuccessfulAt: new Date(now - 180000).toISOString(), error: 'timeout', errorKind: 'timeout',
    workflows: [{ name: 'Tests', status: 'completed', conclusion: 'success', jobs: [
      { name: 'unit', status: 'completed', conclusion: 'success' },
    ] }],
  } };
  assert.deepEqual(Array.from(renderWidget(status, theme, 120, now)), ['⚠ GitHub Tests · 1/1 · stale 3m · timeout']);
  assert.ok(styled.some(([color, text]) => color === 'muted' && text.includes('Tests')));
  status.github.workflows = [];
  assert.deepEqual(Array.from(renderWidget(status, plain, 120, now)), ['⚠ GitHub · unavailable · timeout']);
});

test('compact widget preserves job errors, unknown states, sanitization and narrow widths', () => {
  const { renderWidget } = load('pipeline/widget.ts');
  const status = { configured: false, suites: {}, github: { workflows: [
    { name: 'Tests', status: 'completed', conclusion: 'success', jobsError: 'Jobs unavailable' },
    { name: 'Other\x1b\n漢字', status: 'completed', conclusion: 'future' },
  ] } };
  const text = renderWidget(status, plain, 120, now).join('\n');
  assert.match(text, /⚠ GitHub Tests.*\n  └─ ⚠ Jobs unavailable/);
  assert.match(text, /○ GitHub Other.*future/);
  assert.doesNotMatch(text, /\x1b/);
  for (const width of [0, 1, 5, 20]) {
    assert.ok(renderWidget(status, plain, width, now).every(line => require('@earendil-works/pi-tui').visibleWidth(line) <= width));
  }
});

test('widget hides completely for absent or empty configuration', () => {
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
  assert.equal(renderWidget({ configured: false, suites: {} }, plain, 80, now).length, 0);
  assert.equal(renderWidget({ configured: true, suites: {} }, plain, 80, now).length, 0);
});

test('local rows have no heading when GitHub is absent or empty', () => {
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
  for (const github of [undefined, { workflows: [] }]) {
    const status = { configured: true, suites: { unit: result('passed') }, prepare: result('passed'), github };
    assert.deepEqual(Array.from(renderWidget(status, plain, 120, now)), ['✓ prepare 3m ago', '✓ unit 3m ago']);
  }
});

test('visible GitHub sections use compact muted labels and label existing local rows', () => {
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
  for (const github of [{ workflows: [{ name: 'Tests', status: 'queued' }] }, { workflows: [], error: 'GitHub unavailable' }]) {
    for (const configured of [true, false]) {
      const styled = [];
      const theme = { fg: (color, text) => { styled.push([color, text]); return text; } };
      const status = { configured, suites: configured ? { unit: result('passed') } : {}, github };
      const lines = renderWidget(status, theme, 120, now);
      assert.equal(lines[0], configured ? 'Local' : 'GitHub');
      assert.equal(lines.includes('Local'), configured);
      assert.ok(styled.some(([color, text]) => color === 'muted' && text === 'GitHub'));
      if (configured) assert.ok(styled.some(([color, text]) => color === 'muted' && text === 'Local'));
      assert.ok(lines.every(line => !line.startsWith('#')));
    }
  }
});

test('remote-only widget shows latest outcomes without local configuration or freshness warnings', () => {
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
  const status = { configured: false, suites: {}, github: { repository: 'owner/repo', branch: 'main', checkedAt: new Date(now).toISOString(), workflows: [
    { name: 'Tests', status: 'completed', conclusion: 'success', updatedAt: new Date(now - 3600000).toISOString() },
    { name: 'Build', status: 'in_progress' }, { name: 'Lint', status: 'queued' }, { name: 'Unused', status: 'never' },
  ] } };
  const text = renderWidget(status, plain, 120, now).join('\n');
  assert.match(text, /GitHub\n✓ Tests passed 1h ago/);
  assert.match(text, /› Build running/);
  assert.match(text, /Lint queued/);
  assert.match(text, /Unused never/);
  assert.doesNotMatch(text, /stale|HEAD|local changes/);
  status.github.workflows = [];
  assert.equal(renderWidget(status, plain, 120, now).length, 0);
});

test('remote errors do not hide local suites and unknown conclusions never use success color', () => {
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
  const colors = [];
  const theme = { fg: (color, text) => { colors.push(color); return text; } };
  const status = { configured: true, suites: { unit: result('passed') }, github: { workflows: [], error: 'GitHub Actions unavailable: check gh auth login.' } };
  assert.match(renderWidget(status, theme, 120, now).join('\n'), /✓ unit.*\n.*GitHub Actions unavailable/s);
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'action_required', 'unknown']) {
    colors.length = 0;
    const remote = { configured: false, suites: {}, github: { workflows: [{ name: 'Tests', status: 'completed', conclusion }] } };
    assert.equal(renderWidget(remote, theme, 120, now)[0], 'GitHub');
    assert.ok(renderWidget(remote, theme, 120, now)[1].includes('Tests'));
    assert.equal(colors.includes('success'), false);
    assert.ok(renderWidget(remote, theme, 5, now).every(line => require('@earendil-works/pi-tui').visibleWidth(line) <= 5));
  }
});

test('workflow groups have visible job branches and separate last-child markers', () => {
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
  const job = (name, conclusion = 'success') => ({ name, status: 'completed', conclusion });
  const status = { configured: false, suites: {}, github: { workflows: [
    { ...job('Server package'), updatedAt: new Date(now - 51 * 60000).toISOString(), jobs: [job('swift-packed'), job('package')] },
    { ...job('Tests', 'failure'), updatedAt: new Date(now - 49 * 60000).toISOString(), jobs: [job('unit'), job('build'), job('swift-integration'), job('e2e'), job('sonar', 'failure')] },
    { ...job('Single'), jobs: [job('only')] },
    { ...job('Empty'), jobs: [] },
  ] } };
  const expected = [
    'GitHub',
    '✓ Server package passed 51m ago',
    '  ├─ ✓ swift-packed passed',
    '  └─ ✓ package passed',
    '✗ Tests failed 49m ago',
    '  ├─ ✓ unit passed',
    '  ├─ ✓ build passed',
    '  ├─ ✓ swift-integration passed',
    '  ├─ ✓ e2e passed',
    '  └─ ✗ sonar failed',
    '✓ Single passed',
    '  └─ ✓ only passed',
    '✓ Empty passed',
  ];
  assert.deepEqual(Array.from(renderWidget(status, plain, 120, now)), expected);
  const colored = { fg: (_color, text) => `\x1b[31m${text}\x1b[0m` };
  const { stripVTControlCharacters } = require('node:util');
  assert.deepEqual(Array.from(renderWidget(status, colored, 120, now), stripVTControlCharacters), expected);
});

test('jobs render below their workflow with status, matrix names and no repeated age', () => {
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
  const colors = [];
  const theme = { fg: (color, text) => { colors.push([color, text]); return text; } };
  const jobs = [
    { name: 'build (node 24)', status: 'completed', conclusion: 'success' },
    { name: 'e2e', status: 'completed', conclusion: 'failure' },
    { name: 'sonar', status: 'completed', conclusion: 'skipped' },
    { name: 'unit', status: 'in_progress' },
    { name: 'lint', status: 'queued' },
    { name: 'unknown', status: 'completed', conclusion: 'future' },
  ];
  const status = { configured: false, suites: {}, github: { workflows: [
    { name: 'Tests', status: 'completed', conclusion: 'failure', updatedAt: new Date(now - 60000).toISOString(), jobs },
    { name: 'Deploy', status: 'queued', jobs: [] },
  ] } };
  const lines = renderWidget(status, theme, 120, now);
  assert.equal(lines.join('\n'), 'GitHub\n✗ Tests failed 1m ago\n  ├─ ✓ build (node 24) passed\n  ├─ ✗ e2e failed\n  ├─ ○ sonar skipped\n  ├─ › unit running\n  ├─ ○ lint queued\n  └─ ○ unknown future\n○ Deploy queued');
  assert.ok(colors.some(([color, text]) => color === 'error' && text.includes('e2e')));
  assert.equal(colors.some(([color, text]) => color === 'success' && text.includes('unknown')), false);
  jobs[0].name = 'build\x1b[31m\n漢字';
  for (const width of [1, 5, 20, 80]) {
    const rendered = renderWidget(status, plain, width, now);
    assert.ok(rendered.every(line => require('@earendil-works/pi-tui').visibleWidth(line) <= width));
    assert.ok(rendered.every(line => !/[\x00-\x1f\x7f-\x9f]/.test(require('node:util').stripVTControlCharacters(line))));
    assert.ok(rendered.every(line => !line.includes('\x1b[31m')));
  }
});

test('stale GitHub heading uses successful-fetch age and dims cached workflows and jobs', () => {
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
  const styled = [];
  const theme = { fg: (color, text) => { styled.push([color, text]); return text; } };
  const status = { configured: true, suites: { unit: result('passed') }, github: {
    stale: true, lastSuccessfulAt: new Date(now - 180000).toISOString(), checkedAt: new Date(now).toISOString(),
    error: 'GitHub Actions unavailable: request timed out.', errorKind: 'timeout',
    workflows: [{ name: 'Tests', status: 'completed', conclusion: 'success', updatedAt: new Date(now - 3600000).toISOString(),
      jobs: [{ name: 'unit', status: 'completed', conclusion: 'failure' }] }],
  } };
  const lines = Array.from(renderWidget(status, theme, 120, now));
  assert.deepEqual(lines, ['Local', '✓ unit 3m ago', '⚠ GitHub · stale 3m · timeout', '✓ Tests passed 1h ago', '  └─ ✗ unit failed']);
  assert.ok(styled.some(([color, text]) => color === 'warning' && text === lines[2]));
  for (const line of lines.slice(3)) assert.ok(styled.some(([color, text]) => color === 'muted' && text === line));
  assert.ok(renderWidget(status, plain, 120, now + 60000).includes('⚠ GitHub · stale 4m · timeout'));
  for (const width of [1, 5, 20]) assert.ok(renderWidget(status, theme, width, now).every(line => require('@earendil-works/pi-tui').visibleWidth(line) <= width));
  delete status.github.error; delete status.github.stale; delete status.github.errorKind;
  assert.ok(renderWidget(status, plain, 120, now).includes('GitHub'));
  assert.doesNotMatch(renderWidget(status, plain, 120, now).join('\n'), /stale|timeout/);
});

test('initial classified GitHub errors use a compact unavailable heading without stale rows', () => {
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
  const status = { configured: false, suites: {}, github: { workflows: [], error: 'Request timed out.', errorKind: 'timeout' } };
  assert.deepEqual(Array.from(renderWidget(status, plain, 120, now)), ['⚠ GitHub · unavailable · timeout']);
});

test('job-fetch warning keeps workflow status and local rows visible', () => {
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
  const status = { configured: true, suites: { unit: result('passed') }, github: { workflows: [
    { name: 'Tests', status: 'completed', conclusion: 'failure', jobsError: 'Jobs unavailable: check connection and repository access.' },
  ] } };
  assert.equal(renderWidget(status, plain, 120, now).join('\n'), 'Local\n✓ unit 3m ago\nGitHub\n✗ Tests failed\n  └─ ⚠ Jobs unavailable: check connection and repository access.');
});

test('each suite gets its own line with age, outcome and stale previous pass', () => {
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
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
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
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
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
  const status = { configured: true, suites: { unit: { outcome: 'running', stale: false, startedAt: new Date(now - 24000).toISOString() }, integration: result('cancelled'), e2e: result('timed-out') } };
  const text = renderWidget(status, plain, 180, now).join('\n');
  assert.match(text, /› unit running 24s/); assert.match(text, /integration cancelled/); assert.match(text, /e2e timed out/);
  assert.match(renderWidget(status, plain, 180, now + 1000).join('\n'), /running 25s/);
});

test('narrow widths and wide characters never overflow terminal columns', () => {
  const { renderStatus: renderWidget } = load('pipeline/widget.ts');
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
  const { default: extension } = load('pipeline/index.ts', { typebox: { Type }, '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_p, fn) => fn() } });
  const events = {}, widgets = [];
  extension({ registerTool() {}, registerCommand() {}, on(name, fn) { events[name] = fn; } });
  const ctx = { cwd: f.root, mode: 'rpc', hasUI: true, isIdle: () => true, ui: { theme: plain, setWidget: (_key, content) => widgets.push(content) } };
  t.after(() => events.session_shutdown({}, ctx));
  await events.session_start({}, ctx);
  await waitFor(() => widgets.at(-1)?.some(line => line.includes('✓ Local 1/1')));
  assert.match(widgets.at(-1).join('\n'), /✓ Local 1\/1/);
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
  const { default: extension } = load('pipeline/index.ts', { typebox: { Type }, '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_p, fn) => fn() } });
  const events = {}, widgets = [];
  extension({ registerTool() {}, registerCommand() {}, on(name, fn) { events[name] = fn; } });
  const ctx = { cwd: f.root, mode: 'tui', hasUI: true, isIdle: () => true, ui: { theme: plain, setWidget: (_key, value) => widgets.push(value) } };
  t.after(() => events.session_shutdown({}, ctx));
  await events.session_start({}, ctx);
  await waitFor(() => typeof widgets.at(-1) === 'function');
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
  const { default: extension } = load('pipeline/index.ts', { typebox: { Type }, '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_p, fn) => fn() } });
  const events = {}, widgets = [];
  extension({ registerTool() {}, registerCommand() {}, on(name, fn) { events[name] = fn; } });
  const ctx = { cwd: f.root, mode: 'rpc', hasUI: true, isIdle: () => true, ui: { theme: plain, setWidget: (_key, value) => widgets.push(value) } };
  const starting = events.session_start({}, ctx);
  await events.session_shutdown({}, ctx);
  await starting;
  assert.equal(widgets.length, 0, 'shutdown must invalidate the awaited initialization');
});
