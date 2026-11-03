const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

class MarketplaceDriver {
  static async create(t) {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-marketplace-'));
    const d = new MarketplaceDriver();
    d.home = home;
    d.repo = path.resolve(__dirname, '../../..');
    d.env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude') };
    await fs.mkdir(path.join(home, '.pi', 'agent'), { recursive: true });
    await fs.symlink(d.repo, path.join(home, '.pi', 'agent', 'extensions'), 'dir');
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    return d;
  }
  async addMarketplace() {
    this.catalog = JSON.parse(await fs.readFile(path.join(this.repo, '.claude-plugin', 'marketplace.json'), 'utf8'));
  }
  async installPipeline() {
    const entry = this.catalog.plugins.find(item => item.name === 'pipeline');
    assert.ok(entry, 'pipeline is listed in the marketplace');
    this.installPath = path.join(this.home, 'installed-pipeline');
    // Claude copies the selected plugin directory into its cache, not the parent repository.
    await fs.cp(path.resolve(this.repo, entry.source), this.installPath, { recursive: true });
  }
  async thenPipelineIsListed() {
    assert.equal(this.catalog.name, 'pi-extensions');
    assert.ok(this.catalog.plugins.some(item => item.name === 'pipeline' && item.source === './pipeline'));
  }
  async thenInstalledPipelineConnects() {
    const config = JSON.parse(await fs.readFile(path.join(this.installPath, '.mcp.json'), 'utf8'));
    const spec = config.mcpServers.pipeline;
    assert.deepEqual(spec.args, ['--import', '${HOME}/.pi/agent/extensions/node_modules/tsx/dist/loader.mjs', '${HOME}/.pi/agent/extensions/pipeline/claude/main.ts']);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const { ElicitRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
    const client = new Client({ name: 'marketplace-test', version: '1' }, { capabilities: { elicitation: {} } });
    client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept', content: { approved: true } }));
    const transport = new StdioClientTransport({ command: spec.command, args: spec.args.map(a => a.replaceAll('${HOME}', this.home).replaceAll('${CLAUDE_PLUGIN_ROOT}', this.installPath)), cwd: this.home, env: { ...this.env, CLAUDE_PROJECT_DIR: this.home } });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.ok(tools.tools.some(tool => tool.name === 'pipeline_status'));
      const configured = await client.callTool({ name: 'pipeline_configure', arguments: { config: { suites: { unit: { command: [process.execPath, '-e', 'console.log("passed")'] } } } } });
      assert.equal(JSON.parse(configured.content[0].text).saved, true);
      const run = await client.callTool({ name: 'pipeline_run', arguments: {} });
      assert.equal(JSON.parse(run.content[0].text)[0].outcome, 'passed');
    } finally { await client.close(); }
  }
}
module.exports = { MarketplaceDriver };
