const { test } = require('node:test');
const { createAgenticFlowDriver } = require('./support/continuation-driver.cjs');

test('explicit unfinished work requests a continuation', async t => {
 const flow = await createAgenticFlowDriver(t);
 flow.thenStatusInstructionsProvided();
 await flow.finishWithStatus('not-finished');
 flow.thenContinuationRequested();
});

test('completed work settles without continuation', async t => {
 const flow = await createAgenticFlowDriver(t);
 await flow.finishWithStatus('done');
 flow.thenNoContinuation();
});

test('a blocker or approval request is never automatically continued', async t => {
 const flow = await createAgenticFlowDriver(t);
 await flow.finishWithStatus('blocked');
 flow.thenNoContinuation();

 await flow.finishWithApprovalRequired();
 flow.thenNoContinuation();
});

test('an ambiguous response settles rather than guessing', async t => {
 const flow = await createAgenticFlowDriver(t);
 await flow.finishWithoutStatus();
 flow.thenNoContinuation();
});

test('automatic continuation stops at its configured limit', async t => {
 const flow = await createAgenticFlowDriver(t);
 await flow.exhaustContinuationLimit();
 await flow.finishWithStatus('not-finished');
 flow.thenNoContinuation();
 flow.thenLimitReported();
});

test('cancellation prevents automatic continuation', async t => {
 const flow = await createAgenticFlowDriver(t);
 await flow.cancelWithUnfinishedWork();
 flow.thenNoContinuation();
});

test('a new user request gets a fresh continuation budget', async t => {
 const flow = await createAgenticFlowDriver(t);
 await flow.exhaustContinuationLimit();
 await flow.startNewRequest();
 await flow.finishWithStatus('not-finished');
 flow.thenContinuationRequested();
});

test('queued work, unavailable context and incomplete responses do not trigger another continuation', async t => {
 const flow = await createAgenticFlowDriver(t);
 for (const state of [{ pending: true }, { canContinue: false }, { stopReason: 'length' }]) {
  await flow.finishWithUnfinishedAnd(state);
  flow.thenNoContinuation();
 }
});
