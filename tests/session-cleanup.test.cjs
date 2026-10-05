const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the registered dry-run command without ever invoking deletion.
async function dryRun(entries, { current = false, missing = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'session-cleanup-test-'));
  try {
    const path = join(dir, 'session.jsonl');
    if (!missing) await writeFile(path, entries.map(e => typeof e === 'string' ? e : JSON.stringify(e)).join('\n'));
    const commands = new Map();
    const source = readFileSync(join(__dirname, '..', 'session-cleanup.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    vm.runInNewContext(code, {
      exports, process: { env: {} },
      require(id) {
        if (id === '@earendil-works/pi-coding-agent') return {
          SessionManager: { listAll: async () => [{ path, name: 'Display title', modified: new Date(0) }] }
        };
        if (id === 'node:child_process') return { spawnSync() { throw new Error('Deletion forbidden in tests'); } };
        return require(id);
      }
    });
    exports.default({ registerCommand(name, command) { commands.set(name, command); } });
    let notification;
    await commands.get('session-cleanup-dry').handler('', {
      sessionManager: { getSessionFile: () => current ? path : undefined },
      ui: { notify: text => { notification = text; } }
    });
    return notification;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const info = (name, autoTitle) => ({ type: 'session_info', name, ...(autoTitle === undefined ? {} : { autoTitle }) });

test('old auto-titled sessions are candidates', async () => {
  assert.match(await dryRun([info('Automatic', true)]), /would delete 1/);
});
test('manually named sessions are candidates, including legacy entries', async () => {
  for (const flag of [undefined, false]) assert.match(await dryRun([info('Manual', flag)]), /would delete 1/);
});
test('all named sessions are eligible regardless of the latest session_info', async () => {
  assert.match(await dryRun([info('Auto', true), info('Manual')]), /would delete 1/);
  assert.match(await dryRun([info('Manual'), info('Auto', true)]), /would delete 1/);
});
test('unnamed sessions and unrelated entries are eligible', async () => {
  assert.match(await dryRun([{ type: 'session', id: 'test' }, 'not json']), /would delete 1/);
});
test('current named session stays protected', async () => {
  assert.match(await dryRun([info('Manual')], { current: true }), /protected 1/);
});
test('dry run does not need to read candidate files', async () => {
  const result = await dryRun([], { missing: true });
  assert.match(result, /would delete 1/);
  assert.match(result, /errors 0/);
});
