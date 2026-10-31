const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTs } = require('../integration/support/learning-plan-driver.cjs');
const { widgetLines, fullPlan } = loadTs(path.resolve(__dirname, '../../ui/format.ts'));

function state(count) {
  return { plan: { title: 'TypeScript', nextId: count + 1,
    milestones: Array.from({ length: count }, (_, i) => ({
      id: i + 1, title: 'Milestone ' + (i + 1), criterion: 'Explain independently', status: 'pending',
    })) } };
}

test('a missing plan removes the widget', () => {
  assert.equal(widgetLines({ plan: null }), undefined);
  assert.equal(fullPlan({ plan: null }), 'No learning plan.');
});

test('long lists remove completed rows first while retaining the active milestone', () => {
  const plan = state(12);
  for (let i = 0; i < 4; i++) plan.plan.milestones[i].status = 'demonstrated';
  plan.plan.milestones[11].status = 'active';

  const lines = widgetLines(plan);

  assert.equal(lines[0], 'TypeScript · 4/12 demonstrated');
  assert.ok(lines.some(line => line === '● #12 Milestone 12'));
  assert.ok(!lines.some(line => /#1 /.test(line)));
  assert.equal(lines.length, 10);
  assert.match(lines.at(-1), /4 more/);
});

test('an active milestone beyond the first eight pending rows remains visible', () => {
  const plan = state(12);
  plan.plan.milestones[11].status = 'active';

  assert.ok(widgetLines(plan).includes('● #12 Milestone 12'));
  assert.equal(fullPlan(plan).match(/Criterion:/g).length, 12);
});

test('widget text cannot inject terminal escapes or multiline rows', () => {
  const plan = state(1);
  plan.plan.title = 'Topic\nNext\u001b[31m';
  plan.plan.milestones[0].title = 'Explain\n\ttypes\u001b[0m';

  const lines = widgetLines(plan);

  assert.equal(lines.length, 2);
  assert.ok(lines.every(line => !/[\x00-\x1f\x7f-\x9f]/.test(line)));
});

test('full details include criteria and evidence but compact widget omits them', () => {
  const plan = state(1);
  plan.plan.milestones[0].evidence = 'Independent transfer demonstrated.';

  assert.match(fullPlan(plan), /Criterion: Explain independently/);
  assert.match(fullPlan(plan), /Evidence: Independent transfer demonstrated/);
  assert.ok(!widgetLines(plan).join('\n').includes('Criterion'));
});
