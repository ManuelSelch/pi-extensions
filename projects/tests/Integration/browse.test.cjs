const { test } = require('node:test');
const { createDriver } = require('./Support/driver.cjs');
const app = t => { const d = createDriver(t); d.registerCommands(); return d; };
async function registered(t) {
  const d = app(t); d.createRepository();
  await d.send('create One'); await d.send('add One Backend');
  return d;
}

test('browse completes projects → repositories → details → back without mutations or notifications', async t => {
  const d = await registered(t); d.preserveCatalogue();
  d.respondWithStatus({configured:true,suites:{test:{outcome:'failed',stale:false}},github:{repository:'o/r',branch:'main',workflows:[{name:'CI',status:'completed',conclusion:'success'}]}});
  d.selectProjectNext('One'); d.selectRepositoryNext('Backend'); d.backNext(); d.backNext(); d.closeNext();
  await d.send('browse');
  d.thenMenuCount(5); d.thenMenuTitle(0,'Projects');
  d.thenMenuOption(1,/Backend — Local: ✗ failed · GitHub: ✓ passed/);
  d.thenMenuTitle(2,/^Backend\n[\s\S]*✗ test[\s\S]*✓ CI/);
  d.thenMenuTitle(4,'Projects'); d.thenReadCount(1); d.thenReaderStopped();
  d.thenNoNotices(); d.thenCatalogueUnchanged(); d.thenNativeDialogSignals();
});
test('browse supports empty catalogue and empty projects with no status reads', async t => {
  const d = app(t); d.closeNext(); await d.send('browse');
  d.thenMenuTitle(0,/^Projects\nNo registered projects/);
  await d.send('create Empty'); d.selectProjectNext('Empty'); d.closeNext(); await d.send('browse');
  d.thenMenuTitle(1,'Projects'); d.thenMenuTitle(2,/^Empty\nNo repositories/); d.thenReadCount(0);
});
test('Escape returns one level and closes at Projects', async t => {
  const d = await registered(t);
  d.selectProjectNext('One'); d.selectRepositoryNext('Backend'); d.cancelNext(); d.cancelNext(); d.cancelNext();
  await d.send('browse'); d.thenMenuCount(5); d.thenMenuTitle(4,'Projects'); d.thenReaderStopped(); d.thenNoNotices();
});
test('browse rejects arguments and unsupported modes and adds completion', async t => {
  const d = app(t); d.thenCompletion('bro',['browse']);
  await d.send('browse One'); d.thenNotice(/Usage: \/projects browse/,'error'); d.thenMenuCount(0);
  await d.send('browse',false); d.thenNotice(/interactive.*\/projects list.*\/projects status/i,'error'); d.thenMenuCount(0);
});
test('shared repositories reuse status across projects until refresh and close stops readers', async t => {
  const d = await registered(t); await d.send('create Two'); await d.send('add Two');
  d.selectProjectNext('One'); d.backNext(); d.selectProjectNext('Two'); d.closeNext();
  await d.send('browse'); d.thenReadCountForSharedRepositories(1); d.thenReaderStopped(); d.thenNoNotices();
});
test('refresh rereads selected project status and retains detail navigation', async t => {
  const d = await registered(t);
  d.selectProjectNext('One'); d.selectRepositoryNext('Backend'); d.refreshNext(); d.closeNext();
  await d.send('browse'); d.thenReadCount(2); d.thenMenuTitle(2,/^Backend\n/); d.thenMenuTitle(3,/^Backend\n/);
});
test('refresh rereads catalogue and falls back safely after project or membership removal', async t => {
  const d = await registered(t);
  d.selectProjectNext('One'); d.selectRepositoryNext('Backend'); d.unlinkRepositoryThenRefreshNext(); d.removeProjectThenRefreshNext('One'); d.closeNext();
  await d.send('browse'); d.thenReadCount(1); d.thenMenuTitle(3,/^One\nNo repositories/); d.thenMenuTitle(4,/^Projects\nNo registered projects/);
});
test('catalogue refresh discovers newly registered projects without reading unselected repos', async t => {
  const d = await registered(t); d.addProjectThenRefreshNext('New'); d.closeNext();
  await d.send('browse'); d.thenMenuOption(1,/New — 0 repositories/); d.thenReadCount(0);
});
test('per-repository failure does not hide healthy repositories', async t => {
  const d = app(t); d.seedStatusRepositories(2); d.failOneStatus();
  d.selectProjectNext('Many'); d.selectRepositoryNext('repo-0'); d.closeNext();
  await d.send('browse'); d.thenMenuOption(1,/repo-0 — Local: unavailable/); d.thenMenuOption(1,/repo-1 — Local: ✓ passed/);
  d.thenMenuTitle(2,/Status unavailable: invalid local config/);
});
test('browse bounds concurrent status reads to four', async t => {
  const d = app(t); d.seedStatusRepositories(9); await d.thenBrowseReadsAreBounded();
});
test('session replacement and shutdown discard late status without reopening menus', async t => {
  for (const event of ['session_start','session_shutdown']) {
    const d = await registered(t); d.holdStatus(); d.selectProjectNext('One');
    const pending = d.send('browse'); await d.waitForStatus();
    await d.lifecycle(event); d.thenReaderStopped(); d.releaseStatus(); await pending;
    d.thenMenuCount(1); d.thenNoNotices();
  }
});
test('lifecycle teardown cancels the active native select', async t => {
  const d = app(t); d.holdNextMenu();
  const pending = d.send('browse'); await d.waitForMenu();
  await d.lifecycle('session_shutdown'); await pending; d.thenMenuCount(1); d.thenNoNotices();
});
