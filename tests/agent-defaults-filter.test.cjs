const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const source = readFileSync(require('node:path').join(__dirname, '..', 'agent-defaults.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require,
    __dirname: require('node:path').join(__dirname, '..'),
    console,
  });
  return module.exports;
}

const { visibleModelRefs: filterModelRefs } = load();
const visibleModelRefs = (references, patterns) => Array.from(filterModelRefs(references, patterns));
const catalogue = ['openai/gpt-5', 'anthropic/claude-sonnet', 'local/llama'];

 test('an empty enabledModels list means every catalogue model is visible', () => {
  assert.deepEqual(visibleModelRefs(catalogue, []), catalogue);
});

test('exact patterns only expose their matching model', () => {
  assert.deepEqual(visibleModelRefs(catalogue, ['anthropic/claude-sonnet']), ['anthropic/claude-sonnet']);
});

test('wildcards use enabledModels matching semantics', () => {
  assert.deepEqual(visibleModelRefs(catalogue, ['openai/*', 'local/*']), ['openai/gpt-5', 'local/llama']);
});

test('thinking-level suffixes filter by the model reference, not the suffix', () => {
  assert.deepEqual(visibleModelRefs(catalogue, ['openai/gpt-5:high']), ['openai/gpt-5']);
  assert.deepEqual(visibleModelRefs(catalogue, ['anthropic/*:low']), ['anthropic/claude-sonnet']);
});

test('unresolved patterns do not make unrelated catalogue models visible', () => {
  assert.deepEqual(visibleModelRefs(catalogue, ['missing/model', 'openai/*']), ['openai/gpt-5']);
});

test('filtering does not mutate the catalogue or configured patterns', () => {
  const refs = [...catalogue];
  const patterns = ['openai/*'];
  assert.deepEqual(visibleModelRefs(refs, patterns), ['openai/gpt-5']);
  assert.deepEqual(refs, catalogue);
  assert.deepEqual(patterns, ['openai/*']);
});

test('clearing the list restores all models', () => {
  const patterns = ['openai/gpt-5'];
  patterns.length = 0;
  assert.deepEqual(visibleModelRefs(catalogue, patterns), catalogue);
});
