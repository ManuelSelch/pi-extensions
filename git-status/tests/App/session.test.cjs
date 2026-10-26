const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { loader } = require('../load.cjs');

function fixture() {
  const handlers = new Map(), watchers = [], reads = [], publications = [], warnings = [];
  const extension = loader({
    './Infra/git.ts': {
      readGitDirectories: async () => ['/git'],
      readGitStatus: cwd => new Promise(resolve => reads.push({ cwd, resolve })),
    },
    './Infra/watch.ts': {
      watchGitMetadata: (_roots, change, error) => {
        const watcher = { change, error, reconcile() {}, closed: false, close() { this.closed = true; } };
        watchers.push(watcher);
        return watcher;
      },
    },
    './UI/Components/status.ts': { formatRepositoryStatus: result => [{ text: result, color: 'muted' }] },
  })(join(__dirname, '../../index.ts')).default;
  extension({ on: (name, handler) => handlers.set(name, handler) });
  const ctx = cwd => ({ cwd, ui: {
    notify: text => warnings.push(text), theme: { fg: (_color, text) => text },
    setWidget: (_key, rows) => publications.push({ cwd, rows }),
  } });
  return { handlers, watchers, reads, publications, warnings, ctx };
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('replacing a session closes watchers and suppresses the old read completion', async () => {
  const f = fixture();
  const old = f.handlers.get('session_start')({}, f.ctx('old'));
  await settle();
  const next = f.handlers.get('session_start')({}, f.ctx('new'));
  await settle();
  assert.equal(f.watchers[0].closed, true);
  f.reads[0].resolve('old status');
  f.reads[1].resolve('new status');
  await Promise.all([old, next]);
  assert.deepEqual(f.publications, [{ cwd: 'new', rows: ['new status'] }]);
  await f.handlers.get('session_shutdown')();
  assert.equal(f.watchers[1].closed, true);
});

test('unchanged snapshots are not republished and watcher failures warn once', async () => {
  const f = fixture(), ctx = f.ctx('repo');
  const initial = f.handlers.get('session_start')({}, ctx);
  await settle();
  f.reads[0].resolve('same status');
  await initial;
  const refresh = f.handlers.get('tool_execution_end')({ toolName: 'bash' }, ctx);
  await settle();
  f.reads[1].resolve('same status');
  await refresh;
  assert.equal(f.publications.length, 1);
  f.watchers[0].error(new Error('failed'));
  f.watchers[0].error(new Error('failed again'));
  assert.equal(f.warnings.length, 1);
  await f.handlers.get('session_shutdown')();
  f.watchers[0].change();
  f.watchers[0].error(new Error('late failure'));
  assert.equal(f.warnings.length, 1);
});
