const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { loader } = require('../../load.cjs');
const { formatRepositoryStatus } = loader()(join(__dirname, '../../../UI/Components/status.ts'));
const base = {
  repoName: 'bluebird',
  status: { branch: 'feature/search', changed: 0, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 },
  branches: [
    { branch: 'main', kind: 'primary', ahead: 2, behind: 0, upstream: true },
    { branch: 'feature/search', kind: 'feature', unmerged: 3 },
    { branch: 'fix/login', kind: 'feature', unmerged: 1 },
    { branch: 'fix/empty-state', kind: 'feature', unmerged: 0 },
  ],
};
test('keeps file status and unmerged status separate with no classifications or merge targets', () => {
  assert.deepEqual(formatRepositoryStatus(base).map(row => row.text), [
    'bluebird · feature/search  ✓', 'main  ↑2',
    'feature/search  ●3', 'fix/login  ●1', '✓ 1 branch',
  ]);
  assert.equal(formatRepositoryStatus(base)[2].color, 'warning');
});
test('does not duplicate push counts on the checkout line', () => {
  const snapshot = { ...base, status: { ...base.status, branch: 'main', ahead: 2, behind: 1 } };
  assert.deepEqual(formatRepositoryStatus(snapshot).map(row => row.text), [
    'bluebird · main  ✓', 'main  ↑2',
    'feature/search  ●3', 'fix/login  ●1', '✓ 1 branch',
  ]);
});
test('dirty feature checkout keeps all file counts but no upstream arrows', () => {
  const snapshot = { ...base, status: { ...base.status, changed: 3, staged: 1, modified: 1, untracked: 1, ahead: 2, behind: 1 } };
  assert.equal(formatRepositoryStatus(snapshot)[0].text,
    'bluebird · feature/search  +1  ~1  ?1');
  assert.equal(formatRepositoryStatus(snapshot)[0].color, 'warning');
});
test('keeps the current merged branch visible and collapses only other merged branches', () => {
  const snapshot = { ...base, branches: [
    base.branches[0], { branch: 'feature/search', kind: 'feature', unmerged: 0 },
    { branch: 'feat/a', kind: 'feature', unmerged: 0 },
    { branch: 'feat/b', kind: 'feature', unmerged: 0 },
    { branch: 'feat/c', kind: 'feature' },
  ] };
  assert.deepEqual(formatRepositoryStatus(snapshot).map(row => row.text), [
    'bluebird · feature/search  ✓', 'main  ↑2', 'feature/search  ✓',
    'feat/c  merge unknown', '✓ 2 branches',
  ]);
  assert.equal(formatRepositoryStatus(snapshot).at(-1).color, 'muted');
});
test('does not show a zero merged count', () => {
  assert.deepEqual(formatRepositoryStatus({ ...base, branches: base.branches.slice(0, 2) }).map(row => row.text), [
    'bluebird · feature/search  ✓', 'main  ↑2', 'feature/search  ●3',
  ]);
});
test('does not claim unknown ancestry is merged', () => {
  const rows = formatRepositoryStatus({ ...base, branches: [{ branch: 'feat/x', kind: 'feature' }] });
  assert.equal(rows[1].text, 'feat/x  merge unknown');
  assert.equal(rows[1].color, 'warning');
});
test('distinguishes no upstream, unavailable upstream and synchronized primary', () => {
  const row = patch => formatRepositoryStatus({ ...base, branches: [{ branch: 'main', kind: 'primary', ...patch }] })[1].text;
  assert.equal(row({ upstream: false }), 'main  no upstream');
  assert.equal(row({ upstream: true }), 'main  upstream unknown');
  assert.equal(row({ upstream: true, ahead: 0, behind: 0 }), 'main  ✓');
  assert.equal(row({ upstream: true, ahead: 2, behind: 1 }), 'main  ↑2  ↓1');
});

test('matches the approved compact preview without redundant changed counts', () => {
  const rows = formatRepositoryStatus({
    repoName: 'pi-chat',
    status: { ...base.status, branch: 'feat/theme', changed: 1, modified: 1 },
    branches: [
      base.branches[0],
      { branch: 'feat/theme', kind: 'feature', unmerged: 3 },
      { branch: 'feat/minimal-widgets', kind: 'feature', unmerged: 1 },
      ...['feat/a', 'feat/b', 'feat/c'].map(branch => ({ branch, kind: 'feature', unmerged: 0 })),
    ],
  });
  assert.deepEqual(rows.map(row => row.text), [
    'pi-chat · feat/theme  ~1',
    'main  ↑2',
    'feat/theme  ●3',
    'feat/minimal-widgets  ●1',
    '✓ 3 branches',
  ]);
});

test('preserves long branch names with two spaces before counters and no column padding', () => {
  const branch = 'feat/a-very-long-branch-name-that-should-not-be-truncated';
  const rows = formatRepositoryStatus({ ...base,
    status: { ...base.status, branch, changed: 1, untracked: 1 },
    branches: [base.branches[0], { branch, kind: 'feature', unmerged: 12 }],
  });
  assert.deepEqual(rows.map(row => row.text), [
    `bluebird · ${branch}  ?1`, 'main  ↑2', `${branch}  ●12`,
  ]);
  assert.equal(rows[0].label, 'bluebird');
  assert.equal(rows[2].label, branch);
});
