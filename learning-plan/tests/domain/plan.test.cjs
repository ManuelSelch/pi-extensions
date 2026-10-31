const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTs } = require('../integration/support/learning-plan-driver.cjs');
const { applyAction, snapshot, replay } = loadTs(path.resolve(__dirname, '../../domain/plan.ts'));

function create(count = 2) {
  return applyAction({ plan: null }, { action: 'create', title: 'TypeScript',
    milestones: Array.from({ length: count }, (_, i) => ({ title: 'Milestone ' + (i + 1), criterion: 'Explain and independently transfer' })) });
}

test('actions do not mutate their input and ids remain stable on append', () => {
  const before = create();
  const next = applyAction(before, { action: 'add', title: 'New topic', criterion: 'Explain independently' });

  assert.equal(before.plan.milestones.length, 2);
  assert.deepEqual(next.plan.milestones.map(m => m.id), [1, 2, 3]);
  assert.equal(next.plan.nextId, 4);
});

test('invalid final active count rejects the entire batch without changing input', () => {
  const before = create();

  assert.throws(() => applyAction(before, { action: 'update', updates: [
    { id: 1, status: 'active' }, { id: 2, status: 'active' },
  ] }), /one milestone may be active/i);
  assert.deepEqual(before.plan.milestones.map(m => m.status), ['pending', 'pending']);
});

test('reopening demonstrated understanding requires new evidence', () => {
  const before = applyAction(create(), { action: 'update', updates: [
    { id: 1, status: 'demonstrated', evidence: 'Explained and solved a changed task without hints.' },
  ] });

  assert.throws(() => applyAction(before, { action: 'update', updates: [{ id: 1, status: 'active' }] }), /evidence/i);
  const next = applyAction(before, { action: 'update', updates: [
    { id: 1, status: 'active', evidence: 'New example revealed a misconception.' },
  ] });
  assert.equal(next.plan.milestones[0].status, 'active');
  assert.equal(before.plan.milestones[0].status, 'demonstrated');
});

test('assessment evidence can change without claiming demonstration', () => {
  const state = applyAction(create(), { action: 'update', updates: [
    { id: 1, status: 'active', evidence: 'Selected correctly but could not explain; revealing hint needed.' },
  ] });

  assert.equal(state.plan.milestones[0].status, 'active');
  assert.match(state.plan.milestones[0].evidence, /hint needed/);
});

test('reject malformed, empty, oversized and unknown actions', () => {
  const before = create();
  for (const params of [
    { action: 'update', updates: [] },
    { action: 'update', updates: [{ id: 1 }] },
    { action: 'update', updates: [{ id: 1, status: 'active' }, { id: 1, status: 'pending' }] },
    { action: 'update', updates: [{ id: 1, status: 'mastered' }] },
    { action: 'update', updates: [{ id: 1, evidence: ' ' }] },
    { action: 'add', title: ' ', criterion: 'Test' },
    { action: 'add', title: 'Test', criterion: 'x'.repeat(1001) },
    { action: 'clear' },
  ]) assert.throws(() => applyAction(before, params));

  assert.throws(() => applyAction({ plan: null }, { action: 'create', title: 'X', milestones: [] }));
  assert.throws(() => applyAction({ plan: null }, { action: 'create', title: 'X', milestones: [null] }));
  assert.throws(() => applyAction(create(50), { action: 'add', title: 'More', criterion: 'More' }));
  assert.throws(() => applyAction({ plan: null }, { action: 'update', updates: [{ id: 1, status: 'active' }] }));
});

test('invalid history is ignored without repairing or inventing completion evidence', () => {
  const before = create();
  const invalid = structuredClone(before);
  invalid.plan.milestones[0].status = 'demonstrated';
  const entry = (details, isError = false) => ({ type: 'message', message: {
    role: 'toolResult', toolName: 'learning_plan', details, isError,
  } });

  assert.equal(snapshot(invalid), undefined);
  assert.deepEqual(replay([entry(before), entry(invalid), entry({ plan: null }, true), entry({ plan: {} })]), before);
  assert.deepEqual(replay([]), { plan: null });
});

test('replay and validation return detached snapshots', () => {
  const before = create();
  const restored = snapshot(before);
  restored.plan.milestones[0].title = 'Changed';

  assert.equal(before.plan.milestones[0].title, 'Milestone 1');
});
