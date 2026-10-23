const { test } = require('node:test');
const { createLayoutDriver } = require('./Support/layout-driver.cjs');

test('each extension has one native folder entry, except the deferred projects loader', t => {
  const repo = createLayoutDriver(t);
  repo.thenOwnedLayout();
});
test('normal Pi resolution loads only intended entries and preserves registrations', async t => {
  const repo = createLayoutDriver(t);
  await repo.loadWithNativeDiscovery();
  repo.thenExpectedRegistrations();
});
