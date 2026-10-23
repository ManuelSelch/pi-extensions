const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const api = require('../load.cjs').loader()(resolve(__dirname, '../..', 'src/Domain/catalogue.ts'));
const repo = { identity: '/repo/.git', path: '/repo', defaultName: 'repo' };

test('parses quoted positional arguments and rejects unfinished quotes', () => {
  assert.deepEqual(api.parseArguments('add "Pi ecosystem" \'Chat UI\''), ['add', 'Pi ecosystem', 'Chat UI']);
  assert.deepEqual(api.parseArguments(' create SolarHeat '), ['create', 'SolarHeat']);
  assert.throws(() => api.parseArguments('add "unfinished'), /quote/i);
  assert.deepEqual(api.parseArguments('repo-name ""'), ['repo-name', '']);
});

test('creates trimmed names, rejects empty and case-insensitive duplicates', () => {
  const data = api.emptyCatalogue();
  const project = api.createProject(data, ' SolarHeat ', 'p1');
  assert.equal(project.name, 'SolarHeat');
  assert.throws(() => api.createProject(data, 'solarheat', 'p2'), /already exists/i);
  assert.throws(() => api.createProject(data, ' ', 'p3'), /name/i);
  assert.throws(() => api.createProject(data, 'bad\nname', 'p3'), /name/i);
});

test('memberships are idempotent and may span projects; names belong to repositories', () => {
  const data = api.emptyCatalogue();
  api.createProject(data, 'One', 'p1');
  api.createProject(data, 'Two', 'p2');
  api.addRepository(data, 'p1', repo, 'Backend');
  api.addRepository(data, 'p1', repo);
  api.addRepository(data, 'p2', { ...repo, path: '/worktree' });
  assert.equal(data.repositories.length, 1);
  assert.equal(data.repositories[0].name, 'Backend');
  assert.equal(data.repositories[0].path, '/repo');
  assert.deepEqual(data.projects.map(p => p.repositories.length), [1, 1]);
  api.nameRepository(data, repo, 'API');
  assert.equal(data.repositories[0].name, 'API');
  api.nameRepository(data, repo);
  assert.equal(data.repositories[0].name, 'repo');
});

test('project rename preserves ID and memberships; remove/delete never delete repository records', () => {
  const data = api.emptyCatalogue();
  api.createProject(data, 'One', 'p1');
  api.addRepository(data, 'p1', repo);
  api.renameProject(data, 'p1', 'New');
  assert.equal(api.findProject(data, 'new').id, 'p1');
  assert.equal(data.projects[0].repositories.length, 1);
  api.removeRepository(data, 'p1', repo.identity);
  assert.equal(data.projects[0].repositories.length, 0);
  api.deleteProject(data, 'p1');
  assert.equal(data.projects.length, 0);
  assert.equal(data.repositories.length, 1);
});

test('unknown projects and unregistered repositories are errors', () => {
  const data = api.emptyCatalogue();
  assert.throws(() => api.findProject(data, 'Missing'), /unknown project/i);
  assert.throws(() => api.nameRepository(data, repo, 'API'), /add/i);
});

test('validates catalogue structure, identities and membership references', () => {
  assert.deepEqual(api.validateCatalogue(api.emptyCatalogue()), api.emptyCatalogue());
  for (const bad of [
    { version: 2, projects: [], repositories: [] },
    { version: 1, projects: [{ id: 'p', name: 'P', repositories: ['missing'] }], repositories: [] },
    { version: 1, projects: [], repositories: [{ identity: 'relative', path: '/r', name: 'R' }] },
  ]) assert.throws(() => api.validateCatalogue(bad), /catalogue/i);
});
