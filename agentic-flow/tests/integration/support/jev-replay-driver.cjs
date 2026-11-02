const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');

async function createJevReplayDriver(_testContext) {
 const replay = await import(pathToFileURL(resolve(__dirname, '../../../jev/replay.ts')).href);
 let decisions = { done: 'done', blocked: 'blocked', unfinished: 'not-finished' };
 let fail = false, submitted = [], results = [], output = '';
 return {
  async returnDecisions(value) { decisions = value; },
  async failOneDecision() { fail = true; },
  async runSyntheticCases() {
   let index = 0;
   results = await replay.replayCases(async messages => {
    submitted.push(JSON.stringify(messages));
    const position = index++;
    if (fail && position === 0) throw new Error('private provider response');
    return { outcome: position < 2 ? decisions.done : position < 4 ? decisions.blocked : decisions.unfinished, confidence: 0.8, provider: 'mock' };
   });
   output = replay.formatReplay(results);
  },
  thenEachCaseShowsExpectedAndActual() { for (const result of results) { assert.ok(output.includes(`expected=${result.expected}`)); assert.ok(output.includes(`actual=${result.actual}`)); } },
  thenSummaryShowsAgreement() { assert.match(output, /6\/6 matches; 0 errors/); },
  thenDisagreementsAreReported() { assert.equal((output.match(/DISAGREEMENT/g) || []).length, 6); assert.match(output, /actual=uncertain/); },
  thenExpectedLabelsWereNotSubmitted() { for (const item of submitted) { assert.doesNotMatch(item, /"expected"|"id":|done-files|blocked-approval|unfinished-files/); } },
  thenFailureIsReportedSeparately() { assert.match(output, /error=classification_failed/); assert.match(output, /5\/6 matches; 1 errors/); assert.doesNotMatch(output, /private provider response/); },
 };
}
module.exports = { createJevReplayDriver };
