const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
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

function exec(command, args, options = {}) {
  return new Promise(resolve => execFile(command, args, { cwd: options.cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
    resolve({ stdout, stderr, code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, killed: false });
  }));
}

/** Real Git sandbox; fake command host models replacement contexts, not Pi persistence/model execution. */
class HandoffDriver {
  constructor(t) {
    this.directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-handoff-')));
    this.repo = path.join(this.directory, 'repo');
    fs.mkdirSync(this.repo);
    this.implementationSession = path.join(this.directory, 'implementation.jsonl');
    fs.writeFileSync(this.implementationSession, '{"type":"session","id":"implementation"}\n');
    this.timeline = [];
    this.notifications = [];
    this.dialogs = [];
    this.newSessions = [];
    this.prompts = [];
    this.editorTexts = [];
    this.skills = ['skill:code-reviewer'];
    this.idle = true;
    this.hasUI = true;
    this.editorReply = draft => draft;
    this.confirmReplies = [];
    t.after(() => fs.rmSync(this.directory, { recursive: true, force: true }));
  }

  git(...args) { return execFileSync('git', args, { cwd: this.repo, encoding: 'utf8' }).trim(); }
  write(file, content) {
    fs.mkdirSync(path.dirname(path.join(this.repo, file)), { recursive: true });
    fs.writeFileSync(path.join(this.repo, file), content);
  }
  commit(message) { this.git('add', '-A'); this.git('commit', '-q', '-m', message); }
  initialRepository() {
    this.git('init', '-q', '-b', 'main');
    this.git('config', 'user.email', 'test@example.com');
    this.git('config', 'user.name', 'Test');
    this.write('src/app.ts', 'export const app = 1;\n');
    this.write('docs/usage.md', '# Usage\n');
    this.write('plans/other-feature/PLAN.md', '# Other\n\nApproved long ago.\n');
    this.commit('initial');
  }
  featureBranch() {
    this.initialRepository();
    this.git('checkout', '-q', '-b', 'feat/handoff-review');
    this.write('plans/handoff-review/PLAN.md', '# Handoff review\n\nScope: hand off for review.\nApproved by the user on 2026-11-01 (revision 2).\n');
    this.write('mockups/handoff-review/DESIGN.md', '# Mockup\n\nReview status: approved revision 2.\n');
    this.write('src/handoff.ts', 'export const handoff = true;\n');
    this.write('tests/handoff.test.ts', 'test("handoff", () => {});\n');
    this.write('docs/handoff.md', '# Handoff\n');
    this.commit('feat: add handoff');
    this.write('src/app.ts', 'export const app = 2;\n');
    this.write('notes.txt', 'scratch\n');
    return this;
  }
  onMainWithoutUpstream() {
    this.initialRepository();
    this.write('src/app.ts', 'export const app = 2;\n');
    return this;
  }

  install() {
    this.commands = new Map();
    loadTs(path.join(root, 'handoff/index.ts')).default({
      registerCommand: (name, command) => this.commands.set(name, command),
      exec: async (command, args, options) => this.gitFailure && args[0] === this.gitFailure
        ? { stdout: '', code: 128 }
        : exec(command, args, options),
      getCommands: () => this.skills.map(name => ({ name, source: 'skill' })),
    });
  }
  ui(session) {
    return {
      editor: async (title, prefill) => {
        this.dialogs.push({ kind: 'editor', title, prefill, session });
        this.draft = prefill;
        return typeof this.editorReply === 'function' ? this.editorReply(prefill) : this.editorReply;
      },
      confirm: async (title, message) => {
        this.dialogs.push({ kind: 'confirm', title, message, session });
        return this.confirmReplies.length ? this.confirmReplies.shift() : true;
      },
      notify: (message, level = 'info') => this.notifications.push({ message, level, session }),
      setEditorText: text => this.editorTexts.push(text),
    };
  }
  context() {
    return {
      cwd: this.repo,
      hasUI: this.hasUI,
      isIdle: () => this.idle,
      sessionManager: { getSessionFile: () => this.implementationSession },
      ui: this.ui('implementation'),
      newSession: async options => {
        this.newSessions.push(options);
        if (this.cancelNewSession) return { cancelled: true };
        if (this.creationError) throw this.creationError;
        this.review = { entries: [] };
        await options.setup?.({ appendSessionInfo: name => {
          this.review.entries.push({ type: 'session_info', name });
          this.timeline.push('name');
        } });
        await options.withSession?.({
          cwd: this.repo,
          ui: this.ui('review'),
          sendUserMessage: async (content, options) => {
            this.timeline.push('prompt');
            this.prompts.push({ content, options, cwd: this.repo });
            if (this.promptError) throw this.promptError;
          },
        });
        return { cancelled: false };
      },
    };
  }
  async run(args = 'review') {
    if (!this.commands) this.install();
    await this.commands.get('handoff').handler(args, this.context());
  }
  completions(prefix) {
    if (!this.commands) this.install();
    return this.commands.get('handoff').getArgumentCompletions(prefix);
  }
  head() { return this.git('rev-parse', 'HEAD'); }
  mergeBase(ref) { return this.git('merge-base', ref, 'HEAD'); }
  implementationContents() { return fs.readFileSync(this.implementationSession, 'utf8'); }
  expectNothingChanged() {
    assert.deepEqual(this.newSessions, []);
    assert.deepEqual(this.prompts, []);
  }
  expectNotified(level, pattern) {
    assert.ok(this.notifications.some(note => note.level === level && pattern.test(note.message)),
      `expected ${level} notification ${pattern}; got ${JSON.stringify(this.notifications)}`);
  }
  confirmation() { return this.dialogs.find(dialog => dialog.kind === 'confirm' && dialog.session === 'implementation'); }
}

module.exports = { HandoffDriver };
