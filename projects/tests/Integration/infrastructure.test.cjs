const { test } = require('node:test');
const { createDriver } = require('./Support/driver.cjs');

test('reading missing configuration does not create directories or files', t => {
  const app = createDriver(t); app.loadInfrastructure(); app.thenEmptyCatalogue();
});
test('persists successive mutations and releases locks after failed mutations', t => {
  const app = createDriver(t); app.loadInfrastructure();
  app.createStoredProject('One'); app.createStoredProject('Two');
  app.thenStoredProjects('One', 'Two'); app.thenFailedMutationIsAtomic();
});
test('never overwrites malformed JSON', t => {
  const app = createDriver(t); app.loadInfrastructure(); app.corruptCatalogue(); app.thenCorruptionPreserved();
});
test('refuses an update owned by another process', t => {
  const app = createDriver(t); app.loadInfrastructure(); app.lockCatalogue(); app.thenLockedUpdateFails();
});
test('resolves a subdirectory and linked worktree to the same repository', async t => {
  const app = createDriver(t); app.loadInfrastructure(); app.createRepository();
  app.enterSubdirectory(); await app.thenRepositoryResolves();
  app.enterLinkedWorktree(); await app.thenRepositoryResolves();
});
test('reports cwd outside Git without registering it', async t => {
  const app = createDriver(t); app.loadInfrastructure(); await app.thenRepositoryResolutionFails(); app.thenEmptyCatalogue();
});
