const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fixture, config, waitFor } = require('../pipeline-helpers.cjs');

class ClaudePipelineDriver {
  static async create(t) {
    const f = await fixture(t);
    const { tsImport } = await import('tsx/esm/api');
    const { createPipelineServer } = await tsImport(pathToFileURL(path.resolve(__dirname, '../../claude/server.ts')).href, __filename);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { ElicitRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
    const marker = path.join(f.root, 'executed');
    const d = new ClaudePipelineDriver();
    Object.assign(d, { f, marker, reviews: [], approval: 'approve', config: config(`require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`) });
    const server = createPipelineServer({ cwd: f.root, cacheRoot: f.cache, wait: async (_cwd, options) => {
      d.waitOptions = options;
      return { outcome: 'failed', commit: 'a'.repeat(40), runs: [] };
    } });
    const client = new Client({ name: 'pipeline-test', version: '1' }, { capabilities: { elicitation: {} } });
    client.setRequestHandler(ElicitRequestSchema, async request => {
      d.reviews.push(request.params.message);
      if (d.approval === 'unavailable') throw new Error('no interactive UI');
      return d.approval === 'reject' ? { action: 'decline' } : { action: 'accept', content: { approved: true } };
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    Object.assign(d, { server, client });
    t.after(async () => { await client.close(); await server.close(); });
    return d;
  }
  async call(name, args = {}, options = {}) { return this.client.callTool({ name, arguments: args }, undefined, options); }
  async inspectStatus() { this.result = await this.call('pipeline_status'); }
  async approveThroughPi() {
    const { Pipeline } = await (await import('tsx/esm/api')).tsImport(pathToFileURL(path.resolve(__dirname, '../../core/pipeline.ts')).href, __filename);
    await new Pipeline(this.f.root, this.f.cache).configure(this.config, async () => true);
  }
  async runPreviouslyApproved() { this.result = await this.call('pipeline_run'); }
  async configurePipeline(approval) { this.approval = approval; this.result = await this.call('pipeline_configure', { config: this.config }); }
  async runSuite(approval) {
    this.approval = approval;
    if (approval === 'start-and-wait') {
      this.config = config(`require('fs').writeFileSync(${JSON.stringify(this.marker)}, 'started'); setInterval(() => {}, 1000)`);
      await this.configurePipeline('approve');
      this.controller = new AbortController();
      this.pending = this.call('pipeline_run', {}, { signal: this.controller.signal, timeout: 30000 }).catch(error => error);
      await waitFor(async () => fs.stat(this.marker).then(() => true, () => false));
      return;
    }
    await fs.mkdir(path.dirname(this.f.configPath), { recursive: true });
    const { formatConfigYaml } = await (await import('tsx/esm/api')).tsImport(pathToFileURL(path.resolve(__dirname, '../../core/config-format.ts')).href, __filename);
    await fs.writeFile(this.f.configPath, formatConfigYaml(this.config));
    this.result = await this.call('pipeline_run');
  }
  async waitForCommit() { this.result = await this.call('pipeline_wait', { timeoutSeconds: 1 }); }
  async cancelOperation() { this.controller.abort(); await this.pending; }
  async disconnect() { await this.client.close(); await this.pending; }
  async thenDisconnectedWorkIsCancelled() {
    const { Pipeline } = await (await import('tsx/esm/api')).tsImport(pathToFileURL(path.resolve(__dirname, '../../core/pipeline.ts')).href, __filename);
    const pipeline = new Pipeline(this.f.root, this.f.cache);
    await waitFor(async () => (await pipeline.status()).suites.unit?.outcome === 'cancelled');
  }
  async thenStatusIsReadOnly() { assert.equal(this.result.isError, undefined); assert.equal(JSON.parse(this.result.content[0].text).configured, false); assert.equal(this.reviews.length, 0); await this.thenNoCommandsWereExecuted(); }
  async thenConfigurationIsSavedAfterReview() { assert.equal(JSON.parse(this.result.content[0].text).saved, true); assert.match(this.reviews[0], /unit/); assert.ok(await fs.readFile(this.f.configPath)); }
  async thenConfigurationAndApprovalAreUnchanged() { assert.equal(await fs.stat(this.f.configPath).then(() => true, () => false), false); assert.equal(await fs.stat(path.join(this.f.cache, 'approvals')).then(() => true, () => false), false); }
  async thenSuiteResultsAreReported() { assert.equal(this.result.isError, undefined); assert.equal(JSON.parse(this.result.content[0].text)[0].outcome, 'passed'); assert.equal(await fs.readFile(this.marker, 'utf8'), 'ran'); }
  async thenNoApprovalWasRequested() { assert.equal(this.reviews.length, 0); }
  async thenToolFailed() { assert.equal(this.result.isError, true); }
  async thenNoCommandsWereExecuted() { assert.equal(await fs.stat(this.marker).then(() => true, () => false), false); }
  async thenWaitReportsCommitOutcome() { const result = JSON.parse(this.result.content[0].text); assert.equal(result.outcome, 'failed'); assert.equal(result.commit, 'a'.repeat(40)); assert.equal(this.waitOptions.timeoutSeconds, 1); assert.equal(this.result.isError, true); }
  async thenOperationIsCancelled() {
    await waitFor(async () => { const r = await this.call('pipeline_status'); return JSON.parse(r.content[0].text).suites.unit?.outcome === 'cancelled'; });
  }
}
module.exports = { ClaudePipelineDriver };
