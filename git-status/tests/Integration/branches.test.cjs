const { test } = require('node:test');
const { GitStatusDriver } = require('./Support/driver.cjs');

test('clean pushed feature is still unmerged; primary/current/others have stable order from either checkout', async t => {
  const app = new GitStatusDriver(t);
  app.setUpstream();
  app.addBranch('fix/a');
  app.addBranch('feat/z');
  app.commit('feat/z');
  app.push('feat/z');
  await app.inspect('feat/z');
  app.thenClean();
  app.thenBranches(['main', 'feat/z', 'fix/a']);
  app.thenUnmerged('feat/z', 1);
  app.thenPrimary({ upstream: true, ahead: 0, behind: 0 });
  await app.inspect('main');
  app.thenBranches(['main', 'feat/z', 'fix/a']);
});

test('merging updates the widget and shows primary commits to push', async t => {
  const app = new GitStatusDriver(t);
  app.setUpstream();
  app.addBranch('feat/search');
  app.commit('feat/search');
  await app.start('feat/search');
  app.thenRows(['main  ✓', 'feat/search  ●1']);
  app.merge('feat/search');
  await app.refresh();
  app.thenRows(['main  ↑1', 'feat/search  ✓']);
});

test('primary without upstream is explicit and current=primary is not duplicated', async t => {
  const app = new GitStatusDriver(t);
  app.addBranch('feat/search');
  await app.start('main');
  app.thenRows(['main  no upstream', '✓ 1 branch']);
});

test('ordinary checkout uses its primary checked-out branch and preserves file status', async t => {
  const app = new GitStatusDriver(t);
  app.switchPrimary('feature');
  await app.start('feature');
  app.thenRows(['feature  no upstream']);
  app.thenCheckoutVisible();
});

test('detached primary does not falsely claim feature branches are merged', async t => {
  const app = new GitStatusDriver(t);
  app.addBranch('feat/search');
  app.detachPrimary();
  await app.inspect('feat/search');
  app.thenPrimaryUnavailable();
  app.thenUnmerged('feat/search', undefined);
});

test('supplementary read failure keeps checkout status and unknown merge state', async t => {
  const app = new GitStatusDriver(t);
  app.addBranch('feat/search');
  await app.startWithFailure('feat/search', 'rev-list');
  app.thenCheckoutVisible();
  app.thenRows(['main  no upstream', 'feat/search  merge unknown']);
});

test('non-repository clears the widget', async t => {
  const app = new GitStatusDriver(t);
  await app.startOutside();
  app.thenCleared();
});

test('unborn primary preserves file status without claiming a merge', async t => {
  const app = new GitStatusDriver(t);
  app.makeUnborn();
  await app.start('main');
  app.thenCheckoutVisible();
  app.thenRows(['primary branch unavailable', 'new-history  merge unknown']);
});

test('detached linked checkout has no fictitious detached branch row', async t => {
  const app = new GitStatusDriver(t);
  app.addBranch('feat/search');
  app.detach('feat/search');
  await app.start('feat/search');
  app.thenCheckoutVisible();
  app.thenRows(['main  no upstream']);
});

test('failed worktree listing preserves checkout status with explicit unknown state', async t => {
  const app = new GitStatusDriver(t);
  await app.startWithFailure('main', 'worktree');
  app.thenCheckoutVisible();
  app.thenRows(['primary branch unavailable', 'main  merge unknown']);
});

test('primary branch name is discovered, not hardcoded to main', async t => {
  const app = new GitStatusDriver(t);
  app.switchPrimary('develop');
  app.addBranch('feat/search');
  app.commit('feat/search');
  await app.start('feat/search');
  app.thenRows(['develop  no upstream', 'feat/search  ●1']);
});
