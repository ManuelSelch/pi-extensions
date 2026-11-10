const { test, beforeEach } = require('node:test');
const { createApiDriver } = require('./pipeline-api-driver.cjs');

beforeEach(async t => { t.context = { app: await createApiDriver(t) }; });

test('running a suite runs its jobs in order without running another suite', async t => {
  const app = t.context.app;
  await app.configureSuitesWithJobs({ web: ['lint', 'test'], server: ['build'] });

  await app.runSuite('web');

  await app.shouldHaveRunJobsInOrder(['web/lint', 'web/test']);
  await app.shouldNotHaveRunSuite('server');
});

test('jobs inherit suite settings and can override them', async t => {
  const app = t.context.app;
  await app.configureJobsWithSettings({
    suite: 'web', settings: { cwd: 'web', timeoutSeconds: 120, auto: 'after-agent' },
    jobs: { lint: {}, test: { cwd: 'tests', timeoutSeconds: 30, auto: 'manual' } },
  });

  await app.runSuite('web');

  await app.shouldUseJobSettings('web/lint', { cwd: 'web', timeoutSeconds: 120, auto: 'after-agent' });
  await app.shouldUseJobSettings('web/test', { cwd: 'tests', timeoutSeconds: 30, auto: 'manual' });
});

test('automatic runs select jobs using their effective auto setting', async t => {
  const app = t.context.app;
  await app.configureJobsWithSettings({
    suite: 'web', settings: { auto: 'after-agent' },
    jobs: { lint: {}, test: { auto: 'manual' } },
  });

  await app.runAutomatically();

  await app.shouldHaveRunJobsInOrder(['web/lint']);
  await app.shouldNotHaveRunJob('web/test');
});

test('existing command-only suites continue to run and retain their approval and results', async t => {
  const app = t.context.app;
  await app.prepareApprovedLegacySuiteWithResult('unit');

  await app.runSuiteWithoutPrompt('unit');

  await app.shouldPreserveLegacySuiteBehavior('unit');
});

test('job failures remain visible and do not prevent later jobs from running', async t => {
  const app = t.context.app;
  await app.configureSuiteWithJobOutcomes('web', { lint: 'failed', test: 'passed' });

  await app.runSuite('web');

  await app.shouldShowJobOutcomes('web', { lint: 'failed', test: 'passed' });
  await app.shouldShowSuiteOutcome('web', 'failed');
  await app.shouldHaveRunJobsInOrder(['web/lint', 'web/test']);
});
