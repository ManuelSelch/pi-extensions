const { test, before } = require('node:test');
let presentation;
before(async () => { presentation = await import('@manuelselch/pi-sdk/extension-ui'); });
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const question = { questionId: 'powers-1', title: 'A small check', body: 'What is `2 ** 3`?\n\n$$2^3$$',
  options: [{ id: 'a', label: '6' }, { id: 'b', label: '8' }] };
function setup({ answer = '8', reasoning = '  Two multiplied three times.\n', hasUI = true, mode = 'rpc', scoped = true, signal } = {}) {
  const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: id => id === '@manuelselch/pi-sdk/extension-ui' ? presentation : require(id) });
  let tool;
  module.exports.default({ registerTool(value) { tool = value; } });
  const calls = [];
  const ui = {
    async select(title, options) { calls.push({ kind: 'select', title, options: [...options] }); return typeof answer === 'function' ? answer() : answer; },
    async editor(title, prefill) { calls.push({ kind: 'editor', title, prefill }); return reasoning; },
  };
  if (scoped) ui.withPromptPresentation = async (presentation, run) => { calls.push({ kind: 'presentation', ...JSON.parse(JSON.stringify(presentation)) }); return run(); };
  return { tool, calls, run: (params = question) => tool.execute('call', params, signal, undefined, { mode, ui, hasUI }) };
}
const plain = result => JSON.parse(JSON.stringify(result));

test('collects one stable answer and verbatim reasoning using standard scoped select/editor', async () => {
  const app = setup();
  const result = plain(await app.run());
  assert.equal(app.tool.name, 'quiz');
  assert.equal(app.tool.executionMode, 'sequential');
  assert.deepEqual(app.calls.map(call => call.kind), ['presentation', 'select', 'presentation', 'editor']);
  assert.equal(app.calls[0].body.format, 'markdown');
  assert.equal(app.calls[0].body.text, question.body);
  assert.equal(app.calls[0].submission, 'explicit');
  assert.equal(app.calls[0].submitLabel, 'Continue to reasoning');
  assert.deepEqual(app.calls[1].options, ['6', '8', "I don't know"]);
  assert.equal(app.calls[2].submission, undefined);
  assert.equal(app.calls[2].submitLabel, 'Submit answer');
  assert.match(app.calls[2].body.text, /Selected answer: 8/);
  assert.deepEqual(result.details, { ...question, status: 'submitted', answer: { kind: 'option', optionId: 'b', label: '8' }, reasoning: '  Two multiplied three times.\n' });
  assert.deepEqual(JSON.parse(result.content[0].text), result.details);
  assert.equal('correct' in result.details, false);
});

test('preserves empty reasoning and an explicit unknown answer', async () => {
  const result = plain(await setup({ answer: "I don't know", reasoning: '' }).run());
  assert.equal(result.details.status, 'submitted');
  assert.deepEqual(result.details.answer, { kind: 'unknown' });
  assert.equal(result.details.reasoning, '');
});

test('uses readable native dialogs without depending on a host capability', async () => {
  const app = setup({ mode: 'tui', scoped: false });
  const result = plain(await app.run());
  assert.equal(result.details.status, 'submitted');
  assert.deepEqual(app.calls.map(call => call.kind), ['select', 'editor']);
  assert.match(app.calls[0].title, /A small check\n\nWhat is/);
  assert.match(app.calls[1].title, /Selected answer: 8/);
});

test('cancelling selection opens no editor and does not grade', async () => {
  const cancelled = setup({ answer: () => undefined });
  const result = plain(await cancelled.run());
  assert.equal(result.details.status, 'cancelled');
  assert.equal(result.details.stage, 'answer');
  assert.equal(cancelled.calls.some(call => call.kind === 'editor'), false);
  assert.equal('answer' in result.details, false);
});

test('cancelling reasoning does not report a partial quiz submission', async () => {
  const app = setup();
  // Override the default by returning undefined explicitly through an own value.
  const source = app.tool.execute;
  const calls = [];
  const result = plain(await source('call', question, undefined, undefined, { hasUI: true, mode: 'tui',
    ui: { async select() { return '8'; }, async editor() { calls.push('editor'); return undefined; } } }));
  assert.equal(result.details.status, 'cancelled');
  assert.equal(result.details.stage, 'reasoning');
  assert.equal('answer' in result.details, false);
  assert.deepEqual(calls, ['editor']);
});

test('reports unavailable UI explicitly, including unsupported RPC hosts', async () => {
  for (const settings of [{ hasUI: false }, { mode: 'rpc', scoped: false }]) {
    const app = setup(settings);
    assert.equal((await app.run()).details.status, 'unavailable');
    assert.deepEqual(app.calls, []);
  }
});

test('rejects ambiguous choices, reserved identities, blank content and unexpected selections', async () => {
  for (const params of [
    { ...question, options: [question.options[0], { id: 'a', label: 'Other' }] },
    { ...question, options: [question.options[0], { id: 'b', label: '6' }] },
    { ...question, options: [question.options[0], { id: 'b', label: "I don't know" }] },
    { ...question, options: [question.options[0], { id: '__unknown__', label: 'Other' }] },
    { ...question, body: '  ' },
    { ...question, title: '  ' },
    { ...question, questionId: '  ' },
  ]) {
    const app = setup();
    await assert.rejects(app.run(params));
    assert.deepEqual(app.calls, []);
  }
  const app = setup({ answer: 'invented' });
  await assert.rejects(app.run(), /unexpected|unknown|invalid/i);
  assert.equal(app.calls.some(call => call.kind === 'editor'), false);
});

test('aborted calls do not begin or advance a question', async () => {
  const controller = new AbortController();
  controller.abort();
  const app = setup({ signal: controller.signal });
  assert.equal((await app.run()).details.status, 'cancelled');
  assert.deepEqual(app.calls, []);
  const later = new AbortController();
  const advancing = setup({ signal: later.signal, answer: () => { later.abort(); return '8'; } });
  assert.equal((await advancing.run()).details.status, 'cancelled');
  assert.equal(advancing.calls.some(call => call.kind === 'editor'), false);
});
