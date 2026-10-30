const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
function load(file = 'pipeline/core.ts', overrides = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path.join(__dirname, '..', '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, process, Buffer, console, setTimeout, clearTimeout, AbortController,
    require(id) { if (id in overrides) return overrides[id]; if (id.startsWith('.') && id.endsWith('.ts')) return load(path.join(path.dirname(file), id), overrides); return require(id); } });
  return module.exports;
}
async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pi-pipeline-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'project with spaces');
  await fs.mkdir(root);
  return { root, cache: path.join(dir, 'cache'), configPath: path.join(root, '.pi', 'pipeline.yaml') };
}
const config = (script = 'console.log("passed")') => ({ suites: { unit: { command: [process.execPath, '-e', script] } } });
const approve = async () => true;
async function waitFor(predicate) {
  for (let i = 0; i < 300; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('Timed out waiting for fixture');
}
module.exports = { load, fixture, config, approve, waitFor };
