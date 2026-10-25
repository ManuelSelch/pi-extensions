const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./pipeline-helpers.cjs');

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
    return JSON.stringify({ workflow_runs: id === '1' ? [{ id: 100, run_attempt: options.attempt ?? 2, status: 'completed', conclusion: 'success', created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:01:00Z', html_url: 'https://github.com/owner/repo/actions/runs/100' }] : [] });
  };
  const { GitHubActions } = load('pipeline/github.ts');
  const reader = new GitHubActions('/project', execute, () => now);
  return { reader, calls, branch(value) { branch = value; }, advance(ms) { now += ms; }, queries() { return calls.filter(([file]) => file === 'gh'); } };
}

test('automatically reads latest run per workflow on current branch without commit matching', async () => {
  const d = driver();
  const status = await d.reader.read();
  assert.equal(status.repository, 'owner/repo');
  assert.equal(status.branch, 'feature/login');
  assert.equal(status.workflows[0].conclusion, 'success');
  assert.equal(status.workflows[0].url, 'https://github.com/owner/repo/actions/runs/100');
  assert.equal(status.workflows[1].status, 'never');
  assert.ok(d.queries().some(([, args]) => args.some(arg => arg.includes('branch=feature%2Flogin'))));
  assert.equal(d.calls.some(([, args]) => args.includes('HEAD')), false);
});

test('jobs are paginated and pinned to the selected run attempt, retaining matrix names and links', async () => {
  const d = driver({ attempt: 3, jobPages: [
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

test('job errors preserve workflow outcome and other workflows without exposing diagnostics', async () => {
  const d = driver({ jobsError: true });
  const status = await d.reader.read();
  assert.equal(status.error, undefined);
  assert.equal(status.workflows[0].conclusion, 'success');
  assert.match(status.workflows[0].jobsError, /jobs unavailable/i);
  assert.equal(status.workflows[0].jobs, undefined);
  assert.equal(status.workflows[1].status, 'never');
  assert.doesNotMatch(JSON.stringify(status), /private/);
});

test('empty jobs stay empty and workflows with no run do not fetch jobs', async () => {
  const d = driver(); const status = await d.reader.read();
  assert.equal(status.workflows[0].jobs.length, 0);
  assert.equal(status.workflows[1].jobs, undefined);
  assert.equal(d.queries().filter(([, args]) => args.some(arg => arg.includes('/jobs?'))).length, 1);
});

test('cache throttles requests for 60 seconds; changing branches invalidates it', async () => {
  const d = driver();
  await d.reader.read(); await d.reader.read();
  assert.equal(d.queries().length, 4);
  d.advance(60000); await d.reader.read();
  assert.equal(d.queries().length, 8);
  d.branch('main');
  assert.equal((await d.reader.read()).branch, 'main');
  assert.equal(d.queries().length, 12);
});

test('non-GitHub repositories and detached HEAD make no GitHub requests', async () => {
  for (const remotes of ['', 'origin\thttps://gitlab.com/owner/repo.git (fetch)\n']) {
    const d = driver({ remotes });
    assert.equal(await d.reader.read(), undefined);
    assert.equal(d.queries().length, 0);
  }
  const d = driver(); d.branch('');
  assert.equal(await d.reader.read(), undefined);
  assert.equal(d.queries().length, 0);
});

test('origin is preferred; HTTPS and fallback GitHub remotes work', async () => {
  const d = driver({ remotes: 'upstream\tgit@github.com:other/repo.git (fetch)\norigin\thttps://github.com/owner/repo.git (fetch)\n' });
  assert.equal((await d.reader.read()).repository, 'owner/repo');
  const fallback = driver({ remotes: 'upstream\tssh://git@github.com/other/repo.git (fetch)\n' });
  assert.equal((await fallback.reader.read()).repository, 'other/repo');
});

test('no workflows is empty; missing CLI and fetch errors are concise and cached', async () => {
  assert.equal((await driver({ workflows: [] }).reader.read()).workflows.length, 0);
  for (const error of ['ENOENT', 'EFAIL']) {
    const d = driver({ error });
    const status = await d.reader.read();
    assert.match(status.error, error === 'ENOENT' ? /install gh/i : /unavailable/i);
    assert.doesNotMatch(status.error, /secret/);
    await d.reader.read(); assert.equal(d.queries().length, 1);
  }
});

test('concurrent refreshes share a request and shutdown aborts pending reads', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const d = driver({ workflows: [{ id: 1, name: 'Tests' }], fetch: async (_args, signal) => {
    await gate;
    if (signal.aborted) throw new Error('aborted');
    return JSON.stringify({ workflow_runs: [] });
  } });
  const first = d.reader.read(), second = d.reader.read();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(d.queries().length, 2);
  d.reader.stop(); release();
  assert.equal(await first, undefined); assert.equal(await second, undefined);
  assert.equal(await d.reader.read(), undefined);
});

test('failed refreshes retain the last successful snapshot and timestamp until recovery', async () => {
  const options = { jobPages: [{ jobs: [{ name: 'unit', status: 'completed', conclusion: 'success' }] }] };
  const d = driver(options);
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

test('initial failures have no stale snapshot; errors use bounded categories without raw diagnostics', async () => {
  for (const [error, kind] of [
    [{ code: 'ETIMEDOUT' }, 'timeout'], [{ killed: true, signal: 'SIGTERM' }, 'timeout'],
    [{ code: 'ENOENT' }, 'missing-cli'], [{ stderr: 'gh: Bad credentials (HTTP 401) secret' }, 'authentication'],
    [{ stderr: 'To get started with GitHub CLI, please run: gh auth login' }, 'authentication'],
    [{ stderr: 'gh: Not Found (HTTP 404) secret' }, 'access'],
    [{ stderr: 'gh: API rate limit exceeded (HTTP 403) secret' }, 'access'],
    [{ stderr: 'error connecting to api.github.com secret' }, 'connection'],
    [{ code: 'EFAIL', message: 'secret' }, 'unknown'],
  ]) {
    const status = await driver({ error }).reader.read();
    assert.equal(status.errorKind, kind);
    assert.equal(status.stale, undefined);
    assert.equal(status.lastSuccessfulAt, undefined);
    assert.equal(status.workflows.length, 0);
    assert.doesNotMatch(JSON.stringify(status), /secret/);
    if (kind !== 'authentication') assert.doesNotMatch(status.error, /gh auth login/);
  }
});

test('branch and repository changes never reuse another selection\'s successful snapshot', async () => {
  const options = {};
  const d = driver(options);
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

test('switching branches aborts previous fetches and discards their late results', async () => {
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const d = driver({ workflows: [{ id: 1, name: 'Tests' }], fetch: async (args, signal) => {
    if (args.some(arg => arg.includes('branch=feature'))) {
      started();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    }
    return JSON.stringify({ workflow_runs: [] });
  } });
  const previous = d.reader.read(); await pending;
  d.branch('main');
  assert.equal((await d.reader.read()).branch, 'main');
  assert.equal(await previous, undefined);
  assert.equal((await d.reader.read()).branch, 'main');
});

test('production CLI boundary enforces timeout, output bounds and noninteractive GitHub host', async () => {
  const invocations = [];
  const { GitHubActions } = load('pipeline/github.ts', {
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

test('unknown run states remain explicit rather than turning green', async () => {
  const d = driver({ workflows: [{ id: 1, name: 'Tests' }], fetch: async () => JSON.stringify({ workflow_runs: [{ status: 'completed', conclusion: 'future-conclusion', created_at: '2020-01-01T00:00:00Z' }] }) });
  assert.equal((await d.reader.read()).workflows[0].conclusion, 'future-conclusion');
});
