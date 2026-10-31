const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../../..');
function loadTs(file, cache = new Map()) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    if (id.startsWith('.')) return loadTs(path.resolve(path.dirname(file), id.replace(/\.js$/, '.ts')), cache);
    return require(id);
  }, module, module.exports);
  return module.exports;
}

class LearningPlanDriver {
  constructor(t) {
    this.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-learning-plan-'));
    t.after(() => fs.rmSync(this.directory, { recursive: true, force: true }));
    this.branches = new Map();
    this.widgets = new Map();
    this.notifications = [];
    this.successfulMutations = 0;
  }
  async boot() {
    if (this.manager) return;
    this.sdk = await import(pathToFileURL(path.join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/index.js')).href);
    this.manager = this.sdk.SessionManager.create(this.directory, this.directory);
    // Pi intentionally materializes history only after an assistant response.
    this.manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Learning session started.' }],
      api: 'openai-completions', provider: 'openai', model: 'test', stopReason: 'stop', timestamp: 1,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    this.originalFile = this.manager.getSessionFile();
    await this.install();
  }
  context() {
    return { hasUI: !this.withoutUi, sessionManager: this.manager,
      ui: { setWidget: (key, lines, options) => {
        assert.equal(key, 'learning-plan');
        assert.equal(options.placement, 'aboveEditor');
        this.widgets.set(this.manager.getSessionId(), lines);
      }, notify: text => this.notifications.push(text) } };
  }
  async install() {
    this.handlers = new Map();
    this.commands = new Map();
    this.extension = loadTs(path.join(root, 'learning-plan/index.ts'));
    this.extension.default({
      on: (name, callback) => this.handlers.set(name, callback),
      registerTool: tool => { this.tool = tool; },
      registerCommand: (name, command) => this.commands.set(name, command),
    });
    await this.emit('session_start');
  }
  async emit(name) { await this.handlers.get(name)?.({}, this.context()); }
  async call(params) {
    await this.boot();
    this.last = await this.tool.execute('learning-test', params, undefined, undefined, this.context());
    this.manager.appendMessage({ role: 'toolResult', toolName: 'learning_plan', toolCallId: 'learning-test',
      content: this.last.content, details: this.last.details, isError: !!this.last.isError, timestamp: Date.now() });
    if (!this.last.isError && params.action !== 'get') this.successfulMutations++;
    return this.last;
  }
  async create(title, milestones) {
    const result = await this.call({ action: 'create', title, milestones });
    assert.ok(!result.isError, result.content[0].text);
  }
  async createTwoMilestones() {
    await this.create('TypeScript', [
      { title: 'Explain unions', criterion: 'Explain and transfer independently' },
      { title: 'Apply narrowing', criterion: 'Explain and solve a changed example independently' },
    ]);
  }
  async update(updates) {
    const result = await this.call({ action: 'update', updates });
    assert.ok(!result.isError, result.content[0].text);
  }
  async add(title, criterion) {
    const result = await this.call({ action: 'add', title, criterion });
    assert.ok(!result.isError, result.content[0].text);
  }
  async state() {
    const result = await this.call({ action: 'get' });
    assert.ok(!result.isError);
    return result.details.plan;
  }
  async expectMilestones(statuses) { assert.deepEqual((await this.state()).milestones.map(m => m.status), statuses); }
  async expectWidget(lines) { assert.deepEqual(this.widgets.get(this.manager.getSessionId()), lines); }
  async expectWidgetCount(text) { assert.ok(this.widgets.get(this.manager.getSessionId())[0].includes(text)); }
  async expectCompleteSessionSnapshot() {
    const state = await this.state();
    const recorded = this.manager.getBranch().filter(e => e.type === 'message' && e.message.toolName === 'learning_plan');
    assert.ok(recorded.length);
    assert.deepEqual(recorded[0].message.details.plan, state);
    assert.ok(state.milestones.every(m => m.criterion));
  }
  async expectEvidence(id, evidence) { assert.equal((await this.state()).milestones.find(m => m.id === id).evidence, evidence); }
  async rejectUpdate(updates, reason) {
    const before = await this.state();
    const widget = [...this.widgets.get(this.manager.getSessionId())];
    const result = await this.call({ action: 'update', updates });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.toLowerCase().includes(reason.toLowerCase()));
    assert.deepEqual(await this.state(), before);
    await this.expectWidget(widget);
  }
  async rejectCreateOverExistingPlan() {
    const before = await this.state();
    const result = await this.call({ action: 'create', title: 'Replacement', milestones: [{ title: 'New', criterion: 'New' }] });
    assert.equal(result.isError, true);
    assert.deepEqual(await this.state(), before);
  }
  async expectNoSuccessfulMutationSinceCreation() { assert.equal(this.successfulMutations, 1); }
  async createDemonstratedMilestone(evidence) {
    await this.create('TypeScript', [{ title: 'Explain unions', criterion: 'Explain and transfer independently' }]);
    await this.update([{ id: 1, status: 'demonstrated', evidence }]);
  }
  async expectDistinctStableIds() { assert.deepEqual((await this.state()).milestones.map(m => m.id), [1, 2]); }
  async rememberBranch(name) { this.branches.set(name, this.manager.getLeafId()); }
  async restartExtensionAndResumeSession() {
    const file = this.manager.getSessionFile();
    await this.emit('session_shutdown');
    this.manager = this.sdk.SessionManager.open(file);
    await this.install();
  }
  async compactSessionUsingPi() {
    // A later user turn gives Pi a real turn boundary after the plan results.
    this.manager.appendMessage({ role: 'user', content: 'Continue with another example. '.repeat(100), timestamp: Date.now() });
    this.manager.appendMessage({ ...this.manager.getBranch().find(e => e.type === 'message' && e.message.role === 'assistant').message,
      content: [{ type: 'text', text: 'Next independent exercise. '.repeat(100) }], timestamp: Date.now() });
    const settingsManager = this.sdk.SettingsManager.inMemory({ compaction: { reserveTokens: 10, keepRecentTokens: 10 } });
    const loader = new this.sdk.DefaultResourceLoader({ cwd: this.directory, agentDir: this.directory,
      settingsManager, noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true,
      extensionFactories: [pi => {
        pi.on('session_before_compact', event => ({ compaction: {
          summary: 'Deterministic test summary; no model request.',
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
        } }));
      }] });
    await loader.reload();
    const runtime = await this.sdk.ModelRuntime.create({ authPath: path.join(this.directory, 'auth.json'),
      modelsPath: null, modelsStorePath: path.join(this.directory, 'models-store.json'), refreshOnCreate: false });
    const model = runtime.getModels().find(m => m.provider === 'openai');
    assert.ok(model, 'Static test model required');
    const { session } = await this.sdk.createAgentSession({ cwd: this.directory, agentDir: this.directory,
      sessionManager: this.manager, settingsManager, resourceLoader: loader, modelRuntime: runtime, model, tools: [] });
    try {
      await session.bindExtensions({});
      // Prevent auth/network requirements. The compaction content is supplied by the test hook.
      session.agent.streamFunction = () => { throw new Error('Unexpected model request'); };
      const result = await session.compact();
      assert.equal(result.summary, 'Deterministic test summary; no model request.');
      assert.ok(this.manager.getBranch().some(e => e.type === 'compaction'));
      assert.ok(!this.manager.buildSessionContext().messages.some(m => m.role === 'toolResult' && m.toolName === 'learning_plan'),
        'Plan restoration must work even after plan results leave model context');
    } finally { session.dispose(); }
    await this.emit('session_compact');
  }
  async navigateToBranch(name) {
    this.manager.branch(this.branches.get(name));
    await this.emit('session_tree');
  }
  async openDifferentSession() {
    this.manager = this.sdk.SessionManager.create(this.directory, this.directory);
    await this.emit('session_start');
  }
  async expectNoPlanOrWidget() {
    assert.equal(await this.state(), null);
    assert.equal(this.widgets.get(this.manager.getSessionId()), undefined);
  }
  async returnToOriginalSessionWithoutUi() {
    this.manager = this.sdk.SessionManager.open(this.originalFile);
    this.withoutUi = true;
    await this.emit('session_start');
  }
  async expectFullPlanThroughGet() {
    const state = await this.state();
    assert.equal(state.title, 'TypeScript');
    assert.ok(state.milestones.every(m => m.criterion));
    assert.ok(this.last.content[0].text.includes(state.milestones[0].criterion));
  }
  async expectFullPlanThroughCommand() {
    await this.commands.get('learning-plan').handler('', this.context());
    assert.ok(this.notifications.at(-1).includes('Explain and transfer independently'));
  }
  async expectTeachInstructions(expected) {
    // The installable skill is tracked so this suite works in a fresh checkout.
    const skill = fs.readFileSync(path.join(root, 'docs/learning-plan/teach/SKILL.md'), 'utf8');
    const installed = path.resolve(root, '../skills/teach/SKILL.md');
    if (fs.existsSync(installed)) assert.equal(fs.readFileSync(installed, 'utf8'), skill, 'Installed teach skill matches the tracked source');
    const checks = {
      retrieveOnStartAndResume: /start and on resume[^\n]*learning_plan[^\n]*get/i,
      activateBeforeTeaching: /active[^\n]*before teaching/i,
      updateAfterAssessmentBeforeNextQuestion: /after assessment[^\n]*before[^\n]*next question/i,
      requireReasoningAndIndependentTransfer: /sound explanation[^\n]*materially different[^\n]*without a revealing hint/i,
      cancellationIsNotEvidence: /cancellation is not evidence/i,
      preserveIncompleteOnPause: /pause or finish[^\n]*preserve incomplete/i,
      noTodoForLearningMilestones: /do not use[^\n]*todo[^\n]*learning milestones/i,
    };
    for (const [name, enabled] of Object.entries(expected)) if (enabled) assert.match(skill, checks[name], name);
  }
}
module.exports = { LearningPlanDriver, loadTs };
