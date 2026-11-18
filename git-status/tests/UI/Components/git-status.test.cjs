const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { loader } = require('../../load.cjs');
const { formatRepositoryStatus, renderStatusRows } = loader()(join(__dirname, '../../../UI/Components/status.ts'));
const theme = { fg: (_color, text) => text };
const rowText = row => row.name + (row.detail ? '  ' + (row.detail.kind === 'count' ? '●' + row.detail.value : row.detail.value) : '');
const countRow = (name, value) => ({ name, detail: { kind: 'count', value }, color: 'warning', accent: true, branch: true });

test('aligns unmerged counts at the right edge while keeping markers aligned', () => {
  const rows = [
    countRow('csmm-341-remove-tooltips', 9),
    countRow('csmm-328-mock-settings-add-role', 13),
    { name: 'main', detail: { kind: 'text', value: '✓' }, color: 'success', accent: true },
  ];

  assert.deepEqual(renderStatusRows(rows, 36, theme), [
    'csmm-341  remove-tooltips        ● 9',
    'csmm-328  mock-settings-add-ro…  ●13',
    'main  ✓',
  ]);
});

test('fits branch names to the available width while preserving ticket and count', () => {
  const rows = [countRow('csmm-236-declare-every-agreed-endpoint-in-fastapi', 7)];
  assert.deepEqual(renderStatusRows(rows, 30, theme), ['csmm-236  declare-every-a…  ●7']);
  assert.deepEqual(renderStatusRows(rows, 80, theme), [`${'csmm-236  declare-every-agreed-endpoint-in-fastapi'.padEnd(78)}●7`]);
});

test('uses available space before truncating at a hyphenated branch name', () => {
  const rows = [countRow('csmm-344-msw-for-example-long-description', 6), countRow('csmm-328-mock-settings-add-more', 16)];

  const lines = renderStatusRows(rows, 30, theme);

  assert.equal(lines[0], 'csmm-344  msw-for-exampl…  ● 6');
  assert.equal(lines[1], 'csmm-328  mock-settings-…  ●16');
});

test('separates ticket identifiers in branch rows without repeating the branch in the checkout line', () => {
  const branch = 'csmm-341-remove-tooltips';
  const snapshot = { ...base, status: { ...base.status, branch }, branches: [{ branch, kind: 'feature', unmerged: 9 }] };

  assert.deepEqual(renderStatusRows(formatRepositoryStatus(snapshot), 80, theme), [
    'bluebird  ✓',
    `${'csmm-341  remove-tooltips'.padEnd(78)}●9`,
  ]);
  assert.equal(snapshot.status.branch, branch);
});

test('distinguishes the current branch by color without changing status colors', () => {
  const colored = { fg: (color, text) => `[${color}]${text}` };
  const rows = formatRepositoryStatus(base);

  const lines = renderStatusRows(rows, 30, colored);

  assert.match(lines[1], /^\[muted\]main\[warning\]  ↑2$/);
  assert.match(lines[2], /^\[accent\]search\[warning\] +●3$/);
  assert.match(lines[3], /^\[muted\]login\[warning\] +●1$/);
});

test('keeps a long repository name and file status visible at serialized width', () => {
  const snapshot = { ...base, repoName: 'CSMM-Studiopilot-WS26' };

  const lines = renderStatusRows(formatRepositoryStatus(snapshot), 30, theme);

  assert.equal(lines[0], 'CSMM-Studiopilot-WS26  ✓');
  assert.ok(lines.some(line => line.includes('search') && line.endsWith('●3')));
});

test('does not treat other branch names as ticket identifiers', () => {
  for (const branch of ['csmm-341', 'csmm-abc-description', 'team/csmm-341-description']) {
    const rows = [countRow(branch, 1)];
    assert.deepEqual(renderStatusRows(rows, 80, theme), [`${branch.padEnd(78)}●1`]);
  }
});

