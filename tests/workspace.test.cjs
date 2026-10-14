const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'workspace.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, process, Buffer, require(id) {
    if (id === '@earendil-works/pi-coding-agent') return { CONFIG_DIR_NAME: '.pi' };
    return require(id);
  } });
  const commands = new Map(), events = new Map();
  module.exports.default({ registerCommand: (name, spec) => commands.set(name, spec), on: (name, handler) => events.set(name, handler) });
  return { command: commands.get('workspace'), before: events.get('before_agent_start') };
}
function fixture(t, answers = []) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-workspace-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const notices = [], prompts = [];
  const ctx = { cwd, hasUI: true, isProjectTrusted: () => true, ui: {
    notify: (...args) => notices.push(args),
    input: async (...args) => { prompts.push(args); return answers.shift(); },
    select: async () => answers.shift(),
  } };
  return { cwd, ctx, notices, prompts, configPath: path.join(cwd, '.pi', 'workspace.json') };
}
function config(f, folders) {
  fs.mkdirSync(path.dirname(f.configPath), { recursive: true });
  fs.writeFileSync(f.configPath, JSON.stringify({ version: 1, folders }));
}
function event() { return { systemPrompt: 'Existing instructions', systemPromptOptions: { sections: { other: 'Keep me' } } }; }

