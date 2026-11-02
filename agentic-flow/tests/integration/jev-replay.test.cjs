const { test } = require('node:test');
const { createJevReplayDriver } = require('./support/jev-replay-driver.cjs');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');

test('replay requires explicit live consent before contacting a provider', () => {
 const result = spawnSync(process.execPath, [resolve(__dirname, '../../jev/replay-cli.ts')], { encoding: 'utf8', timeout: 10000 });
 assert.equal(result.status, 2);
 assert.match(result.stderr, /--live/);
 assert.equal(result.stdout, '');
});

test('replay compares synthetic done, blocked and unfinished cases', async t => {
 const replay = await createJevReplayDriver(t);
 await replay.returnDecisions({ done: 'done', blocked: 'blocked', unfinished: 'not-finished' });
 await replay.runSyntheticCases();
 replay.thenEachCaseShowsExpectedAndActual();
 replay.thenSummaryShowsAgreement();
});

test('disagreements and uncertain answers remain visible', async t => {
 const replay = await createJevReplayDriver(t);
 await replay.returnDecisions({ done: 'not-finished', blocked: 'uncertain', unfinished: 'done' });
 await replay.runSyntheticCases();
 replay.thenDisagreementsAreReported();
});

test('fixture labels are not sent to the classifier', async t => {
 const replay = await createJevReplayDriver(t);
 await replay.runSyntheticCases();
 replay.thenExpectedLabelsWereNotSubmitted();
});

test('classification errors are reported rather than counted as matches', async t => {
 const replay = await createJevReplayDriver(t);
 await replay.failOneDecision();
 await replay.runSyntheticCases();
 replay.thenFailureIsReportedSeparately();
});
