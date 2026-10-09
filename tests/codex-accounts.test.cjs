const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Load codex-accounts.ts with getAgentDir() pointed at a temp dir so the
// registered /codex-account command can be inspected without touching real
// config. Returns the captured command options plus helpers to seed accounts.
function load({ accounts } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-accounts-test-'));
  if (accounts) {
    writeFileSync(join(dir, 'codex-accounts.json'), JSON.stringify({ accounts }));
  }

  const commands = new Map();
  const source = readFileSync(join(__dirname, '..', 'codex-accounts.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(id) {
      if (id === '@earendil-works/pi-coding-agent') return { getAgentDir: () => dir };
      return require(id);
    },
    process,
    console,
    Buffer,
    crypto,
    fetch,
    URL,
    TextEncoder,
    setTimeout,
    clearTimeout,
  });

  module.exports.default({
    registerCommand(name, options) { commands.set(name, options); },
    registerProvider() {},
    unregisterProvider() {},
    on() {},
  });

  return {
    dir,
    command: commands.get('codex-account'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('codex-account exposes subcommand completion', () => {
  const { command, cleanup } = load();
  try {
    assert.ok(command, '/codex-account is registered');
    const initial = Array.from(command.getArgumentCompletions(''));
    assert.deepEqual(initial.map(i => i.label), ['list', 'add', 'remove']);
    assert.deepEqual(
      Array.from(command.getArgumentCompletions('ad')).map(i => i.label),
      ['add'],
    );
    assert.equal(command.getArgumentCompletions('add '), null);
    assert.equal(command.getArgumentCompletions('nope'), null);
  } finally {
    cleanup();
  }
});

test('codex-account completes configured ids for remove with labels', () => {
  const { command, cleanup } = load({
    accounts: [
      { id: 'work', label: 'Work' },
      { id: 'winter', label: 'Winter' },
      { id: 'home', label: 'Home' },
    ],
  });
  try {
    assert.deepEqual(
      Array.from(command.getArgumentCompletions('remove ')).map(i => ({ value: i.value, label: i.label, description: i.description })),
      [
        { value: 'remove work', label: 'work', description: 'Work' },
        { value: 'remove winter', label: 'winter', description: 'Winter' },
        { value: 'remove home', label: 'home', description: 'Home' },
      ],
    );
    assert.deepEqual(
      Array.from(command.getArgumentCompletions('remove w')).map(i => i.label),
      ['work', 'winter'],
    );
    assert.equal(command.getArgumentCompletions('remove work '), null);
  } finally {
    cleanup();
  }
});

test('codex-account dispatches list and unknown subcommands', async () => {
  const { command, cleanup } = load({ accounts: [{ id: 'work', label: 'Work' }] });
  try {
    let notification;
    const ctx = {
      modelRegistry: { getProviderAuthStatus: () => ({ configured: true, source: 'auth.json' }) },
      ui: { notify: (text, level) => { notification = { text, level }; } },
    };

    await command.handler('list', ctx);
    assert.equal(notification.level, 'info');
    assert.match(notification.text, /Work: openai-codex-work — logged in \(auth\.json\)/);

    await command.handler('bogus', ctx);
    assert.equal(notification.level, 'warning');
    assert.match(notification.text, /Usage: \/codex-account/);
  } finally {
    cleanup();
  }
});