test('registers workspace command and subcommand completion', () => {
  const { command, before } = load();
  assert.equal(typeof before, 'function');
  assert.deepEqual(Array.from(command.getArgumentCompletions('').map(x => x.value)), ['add', 'list', 'remove']);
  assert.equal(command.getArgumentCompletions('add '), null);
});
test('missing configuration is a no-op and does not create files', async t => {
  const f = fixture(t), e = event();
  assert.equal(await load().before(e, f.ctx), undefined);
  assert.equal(e.systemPromptOptions.sections.workspace, undefined);
  assert.equal(fs.existsSync(f.configPath), false);
});
test('add accepts paths with spaces and saves a canonical folder, label and description', async t => {
  const f = fixture(t, ['Lecture notes', 'Obsidian notes for Module A']);
  const folder = path.join(f.cwd, 'Notes with spaces'); fs.mkdirSync(folder);
  await load().command.handler('add "Notes with spaces"', f.ctx);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.configPath, 'utf8')), { version: 1, folders: [{ path: fs.realpathSync(folder), label: 'Lecture notes', description: 'Obsidian notes for Module A' }] });
  assert.equal(fs.readdirSync(path.dirname(f.configPath)).join(), 'workspace.json');
});
test('interactive add cancellation does not create config', async t => {
  const f = fixture(t, [undefined]);
  await load().command.handler('add', f.ctx);
  assert.equal(fs.existsSync(f.configPath), false);
});
test('add rejects files and missing folders without writing', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.cwd, 'file.md'), 'notes');
  const { command } = load();
  await command.handler('add file.md', f.ctx);
  await command.handler('add missing', f.ctx);
  assert.equal(fs.existsSync(f.configPath), false);
  assert.equal(f.notices.filter(n => n[1] === 'error').length, 2);
});
test('duplicate paths including symlink aliases are rejected', async t => {
  const f = fixture(t); const folder = path.join(f.cwd, 'notes'); fs.mkdirSync(folder);
  fs.symlinkSync(folder, path.join(f.cwd, 'alias'));
  config(f, [{ path: fs.realpathSync(folder), label: 'Notes' }]);
  const original = fs.readFileSync(f.configPath, 'utf8');
  await load().command.handler('add alias', f.ctx);
  assert.equal(fs.readFileSync(f.configPath, 'utf8'), original);
  assert.match(f.notices.at(-1)[0], /already linked/i);
});
test('list shows paths and descriptions; removal only unlinks the selected folder', async t => {
  const f = fixture(t); const folder = path.join(f.cwd, 'notes'); fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'note.md'), 'Keep');
  config(f, [{ path: folder, label: 'Notes', description: 'Lecture notes' }]);
  const { command } = load(); await command.handler('list', f.ctx);
  assert.match(f.notices.at(-1)[0], /Lecture notes/);
  assert.ok(f.notices.at(-1)[0].includes(folder));
  await command.handler('remove 1', f.ctx);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.configPath, 'utf8')).folders, []);
  assert.equal(fs.readFileSync(path.join(folder, 'note.md'), 'utf8'), 'Keep');
});
test('injects a fresh dedicated section on every run and after switching workspaces', async t => {
  const f = fixture(t), other = fixture(t); const { before } = load();
  config(f, [{ path: f.cwd, label: 'Notes' }]);
  for (let i = 0; i < 2; i++) {
    const e = event(); await before(e, f.ctx);
    assert.match(e.systemPromptOptions.sections.workspace, /Notes/);
    assert.equal(e.systemPromptOptions.sections.other, 'Keep me');
    assert.equal(e.systemPrompt, 'Existing instructions');
  }
  config(f, [{ path: f.cwd, label: 'Script', description: 'The script is Algorithms.pdf' }]);
  const changed = event(); await before(changed, f.ctx);
  assert.match(changed.systemPromptOptions.sections.workspace, /Algorithms.pdf/);
  assert.doesNotMatch(changed.systemPromptOptions.sections.workspace, /"Notes"/);
  const switched = event(); await before(switched, other.ctx);
  assert.equal(switched.systemPromptOptions.sections.workspace, undefined);
});
test('empty configuration clears the section without creating a message', async t => {
  const f = fixture(t); config(f, []); const e = event();
  e.systemPromptOptions.sections.workspace = 'Old paths';
  assert.equal(await load().before(e, f.ctx), undefined);
  assert.equal(e.systemPromptOptions.sections.workspace, undefined);
});
test('older Pi API receives an appended system prompt, preserving existing instructions', async t => {
  const f = fixture(t); config(f, [{ path: f.cwd, label: 'Notes' }]);
  const result = await load().before({ systemPrompt: 'Existing instructions', systemPromptOptions: {} }, f.ctx);
  assert.ok(result.systemPrompt.startsWith('Existing instructions\n'));
  assert.match(result.systemPrompt, /Notes/);
  assert.equal(result.message, undefined);
});
test('forced system prompts keep their override and receive the mapping', async t => {
  const f = fixture(t); config(f, [{ path: f.cwd, label: 'Notes' }]);
  const e = event(); e.systemPromptOptions.forceSystemPrompt = 'Forced instructions';
  const result = await load().before(e, f.ctx);
  assert.ok(result.systemPrompt.startsWith('Forced instructions\n'));
  assert.match(result.systemPrompt, /Notes/);
});
test('unavailable folders are marked and warned about, not silently omitted', async t => {
  const f = fixture(t); config(f, [{ path: path.join(f.cwd, 'gone'), label: 'Script' }]);
  const e = event(); await load().before(e, f.ctx);
  assert.match(e.systemPromptOptions.sections.workspace, /unavailable/i);
  assert.equal(f.notices.at(-1)[1], 'warning');
});
test('malformed configuration is reported and never overwritten', async t => {
  const f = fixture(t); config(f, []); fs.writeFileSync(f.configPath, '{broken');
  const { before, command } = load(); const e = event(); await before(e, f.ctx);
  assert.match(e.systemPromptOptions.sections.workspace, /configuration.*unavailable/i);
  await command.handler('add .', f.ctx);
  assert.equal(fs.readFileSync(f.configPath, 'utf8'), '{broken');
  assert.equal(f.notices.at(-1)[1], 'error');
});
test('invalid versions and folder shapes are rejected', async t => {
  const f = fixture(t); config(f, []);
  for (const invalid of [{ version: 2, folders: [] }, { version: 1, folders: [{ path: '../relative', label: 'Notes' }] }, { version: 1, folders: [{ path: f.cwd, label: 42 }] }]) {
    fs.writeFileSync(f.configPath, JSON.stringify(invalid));
    const e = event(); await load().before(e, f.ctx);
    assert.match(e.systemPromptOptions.sections.workspace, /configuration.*unavailable/i);
  }
});
test('untrusted projects neither read nor mutate workspace configuration', async t => {
  const f = fixture(t); config(f, [{ path: f.cwd, label: 'Do not inject' }]);
  f.ctx.isProjectTrusted = () => false;
  const { before, command } = load(), e = event(); await before(e, f.ctx);
  assert.equal(e.systemPromptOptions.sections.workspace, undefined);
  await command.handler('remove 1', f.ctx);
  assert.equal(JSON.parse(fs.readFileSync(f.configPath, 'utf8')).folders.length, 1);
  assert.match(f.notices.at(-1)[0], /trust/i);
});
test('a concurrent writer lock prevents lost updates', async t => {
  const f = fixture(t, ['Notes', '']); config(f, []);
  fs.mkdirSync(`${f.configPath}.lock`);
  await load().command.handler('add .', f.ctx);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.configPath, 'utf8')).folders, []);
  assert.match(f.notices.at(-1)[0], /another.*update|locked/i);
});
