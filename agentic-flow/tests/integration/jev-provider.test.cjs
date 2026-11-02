const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');

const modulePath = pathToFileURL(resolve(__dirname, '../../jev/observe.ts')).href;
const messages = [
 { role: 'user', content: [{ type: 'text', text: 'old request' }] },
 { role: 'user', content: [{ type: 'text', text: 'finish the task' }, { type: 'image', data: 'PRIVATE-IMAGE' }] },
 { role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE-THOUGHT' }, { type: 'text', text: 'work remains' }, { type: 'toolCall', arguments: { password: 'PRIVATE-ARG' } }] },
 { role: 'toolResult', content: [{ type: 'text', text: 'check failed' }], isError: true },
];
function response(model = 'typesafe/jev-1.14-20261014') {
 return { model, answers: { completion: { type: 'choice', choice: 'not-finished', confidence: 0.8, probabilities: { done: 0.1, blocked: 0.05, 'not-finished': 0.8, uncertain: 0.05 } } }, usage: { input_tokens: 10, output_tokens: 2 } };
}

test('Jev uses the native OpenRouter Decisions contract with bounded projected evidence', async () => {
 const { observe } = await import(modulePath);
 let request;
 const result = await observe(messages, { env: { JEV_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'secret' }, fetchImpl: async (url, init) => {
  request = { url, init };
  return new Response(JSON.stringify(response()), { status: 200 });
 } });
 assert.equal(request.url, 'https://openrouter.ai/api/alpha/decisions');
 assert.equal(request.init.redirect, 'manual');
 assert.equal(JSON.parse(request.init.body).model, 'typesafe/jev-1.14');
 assert.match(request.init.body, /finish the task/);
 assert.doesNotMatch(request.init.body, /old request|PRIVATE-IMAGE|PRIVATE-THOUGHT|PRIVATE-ARG/);
 assert.deepEqual(result, { outcome: 'not-finished', confidence: 0.8, provider: 'openrouter' });
});

test('Jev uses the TypeSafe endpoint by default', async () => {
 const { observe } = await import(modulePath);
 let url, body;
 await observe(messages, { env: { TYPESAFE_API_KEY: 'secret' }, fetchImpl: async (target, init) => {
  url = target; body = JSON.parse(init.body);
  return new Response(JSON.stringify(response('jev-1.14.0')), { status: 200 });
 } });
 assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
 assert.equal(body.model, 'jev-1.14.0');
});

test('Jev rejects malformed, inconsistent and unexpected-model responses', async () => {
 const { validateObservation } = await import(modulePath);
 const accept = model => model.startsWith('typesafe/jev-1.14');
 for (const value of [response('typesafe/jev-router'), { ...response(), usage: {} }, { ...response(), answers: { completion: { ...response().answers.completion, probabilities: { done: 1 } } } }]) {
  assert.throws(() => validateObservation(value, accept));
 }
});

test('missing credentials and oversized evidence fail before network access', async () => {
 const { observe } = await import(modulePath);
 let calls = 0;
 const fetchImpl = async () => { calls++; throw new Error('unexpected'); };
 await assert.rejects(observe(messages, { env: {}, fetchImpl }));
 await assert.rejects(observe([{ role: 'user', content: 'x'.repeat(25000) }], { env: { TYPESAFE_API_KEY: 'secret' }, fetchImpl }));
 assert.equal(calls, 0);
});
