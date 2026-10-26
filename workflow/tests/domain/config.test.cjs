const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('../support/load.cjs');
const { steps, validateConfig, validateDefaults, resolveSteps, composePrompts, WorkflowDraft, parseCommand } = load('domain/config.ts');
const defaults = Object.fromEntries(['mock','plan','design','commit'].map(s => [s, { enabled:true, prompt:s+'.md', skills:[s] }]));

test('inherits fields independently, retaining false, null, empty lists and provenance', () => {
  const result = resolveSteps(defaults, { steps:{mock:{enabled:false, prompt:'global.md'}} }, { steps:{mock:{skills:[]},design:{prompt:null}} }, 'global.json', 'project.json');
  assert.equal(result.mock.enabled, false);
  assert.equal(result.mock.prompt, 'global.md');
  assert.deepEqual(plain(result.mock.skills), []);
  assert.equal(result.mock.sources.enabled, 'global.json');
  assert.equal(result.mock.sources.skills, 'project.json');
  assert.equal(result.design.prompt, null);
  assert.ok(steps.every(s => resolveSteps(defaults)[s].enabled));
});
test('validates the unversioned current shape without mutating unknown fields', () => {
  const config = {note:1,steps:{mock:{enabled:false, extra:'keep'}}};
  assert.equal(validateConfig(config, 'config.json'), config);
  for(const value of [null, [], {steps:[]}, {steps:{typo:{}}}, {steps:{mock:{enabled:'yes'}}}, {steps:{mock:{prompt:''}}}, {steps:{mock:{skills:[1]}}}]) {
    assert.throws(() => validateConfig(value, 'config.json'), /config.json/);
  }
});
test('shipped defaults require every field for every step, including disabled steps', () => {
  assert.deepEqual(plain(validateDefaults({steps:defaults}, 'defaults.json')), defaults);
  for (const step of steps) for (const field of ['enabled','prompt','skills']) {
    const config = {steps:JSON.parse(JSON.stringify(defaults))};
    delete config.steps[step][field];
    assert.throws(() => validateDefaults(config, 'defaults.json'), /defaults.json/);
  }
  const config = {steps:JSON.parse(JSON.stringify(defaults))};
  config.steps.mock={enabled:false,prompt:null,skills:[]};
  assert.deepEqual(plain(validateDefaults(config, 'defaults.json').mock), config.steps.mock);
});
test('composes prompts once in fixed order, not input order', () => {
  assert.equal(composePrompts({commit:'commit',mock:'mock',design:'design'}), '## mock\nmock\n\n## design\ndesign\n\n## commit\ncommit');
});
test('draft patches only changed enablement and cancels toggle round trips', () => {
  const draft = new WorkflowDraft({steps:{mock:{enabled:false}}}, {mock:false,plan:true,design:true,commit:true}, {mock:true,plan:true,design:true,commit:true});
  draft.toggle('mock');
  assert.deepEqual(plain(draft.patch()), {mock:true});
  draft.toggle('mock');
  assert.deepEqual(plain(draft.patch()), {});
  draft.restore();
  assert.equal(draft.values().mock, true);
  assert.deepEqual(plain(draft.patch()), {mock:null});
});
test('commands use subcommands, not flags or manual on/off', () => {
  for (const [text, expected] of [['','project'], ['global','global'], ['status','status'], ['preview','preview']]) assert.equal(parseCommand(text), expected);
  assert.throws(() => parseCommand('--global'), /Usage/);
  assert.throws(() => parseCommand('on mock'), /Usage/);
});
