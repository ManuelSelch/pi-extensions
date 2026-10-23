const { test } = require('node:test');
const { createDriver } = require('./Support/driver.cjs');

function app(t) { const driver = createDriver(t); driver.registerCommands(); return driver; }

test('registers command without help; empty catalogue and create/list/show work', async t => {
  const projects = app(t);
  projects.thenNoHelpCompletion();
  await projects.send(''); projects.thenNotice(/no projects/i);
  await projects.send('create "Pi ecosystem"'); projects.thenStoredProjects('Pi ecosystem');
  await projects.send('list'); projects.thenNotice(/Pi ecosystem.*0/);
  await projects.send('show "Pi ecosystem"'); projects.thenNotice(/no repositories/i);
  await projects.send('create "pi ecosystem"'); projects.thenNotice(/already exists/i, 'error');
});
test('adds from a subdirectory, uses positional name, and shares names across projects', async t => {
  const projects = app(t); projects.createRepository(); projects.enterSubdirectory();
  await projects.send('create One'); await projects.send('create Two');
  await projects.send('add One Backend'); projects.thenRepositoryName('Backend');
  await projects.send('add One'); projects.thenMembershipCount(1);
  projects.enterLinkedWorktree(); await projects.send('add Two');
  await projects.send('repo-name "Backend API"'); projects.thenRepositoryName('Backend API');
  await projects.send('show One'); projects.thenNotice(/Backend API/);
  await projects.send('repo-name'); projects.thenRepositoryName('repo');
});
test('project picker supports selection and cancellation for add/remove', async t => {
  const projects = app(t); projects.createRepository(); await projects.send('create One');
  projects.selectNext(undefined); await projects.send('add'); projects.thenMembershipCount(0); projects.thenNoNotices();
  projects.selectNext(0); await projects.send('add'); projects.thenMembershipCount(1);
  projects.selectNext(undefined); await projects.send('remove'); projects.thenMembershipCount(1);
  projects.selectNext(0); await projects.send('remove'); projects.thenMembershipCount(0);
});
test('rename retains memberships; delete requires confirmation and never deletes repository files', async t => {
  const projects = app(t); projects.createRepository(); await projects.send('create One'); await projects.send('add One');
  await projects.send('rename One "New project"'); projects.thenStoredProjects('New project'); projects.thenMembershipCount(1);
  projects.confirmNext(false); await projects.send('delete "New project"'); projects.thenStoredProjects('New project');
  projects.confirmNext(true); await projects.send('delete "New project"'); projects.thenStoredProjects(); projects.thenRepositoryStillExists();
});
test('rejects invalid usage, unknown projects, non-Git cwd and noninteractive pickers', async t => {
  const projects = app(t); await projects.send('create One');
  await projects.send('add One'); projects.thenNotice(/Git repository/, 'error');
  projects.createRepository();
  await projects.send('add Unknown'); projects.thenNotice(/unknown project/i, 'error');
  await projects.send('add', false); projects.thenNotice(/interactive|specify/i, 'error');
  await projects.send('delete One', false); projects.thenNotice(/confirmation|interactive/i, 'error');
  for (const input of ['create', 'list extra', 'add One Backend extra', 'help', 'rename One', 'create "unfinished', 'toString', '__proto__']) {
    await projects.send(input); projects.thenNotice(/usage|unknown|quote/i, 'error');
  }
  await projects.send('add One ""'); projects.thenNotice(/name/i, 'error');
  projects.thenMembershipCount(0);
});
test('completes project names including unfinished quoted names and reads changes immediately', async t => {
  const projects = app(t);
  projects.thenCompletion('cr', ['create']);
  await projects.send('create "Pi ecosystem"');
  projects.thenCompletion('add Pi', ['add "Pi ecosystem"']);
  projects.thenCompletion('show "Pi', ['show "Pi ecosystem"']);
  projects.thenCompletion('rename "Pi ecosystem" ', []);
  projects.thenCompletion('create ', []);
  await projects.send('rename "Pi ecosystem" New');
  projects.thenCompletion('add N', ['add New']);
});
