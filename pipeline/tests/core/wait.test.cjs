const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../pipeline-helpers.cjs');
const { waitForPipeline } = load('pipeline/core/wait.ts');

const run = (id = 1, status = 'completed', conclusion = 'success', attempt = 1) => ({ id, attempt, name: `Workflow ${id}`, status, conclusion, url: `https://github.com/o/r/actions/runs/${id}` });
function fixture(snapshots, options = {}) {
  let now = 0, reads = 0, resolves = 0;
  const controller = new AbortController();
  const reader = {
    async resolve(ref) { resolves++; return { repository: 'o/r', commit: ref === 'HEAD' ? 'a'.repeat(40) : ref }; },
    async read() { const value = snapshots[Math.min(reads++, snapshots.length - 1)]; if (value instanceof Error) throw value; return value; },
    async failedJobs() { return [{ name: 'unit', conclusion: 'failure', url: 'https://github.com/job/1' }]; },
  };
  const wait = () => waitForPipeline(reader, { timeoutSeconds: 60, signal: controller.signal, ...options }, {
    now: () => now,
    sleep: async ms => { now += ms; options.onSleep?.(controller); },
  });
  return { wait, controller, reads: () => reads, resolves: () => resolves };
}

test('pins HEAD once and waits for queued and running workflows to complete', async () => {
  const f = fixture([[run(1, 'queued', null)], [run(1, 'in_progress', null)], [run()], [run()]]);

  const result = await f.wait();

  assert.equal(result.outcome, 'passed');
  assert.equal(result.commit, 'a'.repeat(40));
  assert.equal(f.resolves(), 1);
  assert.equal(f.reads(), 4);
});

test('discovers delayed workflows and waits for every run, including same-workflow events', async () => {
  const f = fixture([[], [run()], [run(), run(2, 'queued', null)], [run(), run(2)], [run(), run(2)]], { timeoutSeconds: 90 });

  const result = await f.wait();

  assert.equal(result.outcome, 'passed');
  assert.equal(result.runs.length, 2);
});

test('waits for other runs after failure and returns failed job names and URLs', async () => {
  const f = fixture([[run(1, 'completed', 'failure'), run(2, 'in_progress', null)], [run(1, 'completed', 'failure'), run(2)], [run(1, 'completed', 'failure'), run(2)]]);

  const result = await f.wait();

  assert.equal(result.outcome, 'failed');
  assert.equal(result.runs[0].failedJobs[0].name, 'unit');
  assert.equal(result.runs[0].failedJobs[0].url, 'https://github.com/job/1');
});

test('distinguishes no runs found from unfinished runs at timeout', async () => {
  assert.equal((await fixture([[]]).wait()).outcome, 'not-found');
  assert.equal((await fixture([[run(1, 'waiting', null)]]).wait()).outcome, 'timed-out');
});

test('unknown, cancelled and timed-out remote conclusions are never successful', async () => {
  for (const conclusion of ['cancelled', 'timed_out', 'action_required', 'future', null]) {
    assert.equal((await fixture([[run(1, 'completed', conclusion)]]).wait()).outcome, 'failed');
  }
});

test('skipped and neutral terminal runs do not fail an otherwise successful pipeline', async () => {
  assert.equal((await fixture([[run(), run(2, 'completed', 'skipped'), run(3, 'completed', 'neutral')]]).wait()).outcome, 'passed');
});

test('rerun attempts reset completion confirmation', async () => {
  const f = fixture([[run()], [run(1, 'in_progress', null, 2)], [run(1, 'completed', 'failure', 2)], [run(1, 'completed', 'failure', 2)]]);

  assert.equal((await f.wait()).outcome, 'failed');
  assert.equal(f.reads(), 4);
});

test('a disappearing run is not accepted as a successful empty pipeline', async () => {
  assert.equal((await fixture([[run(1, 'in_progress', null)], []]).wait()).outcome, 'timed-out');
});

test('read errors never reuse a previous successful snapshot', async () => {
  const result = await fixture([[run()], new Error('secret diagnostic')]).wait();

  assert.equal(result.outcome, 'unavailable');
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('cancellation before invocation performs no reads or resolution', async () => {
  const f = fixture([[run()]]); f.controller.abort();

  assert.equal((await f.wait()).outcome, 'cancelled');
  assert.equal(f.reads(), 0);
  assert.equal(f.resolves(), 0);
});

test('cancellation during polling is distinct from remote failure', async () => {
  const f = fixture([[run(1, 'in_progress', null)]], { onSleep: controller => controller.abort() });

  assert.equal((await f.wait()).outcome, 'cancelled');
});

test('job-detail failure retains the failed pipeline outcome', async () => {
  let now = 0;
  const result = await waitForPipeline({
    resolve: async () => ({ repository: 'o/r', commit: 'a'.repeat(40) }),
    read: async () => [run(1, 'completed', 'failure')],
    failedJobs: async () => { throw new Error('secret'); },
  }, {}, { now: () => now, sleep: async ms => { now += ms; } });

  assert.equal(result.outcome, 'failed');
  assert.match(result.runs[0].jobsError, /unavailable/i);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('real deadline aborts in-flight resolution without claiming no pipeline exists', async () => {
  let aborted = false;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = await waitForPipeline({
      resolve: (_ref, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true })),
      read: async () => [], failedJobs: async () => [],
    }, { timeoutSeconds: 0.02 });

    assert.equal(result.outcome, 'timed-out');
    assert.equal(aborted, true);
  } finally { clearTimeout(keepAlive); }
});

test('real polling sleep is promptly cancellable and no late result is emitted', async () => {
  const controller = new AbortController();
  let reads = 0, cancel;
  try {
    const result = await waitForPipeline({
      resolve: async () => ({ repository: 'o/r', commit: 'a'.repeat(40) }),
      read: async () => { reads++; return [run(1, 'in_progress', null)]; }, failedJobs: async () => [],
    }, { signal: controller.signal, onUpdate: () => { cancel = setTimeout(() => controller.abort(), 10); } });

    assert.equal(result.outcome, 'cancelled');
    assert.equal(reads, 1);
  } finally { clearTimeout(cancel); }
});

test('rejects invalid timeouts before accessing GitHub', async () => {
  for (const timeoutSeconds of [0, -1, NaN, Infinity, 86401]) {
    await assert.rejects(fixture([[]], { timeoutSeconds }).wait(), /timeout/i);
  }
});
