const { test, beforeEach, afterEach } = require('node:test');

const { MarketplaceDriver } = require('./marketplace-driver.cjs');

beforeEach(async t => { t.context = { marketplace: await MarketplaceDriver.create(t) }; });
afterEach(async t => { await t.context?.marketplace?.dispose(); });

test('the extensions marketplace lists the pipeline plugin', async t => {
  const marketplace = t.context.marketplace;

  await marketplace.addMarketplace();

  await marketplace.thenPipelineIsListed();
});

test('pipeline installed from the marketplace connects to its MCP server', async t => {
  const marketplace = t.context.marketplace;
  await marketplace.addMarketplace();

  await marketplace.installPipeline();

  await marketplace.thenInstalledPipelineConnects();
});
