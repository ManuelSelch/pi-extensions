const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = readFileSync(require('node:path').join(__dirname, '..', 'index.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(overrides = {}) {
  const moduleStub = { exports: {} };
  vm.runInNewContext(code, {
    module: moduleStub,
    exports: moduleStub.exports,
    require(id) {
      if (id === 'typebox') return { Type: new Proxy({}, { get: () => () => ({}) }) };
      if (overrides.modules?.[id]) return overrides.modules[id];
      return require(id);
    },
    process,
    setTimeout,
    clearTimeout,
    AbortSignal,
    URL,
    fetch: async () => ({ ok: true }),
    ...overrides.globals,
  });
  return moduleStub.exports;
}
const { previewWidgetLines } = load();

test('active preview shows only a named Markdown link', () => {
  for (const status of ['starting', 'running']) {
    assert.deepEqual(Array.from(previewWidgetLines({ name: 'Frontend', url: 'http://localhost:5174', status })),
      ['[Frontend](http://localhost:5174)']);
  }
});

test('inactive preview clears the widget', () => {
  assert.equal(previewWidgetLines(undefined), undefined);
  for (const status of ['stopped', 'failed']) {
    assert.equal(previewWidgetLines({ name: 'Frontend', url: 'http://localhost:5174', status }), undefined);
  }
});

test('escapes brackets in preview names', () => {
  assert.equal(previewWidgetLines({ name: 'Frontend [dev]', url: 'http://localhost:5174', status: 'running' })[0],
    '[Frontend \\[dev\\]](http://localhost:5174)');
});

function runtime(branches = new Map(), globals = {}) {
  const { EventEmitter } = require('node:events');
  const tools = new Map();
  const commands = new Map();
  const handlers = new Map();
  const children = [];
  const signals = [];
  let active;
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
    on(name, handler) { handlers.set(name, handler); },
    appendEntry(customType, data) {
      branches.get(active.id).push({ type: 'custom', customType, data: JSON.parse(JSON.stringify(data)) });
    },
  };
  load({
    modules: {
      'node:child_process': {
        spawn(command, options) {
          const child = new EventEmitter();
          Object.assign(child, { pid: 1000 + children.length, command, options });
          children.push(child);
          return child;
        },
      },
    },
    globals: {
      process: {
        platform: 'darwin',
        kill(pid, signal) {
          signals.push({ pid, signal });
          const child = children.find((item) => item.pid === -pid);
          queueMicrotask(() => child.emit('exit', 0));
        },
      },
      ...globals,
    },
  }).default(pi);
  function context(id = 'a') {
    if (!branches.has(id)) branches.set(id, []);
    const widgets = [];
    return {
      id, cwd: process.cwd(), hasUI: true, widgets,
      sessionManager: { getSessionId: () => id, getBranch: () => branches.get(id) },
      ui: { setWidget: (key, lines) => widgets.push({ key, lines }), notify() {} },
    };
  }
  return {
    branches, children, signals, context,
    async event(name, ctx, event = {}) { active = ctx; await handlers.get(name)?.(event, ctx); },
    async tool(name, ctx, args) { active = ctx; return tools.get(name).execute('', args, undefined, undefined, ctx); },
    async command(ctx, args) { active = ctx; await commands.get('preview').handler(args, ctx); },
  };
}
const config = { name: 'Frontend', cwd: '.', command: 'npm run dev', url: 'http://localhost:5174' };

function lastState(runtime, id = 'a') {
  return runtime.branches.get(id).filter((entry) => entry.customType === 'preview-state').at(-1)?.data;
}

test('reload stops the old process and restores active configuration in a fresh runtime', async () => {
  const old = runtime();
  const ctx = old.context();
  await old.event('session_start', ctx);
  await old.tool('preview_start', ctx, config);
  assert.equal(lastState(old)?.active, true);
  assert.equal(lastState(old)?.command, config.command);
  assert.equal(lastState(old)?.cwd, process.cwd());
  assert.equal(lastState(old)?.child, undefined);
  await old.event('session_shutdown', ctx, { reason: 'reload' });
  assert.equal(old.signals[0]?.signal, 'SIGTERM');
  assert.equal(lastState(old).active, true);
  assert.equal(ctx.widgets.at(-1).lines, undefined);

  const fresh = runtime(old.branches);
  const restored = fresh.context();
  await fresh.event('session_start', restored, { reason: 'reload' });
  assert.equal(fresh.children.length, 1);
  assert.equal(fresh.children[0].command, config.command);
  assert.equal(fresh.children[0].options.cwd, process.cwd());
  assert.equal(restored.widgets.at(-1).key, 'Preview');
  assert.equal(restored.widgets.at(-1).lines[0], '[Frontend](http://localhost:5174)');
  await fresh.tool('preview_start', restored, config);
  assert.equal(fresh.children.length, 1, 'does not duplicate an active preview');
  await fresh.event('session_shutdown', restored, { reason: 'quit' });
});

for (const method of ['tool', 'command']) {
  test(`explicit ${method} stop stays stopped after reload but keeps restart configuration`, async () => {
    const old = runtime();
    const ctx = old.context();
    await old.tool('preview_start', ctx, config);
    if (method === 'tool') await old.tool('preview_manage', ctx, { action: 'stop' });
    else await old.command(ctx, 'stop');
    assert.equal(lastState(old)?.active, false);
    await old.event('session_shutdown', ctx, { reason: 'reload' });
    const fresh = runtime(old.branches);
    const restored = fresh.context();
    await fresh.event('session_start', restored, { reason: 'reload' });
    assert.equal(fresh.children.length, 0);
    assert.equal(restored.widgets.at(-1).lines, undefined);
    await fresh.command(restored, 'start');
    assert.equal(fresh.children.length, 1);
    assert.equal(lastState(fresh).active, true);
    await fresh.event('session_shutdown', restored, { reason: 'quit' });
  });
}

