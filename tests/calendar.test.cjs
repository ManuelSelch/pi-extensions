const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const source = readFileSync(join(__dirname, '..', 'calendar.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(id) {
      if (id === '@earendil-works/pi-coding-agent') return {};
      if (id === 'typebox') return require('typebox');
      return require(id);
    },
  });
  return module.exports;
}

const { localDate, parseEvents } = load();

test('formats local dates without UTC timezone shifts', () => {
  assert.equal(localDate(0, new Date(2026, 0, 2, 23)), '2026-01-02');
  assert.equal(localDate(7, new Date(2026, 0, 29)), '2026-02-05');
});

test('flattens khal day buckets and keeps only UID-bearing events', () => {
  const events = parseEvents(JSON.stringify([
    [{ uid: 'event-1', summary: 'Meeting' }],
    [{ summary: 'invalid' }, { uid: 'event-2' }],
  ]));
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    { uid: 'event-1', summary: 'Meeting' },
    { uid: 'event-2' },
  ]);
});

test('rejects malformed khal JSON', () => {
  assert.throws(() => parseEvents('not json'));
});
