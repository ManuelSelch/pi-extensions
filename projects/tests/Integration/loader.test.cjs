const { test } = require('node:test');
const { createDriver } = require('./Support/driver.cjs');

test('real Pi loader registers projects and uses the configured agent directory', async t => {
  const projects = createDriver(t);
  await projects.registerWithPiLoader();
  projects.createRepository();
  await projects.send('create "My project"'); projects.thenStoredProjects('My project');
  await projects.send('add "My project" "My repository"'); projects.thenRepositoryName('My repository');
  await projects.send('show "My project"'); projects.thenNotice(/My repository/);
  projects.thenCompletion('add "My', ['add "My project"']);
  await projects.send('status "My project"'); projects.thenNotice(/My repository[\s\S]*Local: not configured/);
});
