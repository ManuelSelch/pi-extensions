const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = readFileSync(require('node:path').join(__dirname, '..', 'preview.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleStub = { exports: {} };
vm.runInNewContext(code, {
  module: moduleStub,
  exports: moduleStub.exports,
  require(id) {
    if (id === 'typebox') return { Type: new Proxy({}, { get: () => () => ({}) }) };
    return require(id);
  },
});
const { previewWidgetLines } = moduleStub.exports;

test('active preview shows only a named Markdown link', () => {
  for (const status of ['starting', 'running']) {
    assert.deepEqual(Array.from(previewWidgetLines({ name: 'Frontend', url: 'http://localhost:5174', status })),
      ['[Frontend](http://localhost:5174)']);
  }
});

test('inactive preview clears the widget', () => {
  assert.equal(previewWidgetLines(undefined), undefined);
  for (const status of ['stopped', 'failed']) {
    assert.equal(previewWidgetLines({ name: 'Frontend', url: 'http://localhost:5174', status }), undefined);
  }
});

test('escapes brackets in preview names', () => {
  assert.equal(previewWidgetLines({ name: 'Frontend [dev]', url: 'http://localhost:5174', status: 'running' })[0],
    '[Frontend \\[dev\\]](http://localhost:5174)');
});
