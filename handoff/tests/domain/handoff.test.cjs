const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load() {
  const file = path.resolve(__dirname, '../../domain/handoff.ts');
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}
const domain = load();

test('classifies changed paths by review concern', () => {
  assert.equal(domain.classifyPath('src/app.ts'), 'code');
  assert.equal(domain.classifyPath('tests/app.test.ts'), 'tests');
  assert.equal(domain.classifyPath('src/app.spec.tsx'), 'tests');
  assert.equal(domain.classifyPath('handoff/tests/domain/handoff.test.cjs'), 'tests');
  assert.equal(domain.classifyPath('docs/usage.md'), 'docs');
  assert.equal(domain.classifyPath('README.md'), 'docs');
  assert.equal(domain.classifyPath('plans/x/PLAN.md'), 'artifacts');
  assert.equal(domain.classifyPath('mockups/x/main.tsx'), 'artifacts');
});

test('parses review arguments', () => {
  assert.deepEqual(domain.parseArguments('review'), { ok: true });
  assert.deepEqual(domain.parseArguments('  review  '), { ok: true });
  assert.equal(domain.parseArguments('review --base origin/main').ok, false);
  assert.equal(domain.parseArguments('review Inbox rows').ok, false);
  assert.equal(domain.parseArguments('').ok, false);
  assert.equal(domain.parseArguments('review --base').ok, false);
  assert.equal(domain.parseArguments('reviews').ok, false);
});

test('states how many entries a capped list omits', () => {
  const files = Array.from({ length: 103 }, (_, index) => `src/file-${index}.ts`);
  const text = domain.formatHandoff({
    feature: 'Large', root: '/repo', branch: 'feat/large', head: { sha: 'h', subject: 'large' },
    base: { sha: 'b', source: 'merge-base with main' }, commits: [], uncommitted: [], changed: files,
    plans: [], mockups: [], approvals: [],
  });

  assert.match(text, /Code \(103\): /);
  assert.match(text, /`src\/file-99\.ts`, … and 3 more/);
  assert.doesNotMatch(text, /file-100/);
});
