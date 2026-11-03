const { test } = require('node:test');

const { ClaudePipelineDriver } = require('./claude-driver.cjs');

test('Claude reads pipeline status without executing commands or requesting approval', async t => {
  const pipeline = await ClaudePipelineDriver.create(t);

  await pipeline.inspectStatus();

  await pipeline.thenStatusIsReadOnly();
});

test('Claude saves configuration only after the user reviews and approves it', async t => {
  const pipeline = await ClaudePipelineDriver.create(t);

  await pipeline.configurePipeline('approve');

  await pipeline.thenConfigurationIsSavedAfterReview();
});

test('Claude does not save configuration when approval is rejected or unavailable', async t => {
  for (const approval of ['reject', 'unavailable']) {
    const pipeline = await ClaudePipelineDriver.create(t);

    await pipeline.configurePipeline(approval);

    await pipeline.thenConfigurationAndApprovalAreUnchanged();
  }
});

test('Claude runs approved suites and reports their results', async t => {
  const pipeline = await ClaudePipelineDriver.create(t);

  await pipeline.runSuite('approve');

  await pipeline.thenSuiteResultsAreReported();
});

test('Claude reuses an existing Pi approval for the same configuration', async t => {
  const pipeline = await ClaudePipelineDriver.create(t);
  await pipeline.approveThroughPi();

  await pipeline.runPreviouslyApproved();

  await pipeline.thenSuiteResultsAreReported();
  await pipeline.thenNoApprovalWasRequested();
});

test('Claude never runs an unapproved pipeline when approval is rejected or unavailable', async t => {
  for (const approval of ['reject', 'unavailable']) {
    const pipeline = await ClaudePipelineDriver.create(t);

    await pipeline.runSuite(approval);

    await pipeline.thenNoCommandsWereExecuted();
    await pipeline.thenToolFailed();
  }
});

test('Claude reports the outcome of waiting for an exact commit', async t => {
  const pipeline = await ClaudePipelineDriver.create(t);

  await pipeline.waitForCommit('failed');

  await pipeline.thenWaitReportsCommitOutcome();
});

test('disconnecting Claude stops local work', async t => {
  const pipeline = await ClaudePipelineDriver.create(t);
  await pipeline.runSuite('start-and-wait');

  await pipeline.disconnect();

  await pipeline.thenDisconnectedWorkIsCancelled();
});

test('cancelling a Claude operation stops local work', async t => {
  const pipeline = await ClaudePipelineDriver.create(t);
  await pipeline.runSuite('start-and-wait');

  await pipeline.cancelOperation();

  await pipeline.thenOperationIsCancelled();
});
