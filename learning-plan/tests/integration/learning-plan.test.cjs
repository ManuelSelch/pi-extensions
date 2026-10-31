const { test } = require('node:test');
const { LearningPlanDriver } = require('./support/learning-plan-driver.cjs');

test('create a session plan and show its milestones above the composer', async t => {
  const plan = new LearningPlanDriver(t);
  await plan.create('TypeScript', [
    { title: 'Explain unions', criterion: 'Explain why a value may have either type' },
    { title: 'Apply narrowing', criterion: 'Explain a check and solve a changed example independently' },
  ]);

  await plan.expectMilestones(['pending', 'pending']);
  await plan.expectWidget(['TypeScript · 0/2 demonstrated', '○ #1 Explain unions', '○ #2 Apply narrowing']);
  await plan.expectCompleteSessionSnapshot();
});

test('complete one milestone and activate the next atomically', async t => {
  const plan = new LearningPlanDriver(t);
  await plan.createTwoMilestones();
  await plan.update([{ id: 1, status: 'active' }]);

  await plan.update([
    { id: 1, status: 'demonstrated', evidence: 'Explained the union and independently handled a different example.' },
    { id: 2, status: 'active' },
  ]);

  await plan.expectMilestones(['demonstrated', 'active']);
  await plan.expectEvidence(1, 'Explained the union and independently handled a different example.');
  await plan.expectWidgetCount('1/2 demonstrated');
});

test('invalid changes leave both stored state and widget unchanged', async t => {
  const plan = new LearningPlanDriver(t);
  await plan.createTwoMilestones();

  await plan.rejectUpdate([{ id: 1, status: 'demonstrated' }], 'evidence');
  await plan.rejectUpdate([{ id: 1, status: 'active' }, { id: 2, status: 'active' }], 'active');
  await plan.rejectUpdate([{ id: 1, status: 'active' }, { id: 99, status: 'pending' }], '99');
  await plan.rejectCreateOverExistingPlan();

  await plan.expectMilestones(['pending', 'pending']);
  await plan.expectNoSuccessfulMutationSinceCreation();
});

test('reopen understanding with an explanation, and append a new milestone', async t => {
  const plan = new LearningPlanDriver(t);
  await plan.createDemonstratedMilestone('Explained and applied independently.');

  await plan.update([{ id: 1, status: 'active', evidence: 'A changed example revealed confusion about null.' }]);
  await plan.add('Handle null', 'Explain and independently handle a nullable union');

  await plan.expectMilestones(['active', 'pending']);
  await plan.expectEvidence(1, 'A changed example revealed confusion about null.');
  await plan.expectDistinctStableIds();
});

test('restore branch-local state after reload, navigation and compaction', async t => {
  const plan = new LearningPlanDriver(t);
  await plan.createTwoMilestones();
  await plan.rememberBranch('before-practice');
  await plan.update([{ id: 1, status: 'active' }]);

  await plan.restartExtensionAndResumeSession();
  await plan.expectMilestones(['active', 'pending']);

  await plan.compactSessionUsingPi();
  await plan.restartExtensionAndResumeSession();
  await plan.expectMilestones(['active', 'pending']);

  await plan.navigateToBranch('before-practice');
  await plan.expectMilestones(['pending', 'pending']);
});

test('sessions are isolated and full details are readable without UI', async t => {
  const plan = new LearningPlanDriver(t);
  await plan.createTwoMilestones();
  await plan.openDifferentSession();
  await plan.expectNoPlanOrWidget();

  await plan.returnToOriginalSessionWithoutUi();
  await plan.expectFullPlanThroughGet();
  await plan.expectFullPlanThroughCommand();
});

test('teach skill retrieves the plan and updates only assessed understanding', async t => {
  const plan = new LearningPlanDriver(t);

  await plan.expectTeachInstructions({
    retrieveOnStartAndResume: true,
    activateBeforeTeaching: true,
    updateAfterAssessmentBeforeNextQuestion: true,
    requireReasoningAndIndependentTransfer: true,
    cancellationIsNotEvidence: true,
    preserveIncompleteOnPause: true,
    noTodoForLearningMilestones: true,
  });
});
