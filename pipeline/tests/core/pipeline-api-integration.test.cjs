const { test, beforeEach, afterEach } = require('node:test');
const { createApiDriver } = require('./pipeline-api-driver.cjs');

beforeEach(async t => { t.context = { app: await createApiDriver(t) }; });
afterEach(async t => { await t.context?.app?.stop(); });

test('API canonicalizes real Git subdirectories and keeps linked-worktree results isolated', async t => {
  const app = t.context.app;
  await app.createRepository(); await app.configureLocalSuite();
  app.enterSubdirectory(); await app.read(); app.thenSuiteNeverRan();
  app.enterRoot(); await app.read(); app.thenReaderCount(1);
  await app.enterLinkedWorktree(); await app.read();
  app.thenNoLocalConfiguration(); app.thenReaderCount(2); app.thenRootsAreDistinct();
  await app.thenReadOnly(); app.stop(); app.thenAllReadersStopped();
});

test('API accepts an existing non-Git directory without creating configuration or caches', async t => {
  const app = t.context.app;
  await app.read(); app.thenNoLocalConfiguration(); await app.thenReadOnly();
  await app.thenMissingPathRejected();
});