test('fits wide unicode, checkout counters, and very narrow widths', () => {
  const rows = [{ name: 'repo界界界界界', detail: { kind: 'text', value: '+2  ~3' }, color: 'warning', accent: true }];
  const { visibleWidth } = require('@earendil-works/pi-tui');
  for (const width of [0, 1, 5, 12, 20, 30]) {
    const [line] = renderStatusRows(rows, width, theme);
    assert.ok(visibleWidth(line) <= width);
    if (width >= 12) assert.ok(line.endsWith('  +2  ~3'));
  }
});
test('shortens conventional branch prefixes only in display labels', () => {
  for (const prefix of ['feature', 'feat', 'fix', 'bugfix']) {
    const branch = `${prefix}/topic/nested`;
    const snapshot = { ...base, status: { ...base.status, branch }, branches: [{ branch, kind: 'feature', unmerged: 1 }] };
    const rows = formatRepositoryStatus(snapshot);
    assert.equal(rowText(rows[0]), 'bluebird  ✓');
    assert.equal(rowText(rows[1]), 'topic/nested  ●1');
    assert.equal(rows[1].name, 'topic/nested');
    assert.equal(snapshot.status.branch, branch);
  }
  for (const branch of ['chore/topic', 'feat/', 'FEAT/topic']) {
    const snapshot = { ...base, status: { ...base.status, branch }, branches: [{ branch, kind: 'feature', unmerged: 1 }] };
    assert.equal(formatRepositoryStatus(snapshot)[1].name, branch);
  }
});
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
  assert.deepEqual(formatRepositoryStatus(base).map(rowText), [
    'bluebird  ✓', 'main  ↑2',
    'search  ●3', 'login  ●1', '✓ 1 branch',
  ]);
  assert.equal(formatRepositoryStatus(base)[2].color, 'warning');
});
test('does not duplicate push counts on the checkout line', () => {
  const snapshot = { ...base, status: { ...base.status, branch: 'main', ahead: 2, behind: 1 } };
  assert.deepEqual(formatRepositoryStatus(snapshot).map(rowText), [
    'bluebird  ✓', 'main  ↑2',
    'search  ●3', 'login  ●1', '✓ 1 branch',
  ]);
});
test('dirty feature checkout keeps all file counts but no upstream arrows', () => {
  const snapshot = { ...base, status: { ...base.status, changed: 3, staged: 1, modified: 1, untracked: 1, ahead: 2, behind: 1 } };
  assert.equal(rowText(formatRepositoryStatus(snapshot)[0]),
    'bluebird  +1  ~1  ?1');
  assert.equal(formatRepositoryStatus(snapshot)[0].color, 'warning');
});
test('keeps the current merged branch visible and collapses only other merged branches', () => {
  const snapshot = { ...base, branches: [
    base.branches[0], { branch: 'feature/search', kind: 'feature', unmerged: 0 },
    { branch: 'feat/a', kind: 'feature', unmerged: 0 },
    { branch: 'feat/b', kind: 'feature', unmerged: 0 },
    { branch: 'feat/c', kind: 'feature' },
  ] };
  assert.deepEqual(formatRepositoryStatus(snapshot).map(rowText), [
    'bluebird  ✓', 'main  ↑2', 'search  ✓',
    'c  merge unknown', '✓ 2 branches',
  ]);
  assert.equal(formatRepositoryStatus(snapshot).at(-1).color, 'muted');
});
test('does not show a zero merged count', () => {
  assert.deepEqual(formatRepositoryStatus({ ...base, branches: base.branches.slice(0, 2) }).map(rowText), [
    'bluebird  ✓', 'main  ↑2', 'search  ●3',
  ]);
});
test('does not claim unknown ancestry is merged', () => {
  const rows = formatRepositoryStatus({ ...base, branches: [{ branch: 'feat/x', kind: 'feature' }] });
  assert.equal(rowText(rows[1]), 'x  merge unknown');
  assert.equal(rows[1].color, 'warning');
});
test('distinguishes no upstream, unavailable upstream and synchronized primary', () => {
  const row = patch => rowText(formatRepositoryStatus({ ...base, branches: [{ branch: 'main', kind: 'primary', ...patch }] })[1]);
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
  assert.deepEqual(rows.map(rowText), [
    'pi-chat  ~1',
    'main  ↑2',
    'theme  ●3',
    'minimal-widgets  ●1',
    '✓ 3 branches',
  ]);
});

test('preserves long branch names with two spaces before counters and no column padding', () => {
  const branch = 'feat/a-very-long-branch-name-that-should-not-be-truncated';
  const rows = formatRepositoryStatus({ ...base,
    status: { ...base.status, branch, changed: 1, untracked: 1 },
    branches: [base.branches[0], { branch, kind: 'feature', unmerged: 12 }],
  });
  const label = branch.slice('feat/'.length);
  assert.deepEqual(rows.map(rowText), [
    `bluebird  ?1`, 'main  ↑2', `${label}  ●12`,
  ]);
  assert.equal(rows[0].name, 'bluebird');
  assert.equal(rows[2].name, label);
});
