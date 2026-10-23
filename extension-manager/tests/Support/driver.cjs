const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

async function createDriver(t, options = {}) {
  const sdk = await import('@earendil-works/pi-coding-agent');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'extension-manager-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agentDir = path.join(root, 'custom agent');
  const cwd = path.join(root, 'project with spaces');
  const bases = { user: agentDir, project: path.join(cwd, '.pi') };
  for (const base of Object.values(bases)) fs.mkdirSync(path.join(base, 'extensions'), { recursive: true });
  const snapshots = new Map();
  const notices = [];
  const menus = [];
  let command;
  const selfPath = path.join(agentDir, 'extensions', options.folderSelf ? 'extension-manager/index.ts' : 'extension-manager.ts');
  const file = path.resolve(__dirname, '../../index.ts');
  const source = fs.readFileSync(file, 'utf8')
    .replaceAll('import.meta.filename', JSON.stringify(selfPath))
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(selfPath).href));
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, console,
    process: { ...process, cwd: () => cwd },
    require(id) {
      if (id === '@earendil-works/pi-coding-agent') return { ...sdk, getAgentDir: () => agentDir };
      if (id === 'node:fs') {
        const sandbox = { ...fs };
        for (const name of ['readFileSync', 'writeFileSync', 'readdirSync', 'existsSync', 'renameSync']) {
          sandbox[name] = (file, ...args) => {
            assert.ok(path.resolve(file).startsWith(`${root}${path.sep}`), `Outside fixture: ${file}`);
            return fs[name](file, ...args);
          };
        }
        return sandbox;
      }
      return require(id);
    },
  });
  function settingsPath(scope) { return path.join(bases[scope], 'settings.json'); }
  function writeSettings(scope, value) { fs.writeFileSync(settingsPath(scope), JSON.stringify(value)); }
  function readSettings(scope) {
    return fs.existsSync(settingsPath(scope)) ? JSON.parse(fs.readFileSync(settingsPath(scope), 'utf8')) : {};
  }
  const configPath = path.join(agentDir, 'extension-manager.json');
  const driver = {
    addExtension(name, scope = 'user', source = 'export default function () {}') {
      const file = path.join(bases[scope], 'extensions', name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, source);
      snapshots.set(file, source);
      return file;
    },
    addBrokenLink() { fs.symlinkSync('missing-target', driver.absolute('broken.ts')); },
    async thenRegistersWithPiLoader() {
      const { spawnSync } = require('node:child_process');
      const loaderUrl = pathToFileURL(path.resolve(__dirname, '../../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js')).href;
      const script = `
        import assert from 'node:assert/strict';
        import { loadExtensions } from ${JSON.stringify(loaderUrl)};
        const result = await loadExtensions([${JSON.stringify(file)}], ${JSON.stringify(cwd)});
        assert.deepEqual(result.errors, []);
        assert.equal(result.extensions.length, 1);
        assert.ok(result.extensions[0].commands.has('extensions'));
      `;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, encoding: 'utf8', timeout: 30000,
      });
      assert.equal(result.status, 0, `${result.error ?? ''}${result.stdout}${result.stderr}`);
    },
    configure: writeSettings,
    configureRaw(scope, value) { fs.writeFileSync(settingsPath(scope), value); },
    setDefaults(config) { fs.writeFileSync(configPath, JSON.stringify(config)); },
    async start() {
      await module.exports.default({ registerCommand(name, spec) { assert.equal(name, 'extensions'); command = spec; } });
    },
    async act(action, ...choices) {
      const queue = [action, ...choices];
      await command.handler('', {
        cwd, hasUI: true,
        ui: {
          async select(title, entries) {
            menus.push(entries);
            const choice = queue.shift();
            if (choice === undefined) return undefined;
            const found = entries.find(entry => entry === choice || entry.endsWith(` ${choice}`));
            assert.ok(found, `Missing choice ${choice} in ${entries.join(', ')}`);
            return found;
          },
          notify(message, level) { notices.push({ message, level }); },
        },
      });
    },
    thenSettings(scope, expected) { assert.deepEqual(readSettings(scope), expected); },
    thenRawSettings(scope, expected) { assert.equal(fs.readFileSync(settingsPath(scope), 'utf8'), expected); },
    thenNotice(pattern) { assert.ok(notices.some(n => pattern.test(n.message)), JSON.stringify(notices)); },
    thenNoNotice(pattern) { assert.ok(!notices.some(n => pattern.test(n.message)), JSON.stringify(notices)); },
    thenMenuIncludes(text) { assert.ok(menus.some(menu => menu.some(entry => entry.includes(text))), JSON.stringify(menus)); },
    thenMenuExcludes(text) { assert.ok(!menus.some(menu => menu.some(entry => entry.includes(text))), JSON.stringify(menus)); },
    thenSourcesUnchanged() {
      for (const [file, source] of snapshots) {
        assert.equal(fs.readFileSync(file, 'utf8'), source);
        assert.equal(fs.existsSync(`${file}.disabled`), false);
      }
    },
    thenDefault(id, enabled) { assert.equal(JSON.parse(fs.readFileSync(configPath)).defaults[id], enabled); },
    thenSeen(id) { assert.ok(JSON.parse(fs.readFileSync(configPath)).seen.includes(id)); },
    async thenNativeEnabled(file, enabled) {
      const settingsManager = sdk.SettingsManager.inMemory(readSettings('user'), { projectTrusted: true });
      settingsManager.setProjectExtensionPaths(readSettings('project').extensions ?? []);
      const result = await new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager }).resolve();
      const entry = result.extensions.find(entry => entry.path === file);
      assert.ok(entry, `Native discovery missed ${file}`);
      assert.equal(entry.enabled, enabled);
    },
    absolute(name, scope = 'user') { return path.join(bases[scope], 'extensions', name); },
    homeRelative(name) { return `~/${path.relative(os.homedir(), driver.absolute(name))}`; },
  };
  driver.addExtension(options.folderSelf ? 'extension-manager/index.ts' : 'extension-manager.ts');
  return driver;
}
module.exports = { createDriver };
