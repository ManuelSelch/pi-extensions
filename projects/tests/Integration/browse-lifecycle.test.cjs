const { test } = require('node:test');
const { createDriver } = require('./Support/driver.cjs');
const app = t => { const d = createDriver(t); d.registerCommands(); return d; };
async function registered(t) {
  const d = app(t); d.createRepository(); await d.send('create One'); await d.send('add One Backend'); return d;
}

test('a superseding browse cancels the old native dialog without opening extra menus', async t => {
  const d = app(t); d.holdNextMenu(); const old = d.send('browse'); await d.waitForMenu();
  d.closeNext(); await d.send('browse'); await old;
  d.thenMenuCount(2); d.thenNoNotices();
});
test('teardown settles even if a native-dialog host ignores AbortSignal', async t => {
  const d = app(t); d.holdNextMenu(true); const pending = d.send('browse'); await d.waitForMenu();
  await d.lifecycle('session_shutdown'); await pending; d.thenMenuCount(1); d.thenNoNotices();
});
test('browser owns its reader independently from text-report caching', async t => {
  const d = await registered(t); await d.send('status'); d.thenActiveReaderCount(1);
  d.selectProjectNext('One'); d.closeNext(); await d.send('browse');
  d.thenReaderStopped(); d.thenActiveReaderCount(1);
  await d.lifecycle('session_shutdown'); d.thenActiveReaderCount(0);
});
test('unlinked retained repositories do not appear or get read', async t => {
  const d = await registered(t); await d.send('remove One');
  d.selectProjectNext('One'); d.closeNext(); await d.send('browse');
  d.thenMenuTitle(1,/^One\nNo repositories/); d.thenReadCount(0);
});
test('browser reads registered default checkout even from a linked-worktree session', async t => {
  const d = await registered(t); d.enterLinkedWorktree();
  d.selectProjectNext('One'); d.closeNext(); await d.send('browse'); d.thenDefaultCheckoutRead();
});
test('malformed catalogue during refresh stops browsing without overwriting corruption', async t => {
  const d = await registered(t); d.loadInfrastructure();
  d.selectProjectNext('One'); d.corruptCatalogueThenRefreshNext(); await d.send('browse');
  d.thenMenuCount(2); d.thenNotice(/JSON|catalogue/i,'error'); d.thenReaderStopped(); d.thenCorruptionPreserved();
});
test('failed native dialogs report the error and stop browser-owned status resources', async t => {
  const d = await registered(t); d.selectProjectNext('One'); d.failNextMenu(); await d.send('browse');
  d.thenNotice(/native dialog failed/,'error'); d.thenReaderStopped();
});
