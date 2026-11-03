const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../pipeline-helpers.cjs');

class WaitToolDriver {
  static async create(t) {
    const tools = {}, events = {}, calls = [], updates = [];
    const Type = (await import('typebox')).Type;
    const { default: extension } = load('pipeline/index.ts', {
      typebox: { Type },
      '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_path, fn) => fn() },
      '../core/wait.ts': { waitForPipeline: async (reader, options) => {
        calls.push({ reader, options });
        options.onUpdate({ outcome: 'waiting', runs: [] });
        if (driver.outcome) return { outcome: driver.outcome, runs: [] };
        if (options.signal.aborted) return { outcome: 'cancelled', runs: [] };
        return new Promise(resolve => options.signal.addEventListener('abort', () => resolve({ outcome: 'cancelled', runs: [] }), { once: true }));
      } },
    });
    extension({ registerTool(spec) { tools[spec.name] = spec; }, registerCommand() {}, on(name, fn) { events[name] = fn; } });
    const driver = new WaitToolDriver();
    Object.assign(driver, { tools, events, calls, updates, ctx: { cwd: '/project', hasUI: false } });
    t.after(() => driver.dispose());
    return driver;
  }
  async dispose() { if (this.disposed) return; this.disposed = true; await this.stopSession(); }
  startWaiting(params = {}, signal) { this.result = this.tools.pipeline_wait.execute('wait', params, signal, update => this.updates.push(update), this.ctx); }
  async stopSession() { await this.events.session_shutdown({}, this.ctx); }
  async replaceSession() { await this.events.session_start({}, this.ctx); }
  async thenOutcome(expected) { const result = await this.result; assert.equal(result.details.outcome, expected); assert.equal(result.isError, expected !== 'passed'); }
  thenParametersForwarded() { assert.equal(this.calls[0].options.ref, 'release'); assert.equal(this.calls[0].options.timeoutSeconds, 90); assert.equal(this.updates[0].details.outcome, 'waiting'); }
  thenSchemaHasDefaultsGuidance() {
    assert.match(this.tools.pipeline_wait.description, /HEAD.*resolved once/);
    assert.equal(this.tools.pipeline_wait.parameters.properties.timeoutSeconds.maximum, 86400);
  }
}

beforeEach(async t => { t.context = { driver: await WaitToolDriver.create(t) }; });
afterEach(async t => { await t.context?.driver?.dispose(); });

test('wait tool forwards selection and progress without configuration or UI', async t => {
  const d = t.context.driver;
  d.outcome = 'passed';

  d.startWaiting({ ref: 'release', timeoutSeconds: 90 });

  await d.thenOutcome('passed');
  d.thenParametersForwarded();
  d.thenSchemaHasDefaultsGuidance();
});

for (const outcome of ['failed', 'cancelled', 'not-found', 'timed-out', 'unavailable']) {
  test(`wait outcome ${outcome} is a tool error`, async t => {
    const d = t.context.driver;
    d.outcome = outcome;

    d.startWaiting();

    await d.thenOutcome(outcome);
  });
}

test('session shutdown cancels pending waits and awaits cleanup', async t => {
  const d = t.context.driver;

  d.startWaiting();
  await d.stopSession();

  await d.thenOutcome('cancelled');
});

test('session replacement cancels pending waits before restarting readers', async t => {
  const d = t.context.driver;

  d.startWaiting();
  await d.replaceSession();

  await d.thenOutcome('cancelled');
});

test('tool cancellation propagates into the wait operation', async t => {
  const d = t.context.driver;
  const controller = new AbortController();

  d.startWaiting({}, controller.signal);
  controller.abort();

  await d.thenOutcome('cancelled');
});
