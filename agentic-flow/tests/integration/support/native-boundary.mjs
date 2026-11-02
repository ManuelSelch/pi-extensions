import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdk = await import(pathToFileURL(resolve(process.argv[2])).href);

const cwd = await mkdtemp(join(tmpdir(), 'agentic-flow-'));
const agentDir = join(cwd, 'agent');
const settingsManager = sdk.SettingsManager.inMemory({}, { projectTrusted: true });
const resourceLoader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, additionalExtensionPaths: [resolve('agentic-flow/index.ts')] });
try {
 await resourceLoader.reload();
 assert.deepEqual(resourceLoader.getExtensions().errors, []);
 const sessionManager = sdk.SessionManager.inMemory(cwd);
 const { session } = await sdk.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, sessionManager, tools: [] });
 try {
  const errors = [];
  await session.bindExtensions({ mode: 'rpc', uiContext: { notify() {} }, onError: error => errors.push(error) });
  sessionManager.appendMessage({ role: 'user', content: 'Do the task', timestamp: Date.now() });
  sessionManager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: '[agentic-flow: not-finished]' }], api: 'openai-responses', provider: 'test', model: 'test', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() });
  assert.equal(session._buildBoundaryContext([], 'agent_before_settle').canContinue, false);
  session._lastActivityOutcome = 'completed';
  assert.equal(await session._runBeforeSettleBoundary(), true);
  assert.equal(session._buildBoundaryContext([], 'agent_before_settle').canContinue, true);
  assert.ok(sessionManager.getBranch().some(entry => entry.type === 'custom_message' && entry.customType === 'agentic-flow-continuation'));
  assert.deepEqual(errors, []);
 } finally { session.dispose(); }
} finally { await rm(cwd, { recursive: true, force: true }); }
