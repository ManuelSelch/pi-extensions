const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { join } = require('node:path');
const { loader } = require('../load.cjs');

function fixture(t) {
  const directories = new Set(['/git', '/git/refs', '/git/refs/heads', '/git/objects', '/git/logs', '/git/worktrees', '/git/worktrees/feature']);
  const handles = new Map();
  const inspected = [];
  const errors = [];
  let changes = 0;
  const fs = {
    lstatSync(path) {
      inspected.push(path);
      if (!directories.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { isDirectory: () => true, isSymbolicLink: () => false, dev: 1, ino: path };
    },
    readdirSync(path) {
      inspected.push(path);
      return [...directories].filter(p => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
        .map(p => ({ name: p.slice(path.length + 1), isDirectory: () => true, isSymbolicLink: () => false }));
    },
    watch(path, options, callback) {
      assert.equal(options.recursive, false);
      const handle = new EventEmitter();
      handle.closed = false;
      handle.close = () => { handle.closed = true; };
      handle.change = filename => callback('rename', filename);
      handles.set(path, handle);
      return handle;
    },
  };
  const { watchGitMetadata } = loader({ 'node:fs': fs })(join(__dirname, '../../Infra/watch.ts'));
  const watcher = watchGitMetadata(['/git', '/git'], () => changes++, error => errors.push(error));
  t.after(() => watcher.close());
  return { directories, handles, inspected, watcher, errors, changes: () => changes };
}

test('watches only selected metadata directories, deduplicated, without traversing objects or logs', t => {
  const f = fixture(t);
  assert.deepEqual([...f.handles.keys()].sort(), ['/git', '/git/refs', '/git/refs/heads', '/git/worktrees', '/git/worktrees/feature']);
  assert.ok(!f.inspected.some(p => p.includes('/objects') || p.includes('/logs')));
});

test('filters unrelated root entries and lock files but accepts metadata and unknown filenames', t => {
  const f = fixture(t);
  for (const name of ['objects', 'logs', 'index.lock', 'COMMIT_EDITMSG']) f.handles.get('/git').change(name);
  f.handles.get('/git/refs/heads').change('main.lock');
  assert.equal(f.changes(), 0);
  for (const name of ['HEAD', 'index', 'packed-refs', 'config', 'refs', 'worktrees', null]) f.handles.get('/git').change(name);
  f.handles.get('/git/refs/heads').change('main');
  f.handles.get('/git/worktrees/feature').change('HEAD');
  assert.equal(f.changes(), 9);
});

test('reconciles new and removed ref directories and worktree records', t => {
  const f = fixture(t);
  f.directories.add('/git/refs/heads/feat');
  f.directories.add('/git/worktrees/second');
  f.watcher.reconcile();
  assert.ok(f.handles.has('/git/refs/heads/feat'));
  assert.ok(f.handles.has('/git/worktrees/second'));
  f.directories.delete('/git/worktrees/second');
  f.watcher.reconcile();
  assert.equal(f.handles.get('/git/worktrees/second').closed, true);
});

test('closes failed handles without retrying and ignores callbacks after disposal', t => {
  const f = fixture(t);
  const root = f.handles.get('/git');
  root.emit('error', new Error('watch failed'));
  assert.equal(root.closed, true);
  assert.equal(f.errors.length, 1);
  f.watcher.reconcile();
  assert.equal(f.handles.get('/git'), root);
  f.watcher.close();
  f.watcher.close();
  const count = f.changes();
  root.change('HEAD');
  assert.equal(f.changes(), count);
  assert.ok([...f.handles.values()].every(handle => handle.closed));
});
