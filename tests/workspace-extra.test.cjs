const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup(t, answers = []) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-workspace-extra-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const source = fs.readFileSync(path.join(__dirname, '..', 'workspace.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }, notices = [];
  vm.runInNewContext(code, { module, exports: module.exports, process, Buffer, require(id) {
    if (id === '@earendil-works/pi-coding-agent') return { CONFIG_DIR_NAME: '.pi' };
    if (id === 'node:os') return { homedir: () => cwd };
    return require(id);
  } });
  let command;
  const events = new Map();
  module.exports.default({ registerCommand: (_name, spec) => { command = spec; }, on(name, handler) { events.set(name, handler); } });
  const ctx = { cwd, hasUI: true, isProjectTrusted: () => true, ui: {
    notify: (...args) => notices.push(args), input: async () => answers.shift(), select: async () => answers.shift(),
  } };
  events.get('session_start')?.({}, ctx);
  return { cwd, ctx, command, notices, events, file: path.join(cwd, '.pi', 'workspace.json') };
}

test('add preserves repeated spaces in folder paths', async t => {
  const f = setup(t, ['Notes', '']); const folder = path.join(f.cwd, 'Two  spaces'); fs.mkdirSync(folder);
  await f.command.handler('add "Two  spaces"', f.ctx);
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).folders[0].path, fs.realpathSync(folder));
});
test('home paths expand and blank label uses folder name', async t => {
  const f = setup(t, ['', '']); fs.mkdirSync(path.join(f.cwd, 'notes'));
  await f.command.handler('add ~/notes', f.ctx);
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).folders[0].label, 'notes');
});
test('a change by another session during dialogs is preserved', async t => {
  const f = setup(t, ['Notes', '']);
  f.ctx.ui.input = async title => {
    if (title.startsWith('Description')) {
      fs.mkdirSync(path.dirname(f.file), { recursive: true });
      fs.writeFileSync(f.file, JSON.stringify({ version: 1, folders: [{ path: path.join(f.cwd, 'other'), label: 'Other' }] }));
      return '';
    }
    return 'Notes';
  };
  await f.command.handler('add .', f.ctx);
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).folders.length, 2);
});
test('interactive remove unlinks selection; cancelled selection preserves config', async t => {
  const f = setup(t, [undefined]); fs.mkdirSync(path.dirname(f.file), { recursive: true });
  fs.writeFileSync(f.file, JSON.stringify({ version: 1, folders: [{ path: f.cwd, label: 'Notes' }] }));
  await f.command.handler('remove', f.ctx);
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).folders.length, 1);
  f.ctx.ui.select = async (_title, choices) => choices[0];
  await f.command.handler('remove', f.ctx);
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).folders.length, 0);
});
test('invalid labels cannot leave a partially saved config or lock', async t => {
  const f = setup(t, ['x'.repeat(201), '']);
  await f.command.handler('add .', f.ctx);
  assert.equal(fs.existsSync(f.file), false);
  assert.equal(fs.existsSync(`${f.file}.lock`), false);
  assert.equal(f.notices.at(-1)[1], 'error');
});

function values(command, prefix) {
  return Array.from(command.getArgumentCompletions(prefix) ?? [], item => item.value);
}
test('add completes only folders, sorted with trailing slashes and full command arguments', t => {
  const f = setup(t);
  for (const name of ['Zebra', 'Notes', '.hidden']) fs.mkdirSync(path.join(f.cwd, name));
  fs.writeFileSync(path.join(f.cwd, 'Not-a-folder.md'), 'notes');
  assert.deepEqual(values(f.command, 'add '), ['add Notes/', 'add Zebra/']);
  assert.deepEqual(values(f.command, 'add No'), ['add Notes/']);
  assert.deepEqual(values(f.command, 'add .'), ['add .hidden/']);
  assert.deepEqual(values(f.command, 'list '), []);
  assert.deepEqual(values(f.command, 'remove '), []);
});
test('add completes nested relative, absolute and home paths without changing their form', t => {
  const f = setup(t); fs.mkdirSync(path.join(f.cwd, 'Notes', 'Lecture A'), { recursive: true });
  assert.deepEqual(values(f.command, 'add Notes/Le'), ['add Notes/Lecture A/']);
  assert.deepEqual(values(f.command, `add ${f.cwd}/No`), [`add ${f.cwd}/Notes/`]);
  assert.deepEqual(values(f.command, 'add ~/No'), ['add ~/Notes/']);
  assert.deepEqual(values(f.command, 'add ~'), ['add ~/Notes/']);
  assert.deepEqual(values(f.command, 'add missing/'), []);
});
test('add folder completion uses the current session cwd after a runtime switch', t => {
  const f = setup(t); const other = path.join(f.cwd, 'other'); fs.mkdirSync(other);
  fs.mkdirSync(path.join(other, 'Script'));
  f.events.get('session_start')({}, { cwd: other });
  assert.deepEqual(values(f.command, 'add Sc'), ['add Script/']);
});
test('completed paths containing spaces can be submitted directly', async t => {
  const f = setup(t, ['Notes', '']); fs.mkdirSync(path.join(f.cwd, 'Two  spaces'));
  const [completion] = values(f.command, 'add Two');
  assert.equal(completion, 'add Two  spaces/');
  await f.command.handler(completion, f.ctx);
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).folders[0].path, fs.realpathSync(path.join(f.cwd, 'Two  spaces')));
});
