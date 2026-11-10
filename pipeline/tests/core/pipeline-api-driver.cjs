const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const execute = promisify(require('node:child_process').execFile);
const { load, fixture } = require('../pipeline-helpers.cjs');

async function createApiDriver(t) {
  const f = await fixture(t);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = f.cache;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  const roots = [], readers = [];
  class Remote {
    constructor(root) { roots.push(root); readers.push(this); }
    async read() { return undefined; }
    stop() { this.stopped = true; }
  }
  const { PipelineStatusReader } = load('pipeline/core/api.ts', { './github.ts': { GitHubActions: Remote } });
  const reader = new PipelineStatusReader();
  t.after(() => reader.stop());
  let cwd = f.root, status, remoteFailure = false, remoteStatus;
  const { Pipeline } = load();
  const pipeline = new Pipeline(f.root, f.cache);
  const { GitHubActions } = load('pipeline/core/github.ts');
  const github = new GitHubActions(f.root, async (file, args) => {
    if (file === 'git') return args[0] === 'remote' ? 'origin\tgit@github.com:owner/repo.git (fetch)\n' : 'main';
    if (remoteFailure) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    if (args.some(arg => arg.includes('/actions/workflows?'))) return JSON.stringify([{ workflows: [{ id: 1, name: 'CI' }] }]);
    if (args.some(arg => arg.includes('/jobs?'))) return JSON.stringify([{ jobs: [] }]);
    return JSON.stringify([{ workflow_runs: [{ id: 1, run_number: 1, run_attempt: 1, status: 'completed', conclusion: 'success' }] }]);
  });
  t.after(() => github.stop());
  async function runSuite(script) {
    await pipeline.configure(require('../pipeline-helpers.cjs').config(script), async () => true);
    await pipeline.run('all', { confirm: async () => true });
  }
  async function checkOutcome(outcome) {
    const result = await pipeline.status();
    assert.equal(result.suites.unit.outcome, outcome);
    assert.equal(Object.hasOwn(result.suites.unit, 'stale'), false);
    const { renderWidget } = load('pipeline/pi/widget.ts');
    const text = renderWidget(result, { fg: (_color, value) => value }, 120).join('\n');
    assert.match(text, outcome === 'passed' ? /✓ Local 1\/1/ : /✗ Local 0\/1/);
    assert.doesNotMatch(text, /stale/i);
  }
  return {
    runPassingSuite: () => runSuite('console.log("passed")'),
    runFailingSuite: () => runSuite('process.exit(1)'),
    async changeSource() { await fs.writeFile(path.join(f.root, 'source.txt'), 'changed'); },
    async changeSourceAndConfiguration() {
      await fs.writeFile(path.join(f.root, 'source.txt'), 'changed');
      await pipeline.configure(require('../pipeline-helpers.cjs').config('console.log("new configuration")'), async () => true);
    },
    shouldShowPassedWithoutStale: () => checkOutcome('passed'),
    shouldShowFailedWithoutStale: () => checkOutcome('failed'),
    async fetchPassingGitHubStatus() { const result = await github.read(); assert.equal(result.workflows[0].conclusion, 'success'); },
    async failGitHubRefresh() { remoteFailure = true; remoteStatus = await github.read({ force: true }); },
    shouldShowGitHubUnavailableWithoutStaleResults() {
      assert.ok(remoteStatus.error);
      assert.equal(remoteStatus.workflows.length, 0);
      assert.equal(Object.hasOwn(remoteStatus, 'stale'), false);
    },
    async createRepository() {
      await execute('git', ['init', f.root]);
      await execute('git', ['-C', f.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'initial']);
      await fs.mkdir(path.join(f.root, 'sub'));
    },
    async configureLocalSuite() {
      await fs.mkdir(path.dirname(f.configPath), { recursive: true });
      // If status mistakenly executes a command, this creates an observable marker.
      await fs.writeFile(f.configPath, require('yaml').stringify({ suites: { unit: {
        command: [process.execPath, '-e', 'require("node:fs").writeFileSync("UNEXPECTED-RUN", "ran")'],
      } } }));
    },
    async enterLinkedWorktree() {
      cwd = path.join(f.root, '..', 'linked');
      await execute('git', ['-C', f.root, 'worktree', 'add', '-b', 'feature', cwd]);
    },
    enterSubdirectory() { cwd = path.join(f.root, 'sub'); },
    enterRoot() { cwd = f.root; },
    async read() { status = await reader.read(cwd); },
    thenSuiteNeverRan() { assert.equal(status.suites.unit.outcome, 'never'); assert.equal(Object.hasOwn(status.suites.unit, 'stale'), false); },
    thenNoLocalConfiguration() { assert.equal(status.configured, false); },
    thenReaderCount(count) { assert.equal(roots.length, count); },
    thenRootsAreDistinct() { assert.notEqual(roots[0], roots[1]); },
    async thenReadOnly() {
      await assert.rejects(fs.stat(path.join(f.root, 'UNEXPECTED-RUN')), { code: 'ENOENT' });
      await assert.rejects(fs.stat(f.cache), { code: 'ENOENT' });
    },
    async thenMissingPathRejected() {
      await assert.rejects(reader.read(path.join(f.root, 'missing')), { code: 'ENOENT' });
    },
    stop() { reader.stop(); },
    thenAllReadersStopped() { assert.ok(readers.every(reader => reader.stopped)); },
  };
}
module.exports = { createApiDriver };
