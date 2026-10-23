const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { load, fixture, config, approve } = require('./pipeline-helpers.cjs');

async function repository(t) {
  const f = await fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: f.root });
  git('init', '-q');
  await fs.writeFile(path.join(f.root, 'source.txt'), 'source');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'initial');
  const other = path.join(path.dirname(f.root), 'linked worktree');
  git('worktree', 'add', '-q', '-b', 'linked', other);
  return { ...f, other, git };
}
async function writeConfig(root, c) {
  await fs.mkdir(path.join(root, '.pi'), { recursive: true });
  await fs.writeFile(path.join(root, '.pi', 'pipeline.json'), JSON.stringify(c));
}

test('repository approval enables linked-worktree automation while results, logs and locks stay isolated', async t => {
  const f = await repository(t); const { Pipeline } = load();
  const main = new Pipeline(f.root, f.cache); const linked = new Pipeline(f.other, f.cache);
  const c = config(); c.suites.unit.auto = 'after-agent';
  await main.configure(c, async text => { assert.match(text, /all worktrees/i); return true; });
  await writeConfig(f.other, c);
  assert.equal(await linked.isApproved(), true);
  assert.equal(await new Pipeline(f.other, f.cache).isApproved(), true);
  assert.notEqual(main.storage, linked.storage);
  const release = await main.acquire();
  try {
    const result = (await linked.run('all', { automatic: true }))[0];
    assert.equal(result.outcome, 'passed');
    assert.ok(result.logPath.startsWith(linked.storage + path.sep));
    assert.equal((await main.status()).suites.unit.outcome, 'never');
  } finally { await release(); }
  const changed = config('console.log("changed")'); changed.suites.unit.auto = 'after-agent';
  await writeConfig(f.other, changed);
  assert.equal(await linked.isApproved(), false);
  assert.equal((await linked.run('all', { automatic: true })).length, 0);
  await assert.rejects(linked.run(), /approval.*required/i);
  await linked.run('all', { confirm: async text => { assert.match(text, /all worktrees/i); return true; } });
  assert.equal(await main.isApproved(), true, 'approving another config must not erase prior approvals');
  await writeConfig(f.root, changed);
  assert.equal(await main.isApproved(), true);
});

test('approvals do not cross independent repositories, clones or non-git directories', async t => {
  const f = await repository(t); const { Pipeline } = load();
  const p = new Pipeline(f.root, f.cache); await p.configure(config(), approve);
  const clone = path.join(path.dirname(f.root), 'clone');
  f.git('clone', '-q', f.root, clone);
  await writeConfig(clone, config());
  assert.equal(await new Pipeline(clone, f.cache).isApproved(), false);
  const outside = path.join(path.dirname(f.root), 'non-git'); await fs.mkdir(outside);
  const nonGit = new Pipeline(outside, f.cache); await nonGit.configure(config(), approve);
  const other = path.join(path.dirname(f.root), 'other non-git'); await fs.mkdir(other);
  await writeConfig(other, config());
  assert.equal(await new Pipeline(other, f.cache).isApproved(), false);
  assert.equal(await new Pipeline(outside, f.cache).isApproved(), true);
});

test('simultaneous worktree approvals retain both configuration fingerprints', async t => {
  const f = await repository(t); const { Pipeline } = load();
  const a = new Pipeline(f.root, f.cache); const b = new Pipeline(f.other, f.cache);
  await Promise.all([a.configure(config('console.log("a")'), approve), b.configure(config('console.log("b")'), approve)]);
  assert.equal(await a.isApproved(), true);
  assert.equal(await b.isApproved(), true);
  await writeConfig(f.root, config('console.log("b")'));
  await writeConfig(f.other, config('console.log("a")'));
  assert.equal(await a.isApproved(), true);
  assert.equal(await b.isApproved(), true);
});

test('legacy worktree approvals remain valid locally without silently broadening trust', async t => {
  const f = await repository(t); const { Pipeline } = load();
  const main = new Pipeline(f.root, f.cache); const linked = new Pipeline(f.other, f.cache);
  await writeConfig(f.root, config()); await writeConfig(f.other, config());
  await fs.mkdir(main.storage, { recursive: true });
  const fingerprint = createHash('sha256').update(JSON.stringify(await main.config())).digest('hex');
  await fs.writeFile(path.join(main.storage, 'approval.json'), JSON.stringify({ fingerprint }));
  assert.equal(await main.isApproved(), true);
  assert.equal(await linked.isApproved(), false);
  await main.configure(config(), approve);
  assert.equal(await linked.isApproved(), true);
});
