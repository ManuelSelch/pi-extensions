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
  let store, git, command, pipeline;
  const events = new Map();
  const readers = [], reads = [];
  let response = async () => ({ configured: false, suites: {} });
  const statusLoad = loader({
    '@earendil-works/pi-coding-agent': { getAgentDir: () => path.join(root, 'agent') },
    '../../../pipeline/api.ts': { PipelineStatusReader: class {
      constructor() { readers.push(this); this.stopped = false; }
      read(path) { reads.push(path); return response(path); }
      stop() { this.stopped = true; }
    } },
  });
  const notices = [], selections = [], menus = [];
  const chooseMatching = (pattern, before) => selections.push(async (_title, options) => {
    before?.();
    const choice = options.find(option => pattern.test(option));
    assert.ok(choice, `Missing option ${pattern}: ${options.join('; ')}`);
    return choice;
  });
  let confirmation = true, cwd = root;
  const run = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const repo = path.join(root, 'repo');
  const file = path.join(root, 'agent/projects/config.json');
  const driver = {
    loadInfrastructure() { store = load(source('Infra/storage.ts')); git = load(source('Infra/git.ts')); },
    registerCommands() {
      statusLoad(source('App/extension.ts')).default({
        registerCommand(name, value) { assert.equal(name, 'projects'); command = value; },
        on(name, handler) { events.set(name, handler); },
      });
    },
    useRealPipeline() { pipeline = new (load(source('Infra/pipeline.ts')).ProjectPipelineReader)(); t.after(() => pipeline.stop()); },
    async thenLocalOnlyStatus() {
      const result = await pipeline.read(repo);
      assert.equal(result.configured, false); assert.deepEqual(result.suites, {}); assert.equal(result.github, undefined);
    },
    async thenMissingCheckoutFails() { await assert.rejects(pipeline.read(path.join(root, 'missing')), /ENOENT/); },
    async thenConfiguredSuiteNeverRan() {
      fs.mkdirSync(path.join(repo, '.pi'));
      fs.writeFileSync(path.join(repo, '.pi/pipeline.json'), JSON.stringify({ version: 1, suites: { test: { command: ['do-not-execute'] } } }));
      const result = await pipeline.read(repo);
      assert.equal(result.configured, true); assert.equal(result.suites.test.outcome, 'never');
    },
    failOneStatus() { response = async checkout => {
      if (checkout.endsWith('repo-0')) throw new Error('invalid local config');
      return { configured: true, suites: { test: { outcome: 'passed', stale: false } } };
    }; },
    removeCheckout() { fs.rmSync(repo, { recursive: true, force: true }); },
    respondWithStatus(value) { response = async () => value; },
    failStatus(message) { response = async () => { throw new Error(message); }; },
    thenReadCount(count) { assert.equal(reads.length, count); },
    thenDefaultCheckoutRead() { assert.equal(reads.at(-1), fs.realpathSync(repo)); },
    async lifecycle(name) { await events.get(name)?.({}, {}); },
    thenReaderStopped() { assert.ok(readers.at(-1).stopped); },
    thenActiveReaderCount(count) { assert.equal(readers.filter(reader => !reader.stopped).length, count); },
    holdStatus() {
      let release, entered;
      const started = new Promise(resolve => { entered = resolve; });
      const pending = new Promise(resolve => { release = resolve; });
      response = async () => { entered(); return pending; };
      driver.waitForStatus = () => started;
      driver.releaseStatus = () => release({ configured: false, suites: {} });
    },
    seedStatusRepositories(count) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const repositories = Array.from({ length: count }, (_, i) => ({ identity: path.join(root, `git-${i}`), name: `repo-${i}`, path: path.join(root, `repo-${i}`) }));
      for (const repository of repositories) fs.mkdirSync(repository.path);
      fs.writeFileSync(file, JSON.stringify({ version: 1, repositories, projects: [{ id: 'many', name: 'Many', repositories: repositories.map(r => r.identity) }] }));
    },
    async thenReadsAreBounded() {
      let active = 0, maximum = 0;
      response = async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setImmediate(resolve)); active--; return { configured: false, suites: {} }; };
      await driver.send('status');
      assert.equal(maximum, 4); assert.equal(reads.length, 9);
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
    selectProjectNext(name) { selections.push((_title, options) => {
      const choice = options.find(option => option.includes(`. ${name} —`));
      assert.ok(choice, `Missing project ${name}`); return choice;
    }); },
    selectRepositoryNext(name) { selections.push((_title, options) => {
      const choice = options.find(option => /^\d+\. /.test(option) && option.slice(option.indexOf('. ') + 2) === name);
      assert.ok(choice, `Missing repository ${name}`); return choice;
    }); },
    backNext() { chooseMatching(/^← Back/); },
    closeNext() { chooseMatching(/^Close$/); },
    cancelNext() { selections.push(undefined); },
    refreshNext() { chooseMatching(/^↻ Refresh/); },
    removeProjectThenRefreshNext(name) { chooseMatching(/^↻ Refresh/, () => {
      const data = JSON.parse(fs.readFileSync(file));
      data.projects = data.projects.filter(project => project.name !== name);
      fs.writeFileSync(file, JSON.stringify(data));
    }); },
    unlinkRepositoryThenRefreshNext() { chooseMatching(/^↻ Refresh/, () => {
      const data = JSON.parse(fs.readFileSync(file));
      data.projects.forEach(project => { project.repositories = []; });
      fs.writeFileSync(file, JSON.stringify(data));
    }); },
    addProjectThenRefreshNext(name) { chooseMatching(/^↻ Refresh/, () => {
      const data = JSON.parse(fs.readFileSync(file));
      data.projects.push({ id: name, name, repositories: [] });
      fs.writeFileSync(file, JSON.stringify(data));
    }); },
    failNextMenu() { selections.push(() => { throw new Error('native dialog failed'); }); },
    corruptCatalogueThenRefreshNext() { chooseMatching(/^↻ Refresh/, () => fs.writeFileSync(file, '{broken')); },
    holdNextMenu(ignoreSignal = false) {
      let entered;
      const started = new Promise(resolve => { entered = resolve; });
      selections.push((_title, _options, opts) => new Promise(resolve => {
        entered();
        if (!ignoreSignal) opts?.signal?.addEventListener('abort', () => resolve(undefined), { once: true });
        t.after(() => resolve(undefined));
      }));
      driver.waitForMenu = () => started;
    },
    preserveCatalogue() { driver.catalogueBefore = fs.readFileSync(file, 'utf8'); },
    thenCatalogueUnchanged() { assert.equal(fs.readFileSync(file, 'utf8'), driver.catalogueBefore); },
    thenMenuCount(count) { assert.equal(menus.length, count); },
    thenMenuTitle(index, expected) {
      if (expected instanceof RegExp) assert.match(menus[index]?.title ?? '', expected);
      else assert.equal(menus[index]?.title, expected);
    },
    thenMenuOption(index, pattern) { assert.ok(menus[index]?.options.some(option => pattern.test(option)), JSON.stringify(menus)); },
    thenNativeDialogSignals() { assert.ok(menus.length); assert.ok(menus.every(menu => menu.signal instanceof AbortSignal)); },
    thenReadCountForSharedRepositories(count) { assert.equal(new Set(reads).size, count); assert.equal(reads.length, count); },
    async thenBrowseReadsAreBounded() {
      let active = 0, maximum = 0;
      response = async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setImmediate(resolve)); active--; return { configured: false, suites: {} }; };
      driver.selectProjectNext('Many'); driver.closeNext(); await driver.send('browse');
      assert.equal(maximum, 4); assert.equal(reads.length, 9);
    },
    confirmNext(value) { confirmation = value; },
    async send(input, interactive = true) {
      notices.length = 0;
      await command.handler(input, { cwd, hasUI: interactive, ui: {
        notify(message, level) { notices.push({ message, level }); },
        async select(title, options, opts) {
          menus.push({ title, options: [...options], signal: opts?.signal });
          const choice = selections.shift();
          return typeof choice === 'function' ? choice(title, options, opts) : typeof choice === 'number' ? options[choice] : choice;
        },
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
