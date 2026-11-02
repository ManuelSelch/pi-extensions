const assert = require('node:assert/strict');
const { load } = require('../../../../workflow/tests/support/load.cjs');

async function createAgenticFlowDriver(_testContext) {
 const handlers = {};
 const notifications = [];
 const pi = {
  on(name, handler) { handlers[name] = handler; },
  registerCommand() {},
 };
 const todo = { getTodoStateFromBranch() {}, summary() {}, TODO_SNAPSHOT_ENTRY: 'todo-state', todoSnapshot() {} };
 const extension = load('../agentic-flow/index.ts', { '../todo/index.ts': todo });
 extension.default(pi);
 const ctx = { ui: { notify(message) { notifications.push(message); } } };
 const options = { sections: {} };
 await handlers.before_agent_start({ systemPromptOptions: options }, ctx);
 let result;
 async function settle(text, outcome = 'completed', overrides = {}) {
  const message = { role: 'assistant', stopReason: overrides.stopReason || 'stop', content: [{ type: 'text', text }] };
  result = await handlers.agent_before_settle({ entries: [], continue: overrides.alreadyContinuing || false, outcome, context: { contextMessages: [message], canContinue: overrides.canContinue === true, pendingMessages: overrides.pending ? [{}] : [] } }, ctx);
 }
 return {
  async finishWithStatus(status) { await settle(`Work summary.\n\n[agentic-flow: ${status}]`); },
  async finishWithApprovalRequired() { await settle('Please approve these scenarios.\n\n[agentic-flow: blocked]'); },
  async finishWithoutStatus() { await settle('Work may remain.'); },
  async cancelWithUnfinishedWork() { await settle('[agentic-flow: not-finished]', 'aborted'); },
  async finishWithUnfinishedAnd(overrides) { await settle('[agentic-flow: not-finished]', 'completed', overrides); },
  async startNewRequest() { await handlers.before_agent_start({ systemPromptOptions: { sections: {} } }, ctx); },
  async thenStatusInstructionsProvided() {
   const { pathToFileURL } = require('node:url');
   const { resolve } = require('node:path');
   const runtime = await import(pathToFileURL(resolve(__dirname, '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js')).href);
   const sections = runtime.buildSystemPromptSections({ ...options, cwd: process.cwd() });
   assert.match(sections.agentic_flow, /approval/);
   assert.match(sections.agentic_flow, /not-finished/);
  },
  async exhaustContinuationLimit() {
   await settle('[agentic-flow: not-finished]');
   await settle('[agentic-flow: not-finished]');
  },
  thenContinuationRequested() { assert.equal(result?.continue, true); assert.match(result.entries.at(-1).content, /continue/i); },
  thenNoContinuation() { assert.notEqual(result?.continue, true); },
  thenLimitReported() { assert.ok(notifications.some(message => /limit/i.test(message))); },
 };
}
module.exports = { createAgenticFlowDriver };
