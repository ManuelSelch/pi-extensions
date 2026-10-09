const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(sdk = {}, childProcess = require('node:child_process')) {
  const source = readFileSync(join(__dirname, '..', 'git-status.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(id) {
      if (id === '@earendil-works/pi-coding-agent') return sdk;
      if (id === 'node:child_process') return childProcess;
      return require(id);
    },
    process,
    console,
  });
  return module.exports;
}

const { parseGitStatus, formatGitStatus, formatRepositoryLabel } = load();

function bashHarness(exec) {
  const handlers = new Map();
  const widgets = [];
  const sdk = {
    SettingsManager: {
      create(cwd) {
        assert.equal(cwd, '/repo');
        return { getShellPath: () => '/custom/bash' };
      },
    },
    createLocalBashOperations(options) {
      assert.equal(options.shellPath, '/custom/bash');
      return { exec };
    },
  };
  const childProcess = {
    execFile(_file, args, _options, callback) {
      const stdout = args.includes('--show-toplevel') ? '/repo\n'
        : args.includes('--git-common-dir') ? '.git\n'
        : '## main\n?? created.txt\n';
      // Match execFile's custom promisify result shape.
      callback(null, { stdout, stderr: '' });
    },
  };
  load(sdk, childProcess).default({ on: (name, handler) => handlers.set(name, handler) });
  const ctx = {
    cwd: '/repo',
    ui: { theme: { fg: (_color, text) => text }, setWidget: (name, lines) => widgets.push({ name, lines }) },
  };
  return { handlers, widgets, ctx };
}

for (const excludeFromContext of [false, true]) {
  test(`refreshes after ${excludeFromContext ? '!!' : '!'} bash completes without changing execution`, async () => {
    let finish;
    let received;
    const result = { exitCode: 1 };
    const harness = bashHarness((...args) => {
      received = args;
      return new Promise((resolve) => { finish = () => resolve(result); });
    });
    const handler = harness.handlers.get('user_bash');
    assert.equal(typeof handler, 'function');
    const response = await handler({ command: 'touch created.txt; false', cwd: '/repo', excludeFromContext }, harness.ctx);
    const options = { onData() {}, signal: new AbortController().signal, env: { TEST: '1' } };
    const running = response.operations.exec('prefix\ntouch created.txt; false', '/repo', options);
    assert.equal(harness.widgets.length, 0, 'must not refresh before completion');
    assert.equal(received[0], 'prefix\ntouch created.txt; false');
    assert.equal(received[1], '/repo');
    assert.equal(received[2], options);
    finish();
    assert.equal(await running, result);
    assert.equal(harness.widgets.length, 1);
    assert.equal(harness.widgets[0].name, 'git-status');
    assert.match(harness.widgets[0].lines[0], /1 changed.*1 untracked/);
  });
}

test('refreshes after a cancelled bash command', async () => {
  const harness = bashHarness(async () => ({ exitCode: null }));
  const handler = harness.handlers.get('user_bash');
  assert.equal(typeof handler, 'function');
  const response = await handler({ command: 'sleep 10', cwd: '/repo', excludeFromContext: false }, harness.ctx);
  const result = await response.operations.exec('sleep 10', '/repo', { onData() {} });
  assert.equal(result.exitCode, null);
  assert.equal(harness.widgets.length, 1);
});

test('refreshes after bash throws while preserving the error', async () => {
  const error = new Error('execution failed');
  const harness = bashHarness(async () => { throw error; });
  const handler = harness.handlers.get('user_bash');
  assert.equal(typeof handler, 'function');
  const response = await handler({ command: 'touch created.txt', cwd: '/repo', excludeFromContext: false }, harness.ctx);
  await assert.rejects(response.operations.exec('touch created.txt', '/repo', { onData() {} }), (caught) => caught === error);
  assert.equal(harness.widgets.length, 1);
});

test('real user bash execution updates the widget after changing a Git repository', async () => {
  const sdk = await import('@earendil-works/pi-coding-agent');
  const cwd = mkdtempSync(join(tmpdir(), 'pi-git-status-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd, stdio: 'ignore' });
    const handlers = new Map();
    const widgets = [];
    load(sdk).default({ on: (name, handler) => handlers.set(name, handler) });
    const ctx = {
      cwd,
      ui: { theme: { fg: (_color, text) => text }, setWidget: (_name, lines) => widgets.push(lines) },
    };
    await handlers.get('session_start')({}, ctx);
    assert.match(widgets.at(-1)[0], /main  clean/);
    const response = await handlers.get('user_bash')({ command: 'touch created.txt && git add created.txt', cwd, excludeFromContext: false }, ctx);
    const result = await response.operations.exec('touch created.txt && git add created.txt', cwd, { onData() {} });
    assert.equal(result.exitCode, 0);
    assert.match(widgets.at(-1)[0], /main  1 changed  \+1 staged/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('parses branch and staged, modified, and untracked files', () => {
  const status = parseGitStatus([
    '## main...origin/main [ahead 2, behind 1]',
    'M  staged.ts',
    ' M modified.ts',
    '?? new.ts',
  ].join('\n'));

  assert.deepEqual({ ...status }, {
    branch: 'main',
    ahead: 2,
    behind: 1,
    changed: 3,
    staged: 1,
    modified: 1,
    untracked: 1,
  });
});

test('counts conflicts in both staged and modified buckets', () => {
  const status = parseGitStatus(['## feature', 'UU conflict.ts'].join('\n'));

  assert.equal(status.changed, 1);
  assert.equal(status.staged, 1);
  assert.equal(status.modified, 1);
  assert.equal(status.untracked, 0);
});

test('formats a clean branch with ahead and behind counts', () => {
  assert.equal(
    formatGitStatus({ branch: 'main', ahead: 2, behind: 1, changed: 0, staged: 0, modified: 0, untracked: 0 }),
    'main  clean  ↑2  ↓1',
  );
});

test('formats changed files without zero-valued categories', () => {
  assert.equal(
    formatGitStatus({ branch: 'feature', ahead: 0, behind: 0, changed: 3, staged: 1, modified: 1, untracked: 1 }),
    'feature  3 changed  +1 staged  ~1 modified  ?1 untracked',
  );
});

test('does not repeat a worktree directory that identifies its branch', () => {
  assert.equal(formatRepositoryLabel('worktree', 'fix/exit-worktree', 'fix-exit-worktree'), 'worktree');
  assert.equal(formatRepositoryLabel('worktree', 'fix/exit-worktree', 'review-copy'), 'worktree/review-copy');
});
