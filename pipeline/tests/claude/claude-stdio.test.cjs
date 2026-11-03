const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readFile, mkdir, symlink } = require('node:fs/promises');
const { fixture } = require('../pipeline-helpers.cjs');

test('Claude plugin starts its configured stdio server in the project directory', async t => {
  const f = await fixture(t);
  const root = path.resolve(__dirname, '../..');
  const home = path.dirname(f.root);
  await mkdir(path.join(home, '.pi', 'agent'), { recursive: true });
  await symlink(path.dirname(root), path.join(home, '.pi', 'agent', 'extensions'), 'dir');
  const manifest = JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8'));
  const spec = manifest.mcpServers.pipeline;
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'pipeline-stdio-test', version: '1' });
  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args.map(arg => arg.replaceAll('${HOME}', home).replaceAll('${CLAUDE_PLUGIN_ROOT}', root)),
    cwd: home,
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: f.root, PI_CODING_AGENT_DIR: f.cache },
  });
  t.after(() => client.close());

  await client.connect(transport);
  const tools = await client.listTools();
  const status = await client.callTool({ name: 'pipeline_status', arguments: {} });

  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['pipeline_configure', 'pipeline_run', 'pipeline_status', 'pipeline_wait']);
  assert.equal(JSON.parse(status.content[0].text).configured, false);
  const configure = await client.callTool({ name: 'pipeline_configure', arguments: { config: { suites: { unit: { command: ['node', '-v'] } } } } });
  assert.equal(JSON.parse(configure.content[0].text).configPath, f.configPath);
  assert.equal(JSON.parse(configure.content[0].text).saved, false);
});
