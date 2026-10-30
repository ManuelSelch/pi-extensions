const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const execute = promisify(require('node:child_process').execFile);
const { load, fixture } = require('./pipeline-helpers.cjs');

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
  const { PipelineStatusReader } = load('pipeline/api.ts', { './github.ts': { GitHubActions: Remote } });
  const reader = new PipelineStatusReader();
  t.after(() => reader.stop());
  let cwd = f.root, status;
  return {
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
    thenSuiteNeverRan() { assert.equal(status.suites.unit.outcome, 'never'); assert.equal(status.suites.unit.stale, false); },
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
