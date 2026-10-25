const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { loader } = require('../load.cjs');
const { orderBranches, parseWorktrees } = loader()(join(__dirname, '../../Domain/status.ts'));

test('orders primary first, current second, then remaining branches by name without duplicates', () => {
  assert.deepEqual(orderBranches('main', 'feat/z', ['fix/b', 'feat/a', 'feat/z', 'main', 'fix/b']),
    ['main', 'feat/z', 'feat/a', 'fix/b']);
});
test('does not duplicate current when it is primary or invent a detached branch', () => {
  assert.deepEqual(orderBranches('main', 'main', ['feat/a', 'main']), ['main', 'feat/a']);
  assert.deepEqual(orderBranches('main', undefined, ['feat/a']), ['main', 'feat/a']);
});
test('includes an ordinary current feature branch without a linked worktree', () => {
  assert.deepEqual(orderBranches('feature', 'feature', []), ['feature']);
});
test('parses null-delimited worktrees, including paths with newlines and detached entries', () => {
  assert.deepEqual(parseWorktrees('worktree /repo\nname\0HEAD abc\0branch refs/heads/main\0\0worktree /copy\0HEAD def\0detached\0\0'),
    [{ path: '/repo\nname', branch: 'main' }, { path: '/copy' }]);
});
