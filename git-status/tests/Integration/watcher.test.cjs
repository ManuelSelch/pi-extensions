const { test } = require('node:test');
const { GitStatusDriver } = require('./Support/driver.cjs');

test('external merge and push update a linked session without tool callbacks', async t => {
  const app = new GitStatusDriver(t);
  app.setUpstream();
  app.addBranch('feat/search');
  app.commit('feat/search');
  await app.start('feat/search');
  app.merge('feat/search');
  await app.eventuallyRows(['main  ↑1', 'feat/search  ✓']);
  app.push('main');
  await app.eventuallyRows(['main  ✓', 'feat/search  ✓']);
});

test('new nested refs, worktree addition/removal, packed refs and primary HEAD changes are observed', async t => {
  const app = new GitStatusDriver(t);
  app.addBranch('feat/search');
  await app.start('feat/search');
  app.addBranch('fix/deep/new');
  app.commit('fix/deep/new');
  await app.eventuallyRows(['main  no upstream', 'feat/search  ✓', 'fix/deep/new  ●1']);
  app.packRefs();
  app.commit('fix/deep/new');
  await app.eventuallyRows(['main  no upstream', 'feat/search  ✓', 'fix/deep/new  ●2']);
  app.removeBranch('fix/deep/new');
  await app.eventuallyRows(['main  no upstream', 'feat/search  ✓']);
  app.switchPrimary('develop');
  await app.eventuallyRows(['develop  no upstream', 'feat/search  ✓']);
});

test('external staging and committing refresh file status, but unstaged edits alone do not', async t => {
  const app = new GitStatusDriver(t);
  await app.start('main');
  await app.thenNoAutomaticUpdate(() => app.editFile());
  app.stage();
  await app.eventuallyCheckout(/\+1/);
  app.commit('main');
  await app.eventuallyCheckout(/✓/);
  await app.thenNoAutomaticUpdate(() => app.editFile());
  await app.refresh();
  await app.eventuallyCheckout(/~1/);
});

test('metadata-triggered refreshes settle without self-triggered publications', async t => {
  const app = new GitStatusDriver(t);
  await app.start('main');
  app.editFile();
  app.stage();
  await app.eventuallyCheckout(/\+1/);
  await app.thenNoAutomaticUpdate(() => {});
});
