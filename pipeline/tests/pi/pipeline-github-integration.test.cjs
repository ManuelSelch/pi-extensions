const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { load, fixture, waitFor } = require('../pipeline-helpers.cjs');

let testFixture, driver, previousAgentDir;
beforeEach(async t => {
  testFixture = await fixture(t);
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = testFixture.cache;
});
afterEach(async () => {
  await driver?.dispose(); driver = undefined;
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

async function createDriver() {
  let Reader = class { async read() { return undefined; } stop() {} };
  let resolveRemote, completions, releaseScan, scanStarted = false, scanHeld = false, scanGate, settlePromise;
  const sourcePath = path.join(testFixture.root, 'source.txt');
  const marker = path.join(testFixture.root, 'automatic-ran');
  class Remote { constructor(root) { return new Reader(root); } }
  const f = testFixture;
  const tools = {}, events = {}, commands = {}, widgets = [], notices = [];
  const Type = (await import('typebox')).Type;
  const { default: extension } = load('pipeline/index.ts', {
    typebox: { Type }, './github.ts': { GitHubActions: Remote },
    'node:fs/promises': { ...fs, async readFile(file, ...args) {
      if (scanHeld && file === sourcePath) { scanStarted = true; await scanGate; }
      return fs.readFile(file, ...args);
    } },
    '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_path, fn) => fn() },
  });
  extension({ registerTool(tool) { tools[tool.name] = tool; }, registerCommand(name, command) { commands[name] = command; }, on(name, fn) { events[name] = fn; } });
  const ctx = { cwd: f.root, mode: 'rpc', hasUI: true, isIdle: () => true, ui: { theme: { fg: (_color, text) => text }, setWidget: (_key, value) => widgets.push(value), notify: text => notices.push(text) } };
  const d = { tools, events, commands, widgets, notices, ctx,
    async holdSourceScan() {
      await fs.writeFile(sourcePath, 'source');
      scanHeld = true;
      scanGate = new Promise(resolve => { releaseScan = resolve; });
    },
    async settleAgent() { settlePromise = events.agent_settled({}, ctx); },
    async shouldShowLocalSuiteWhileSourceScanPending(name) {
      await waitFor(() => widgets.at(-1)?.some(line => line.includes(`${name} never`)) && scanStarted);
      assert.equal(scanHeld, true);
    },
    async shouldNotRunAutomaticJobs() {
      await new Promise(resolve => setTimeout(resolve, 2300));
      await assert.rejects(fs.access(marker), { code: 'ENOENT' });
    },
    finishSourceScan() { scanHeld = false; releaseScan?.(); },
    async shouldEnableAutomaticRunAfterSourceScan() {
      await settlePromise;
      await waitFor(async () => fs.access(marker).then(() => true, () => false));
    },
    async configureNamedSuites(names, options = {}) {
      await fs.mkdir(path.dirname(f.configPath), { recursive: true });
      const command = options.auto === 'after-agent' ? [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`] : ['node', '-e', ''];
      const config = { suites: Object.fromEntries(names.map(name => [name, { command: [...command], ...options }])) };
      await fs.writeFile(f.configPath, require('yaml').stringify(config));
      if (options.auto === 'after-agent') await new (load().Pipeline)(f.root).configure(config, async () => true);
    },
    holdGitHubResponse() {
      const response = new Promise(resolve => { resolveRemote = resolve; });
      Reader = class { read() { return response; } stop() { resolveRemote(undefined); } };
    },
    startSession: () => events.session_start({}, ctx),
    async refreshAfterFileChange() { await events.tool_execution_end({ toolName: 'write' }, ctx); },
    async shouldShowLocalSuiteWhileGitHubPending(name) {
      await waitFor(() => widgets.at(-1)?.some(line => line.includes(`${name} never`)));
      assert.ok(!widgets.at(-1).some(line => line.includes('GitHub')));
    },
    respondWithGitHubWorkflow(name) { resolveRemote({ repository: 'owner/repo', branch: 'main', workflows: [{ name, status: 'completed', conclusion: 'success' }] }); },
    async shouldShowLocalAndGitHub(suite, workflow) {
      await waitFor(() => widgets.at(-1)?.some(line => line.includes(`GitHub ${workflow}`)));
      assert.ok(widgets.at(-1).some(line => line.includes(`${suite} never`)));
    },
    failGitHubResponse(kind) { resolveRemote({ repository: 'owner/repo', branch: 'main', workflows: [], error: 'unavailable', errorKind: kind }); },
    async shouldShowLocalAndGitHubError(suite, kind) {
      await waitFor(() => widgets.at(-1)?.some(line => line.includes(`GitHub · unavailable · ${kind}`)));
      assert.ok(widgets.at(-1).some(line => line.includes(`${suite} never`)));
    },
    async requestPipelineCompletions(prefix) { completions = await commands.pipeline.getArgumentCompletions(prefix); },
    async shouldSuggestCompletions(expected) { assert.deepEqual(Array.from(completions ?? [], item => item.value), expected); },
    async shouldDisplayCompletionLabels(expected) { assert.deepEqual(Array.from(completions ?? [], item => item.label), expected); },
    setReader(value) { Reader = value; },
    async dispose() { if (this.disposed) return; this.disposed = true; this.finishSourceScan(); await events.session_shutdown({}, ctx); },
  };
  driver = d;
  return d;
}

const remote = { repository: 'owner/repo', branch: 'main', checkedAt: '2026-01-01T00:00:00Z', workflows: [{ name: 'Tests', status: 'in_progress', url: 'https://github.com/owner/repo/actions/runs/1', jobs: [{ name: 'e2e', status: 'completed', conclusion: 'failure', url: 'https://github.com/owner/repo/actions/runs/1/job/2' }, { name: 'unit', status: 'completed', conclusion: 'success' }] }] };

test('local results appear before a slow source scan completes', async () => {
  const app = await createDriver();
  await app.configureNamedSuites(['web']);
  await app.holdSourceScan();

  await app.startSession();

  await app.shouldShowLocalSuiteWhileSourceScanPending('web');
  app.finishSourceScan();
});

test('automatic jobs wait for a completed source scan', async () => {
  const app = await createDriver();
  await app.configureNamedSuites(['web'], { auto: 'after-agent' });
  await app.holdSourceScan();
  await app.startSession();
  await app.shouldShowLocalSuiteWhileSourceScanPending('web');
  await app.settleAgent();

  await app.shouldNotRunAutomaticJobs();
  app.finishSourceScan();

  await app.shouldEnableAutomaticRunAfterSourceScan();
});

test('local widget appears while GitHub is pending and gains remote results later', async () => {
  const app = await createDriver();
  await app.configureNamedSuites(['web', 'server']);
  app.holdGitHubResponse();

  await app.startSession();

  await app.shouldShowLocalSuiteWhileGitHubPending('web');
  app.respondWithGitHubWorkflow('CI');
  await app.shouldShowLocalAndGitHub('web', 'CI');
});

test('local updates continue while a GitHub request is pending', async () => {
  const app = await createDriver();
  await app.configureNamedSuites(['web']);
  app.holdGitHubResponse();
  await app.startSession();
  await app.shouldShowLocalSuiteWhileGitHubPending('web');

  await app.configureNamedSuites(['server']);
  await app.refreshAfterFileChange();

  await app.shouldShowLocalSuiteWhileGitHubPending('server');
});

test('GitHub failure does not hide local results', async () => {
  const app = await createDriver();
  await app.configureNamedSuites(['web']);
  app.holdGitHubResponse();
  await app.startSession();
  await app.shouldShowLocalSuiteWhileGitHubPending('web');

  app.failGitHubResponse('timeout');

  await app.shouldShowLocalAndGitHubError('web', 'timeout');
});

test('pipeline completion offers run before choosing a suite', async () => {
  const app = await createDriver();
  await app.configureNamedSuites(['web', 'server']);
  await app.startSession();

  await app.requestPipelineCompletions('r');
  await app.shouldSuggestCompletions(['run']);
  await app.requestPipelineCompletions('run ');
  await app.shouldSuggestCompletions(['run all', 'run web', 'run server']);
});

test('pipeline run completion suggests configured suite names and all filtered by prefix', async () => {
  const app = await createDriver();
  await app.configureNamedSuites(['web', 'server']);
  await app.startSession();

  await app.requestPipelineCompletions('run ');
  await app.shouldSuggestCompletions(['run all', 'run web', 'run server']);
  await app.shouldDisplayCompletionLabels(['all', 'web', 'server']);
  await app.requestPipelineCompletions('run se');
  await app.shouldSuggestCompletions(['run server']);
});

test('pipeline run completion reflects configuration changes and retains all with no suites', async () => {
  const app = await createDriver();
  await app.configureNamedSuites(['web']);
  await app.startSession();
  await app.configureNamedSuites(['server']);

  await app.requestPipelineCompletions('run ');
  await app.shouldSuggestCompletions(['run all', 'run server']);
  await app.configureNamedSuites([]);
  await app.requestPipelineCompletions('run ');
  await app.shouldSuggestCompletions(['run all']);
});

test('remote-only project exposes status via tool, command and widget using a shared reader', async () => {
  let instances = 0, stopped = 0;
  class Reader { constructor() { instances++; } async read() { return remote; } stop() { stopped++; } }
  const d = await createDriver();
  d.setReader(Reader);
  await d.events.session_start({}, d.ctx);
  await waitFor(() => d.widgets.at(-1)?.some(line => line.includes('◐ GitHub Tests')));
  assert.match(d.widgets.at(-1).join('\n'), /◐ GitHub Tests · 2\/2 complete/);
  assert.doesNotMatch(d.widgets.at(-1).join('\n'), /unit passed/);
  const result = await d.tools.pipeline_status.execute('id', {}, undefined, undefined, d.ctx);
  assert.equal(result.details.configured, false);
  assert.equal(result.details.github.workflows[0].url, remote.workflows[0].url);
  assert.equal(result.details.github.workflows[0].jobs[0].url, remote.workflows[0].jobs[0].url);
  assert.match(d.widgets.at(-1).join('\n'), /\n  └─ ✗ e2e failed/);
  await d.commands.pipeline.handler('status', d.ctx);
  assert.match(d.notices.at(-1), /GitHub\n› Tests running/);
  assert.match(d.notices.at(-1), /\n  ├─ ✗ e2e failed\n  └─ ✓ unit passed/);
  assert.equal(instances, 1);
  await d.events.session_shutdown({}, d.ctx);
  assert.equal(d.widgets.at(-1), undefined);
  assert.equal(stopped, 1);
});

test('status command forces a remote refresh and updates the widget; tools and polling stay cached', async () => {
  const reads = [];
  let current = remote;
  class Reader {
    async read(options) {
      reads.push(options);
      if (options?.force) current = { ...remote, workflows: [{ name: 'Tests', status: 'completed', conclusion: 'success' }] };
      return current;
    }
    stop() {}
  }
  const d = await createDriver();
  d.setReader(Reader);
  await d.events.session_start({}, d.ctx);
  await waitFor(() => d.widgets.at(-1)?.some(line => line.includes('◐ GitHub Tests')));
  await d.tools.pipeline_status.execute('id', {}, undefined, undefined, d.ctx);
  assert.ok(reads.every(options => !options?.force));

  await d.commands.pipeline.handler('status', d.ctx);

  assert.equal(reads.filter(options => options?.force).length, 1);
  assert.match(d.notices.at(-1), /✓ Tests passed/);
  await waitFor(() => d.widgets.at(-1)?.some(line => line.includes('✓ GitHub Tests')));
  await d.commands.pipeline.handler('', d.ctx);
  assert.equal(reads.filter(options => options?.force).length, 2);
});

test('session startup completes while GitHub is pending and the widget appears afterward', async () => {
  let resolveRead, started = false;
  class Reader {
    read() { return new Promise(resolve => { resolveRead = resolve; }); }
    stop() { resolveRead?.(undefined); }
  }
  const d = await createDriver();
  d.setReader(Reader);
  const starting = d.events.session_start({}, d.ctx).then(() => { started = true; });
  await waitFor(() => resolveRead);
  // No network response has arrived: startup must already be free to finish.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true, 'session startup must not wait for GitHub status');
  assert.equal(d.widgets.length, 0);
  resolveRead(remote);
  await starting;
  await waitFor(() => d.widgets.at(-1)?.some(line => line.includes('◐ GitHub Tests')));
  assert.match(d.widgets.at(-1).join('\n'), /◐ GitHub Tests · 2\/2 complete/);
});

test('shutdown cancels an awaited remote refresh and cannot resurrect the widget', async () => {
  let resolveRead;
  class Reader { read() { return new Promise(resolve => { resolveRead = resolve; }); } stop() { resolveRead?.(remote); } }
  const d = await createDriver();
  d.setReader(Reader);
  const starting = d.events.session_start({}, d.ctx);
  for (let i = 0; i < 100 && !resolveRead; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(resolveRead);
  await d.events.session_shutdown({}, d.ctx);
  await starting;
  assert.ok(d.widgets.every(value => value === undefined));
});

test('status arriving after shutdown cannot start a new remote reader', async () => {
  let created = 0;
  class Reader { constructor() { created++; } async read() { return remote; } stop() {} }
  const d = await createDriver();
  d.setReader(Reader);
  await d.events.session_shutdown({}, d.ctx);
  await d.tools.pipeline_status.execute('id', {}, undefined, undefined, d.ctx);
  assert.equal(created, 0);
});

test('session replacement disposes the previous status reader and creates a fresh lifecycle', async () => {
  let created = 0, stopped = 0;
  class Reader { constructor() { created++; } async read() { return remote; } stop() { stopped++; } }
  const d = await createDriver();
  d.setReader(Reader);
  await d.events.session_start({}, d.ctx);
  await waitFor(() => created === 1);
  await d.events.session_start({}, d.ctx);
  await waitFor(() => created === 2);
  assert.equal(stopped, 1);
  const result = await d.tools.pipeline_status.execute('id', {}, undefined, undefined, d.ctx);
  assert.equal(result.details.github.repository, 'owner/repo');
  assert.equal(created, 2);
  await d.events.session_shutdown({}, d.ctx);
  assert.equal(stopped, 2);
});

test('non-UI status still reads GitHub without starting monitor timers', async () => {
  class Reader { async read() { return remote; } stop() {} }
  const d = await createDriver();
  d.setReader(Reader);
  const ctx = { ...d.ctx, hasUI: false };
  await d.events.session_start({}, ctx);
  assert.equal(d.widgets.length, 0);
  const result = await d.tools.pipeline_status.execute('id', {}, undefined, undefined, ctx);
  assert.equal(result.details.github.repository, 'owner/repo');
});
