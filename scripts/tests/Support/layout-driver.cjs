const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const root = path.resolve(__dirname, '../../..');
const modules = ['agent-defaults', 'ask-user', 'calendar', 'context-badge', 'extension-manager',
  'git-status', 'manual-updates', 'minimal-tui', 'model-filter', 'pi-open', 'pipeline',
  'preview', 'readonly-mode', 'todo'];
const disabled = ['agentic-flow', 'claude-auth', 'dot-clean', 'pdf', 'session-cleanup', 'thinking-toggle'];
const commands = ['defaults', 'extensions', 'models-add', 'models-filter', 'models-remove',
  'open', 'pipeline', 'preview', 'projects', 'readonly', 'todos', 'update'];
const tools = ['ask_user', 'calendar_list', 'calendar_read', 'pipeline_configure',
  'pipeline_run', 'pipeline_status', 'preview_manage', 'preview_start', 'todo'];

function createLayoutDriver(t) {
  let registrations;
  return {
    thenOwnedLayout() {
      assert.deepEqual(fs.readdirSync(root).filter(name => /\.[tj]s$/.test(name)).sort(), ['projects.ts']);
      assert.equal(fs.existsSync(path.join(root, 'tests')), false);
      assert.deepEqual(fs.readdirSync(root).filter(name => name.endsWith('.ts.disabled')).sort(),
        disabled.map(name => name + '.ts.disabled').sort());
      for (const name of modules) {
        assert.ok(fs.statSync(path.join(root, name, 'index.ts')).isFile(), name);
        assert.equal(fs.existsSync(path.join(root, name + '.ts')), false);
      }
      const discovered = fs.readdirSync(root).filter(name => fs.existsSync(path.join(root, name, 'index.ts'))).sort();
      assert.deepEqual(discovered, [...modules].sort());
    },
    async loadWithNativeDiscovery() {
      const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'extensions-layout-')));
      t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
      const agent = path.join(temporary, 'agent');
      const extensions = path.join(agent, 'extensions');
      const cwd = path.join(temporary, 'project');
      fs.mkdirSync(extensions, { recursive: true });
      fs.mkdirSync(cwd);
      for (const name of [...modules, 'projects', 'projects.ts', 'scripts', 'package.json', '.gitignore',
        ...disabled.map(name => name + '.ts.disabled')]) {
        fs.cpSync(path.join(root, name), path.join(extensions, name), { recursive: true });
      }
      fs.symlinkSync(path.join(root, 'node_modules'), path.join(extensions, 'node_modules'), 'dir');
      const sdk = process.env.PI_MIGRATION_SDK_ENTRY
        ? path.resolve(process.env.PI_MIGRATION_SDK_ENTRY)
        : path.join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/index.js');
      const { stdout } = await execFile(process.execPath,
        [path.join(__dirname, 'native-loader.mjs'), sdk, agent, cwd], {
          cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agent }, timeout: 60000,
        });
      registrations = JSON.parse(stdout);
      const expectedEntries = [...modules.map(name => name + '/index.ts'), 'projects.ts'].sort();
      assert.deepEqual(registrations.entries, expectedEntries);
      assert.equal(registrations.loaded, expectedEntries.length);
    },
    thenExpectedRegistrations() {
      assert.deepEqual(registrations.commands.sort(), commands.sort());
      assert.deepEqual(registrations.tools.sort(), tools.sort());
      for (const name of ['context-badge/index.ts', 'git-status/index.ts', 'preview/index.ts', 'pipeline/index.ts']) {
        assert.ok(registrations.handlers[name].includes('session_start'), name);
      }
    },
  };
}
module.exports = { createLayoutDriver };
