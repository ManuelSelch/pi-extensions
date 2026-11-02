const assert = require('node:assert/strict');
const { load } = require('../../../../workflow/tests/support/load.cjs');

async function createJevObservationDriver(_testContext) {
 const handlers = {}, commands = {}, notifications = [];
 let calls = 0, answer = { outcome: 'done', confidence: 0.9, provider: 'typesafe' }, failure = false, result;
 const pi = { on(name, handler) { handlers[name] = handler; }, registerCommand(name, command) { commands[name] = command; } };
 const todo = { getTodoStateFromBranch() {}, summary() {}, TODO_SNAPSHOT_ENTRY: 'todo-state', todoSnapshot() {} };
 const observer = { async observe() { calls++; if (failure) throw new Error('provider secret'); return answer; } };
 const extension = load('../agentic-flow/index.ts', { '../todo/index.ts': todo, './jev/observe.ts': observer });
 extension.default(pi);
 const ctx = { ui: { notify(message) { notifications.push(message); } } };
 async function finish(text, outcome = 'completed') {
  result = await handlers.agent_before_settle({ entries: [], continue: false, outcome, context: { pendingMessages: [], canContinue: false, contextMessages: [{ role: 'user', content: 'request' }, { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] }] } }, ctx);
 }
 return {
  async enableObservation() { await commands['agentic-flow'].handler('jev on', ctx); },
  async disableObservation() { await commands['agentic-flow'].handler('jev off', ctx); },
  async startNewSession() { await handlers.session_start({}, ctx); },
  async classifyAs(outcome, confidence) { answer = { outcome, confidence, provider: 'typesafe' }; },
  async failClassification() { failure = true; },
  async finishAnUnmarkedRequest() { await finish('A response.'); },
  async finishWithExplicitUnfinishedStatus() { await finish('[agentic-flow: not-finished]'); },
  async cancelRequest() { await finish('A response.', 'aborted'); },
  thenPrivacyWarningShown() { assert.ok(notifications.some(n => /unredacted.*external provider/i.test(n))); },
  thenNoExternalClassification() { assert.equal(calls, 0); },
  thenClassificationReported(outcome, confidence) { assert.ok(notifications.some(n => n.includes(outcome) && n.includes(String(confidence)))); },
  thenNoContinuation() { assert.notEqual(result?.continue, true); },
  thenContinuationRequested() { assert.equal(result?.continue, true); },
  thenClassificationFailureReported() { assert.ok(notifications.some(n => /classification failed/i.test(n))); assert.ok(notifications.every(n => !n.includes('provider secret'))); },
 };
}
module.exports = { createJevObservationDriver };
