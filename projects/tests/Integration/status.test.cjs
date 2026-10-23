const { test } = require('node:test');
const { createDriver } = require('./Support/driver.cjs');
const app = t => { const d = createDriver(t); d.registerCommands(); return d; };

test('status handles empty catalogue, empty project, autocomplete and usage', async t => {
  const d = app(t);
  await d.send('status'); d.thenNotice(/no projects/i); d.thenReadCount(0);
  await d.send('create "Pi ecosystem"');
  d.thenCompletion('sta', ['status']); d.thenCompletion('status "Pi', ['status "Pi ecosystem"']);
  await d.send('status "Pi ecosystem"'); d.thenNotice(/no repositories/i);
  await d.send('status Unknown'); d.thenNotice(/unknown project/i, 'error');
  await d.send('status one two'); d.thenNotice(/usage/i, 'error');
});
test('reads default checkout and deduplicates shared repositories across all projects', async t => {
  const d = app(t); d.createRepository();
  await d.send('create One'); await d.send('create Two');
  await d.send('add One Backend'); await d.send('add Two'); d.enterLinkedWorktree();
  await d.send('status'); d.thenReadCount(1); d.thenDefaultCheckoutRead();
  d.thenNotice(/One[\s\S]*Backend[\s\S]*Local: not configured[\s\S]*Two[\s\S]*Backend/);
  await d.send('status One'); d.thenReadCount(2); d.thenNotice(/^One\n/);
});
test('shows local and remote status through the pipeline API', async t => {
  const d = app(t); d.createRepository(); await d.send('create One'); await d.send('add One');
  d.respondWithStatus({ configured: true, suites: { test: { outcome: 'failed', stale: true } },
    github: { repository: 'o/r', branch: 'main', workflows: [{ name: 'CI', status: 'completed', conclusion: 'success', jobs: [{ name: 'unit', status: 'queued' }] }] } });
  await d.send('status One', false); d.thenNotice(/⚠ test stale \(✗\)[\s\S]*✓ CI[\s\S]*○ unit queued/);
});
test('repository errors and missing paths do not abort the remaining report', async t => {
  const d = app(t); d.createRepository(); await d.send('create Broken'); await d.send('add Broken'); await d.send('create Empty');
  d.failStatus('Invalid pipeline configuration');
  await d.send('status'); d.thenNotice(/unavailable: Invalid pipeline configuration[\s\S]*Empty[\s\S]*No repositories/);
  d.removeCheckout(); await d.send('status Broken'); d.thenNotice(/unavailable:.*ENOENT/); d.thenReadCount(1);
});
test('keeps healthy repository statuses when another repository fails', async t => {
  const d = app(t); d.seedStatusRepositories(2); d.failOneStatus();
  await d.send('status'); d.thenNotice(/repo-0[\s\S]*unavailable: invalid local config[\s\S]*repo-1[\s\S]*✓ test/);
});
test('bounds concurrent API reads', async t => {
  const d = app(t); d.seedStatusRepositories(9); await d.thenReadsAreBounded();
});
test('stops old readers and suppresses late reports on session replacement or shutdown', async t => {
  const d = app(t); d.createRepository(); await d.send('create One'); await d.send('add One');
  for (const event of ['session_start', 'session_shutdown']) {
    d.holdStatus(); const pending = d.send('status'); await d.waitForStatus();
    await d.lifecycle(event); d.thenReaderStopped(); d.releaseStatus(); await pending; d.thenNoNotices();
  }
  d.respondWithStatus({ configured: false, suites: {} }); await d.send('status'); d.thenNotice(/not configured/);
});
test('real adapter reads local-only Git checkout and rejects missing directories', async t => {
  const d = app(t); d.createRepository(); d.useRealPipeline();
  await d.thenLocalOnlyStatus(); await d.thenConfiguredSuiteNeverRan(); await d.thenMissingCheckoutFails();
});
