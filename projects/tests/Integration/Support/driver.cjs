const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loader } = require('../../load.cjs');

function createDriver(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-projects-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const load = loader({ '@earendil-works/pi-coding-agent': { getAgentDir: () => path.join(root, 'agent') } });
  const source = name => path.resolve(__dirname, '../../../src', name);
  let store, git, command;
  const notices = [], selections = [];
  let confirmation = true, cwd = root;
  const run = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const repo = path.join(root, 'repo');
  const file = path.join(root, 'agent/projects/config.json');
  const driver = {
    loadInfrastructure() { store = load(source('Infra/storage.ts')); git = load(source('Infra/git.ts')); },
    registerCommands() {
      load(source('App/extension.ts')).default({ registerCommand(name, value) { assert.equal(name, 'projects'); command = value; } });
    },
    async registerWithPiLoader() {
      const previous = process.env.PI_CODING_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = path.join(root, 'agent');
      t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
      const { loadExtensions } = await import('../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js');
      const loaded = await loadExtensions([path.resolve(__dirname, '../../../../projects.ts')], root);
      assert.deepEqual(loaded.errors, []);
      assert.equal(loaded.extensions.length, 1);
      command = loaded.extensions[0].commands.get('projects');
      assert.ok(command);
      assert.equal(fs.existsSync(file), false, 'registration has no filesystem side effects');
    },
    createRepository() {
      fs.mkdirSync(repo);
      run(repo, 'init');
      run(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'initial');
      cwd = repo;
    },
    enterSubdirectory() { cwd = path.join(repo, 'sub'); fs.mkdirSync(cwd); },
    enterLinkedWorktree() { cwd = path.join(root, 'linked'); run(repo, 'worktree', 'add', '-b', 'feature', cwd); },
    enterNonRepository() { cwd = root; },
    async thenRepositoryResolves() {
      const resolved = await git.resolveRepository(cwd);
      assert.equal(resolved.identity, fs.realpathSync(path.join(repo, '.git')));
      assert.equal(resolved.path, fs.realpathSync(cwd.endsWith('sub') ? repo : cwd));
      assert.equal(resolved.defaultName, 'repo');
    },
    async thenRepositoryResolutionFails() { await assert.rejects(git.resolveRepository(cwd), /Git repository/i); },
    thenEmptyCatalogue() { assert.equal(store.readCatalogue(file).projects.length, 0); assert.equal(fs.existsSync(file), false); },
    createStoredProject(name = 'One') { store.updateCatalogue(file, data => { data.projects.push({ id: name, name, repositories: [] }); }); },
    thenStoredProjects(...names) { assert.deepEqual(JSON.parse(fs.readFileSync(file)).projects.map(p => p.name), names); },
    corruptCatalogue() { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{broken'); },
    thenCorruptionPreserved() { assert.throws(() => driver.createStoredProject(), /JSON|catalogue/i); assert.equal(fs.readFileSync(file, 'utf8'), '{broken'); },
    lockCatalogue() { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.mkdirSync(file + '.lock'); },
    thenLockedUpdateFails() { assert.throws(() => driver.createStoredProject(), /locked/i); assert.equal(fs.existsSync(file), false); },
    thenFailedMutationIsAtomic() {
      const before = fs.readFileSync(file, 'utf8');
      assert.throws(() => store.updateCatalogue(file, data => { data.projects.length = 0; throw new Error('failed'); }), /failed/);
      assert.equal(fs.readFileSync(file, 'utf8'), before);
      assert.equal(fs.existsSync(file + '.lock'), false);
      assert.deepEqual(fs.readdirSync(path.dirname(file)), ['config.json']);
    },
    selectNext(value) { selections.push(value); },
    confirmNext(value) { confirmation = value; },
    async send(input, interactive = true) {
      notices.length = 0;
      await command.handler(input, { cwd, hasUI: interactive, ui: {
        notify(message, level) { notices.push({ message, level }); },
        async select(_title, options) { const choice = selections.shift(); return typeof choice === 'number' ? options[choice] : choice; },
        async confirm() { return confirmation; },
      } });
    },
    thenNotice(pattern, level) { assert.ok(notices.some(n => pattern.test(n.message) && (!level || n.level === level)), JSON.stringify(notices)); },
    thenNoNotices() { assert.deepEqual(notices, []); },
    thenCompletion(prefix, expected) { assert.deepEqual(command.getArgumentCompletions(prefix)?.map(item => item.value) ?? [], expected); },
    thenNoHelpCompletion() { assert.ok(!command.getArgumentCompletions('')?.some(item => item.value === 'help')); },
    thenRepositoryName(name) { assert.equal(JSON.parse(fs.readFileSync(file)).repositories[0].name, name); },
    thenMembershipCount(count) { assert.equal(JSON.parse(fs.readFileSync(file)).projects[0].repositories.length, count); },
    thenRepositoryStillExists() { assert.equal(fs.existsSync(path.join(repo, '.git')), true); },
  };
  return driver;
}
module.exports = { createDriver };
