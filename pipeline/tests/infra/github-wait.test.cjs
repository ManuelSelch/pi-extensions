const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../pipeline-helpers.cjs');
const { GitHubWaitReader } = load('pipeline/infra/github-wait.ts');
const sha = 'a'.repeat(40);
const wireRun = (overrides = {}) => ({ id: 1, run_attempt: 2, name: 'Tests', head_sha: sha, status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/1', ...overrides });
function fixture(options = {}) {
  const calls = [], controller = new AbortController();
  const execute = async (file, args, cwd, signal) => {
    calls.push({ file, args, cwd, signal });
    if (file === 'git') return args[0] === 'remote' ? (options.remotes ?? 'origin\tgit@github.com:o/r.git (fetch)') : sha;
    if (args.some(arg => arg.includes('/jobs?'))) return JSON.stringify(options.jobs ?? [{ jobs: [{ name: 'unit', conclusion: 'failure', html_url: 'https://github.com/job/1' }] }, { jobs: [{ name: 'lint', conclusion: 'success', html_url: 'https://github.com/job/2' }] }]);
    return JSON.stringify(options.pages ?? [{ workflow_runs: [wireRun()] }]);
  };
  return { reader: new GitHubWaitReader('/project', execute), calls, signal: controller.signal };
}

test('resolves an exact commit safely once, including option-like refs', async () => {
  const f = fixture();

  const target = await f.reader.resolve('--unsafe', f.signal);

  assert.equal(target.repository, 'o/r');
  assert.equal(target.commit, sha);
  assert.deepEqual(Array.from(f.calls[1].args), ['rev-parse', '--verify', '--end-of-options', '--unsafe^{commit}']);
});

test('rejects non-GitHub remotes without issuing a GitHub request', async () => {
  const f = fixture({ remotes: 'origin\thttps://gitlab.com/o/r.git (fetch)' });

  await assert.rejects(f.reader.resolve('HEAD', f.signal), /github.com/);
  assert.equal(f.calls.length, 1);
});

test('queries exact SHA across pages, verifies response SHA, and preserves multiple events', async () => {
  const f = fixture({ pages: [{ workflow_runs: [wireRun(), wireRun({ id: 8, head_sha: 'b'.repeat(40) })] }, { workflow_runs: [wireRun({ id: 2, name: 'Tests' })] }] });
  const target = await f.reader.resolve('HEAD', f.signal);

  const runs = await f.reader.read(target, f.signal);

  assert.deepEqual(Array.from(runs, run => run.id), [1, 2]);
  const call = f.calls.at(-1);
  assert.ok(call.args.includes(`repos/o/r/actions/runs?head_sha=${sha}&per_page=100`));
  assert.ok(call.args.includes('--paginate'));
  assert.ok(call.args.includes('--slurp'));
  assert.equal(call.args[call.args.indexOf('--hostname') + 1], 'github.com');
  assert.equal(call.signal, f.signal);
});

test('deduplicates run IDs with the newest attempt and reads failed jobs for that exact attempt', async () => {
  const f = fixture({ pages: [{ workflow_runs: [wireRun({ run_attempt: 3 }), wireRun({ run_attempt: 2 })] }] });
  const target = await f.reader.resolve('HEAD', f.signal);
  const runs = await f.reader.read(target, f.signal);

  const jobs = await f.reader.failedJobs(target, runs[0], f.signal);

  assert.equal(runs.length, 1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].name, 'unit');
  assert.ok(f.calls.at(-1).args.includes('repos/o/r/actions/runs/1/attempts/3/jobs?per_page=100'));
});

test('malformed API results cannot look like an empty or successful pipeline', async () => {
  for (const pages of [{}, [{}], [{ workflow_runs: [wireRun({ id: undefined })] }], [{ total_count: 1001, workflow_runs: [wireRun()] }]]) {
    const f = fixture({ pages });

    await assert.rejects(f.reader.read({ repository: 'o/r', commit: sha }, f.signal));
  }
});
