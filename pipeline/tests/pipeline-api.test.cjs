const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./pipeline-helpers.cjs');

function fixture() {
  const readers = [], localReads = [], roots = [];
  let resolveRoot = async cwd => cwd.replace(/\/sub$/, '');
  let readLocal = async root => ({ configured: true, root, suites: { unit: { outcome: 'passed', stale: false } } });
  let readRemote = async () => ({ repository: 'owner/repo', branch: 'main', workflows: [] });
  class GitHubActions {
    constructor(root) { this.root = root; this.stopped = 0; readers.push(this); }
    read() { return readRemote(this); }
    stop() { this.stopped++; }
  }
  class Pipeline {
    constructor(root) { this.root = root; }
    status() { localReads.push(this.root); return readLocal(this.root); }
  }
  const { PipelineStatusReader } = load('pipeline/api.ts', {
    './core.ts': { Pipeline, projectRoot(cwd) { roots.push(cwd); return resolveRoot(cwd); } },
    './github.ts': { GitHubActions },
  });
  return {
    reader: new PipelineStatusReader(), readers, localReads, roots,
    root(fn) { resolveRoot = fn; }, local(fn) { readLocal = fn; }, remote(fn) { readRemote = fn; },
  };
}

test('composes local and remote data for arbitrary checkout paths without running suites', async () => {
  const f = fixture();
  const status = await f.reader.read('/one/sub');
  assert.equal(status.root, '/one');
  assert.equal(status.suites.unit.outcome, 'passed');
  assert.equal(status.github.repository, 'owner/repo');
  assert.deepEqual(f.localReads, ['/one']);
  assert.equal(f.readers[0].root, '/one');
  f.reader.stop();
});

test('canonical paths reuse a remote reader while local state is reread; roots remain isolated', async () => {
  const f = fixture();
  await f.reader.read('/one/sub'); await f.reader.read('/one'); await f.reader.read('/two');
  assert.deepEqual(f.readers.map(reader => reader.root), ['/one', '/two']);
  assert.deepEqual(f.localReads, ['/one', '/one', '/two']);
  f.reader.stop();
  assert.ok(f.readers.every(reader => reader.stopped === 1));
});

test('concurrent reads of one canonical root share the remote reader', async () => {
  const f = fixture();
  await Promise.all([f.reader.read('/one'), f.reader.read('/one/sub')]);
  assert.equal(f.readers.length, 1);
  f.reader.stop();
});

test('readers have independent ownership and no global cache', async () => {
  const a = fixture(), b = fixture();
  await a.reader.read('/one'); await b.reader.read('/one');
  a.reader.stop();
  assert.equal(b.readers[0].stopped, 0);
  await b.reader.read('/one'); b.reader.stop();
});

test('remote unavailable is data and non-GitHub results omit github entirely', async () => {
  const f = fixture();
  f.remote(async () => ({ repository: 'owner/repo', workflows: [], error: 'GitHub unavailable' }));
  assert.equal((await f.reader.read('/one')).github.error, 'GitHub unavailable');
  f.remote(async () => undefined);
  assert.equal(Object.hasOwn(await f.reader.read('/one'), 'github'), false);
  f.reader.stop();
});

test('local errors propagate instead of becoming a false successful result', async () => {
  const f = fixture();
  f.local(async () => { throw new Error('Invalid configuration'); });
  await assert.rejects(f.reader.read('/one'), /Invalid configuration/);
  f.reader.stop();
});

test('stop is idempotent and subsequent reads reject without resolving cwd', async () => {
  const f = fixture();
  await f.reader.read('/one'); f.reader.stop(); f.reader.stop();
  await assert.rejects(f.reader.read('/two'), /stopped/i);
  assert.deepEqual(f.roots, ['/one']);
  assert.equal(f.readers[0].stopped, 1);
});

test('stop during root resolution prevents creation of a late remote reader', async () => {
  const f = fixture();
  let finish;
  f.root(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.reader.read('/one');
  f.reader.stop(); finish('/one');
  await assert.rejects(pending, /stopped/i);
  assert.equal(f.readers.length, 0);
  assert.deepEqual(f.localReads, []);
});

test('stop cancels in-flight remote reads and rejects late results', async () => {
  const f = fixture();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  f.remote(reader => new Promise(resolve => {
    reader.stop = () => { reader.stopped++; resolve(undefined); };
    started();
  }));
  const pending = f.reader.read('/one');
  await ready; f.reader.stop();
  await assert.rejects(pending, /stopped/i);
  assert.equal(f.readers[0].stopped, 1);
});
