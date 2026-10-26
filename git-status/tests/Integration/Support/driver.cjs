const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { loader } = require('../../load.cjs');

class GitStatusDriver {
  constructor(t) {
    this.root = mkdtempSync(join(tmpdir(), 'git-status-'));
    t.after(() => rmSync(this.root, { recursive: true, force: true }));
    this.repo = join(this.root, 'repo');
    this.git(this.root, 'init', '-b', 'main', this.repo);
    this.git(this.repo, 'config', 'user.email', 'test@example.com');
    this.git(this.repo, 'config', 'user.name', 'Test');
    this.git(this.repo, 'commit', '--allow-empty', '-m', 'initial');
    this.paths = new Map([['main', this.repo]]);
    this.load = loader();
    this.read = this.load(join(__dirname, '../../../Infra/git.ts')).readGitStatus;
    this.extension = this.load(join(__dirname, '../../../index.ts')).default;
  }
  git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim(); }
  addBranch(branch) {
    const path = join(this.root, branch.replaceAll('/', '-'));
    this.git(this.repo, 'worktree', 'add', '-b', branch, path);
    this.paths.set(branch, path);
  }
  commit(branch) { this.git(this.paths.get(branch), 'commit', '--allow-empty', '-m', 'feature work'); }
  push(branch) { this.git(this.paths.get(branch), 'push', '-u', 'origin', branch); }
  detach(branch) { this.git(this.paths.get(branch), 'checkout', '--detach'); }
  makeUnborn() { this.git(this.repo, 'checkout', '--orphan', 'new-history'); }
  merge(branch) { this.git(this.repo, 'merge', '--no-edit', branch); }
  detachPrimary() { this.git(this.repo, 'checkout', '--detach'); }
  switchPrimary(branch) { this.git(this.repo, 'switch', '-c', branch); this.paths.set(branch, this.repo); }
  setUpstream() {
    this.git(this.root, 'init', '--bare', join(this.root, 'remote'));
    this.git(this.repo, 'remote', 'add', 'origin', join(this.root, 'remote'));
    this.git(this.repo, 'push', '-u', 'origin', 'main');
  }
  async inspect(branch) { this.snapshot = await this.read(this.paths.get(branch)); }
  thenBranches(expected) { assert.deepEqual(this.snapshot.branches.map(b => b.branch), expected); }
  thenUnmerged(branch, count) { assert.equal(this.snapshot.branches.find(b => b.branch === branch).unmerged, count); }
  thenClean() { assert.equal(this.snapshot.status.changed, 0); }
  thenPrimary(patch) { for (const [key, value] of Object.entries(patch)) assert.equal(this.snapshot.branches[0][key], value); }
  thenPrimaryUnavailable() { assert.equal(this.snapshot.primaryUnavailable, true); }
  async start(branch, mocks) {
    this.handlers = new Map();
    this.widgets = [];
    const extension = mocks ? loader(mocks)(join(__dirname, '../../../index.ts')).default : this.extension;
    extension({ on: (name, fn) => this.handlers.set(name, fn) });
    this.ctx = { cwd: this.paths.get(branch), ui: { theme: { fg: (_color, text) => text }, setWidget: (key, rows) => { assert.equal(key, 'git-status'); this.widgets.push(rows); } } };
    await this.handlers.get('session_start')({}, this.ctx);
  }
  async startWithFailure(branch, command) {
    const execFile = () => { throw new Error('Use promisified execution'); };
    execFile[require('node:util').promisify.custom] = async (name, args, options) => {
      if (args[0] === command) throw new Error('simulated Git failure');
      return require('node:util').promisify(require('node:child_process').execFile)(name, args, options);
    };
    await this.start(branch, { 'node:child_process': { execFile } });
  }
  async refresh() { await this.handlers.get('tool_execution_end')({ toolName: 'bash' }, this.ctx); }
  thenRows(expected) { assert.deepEqual(this.widgets.at(-1).slice(1), expected); }
  thenCheckoutVisible() { assert.match(this.widgets.at(-1)[0], /✓/); }
  thenCleared() { assert.equal(this.widgets.at(-1), undefined); }
  async startOutside() { this.paths.set('outside', this.root); await this.start('outside'); }
}
module.exports = { GitStatusDriver };
