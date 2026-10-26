const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, overrides = {}) {
  const filename = path.resolve(__dirname, '../../', file);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, process, Buffer, console,
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
