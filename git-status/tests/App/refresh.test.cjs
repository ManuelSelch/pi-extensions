const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { loader } = require('../load.cjs');
const load = () => loader()(join(__dirname, '../../App/refresh.ts'));
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('debounces bursts and does no polling while idle', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const queue = load().createRefreshQueue(async () => calls++, assert.fail);
  t.after(() => queue.close());
  queue.invalidate();
  t.mock.timers.tick(400);
  queue.invalidate();
  t.mock.timers.tick(400);
  assert.equal(calls, 0);
  t.mock.timers.tick(100);
  await settle();
  assert.equal(calls, 1);
  t.mock.timers.tick(10000);
  assert.equal(calls, 1);
});

test('sustained events refresh at maximum wait', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const queue = load().createRefreshQueue(async () => calls++, assert.fail);
  t.after(() => queue.close());
  for (let i = 0; i < 5; i++) { queue.invalidate(); t.mock.timers.tick(400); }
  await settle();
  assert.equal(calls, 1);
});

test('serializes reads and follows an in-flight invalidation once', async () => {
  let calls = 0, release;
  const queue = load().createRefreshQueue(async () => {
    calls++;
    if (calls === 1) await new Promise(resolve => { release = resolve; });
  }, assert.fail);
  const first = queue.request();
  queue.invalidate();
  queue.invalidate();
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(calls, 2);
  queue.close();
});

test('disposal cancels pending work and ignores late invalidation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const queue = load().createRefreshQueue(async () => calls++, assert.fail);
  queue.invalidate();
  queue.close();
  queue.invalidate();
  t.mock.timers.tick(10000);
  await queue.request();
  assert.equal(calls, 0);
});

test('reports read failures and accepts subsequent refreshes', async () => {
  const errors = [];
  let calls = 0;
  const queue = load().createRefreshQueue(async () => { if (++calls === 1) throw new Error('failed'); }, e => errors.push(e));
  await queue.request();
  await queue.request();
  assert.equal(calls, 2);
  assert.equal(errors.length, 1);
  queue.close();
});
