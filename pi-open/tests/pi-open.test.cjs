const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');

const source = readFileSync(require('node:path').join(__dirname, '..', 'index.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(config, gitAnswers = {}) {
  const module = { exports: {} };
  const spawned = [];
  vm.runInNewContext(code, {
    module, exports: module.exports, process: { env: {}, platform: 'darwin' },
    require(id) {
      if (id === 'node:os') return { homedir: () => '/home/test' };
      if (id === 'node:fs') return { readFileSync: () => JSON.stringify(config) };
      if (id === 'node:child_process') return {
        spawn(...args) {
          spawned.push(args);
          const child = new EventEmitter();
          child.unref = () => {};
          return child;
        },
        execFile(command, args, options, callback) {
          const response = gitAnswers[command]?.[JSON.stringify(args)] ?? gitAnswers.default;
          if (typeof response === 'function') {
            response(callback);
            return;
          }
          if (response) {
            callback(null, response, '');
            return;
          }
          callback(new Error('git failed'));
        }
      };
      return require(id);
    },
  });
  return { ...module.exports, spawned };
}

test('loads all configured app names for /open completion (without built-in app names)', () => {
  const { default: extension } = load({ apps: { editor: { command: 'code', args: ['{cwd}'] }, files: { command: 'open', args: ['{cwd}'] } } });
  let command;
  extension({ registerCommand(name, spec) { assert.equal(name, 'open'); command = spec; } });
  assert.equal(JSON.stringify(command.getArgumentCompletions('')), JSON.stringify([{ value: 'editor', label: 'editor' }, { value: 'files', label: 'files' }]));
});

test('spawns the configured executable with cwd substituted as a single argument', async () => {
  const { default: extension, spawned } = load({ apps: { editor: { command: 'code', args: ['--new-window', '{cwd}'] } } });
  let command;
  extension({ registerCommand(_name, spec) { command = spec; } });
  const notices = [];
  await command.handler('editor', { cwd: '/work/my project', ui: { notify: (...args) => notices.push(args) } });
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0][0], 'code');
  assert.deepEqual(Array.from(spawned[0][1]), ['--new-window', '/work/my project']);
  assert.equal(spawned[0][2].cwd, '/work/my project');
  assert.equal(spawned[0][2].shell, false);
  assert.equal(spawned[0][2].detached, true);
  assert.equal(notices.length, 0);
});

test('resolves the primary worktree repo for apps that use {primaryRepo}', async () => {
  const { default: extension, spawned } = load(
    { apps: { 'code-primary': { command: 'code', args: ['{primaryRepo}'] } } },
    {
      default: (callback) => {
        callback(null, 'worktree /work/primary\nworktree /work/feature\n', '');
      },
    },
  );
  let command;
  extension({ registerCommand(_name, spec) { command = spec; } });
  const notices = [];
  await command.handler('code-primary', { cwd: '/work/feature', ui: { notify: (...args) => notices.push(args) } });
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0][0], 'code');
  assert.deepEqual(Array.from(spawned[0][1]), ['/work/primary']);
  assert.equal(spawned[0][2].cwd, '/work/primary');
  assert.equal(notices.length, 0);
});

test('falls back to the repo root when worktree metadata is unavailable', async () => {
  const { default: extension, spawned } = load(
    { apps: { 'code-primary': { command: 'code', args: ['{primaryRepo}'] } } },
    {
      default: (callback) => {
        callback(null, '/work/feature', '');
      },
    },
  );
  let command;
  extension({ registerCommand(_name, spec) { command = spec; } });
  const notices = [];
  await command.handler('code-primary', { cwd: '/work/feature', ui: { notify: (...args) => notices.push(args) } });
  assert.equal(spawned[0][2].cwd, '/work/feature');
  assert.equal(notices.length, 0);
});

test('reports a configured app name that does not exist', async () => {
  const { default: extension } = load({ apps: {} });
  let command;
  extension({ registerCommand(_name, spec) { command = spec; } });
  const notices = [];
  await command.handler('missing', { cwd: '/work', ui: { notify: (...args) => notices.push(args) } });
  assert.match(notices[0][0], /Unknown app/);
});
