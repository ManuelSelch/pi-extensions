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
    'bluebird  feature/search  clean', 'main  ↑2 to push',
    'feature/search  +3 unmerged', 'fix/login  +1 unmerged', 'fix/empty-state  merged',
  ]);
  assert.equal(formatRepositoryStatus(base)[2].color, 'warning');
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
  assert.equal(row({ upstream: true, ahead: 0, behind: 0 }), 'main  up to date');
  assert.equal(row({ upstream: true, ahead: 2, behind: 1 }), 'main  ↑2 to push  ↓1 behind');
});
