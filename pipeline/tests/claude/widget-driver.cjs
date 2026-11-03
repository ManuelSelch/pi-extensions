const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let generation = 0;
class ClaudeWidgetDriver {
  static async create() {
    const driver = new ClaudeWidgetDriver();
    Object.assign(driver, { events: {}, calls: [], timers: [], status: { configured: false, suites: {} }, fail: false });
    const modulePath = pathToFileURL(path.resolve(__dirname, '../../hooks/pipeline.js')).href;
    const mod = await import(`${modulePath}?test=${++generation}`);
    mod.register((name, matcher, handler) => { driver.events[name] = typeof matcher === 'function' ? matcher : handler; });
    driver.api = {
      clock: {
        after: (_ms, fn) => driver.timer(fn),
        every: (_ms, fn) => driver.timer(fn),
      },
      mcp: { call: async (server, tool) => {
        driver.calls.push({ server, tool });
        if (driver.fail) throw new Error('server unavailable');
        return { content: [{ type: 'text', text: JSON.stringify(driver.status) }] };
      } },
      ui: {
        invalidate() {},
        resolve() { return { Box: props => ({ type: 'Box', ...props }), Text: props => ({ type: 'Text', ...props }) }; },
      },
    };
    return driver;
  }
  timer(fn) { const timer = { fn, cancelled: false, cancel() { this.cancelled = true; } }; this.timers.push(timer); return timer; }
  async provideStatus(status) {
    this.fail = false;
    if (status === 'empty') this.status = { configured: false, suites: {} };
    if (status === 'local-and-github') this.status = { configured: true, suites: { unit: { outcome: 'never', stale: false } }, github: { workflows: [{ name: 'Tests', status: 'completed', conclusion: 'failure', jobs: [] }] } };
    if (status === 'changed') this.status = { configured: true, suites: { unit: { outcome: 'failed', stale: false, startedAt: new Date().toISOString() } }, github: { workflows: [] } };
  }
  async failStatusRefresh() { this.fail = true; }
  async advanceRefresh() { for (const timer of this.timers.slice(1)) if (!timer.cancelled) await timer.fn(); }
  async text() {
    const output = await this.events['ui.render'](this.api, { component: 'AbovePrompt', props: {} }, async () => null);
    function flatten(element) { return typeof element === 'string' ? element : element?.children?.map(flatten).join('\n') ?? ''; }
    return flatten(output);
  }
  async thenWidgetShowsLocalAndGitHubStatus() { const text = await this.text(); assert.match(text, /Local/); assert.match(text, /unit/); assert.match(text, /GitHub.*Tests/); }
  async thenWidgetIsHidden() { assert.equal(await this.text(), ''); }
  async thenWidgetShowsChangedStatus() { const text = await this.text(); assert.match(text, /unit/); assert.match(text, /✗/); }
  async thenRefreshFailureIsNotShownAsCurrentSuccess() { const text = await this.text(); assert.match(text, /unavailable|stale/i); assert.doesNotMatch(text, /✓ Local/); }
  async thenNoTestsOrPromptsWereStarted() { assert.ok(this.calls.length); assert.ok(this.calls.every(call => call.tool === 'pipeline_status')); }
  async thenNoFurtherRefreshesOccur() { assert.ok(this.timers.every(timer => timer.cancelled)); }
}
module.exports = { ClaudeWidgetDriver };
