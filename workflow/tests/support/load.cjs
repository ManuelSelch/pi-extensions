const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
function load(file, overrides = {}) {
  const filename = path.resolve(__dirname, '../../', file);
  const module = { exports: {} };
  const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href));
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, process, Buffer, console, URL,
    require(id) {
      if (id in overrides) return overrides[id];
      if (id.startsWith('.') && id.endsWith('.ts')) return load(path.relative(path.resolve(__dirname, '../..'), path.resolve(path.dirname(filename), id)), overrides);
      return require(id);
    },
  });
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
module.exports = { load, plain };
