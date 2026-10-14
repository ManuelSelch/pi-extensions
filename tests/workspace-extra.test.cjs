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
  module.exports.default({ registerCommand: (_name, spec) => { command = spec; }, on() {} });
  const ctx = { cwd, hasUI: true, isProjectTrusted: () => true, ui: {
    notify: (...args) => notices.push(args), input: async () => answers.shift(), select: async () => answers.shift(),
  } };
  return { cwd, ctx, command, notices, file: path.join(cwd, '.pi', 'workspace.json') };
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
