const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const source = readFileSync(join(__dirname, '..', 'git-status.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(id) {
      if (id === '@earendil-works/pi-coding-agent') return {};
      return require(id);
    },
    process,
    console,
  });
  return module.exports;
}

const { parseGitStatus, formatGitStatus, formatRepositoryLabel } = load();

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
