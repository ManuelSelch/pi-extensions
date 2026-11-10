const { test } = require('node:test');
const { createApiDriver } = require('./pipeline-api-driver.cjs');

test('a passed suite remains passed after source or configuration changes', async t => {
  const pipeline = await createApiDriver(t);
  await pipeline.runPassingSuite();
  await pipeline.changeSourceAndConfiguration();
  await pipeline.shouldShowPassedWithoutStale();
});

test('a failed suite remains failed after source changes', async t => {
  const pipeline = await createApiDriver(t);
  await pipeline.runFailingSuite();
  await pipeline.changeSource();
  await pipeline.shouldShowFailedWithoutStale();
});

test('a failed GitHub refresh reports unavailable without stale results', async t => {
  const pipeline = await createApiDriver(t);
  await pipeline.fetchPassingGitHubStatus();
  await pipeline.failGitHubRefresh();
  await pipeline.shouldShowGitHubUnavailableWithoutStaleResults();
});
