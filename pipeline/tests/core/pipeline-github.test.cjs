const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../pipeline-helpers.cjs');

function driver(options = {}) {
  let branch = 'feature/login', now = 0;
  const calls = [];
  const execute = async (file, args, _cwd, signal) => {
    calls.push([file, args]);
    if (file === 'git') return args[0] === 'remote' ? (options.remotes ?? 'origin\tgit@github.com:owner/repo.git (fetch)\n') : branch;
    if (options.error) throw typeof options.error === 'string' ? Object.assign(new Error('secret diagnostic'), { code: options.error }) : options.error;
    if (args.some(arg => arg.includes('/actions/workflows?'))) return JSON.stringify([{ workflows: options.workflows ?? [{ id: 1, name: 'Tests' }, { id: 2, name: 'Lint' }] }]);
    if (args.some(arg => arg.includes('/jobs?'))) {
      if (options.jobsError) throw new Error('private job fetch error');
      return JSON.stringify(options.jobPages ?? [{ jobs: [] }]);
    }
    if (options.fetch) return options.fetch(args, signal);
    const id = args.find(arg => arg.includes('/runs?')).match(/workflows\/(\d+)/)[1];
    const pages = options.runPages ?? [{ workflow_runs: id === '1' ? [{ id: 100, run_number: 1, run_attempt: options.attempt ?? 2, status: 'completed', conclusion: 'success', created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:01:00Z', html_url: 'https://github.com/owner/repo/actions/runs/100' }] : [] }];
    return JSON.stringify(pages);
  };
  const { GitHubActions } = load('pipeline/core/github.ts');
  const reader = new GitHubActions('/project', execute, () => now);
  return { reader, calls, configure(value = {}) { options = value; return this; }, branch(value) { branch = value; }, advance(ms) { now += ms; }, queries() { return calls.filter(([file]) => file === 'gh'); } };
}

beforeEach(t => { t.context = { driver: driver() }; });
afterEach(t => { t.context?.driver?.reader.stop(); });

test('automatically reads latest run per workflow on current branch without commit matching', async t => {
  const d = t.context.driver.configure();
  const status = await d.reader.read();
  assert.equal(status.repository, 'owner/repo');
  assert.equal(status.branch, 'feature/login');
  assert.equal(status.workflows[0].conclusion, 'success');
  assert.equal(status.workflows[0].url, 'https://github.com/owner/repo/actions/runs/100');
  assert.equal(status.workflows[1].status, 'never');
  assert.ok(d.queries().some(([, args]) => args.some(arg => arg.includes('branch=feature%2Flogin'))));
  assert.equal(d.calls.some(([, args]) => args.includes('HEAD')), false);
});

test('highest run number wins across pages despite future timestamps and older reruns', async t => {
  const d = t.context.driver.configure({ workflows: [{ id: 1, name: 'Tests' }], runPages: [
    { workflow_runs: [
      { id: 102, run_number: 2, run_attempt: 1, status: 'completed', conclusion: 'failure', updated_at: '2099-01-01T00:00:00Z' },
      { id: 101, run_number: 1, run_attempt: 3, status: 'completed', conclusion: 'cancelled', updated_at: '2099-01-02T00:00:00Z' },
    ] },
    { workflow_runs: [{ id: 103, run_number: 3, run_attempt: 2, status: 'completed', conclusion: 'success', updated_at: '2020-01-01T00:00:00Z', html_url: 'https://github.com/owner/repo/actions/runs/103' }] },
  ] });

  const workflow = (await d.reader.read()).workflows[0];

  assert.equal(workflow.conclusion, 'success');
  assert.equal(workflow.url, 'https://github.com/owner/repo/actions/runs/103');
  const runArgs = d.queries().find(([, args]) => args.some(arg => arg.includes('/runs?')))[1];
  assert.ok(runArgs.includes('--paginate'));
  assert.ok(runArgs.includes('--slurp'));
  assert.ok(runArgs.some(arg => arg.includes('per_page=100')));
  const jobQueries = d.queries().filter(([, args]) => args.some(arg => arg.includes('/jobs?')));
  assert.equal(jobQueries.length, 1);
  assert.ok(jobQueries[0][1].includes('repos/owner/repo/actions/runs/103/attempts/2/jobs?per_page=100'));
});

test('jobs are paginated and pinned to the selected run attempt, retaining matrix names and links', async t => {
  const d = t.context.driver.configure({ attempt: 3, jobPages: [
    { jobs: [{ name: 'build (node 24)', status: 'completed', conclusion: 'success', html_url: 'https://github.com/owner/repo/actions/runs/100/job/1' }] },
    { jobs: [{ name: 'e2e', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/owner/repo/actions/runs/100/job/2' }, { name: 'sonar', status: 'queued', conclusion: null }] },
  ] });
  const workflow = (await d.reader.read()).workflows[0];
  assert.equal(workflow.jobs.length, 3);
  assert.equal(workflow.jobs[0].name, 'build (node 24)');
  assert.equal(workflow.jobs[1].conclusion, 'failure');
  assert.ok(workflow.jobs[1].url.endsWith('/job/2'));
  assert.equal(workflow.jobs[2].status, 'queued');
  assert.equal(workflow.jobs[2].conclusion, undefined);
  const args = d.queries().find(([, args]) => args.some(arg => arg.includes('/jobs?')))[1];
  assert.ok(args.includes('repos/owner/repo/actions/runs/100/attempts/3/jobs?per_page=100'));
  assert.ok(args.includes('--paginate')); assert.ok(args.includes('--slurp'));
});

test('job errors preserve workflow outcome and other workflows without exposing diagnostics', async t => {
  const d = t.context.driver.configure({ jobsError: true });
  const status = await d.reader.read();
  assert.equal(status.error, undefined);
  assert.equal(status.workflows[0].conclusion, 'success');
  assert.match(status.workflows[0].jobsError, /jobs unavailable/i);
  assert.equal(status.workflows[0].jobs, undefined);
  assert.equal(status.workflows[1].status, 'never');
  assert.doesNotMatch(JSON.stringify(status), /private/);
});

test('empty jobs stay empty and workflows with no run do not fetch jobs', async t => {
  const d = t.context.driver.configure(); const status = await d.reader.read();
  assert.equal(status.workflows[0].jobs.length, 0);
  assert.equal(status.workflows[1].jobs, undefined);
  assert.equal(d.queries().filter(([, args]) => args.some(arg => arg.includes('/jobs?'))).length, 1);
});

test('cache throttles requests for 60 seconds; changing branches invalidates it', async t => {
  const d = t.context.driver.configure();
  await d.reader.read(); await d.reader.read();
  assert.equal(d.queries().length, 4);
  d.advance(60000); await d.reader.read();
  assert.equal(d.queries().length, 8);
  d.branch('main');
  assert.equal((await d.reader.read()).branch, 'main');
  assert.equal(d.queries().length, 12);
});

test('forced reads bypass the TTL, update the shared cache and retain snapshots on failure', async t => {
  const options = {};
  const d = t.context.driver.configure(options);
  const initial = await d.reader.read();
  d.advance(1000);

  const refreshed = await d.reader.read({ force: true });

  assert.notEqual(refreshed, initial);
  assert.equal(refreshed.checkedAt, new Date(1000).toISOString());
  assert.equal(d.queries().length, 8);
  assert.equal(await d.reader.read(), refreshed);
  assert.equal(d.queries().length, 8);

  options.error = 'ETIMEDOUT';
  const failed = await d.reader.read({ force: true });

  assert.equal(failed.stale, true);
  assert.deepEqual(failed.workflows, refreshed.workflows);
  assert.equal(failed.lastSuccessfulAt, refreshed.lastSuccessfulAt);
  delete options.error;
  assert.equal((await d.reader.read({ force: true })).error, undefined);
});

test('forced and ordinary reads share an in-flight refresh', async t => {
  const options = { workflows: [{ id: 1, name: 'Tests' }] };
  const d = t.context.driver.configure(options);
  await d.reader.read();
  const before = d.queries().length;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  options.fetch = async () => { await gate; return JSON.stringify([{ workflow_runs: [] }]); };

  const forced = d.reader.read({ force: true });
  await new Promise(resolve => setImmediate(resolve));
  const second = d.reader.read({ force: true }), ordinary = d.reader.read();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(d.queries().length, before + 2);
  release();
  const result = await forced;
  assert.equal(await second, result);
  assert.equal(await ordinary, result);
  assert.equal(await d.reader.read(), result);
});

for (const remotes of ['', 'origin\thttps://gitlab.com/owner/repo.git (fetch)\n']) {
  test(`non-GitHub remote ${JSON.stringify(remotes)} makes no GitHub requests`, async t => {
    const d = t.context.driver.configure({ remotes });
    assert.equal(await d.reader.read(), undefined);
    assert.equal(d.queries().length, 0);
  });
}
test('detached HEAD makes no GitHub requests', async t => {
  const d = t.context.driver.configure(); d.branch('');
  assert.equal(await d.reader.read(), undefined);
  assert.equal(d.queries().length, 0);
});

for (const [name, remotes, repository] of [
  ['origin is preferred over upstream', 'upstream\tgit@github.com:other/repo.git (fetch)\norigin\thttps://github.com/owner/repo.git (fetch)\n', 'owner/repo'],
  ['SSH fallback remote works', 'upstream\tssh://git@github.com/other/repo.git (fetch)\n', 'other/repo'],
]) {
  test(name, async t => {
    const d = t.context.driver.configure({ remotes });
    assert.equal((await d.reader.read()).repository, repository);
  });
}

test('no workflows is empty', async t => {
  assert.equal((await t.context.driver.configure({ workflows: [] }).reader.read()).workflows.length, 0);
});
for (const error of ['ENOENT', 'EFAIL']) {
  test(`GitHub error ${error} is concise and cached`, async t => {
    const d = t.context.driver.configure({ error });
    const status = await d.reader.read();
    assert.match(status.error, error === 'ENOENT' ? /install gh/i : /unavailable/i);
    assert.doesNotMatch(status.error, /secret/);
    await d.reader.read(); assert.equal(d.queries().length, 1);
  });
}

test('concurrent refreshes share a request and shutdown aborts pending reads', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const d = t.context.driver.configure({ workflows: [{ id: 1, name: 'Tests' }], fetch: async (_args, signal) => {
    await gate;
    if (signal.aborted) throw new Error('aborted');
    return JSON.stringify([{ workflow_runs: [] }]);
  } });
  const first = d.reader.read(), second = d.reader.read();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(d.queries().length, 2);
  d.reader.stop(); release();
  assert.equal(await first, undefined); assert.equal(await second, undefined);
  assert.equal(await d.reader.read(), undefined);
});

test('failed refreshes retain the last successful snapshot and timestamp until recovery', async t => {
  const options = { jobPages: [{ jobs: [{ name: 'unit', status: 'completed', conclusion: 'success' }] }] };
  const d = t.context.driver.configure(options);
  const success = await d.reader.read();
  assert.equal(success.lastSuccessfulAt, new Date(0).toISOString());
  options.error = 'ETIMEDOUT'; d.advance(60000);
  const failed = await d.reader.read();
  assert.ok(failed.error);
  assert.equal(failed.stale, true);
  assert.equal(failed.errorKind, 'timeout');
  assert.deepEqual(failed.workflows, success.workflows);
  assert.equal(failed.lastSuccessfulAt, success.lastSuccessfulAt);
  assert.equal(failed.checkedAt, new Date(60000).toISOString());
  const count = d.queries().length;
  assert.equal(await d.reader.read(), failed);
  assert.equal(d.queries().length, count);
  d.advance(60000);
  assert.equal((await d.reader.read()).lastSuccessfulAt, success.lastSuccessfulAt);
  delete options.error; d.advance(60000);
  const recovered = await d.reader.read();
  assert.equal(recovered.workflows[0].conclusion, 'success');
  assert.equal(recovered.error, undefined);
  assert.equal(recovered.stale, undefined);
  assert.equal(recovered.errorKind, undefined);
  assert.equal(recovered.lastSuccessfulAt, new Date(180000).toISOString());
});

for (const [error, kind] of [
    [{ code: 'ETIMEDOUT' }, 'timeout'], [{ killed: true, signal: 'SIGTERM' }, 'timeout'],
    [{ code: 'ENOENT' }, 'missing-cli'], [{ stderr: 'gh: Bad credentials (HTTP 401) secret' }, 'authentication'],
    [{ stderr: 'To get started with GitHub CLI, please run: gh auth login' }, 'authentication'],
    [{ stderr: 'gh: Not Found (HTTP 404) secret' }, 'access'],
    [{ stderr: 'gh: API rate limit exceeded (HTTP 403) secret' }, 'access'],
    [{ stderr: 'error connecting to api.github.com secret' }, 'connection'],
    [{ code: 'EFAIL', message: 'secret' }, 'unknown'],
]) {
  test(`initial ${kind} failure has no stale snapshot or raw diagnostics`, async t => {
    const status = await t.context.driver.configure({ error }).reader.read();
    assert.equal(status.errorKind, kind);
    assert.equal(status.stale, undefined);
    assert.equal(status.lastSuccessfulAt, undefined);
    assert.equal(status.workflows.length, 0);
    assert.doesNotMatch(JSON.stringify(status), /secret/);
    if (kind !== 'authentication') assert.doesNotMatch(status.error, /gh auth login/);
  });
}

test('branch and repository changes never reuse another selection\'s successful snapshot', async t => {
  const options = {};
  const d = t.context.driver.configure(options);
  await d.reader.read();
  options.error = 'ETIMEDOUT'; d.branch('main');
  const branch = await d.reader.read();
  assert.equal(branch.stale, undefined);
  assert.equal(branch.workflows.length, 0);
  delete options.error;
  d.advance(60000); await d.reader.read();
  options.error = 'ETIMEDOUT'; options.remotes = 'origin\thttps://github.com/other/repo.git (fetch)';
  const repo = await d.reader.read();
  assert.equal(repo.repository, 'other/repo');
  assert.equal(repo.stale, undefined);
  assert.equal(repo.workflows.length, 0);
});

test('switching branches aborts previous fetches and discards their late results', async t => {
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const d = t.context.driver.configure({ workflows: [{ id: 1, name: 'Tests' }], fetch: async (args, signal) => {
    if (args.some(arg => arg.includes('branch=feature'))) {
      started();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    }
    return JSON.stringify([{ workflow_runs: [] }]);
  } });
  const previous = d.reader.read(); await pending;
  d.branch('main');
  assert.equal((await d.reader.read()).branch, 'main');
  assert.equal(await previous, undefined);
  assert.equal((await d.reader.read()).branch, 'main');
});

test('production CLI boundary enforces timeout, output bounds and noninteractive GitHub host', async t => {
  const invocations = [];
  const { GitHubActions } = load('pipeline/core/github.ts', {
    'node:util': { promisify: fn => fn },
    'node:child_process': { execFile: async (file, args, options) => {
      invocations.push({ file, args, options });
      if (file === 'git') return { stdout: args[0] === 'remote' ? 'origin\thttps://github.com/owner/repo.git (fetch)' : 'main' };
      throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    } },
  });
  const reader = new GitHubActions('/project');
  assert.ok((await reader.read()).error);
  const call = invocations.find(call => call.file === 'gh');
  assert.equal(call.options.timeout, 10000);
  assert.equal(call.options.maxBuffer, 2 * 1024 * 1024);
  assert.equal(call.options.env.GH_PROMPT_DISABLED, '1');
  assert.equal(call.args[call.args.indexOf('--hostname') + 1], 'github.com');
  reader.stop(); assert.equal(call.options.signal.aborted, true);
});

test('unknown run states remain explicit rather than turning green', async t => {
  const d = t.context.driver.configure({ workflows: [{ id: 1, name: 'Tests' }], fetch: async () => JSON.stringify([{ workflow_runs: [{ run_number: 1, status: 'completed', conclusion: 'future-conclusion', created_at: '2020-01-01T00:00:00Z' }] }]) });
  assert.equal((await d.reader.read()).workflows[0].conclusion, 'future-conclusion');
});
