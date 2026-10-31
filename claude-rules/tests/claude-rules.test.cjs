const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const ts = require('typescript');

const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const extension = { exports: {} };
new Function('module', 'exports', 'require', code)(extension, extension.exports, require);
const { claudeRulesPrompt, default: claudeRules } = extension.exports;

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'claude-rules-'));
  const home = join(root, 'home');
  const project = join(root, 'work', 'project');
  write(join(home, '.claude', 'rules', 'global.md'), 'Global rule');
  write(join(root, 'work', '.claude', 'rules', 'parent.md'), 'Parent rule');
  write(join(project, '.claude', 'rules', 'b.md'), '---\npaths: ["src/**"]\n---\nScoped rule\n');
  write(join(project, '.claude', 'rules', 'nested', 'a.md'), 'Nested rule');
  write(join(project, '.claude', 'rules', 'notes.txt'), 'Not a rule');
  return { home, project: join(project, 'src') };
}

test('collects global, ancestor and project rules from outermost to nearest', () => {
  const { home, project } = fixture();
  mkdirSync(project, { recursive: true });
  const prompt = claudeRulesPrompt(project, home);
  const order = ['Global rule', 'Parent rule', 'Scoped rule', 'Nested rule'].map(rule => prompt.indexOf(rule));
  assert.ok(order.every(index => index >= 0), prompt);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(prompt, /paths:|Not a rule/);
  assert.match(prompt, /## .*nested\/a\.md/);
});

test('returns no prompt without rules', () => {
  const empty = mkdtempSync(join(tmpdir(), 'claude-rules-empty-'));
  assert.equal(claudeRulesPrompt(empty, empty), undefined);
});

test('adds and removes the claudeRules system prompt section', async () => {
  const { project } = fixture();
  const empty = mkdtempSync(join(tmpdir(), 'claude-rules-none-'));
  let handler;
  claudeRules({ on: (event, fn) => { if (event === 'before_agent_start') handler = fn; } }, empty);
  const sections = { claudeRules: 'stale' };
  await handler({ systemPromptOptions: { sections } }, { cwd: project, ui: { notify() {} } });
  assert.match(sections.claudeRules, /Scoped rule/);
  await handler({ systemPromptOptions: { sections } }, { cwd: empty, ui: { notify() {} } });
  assert.equal('claudeRules' in sections, false);
});
