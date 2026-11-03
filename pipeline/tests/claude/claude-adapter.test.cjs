const { test, beforeEach, afterEach } = require('node:test');

const { ClaudePipelineDriver } = require('./claude-driver.cjs');

beforeEach(async t => { t.context = { pipeline: await ClaudePipelineDriver.create(t) }; });
afterEach(async t => { await t.context?.pipeline?.dispose(); });

test('Claude reads pipeline status without executing commands or requesting approval', async t => {
  const pipeline = t.context.pipeline;

  await pipeline.inspectStatus();

  await pipeline.thenStatusIsReadOnly();
});

test('Claude saves configuration only after the user reviews and approves it', async t => {
  const pipeline = t.context.pipeline;

  await pipeline.configurePipeline('approve');

  await pipeline.thenConfigurationIsSavedAfterReview();
});

for (const approval of ['reject', 'unavailable']) {
  test(`Claude does not save configuration when approval is ${approval}`, async t => {
    const pipeline = t.context.pipeline;

    await pipeline.configurePipeline(approval);

    await pipeline.thenConfigurationAndApprovalAreUnchanged();
  });
}

test('Claude runs approved suites and reports their results', async t => {
  const pipeline = t.context.pipeline;

  await pipeline.runSuite('approve');

  await pipeline.thenSuiteResultsAreReported();
});

test('Claude reuses an existing Pi approval for the same configuration', async t => {
  const pipeline = t.context.pipeline;
  await pipeline.approveThroughPi();

  await pipeline.runPreviouslyApproved();

  await pipeline.thenSuiteResultsAreReported();
  await pipeline.thenNoApprovalWasRequested();
});

for (const approval of ['reject', 'unavailable']) {
  test(`Claude never runs an unapproved pipeline when approval is ${approval}`, async t => {
    const pipeline = t.context.pipeline;

    await pipeline.runSuite(approval);

    await pipeline.thenNoCommandsWereExecuted();
    await pipeline.thenToolFailed();
  });
}

test('Claude reports the outcome of waiting for an exact commit', async t => {
  const pipeline = t.context.pipeline;

  await pipeline.waitForCommit('failed');

  await pipeline.thenWaitReportsCommitOutcome();
});

test('disconnecting Claude stops local work', async t => {
  const pipeline = t.context.pipeline;
  await pipeline.runSuite('start-and-wait');

  await pipeline.disconnect();

  await pipeline.thenDisconnectedWorkIsCancelled();
});

test('cancelling a Claude operation stops local work', async t => {
  const pipeline = t.context.pipeline;
  await pipeline.runSuite('start-and-wait');

  await pipeline.cancelOperation();

  await pipeline.thenOperationIsCancelled();
});
