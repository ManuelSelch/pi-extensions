const { test } = require('node:test');
const { createJevObservationDriver } = require('./support/jev-observation-driver.cjs');

test('Jev observation is disabled by default and on new sessions', async t => {
 const flow = await createJevObservationDriver(t);
 await flow.finishAnUnmarkedRequest();
 flow.thenNoExternalClassification();

 await flow.enableObservation();
 await flow.startNewSession();
 await flow.finishAnUnmarkedRequest();
 flow.thenNoExternalClassification();
});

test('observation can be enabled and disabled with a privacy warning', async t => {
 const flow = await createJevObservationDriver(t);
 await flow.enableObservation();
 flow.thenPrivacyWarningShown();
 await flow.disableObservation();
 await flow.finishAnUnmarkedRequest();
 flow.thenNoExternalClassification();
});

test('enabled observation reports Jev classification without continuing on its decision', async t => {
 const flow = await createJevObservationDriver(t);
 await flow.enableObservation();
 await flow.classifyAs('not-finished', 0.9);
 await flow.finishAnUnmarkedRequest();
 flow.thenClassificationReported('not-finished', 0.9);
 flow.thenNoContinuation();
});

test('done, blocked and uncertain outcomes are reported without continuation', async t => {
 for (const outcome of ['done', 'blocked', 'uncertain']) {
  const flow = await createJevObservationDriver(t);
  await flow.enableObservation();
  await flow.classifyAs(outcome, 0.8);
  await flow.finishAnUnmarkedRequest();
  flow.thenClassificationReported(outcome, 0.8);
  flow.thenNoContinuation();
 }
});

test('classifier failure reports a safe diagnostic without changing continuation behavior', async t => {
 const flow = await createJevObservationDriver(t);
 await flow.enableObservation();
 await flow.failClassification();
 await flow.finishAnUnmarkedRequest();
 flow.thenClassificationFailureReported();
 flow.thenNoContinuation();
});

test('observation preserves explicit-marker continuation', async t => {
 const flow = await createJevObservationDriver(t);
 await flow.enableObservation();
 await flow.classifyAs('done', 0.9);
 await flow.finishWithExplicitUnfinishedStatus();
 flow.thenContinuationRequested();
});

test('cancelled runs are not sent for classification', async t => {
 const flow = await createJevObservationDriver(t);
 await flow.enableObservation();
 await flow.cancelRequest();
 flow.thenNoExternalClassification();
});