test('session state is isolated and new sessions never inherit another preview', async () => {
  const app = runtime();
  const a = app.context('a');
  const b = app.context('b');
  await app.tool('preview_start', a, config);
  await app.event('session_start', b);
  assert.equal(b.widgets.at(-1)?.lines, undefined);
  await app.tool('preview_start', b, { ...config, name: 'Other', url: 'http://localhost:5175' });
  assert.equal(app.children.length, 2);
  await app.event('session_shutdown', a, { reason: 'reload' });
  assert.equal(app.signals[0].pid, -app.children[0].pid);
  assert.equal(lastState(app, 'b').active, true);
  await app.event('session_shutdown', b, { reason: 'quit' });
});

test('malformed saved entries are ignored rather than executing a command', async () => {
  const branches = new Map([['a', [
    { type: 'custom', customType: 'preview-state', data: { ...config, active: 'true' } },
    { type: 'custom', customType: 'preview-state', data: { ...config, active: true, url: 'not a url' } },
  ]]]);
  const app = runtime(branches);
  await app.event('session_start', app.context());
  assert.equal(app.children.length, 0);
});

test('failed previews stay stopped on resume and shutdown is idempotent', async () => {
  const old = runtime();
  const ctx = old.context();
  await old.tool('preview_start', ctx, config);
  old.children[0].emit('error', new Error('spawn failed'));
  await old.event('session_shutdown', ctx, { reason: 'quit' });
  await old.event('session_shutdown', ctx, { reason: 'quit' });
  assert.equal(lastState(old).active, false);
  assert.equal(old.signals.length, 0);
  const fresh = runtime(old.branches);
  await fresh.event('session_start', fresh.context(), { reason: 'resume' });
  assert.equal(fresh.children.length, 0);
});

test('restores only the latest state on the active branch without requiring a UI', async () => {
  const branches = new Map([['a', [
    { type: 'custom', customType: 'preview-state', data: { ...config, active: false } },
    { type: 'custom', customType: 'preview-state', data: { ...config, name: 'Latest', active: true } },
  ]]]);
  const app = runtime(branches);
  const ctx = app.context();
  ctx.hasUI = false;
  await app.event('session_start', ctx, { reason: 'resume' });
  assert.equal(app.children.length, 1);
  assert.equal(ctx.widgets.length, 0);
  await app.event('session_shutdown', ctx, { reason: 'quit' });
});

test('tree navigation restores the target branch and stops its previous process', async () => {
  const app = runtime();
  const ctx = app.context();
  await app.tool('preview_start', ctx, config);
  app.branches.set('a', [{ type: 'custom', customType: 'preview-state', data: { ...config, active: false } }]);
  await app.event('session_tree', ctx);
  assert.equal(app.signals.length, 1);
  assert.equal(ctx.widgets.at(-1).lines, undefined);
  assert.equal(app.children.length, 1);
});

test('readiness response arriving after shutdown cannot resurrect the widget', async () => {
  let ready;
  const app = runtime(new Map(), { fetch: () => new Promise((resolve) => { ready = resolve; }) });
  const ctx = app.context();
  await app.tool('preview_start', ctx, config);
  await app.event('session_shutdown', ctx, { reason: 'reload' });
  const paints = ctx.widgets.length;
  ready({ ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ctx.widgets.length, paints);
});

test('real HTTP preview stops, reloads, and restarts with the same named widget', { timeout: 15000 }, async () => {
  const net = require('node:net');
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  const script = `require('node:http').createServer((req,res)=>res.end('preview-ok')).listen(${port},'127.0.0.1')`;
  const quote = (text) => `'${text.replace(/'/g, `'"'"'`)}'`;
  const args = { ...config, url, command: `${quote(process.execPath)} -e ${quote(script)}` };
  const branch = [];
  const widgets = [];
  const ctx = {
    cwd: process.cwd(), hasUI: true,
    sessionManager: { getSessionId: () => 'real', getBranch: () => branch },
    ui: { setWidget: (key, lines) => widgets.push({ key, lines }), notify() {} },
  };
  function realRuntime() {
    const handlers = new Map();
    const tools = new Map();
    load({ globals: { fetch } }).default({
      on: (name, handler) => handlers.set(name, handler),
      registerTool: (tool) => tools.set(tool.name, tool),
      registerCommand() {},
      appendEntry: (customType, data) => branch.push({ type: 'custom', customType, data }),
    });
    return { handlers, tools };
  }
  async function responds() {
    try { return (await fetch(url, { signal: AbortSignal.timeout(250) })).ok; }
    catch { return false; }
  }
  async function waitFor(expected) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      if (await responds() === expected) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`preview did not become ${expected ? 'available' : 'stopped'}`);
  }
  const old = realRuntime();
  let fresh;
  try {
    await old.tools.get('preview_start').execute('', args, undefined, undefined, ctx);
    await waitFor(true);
    await old.handlers.get('session_shutdown')({ reason: 'reload' }, ctx);
    await waitFor(false);
    fresh = realRuntime();
    await fresh.handlers.get('session_start')({ reason: 'reload' }, ctx);
    await waitFor(true);
    assert.equal(widgets.at(-1).key, 'Preview');
    assert.equal(widgets.at(-1).lines[0], `[Frontend](${url})`);
    await fresh.tools.get('preview_manage').execute('', { action: 'stop' }, undefined, undefined, ctx);
    await waitFor(false);
  } finally {
    await old.handlers.get('session_shutdown')({ reason: 'quit' }, ctx);
    await fresh?.handlers.get('session_shutdown')({ reason: 'quit' }, ctx);
  }
});
