const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup() {
  const source = readFileSync(join(__dirname, '..', 'todo.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(id) {
      if (id === 'typebox') return { Type: new Proxy({}, { get: () => () => ({}) }) };
      return require(id);
    },
  });
  let tool;
  module.exports.default({ on() {}, registerCommand() {}, registerTool(value) { tool = value; } });
  const ctx = { hasUI: false, sessionManager: { getSessionId: () => 'test' } };
  return (params) => tool.execute('', params, undefined, undefined, ctx);
}

test('add returns a compact list of open todos without descriptions', async () => {
  const call = setup();
  await call({ action: 'add', text: 'Read docs', description: 'Long acceptance criteria' });
  await call({ action: 'update', id: 1, status: 'doing' });
  const result = await call({ action: 'add', text: 'Write tests' });
  assert.equal(result.content[0].text, 'Open todos:\n#1 [doing] Read docs\n#2 [pending] Write tests');
  assert.equal(result.details.todos[0].description, 'Long acceptance criteria');
});

test('update omits completed todos from text but retains the full state', async () => {
  const call = setup();
  await call({ action: 'add', text: 'Read docs' });
  await call({ action: 'add', text: 'Write tests' });
  const result = await call({ action: 'update', id: 1, status: 'done' });
  assert.equal(result.content[0].text, 'Open todos:\n#2 [pending] Write tests');
  assert.equal(result.details.todos.length, 2);
  assert.equal(result.details.todos[0].status, 'done');
  const added = await call({ action: 'add', text: 'Verify' });
  assert.equal(added.content[0].text, 'Open todos:\n#2 [pending] Write tests\n#3 [pending] Verify');
});

test('completing the last todo reports no open todos', async () => {
  const call = setup();
  await call({ action: 'add', text: 'Verify' });
  const result = await call({ action: 'update', id: 1, status: 'done' });
  assert.equal(result.content[0].text, 'No open todos.');
  assert.equal(result.details.todos[0].status, 'done');
});

test('invalid updates still return their error message', async () => {
  const result = await setup()({ action: 'update', id: 99, status: 'done' });
  assert.equal(result.content[0].text, 'No task #99.');
  assert.equal(result.isError, true);
});

test('explicit list still includes completed todos and descriptions', async () => {
  const call = setup();
  await call({ action: 'add', text: 'Read docs', description: 'Details' });
  await call({ action: 'update', id: 1, status: 'done' });
  const result = await call({ action: 'list' });
  assert.equal(result.content[0].text, '✓ #1 Read docs\n  Details');
});
