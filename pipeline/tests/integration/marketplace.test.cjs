const { test } = require('node:test');

const { MarketplaceDriver } = require('./marketplace-driver.cjs');

test('the extensions marketplace lists the pipeline plugin', async t => {
  const marketplace = await MarketplaceDriver.create(t);

  await marketplace.addMarketplace();

  await marketplace.thenPipelineIsListed();
});

test('pipeline installed from the marketplace connects to its MCP server', async t => {
  const marketplace = await MarketplaceDriver.create(t);
  await marketplace.addMarketplace();

  await marketplace.installPipeline();

  await marketplace.thenInstalledPipelineConnects();
});
