const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { load, fixture, config, approve, waitFor } = require('./pipeline-helpers.cjs');

test('uses versionless YAML, refuses duplicate keys and does not load legacy JSON files', async t => {
  const f = await fixture(t);
  const { Pipeline } = load();
  const p = new Pipeline(f.root, f.cache);
  await fs.mkdir(path.join(f.root, '.pi'));
  await fs.writeFile(path.join(f.root, '.pi', 'pipeline.json'), JSON.stringify({ version: 1, ...config() }));
  assert.equal(await p.config(), undefined);

  assert.equal(p.configPath, path.join(f.root, '.pi', 'pipeline.yaml'));
  await fs.writeFile(p.configPath, 'suites:\n  unit:\n    command: [npm, test]\n');
  assert.deepEqual(Array.from((await p.config()).suites.unit.command), ['npm', 'test']);
  await fs.writeFile(p.configPath, 'suites: {}\nsuites: {}\n');
  await assert.rejects(p.config(), /unique|duplicate/i);
  await fs.writeFile(p.configPath, 'version: 1\nsuites: {}\n');
  await assert.rejects(p.config(), /Unknown field: version/);
});

test('approval shows stacked creation then focused field changes with named suites', async t => {
  const f = await fixture(t);
  const { Pipeline } = load();
  const p = new Pipeline(f.root, f.cache);
  const initial = { suites: { tests: { command: ['npm', 'test'], timeoutSeconds: 120 }, unchanged: { command: ['do-not-show'] } } };
  await p.configure(initial, async text => {
    assert.match(text, /tests · timeout 120s\nnpm test\n\nunchanged · timeout 300s\ndo-not-show$/);
    assert.doesNotMatch(text, /suites:|timeoutSeconds:|auto:|Suites with/);
    assert.doesNotMatch(text, /version:|Before:|After:/);
    return true;
  });
  const yaml = await fs.readFile(p.configPath, 'utf8');
  assert.match(yaml, /^suites:/);
  assert.doesNotMatch(yaml, /version/);

  const changed = structuredClone(initial);
  changed.suites.tests.timeoutSeconds = 180;
  await p.configure(changed, async text => {
    assert.match(text, /\n\ntests\n/);
    assert.match(text, /- timeout: 120s/);
    assert.match(text, /\+ timeout: 180s/);
    assert.doesNotMatch(text, /unchanged|do-not-show|Before:|After:/);
    return false;
  });
  assert.equal(await fs.readFile(p.configPath, 'utf8'), yaml);

  await fs.writeFile(p.configPath, '# formatting only\n' + yaml);
  await p.configure(initial, async text => { assert.match(text, /No configuration changes/); return true; });
});

test('validates command arrays, names, relative cwd and unknown configuration fields', () => {
  const { validateConfig } = load();
  assert.equal(validateConfig(config()).suites.unit.auto, 'manual');
  assert.equal(Object.hasOwn(validateConfig(config()).suites.unit, 'staleAfterMinutes'), false);
  for (const value of [
    { version: 1, suites: {} }, { suites: { '../evil': { command: ['x'] } } },
    { suites: { unit: { command: 'npm test' } } },
    { suites: { unit: { command: ['x'], cwd: '../outside' } } },
    { suites: { unit: { command: ['x'], timeoutSeconds: 0 } } },
    { suites: { unit: { command: ['x'], typo: true } } },
  ]) assert.throws(() => validateConfig(value));
});

test('ignores legacy suite staleAfterMinutes without retaining it or changing fingerprints', () => {
  const { validateConfig, digest } = load();
  const expected = validateConfig(config());
  for (const value of [30, 0, null, 'obsolete', { ignored: true }]) {
    const legacy = config();
    legacy.suites.unit.staleAfterMinutes = value;

    const normalized = validateConfig(legacy);

    assert.deepEqual(normalized, expected);
    assert.equal(digest(JSON.stringify(normalized)), digest(JSON.stringify(expected)));
    assert.equal(legacy.suites.unit.staleAfterMinutes, value);
  }
});

test('configured suite order is preserved for manual runs, automatic runs and status', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const c = { suites: {
    typecheck: { command: [process.execPath, '-e', ''], auto: 'after-agent' },
    tests: { command: [process.execPath, '-e', ''], auto: 'after-agent' },
  } };
  await p.configure(c, approve);
  assert.deepEqual(Object.keys((await p.config()).suites), ['typecheck', 'tests']);
  assert.deepEqual(Object.keys((await p.status()).suites), ['typecheck', 'tests']);
  assert.deepEqual(Array.from(await p.run('all'), r => r.suite), ['typecheck', 'tests']);
  await fs.writeFile(path.join(f.root, 'source.txt'), 'changed');
  assert.deepEqual(Array.from(await p.run('all', { automatic: true, cooldownMs: 0 }), r => r.suite), ['typecheck', 'tests']);
});

test('confirmation rejection leaves absent/existing config unchanged; acceptance persists local approval', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  assert.equal(await p.configure(config(), async text => { assert.match(text, /unit · timeout 300s\n/); return false; }), false);
  await assert.rejects(fs.readFile(f.configPath), { code: 'ENOENT' });
  await p.configure(config(), approve);
  const before = await fs.readFile(f.configPath, 'utf8');
  assert.equal(await p.configure(config('process.exit(1)'), async () => false), false);
  assert.equal(await fs.readFile(f.configPath, 'utf8'), before);
  assert.equal(await new Pipeline(f.root, f.cache).isApproved(), true);
  await fs.writeFile(f.configPath, require('yaml').stringify(config('process.exit(2)')));
  assert.equal(await p.isApproved(), false);
});

test('requires UI and never approves a file modified during confirmation', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await assert.rejects(p.configure(config()), /approval.*required/i);
  await p.configure(config(), approve);
  await assert.rejects(p.configure(config('process.exit(1)'), async () => {
    await fs.writeFile(f.configPath, require('yaml').stringify(config('process.exit(2)'))); return true;
  }), /changed.*review/i);
  assert.equal(await p.isApproved(), false);
});

test('formatting-only YAML changes preserve approval and freshness; semantic changes do not', async t => {
  const f = await fixture(t);
  const { Pipeline } = load();
  const p = new Pipeline(f.root, f.cache);
  await p.configure(config(''), approve);
  await p.run();
  const yaml = await fs.readFile(p.configPath, 'utf8');
  const original = await p.status();

  await fs.writeFile(p.configPath, '# comment\n' + yaml.replace('    cwd: .\n', ''));
  const formatted = await p.status();
  assert.equal(await p.isApproved(), true);
  assert.equal(formatted.configFingerprint, original.configFingerprint);
  assert.equal(formatted.sourceFingerprint, original.sourceFingerprint);
  assert.equal(formatted.suites.unit.stale, false);

  await fs.writeFile(p.configPath, yaml.replace('timeoutSeconds: 300', 'timeoutSeconds: 120'));
  assert.equal(await p.isApproved(), false);
  assert.equal((await p.status()).suites.unit.stale, true);
});

test('even formatting edits during review are refused and malformed YAML cannot be silently replaced', async t => {
  const f = await fixture(t);
  const { Pipeline } = load();
  const p = new Pipeline(f.root, f.cache);
  await p.configure(config(''), approve);
  const yaml = await fs.readFile(p.configPath, 'utf8');

  await assert.rejects(p.configure(config('changed'), async () => {
    await fs.writeFile(p.configPath, '# concurrent edit\n' + yaml);
    return true;
  }), /changed.*review/i);
  assert.equal(await p.isApproved(), true);
  await fs.writeFile(p.configPath, 'suites: [');
  let prompted = false;
  await assert.rejects(p.configure(config(), async () => { prompted = true; return true; }), /Invalid pipeline YAML/);
  assert.equal(prompted, false);
  assert.equal(await fs.readFile(p.configPath, 'utf8'), 'suites: [');
});

test('working-directory symlinks cannot escape the project', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await fs.symlink(f.cache.replace(/cache$/, ''), path.join(f.root, 'outside'));
  const c = config(); c.suites.unit.cwd = 'outside';
  await assert.rejects(p.configure(c, approve), /outside.*project/i);
});

test('runs suites serially, preserves full logs and bounded output, and persists results', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const c = config('console.log("x".repeat(40000)); console.log(process.cwd())');
  c.suites.integration = { command: [process.execPath, '-e', 'process.exit(3)'] };
  await p.configure(c, approve);
  const results = await p.run('all');
  assert.equal(results.length, 2);
  assert.equal(results.find(r => r.suite === 'integration').outcome, 'failed');
  const result = results.find(r => r.suite === 'unit');
  assert.equal(result.outcome, 'passed'); assert.equal(result.exitCode, 0);
  assert.ok(result.output.length <= 16384);
  assert.match(await fs.readFile(result.logPath, 'utf8'), /x{40000}/);
  assert.match(result.output, /project with spaces/);
  const status = await new Pipeline(f.root, f.cache).status();
  assert.equal(status.suites.unit.outcome, 'passed');
  assert.equal(status.suites.unit.stale, false);
  assert.ok(status.suites.unit.durationMs >= 0);
});

test('execution approval uses stacked entries and a short scope without duplicated headings or footer', async t => {
  const f = await fixture(t);
  const { Pipeline } = load();
  const p = new Pipeline(f.root, f.cache);
  await fs.mkdir(path.dirname(f.configPath));
  await fs.writeFile(f.configPath, require('yaml').stringify({ suites: { tests: {
    command: ['npm', 'test'], timeoutSeconds: 120, auto: 'after-agent',
  } } }));

  await assert.rejects(p.run('tests', { confirm: async text => {
    assert.equal(text, `Project: ${f.root}\nScope: this project directory only\n\ntests · timeout 120s\nnpm test`);
    return false;
  } }), /rejected/i);
  assert.equal(await p.isApproved(), false);
});

test('requires execution approval for external commands and refuses rejected changes', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await p.configure(config(), approve);
  const next = config('console.log("new")'); await fs.writeFile(f.configPath, require('yaml').stringify(next));
  await assert.rejects(p.run('unit'), /approval.*required/i);
  await assert.rejects(p.run('unit', { confirm: async () => false }), /rejected/i);
  assert.equal((await p.run('unit', { confirm: approve }))[0].outcome, 'passed');
});

test('tracks never-run, source changes, generated artifacts, and changes during execution', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await fs.writeFile(path.join(f.root, 'source.txt'), 'before');
  await p.configure(config('setTimeout(() => {}, 150)'), approve);
  assert.equal((await p.status()).suites.unit.outcome, 'never');
  const run = p.run('unit');
  await waitFor(async () => (await p.status()).suites.unit.outcome === 'running');
  await fs.writeFile(path.join(f.root, 'source.txt'), 'after');
  await run;
  assert.equal((await p.status()).suites.unit.stale, true);
  await p.run('unit');
  await fs.mkdir(path.join(f.root, 'coverage'));
  await fs.writeFile(path.join(f.root, 'coverage', 'generated.txt'), 'output');
  assert.equal((await p.status()).suites.unit.stale, false);
  await fs.writeFile(path.join(f.root, 'source.txt'), 'later');
  assert.equal((await p.status()).suites.unit.stale, true);
});

test('enforces timeout, cancellation and exclusive worktree locks', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const c = config('setTimeout(() => {}, 10000)'); c.suites.unit.timeoutSeconds = 0.1;
  await p.configure(c, approve);
  assert.equal((await p.run('unit'))[0].outcome, 'timed-out');
  c.suites.unit.timeoutSeconds = 10; await p.configure(c, approve);
  const controller = new AbortController();
  const run = p.run('unit', { signal: controller.signal });
  await waitFor(async () => (await p.status()).suites.unit.outcome === 'running');
  await assert.rejects(new Pipeline(f.root, f.cache).run('unit'), /busy/i);
  await assert.rejects(p.configure(config(), approve), /busy/i);
  controller.abort(); assert.equal((await run)[0].outcome, 'cancelled');
  await p.configure(config(), approve); // lock released
  assert.equal((await p.run('unit'))[0].outcome, 'passed');
});

test('reports spawn errors as failed runs and isolates worktrees', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const c = config(); c.suites.unit.command = ['definitely-not-a-real-pi-test-executable'];
  await p.configure(c, approve);
  assert.equal((await p.run('unit'))[0].outcome, 'failed');
  const other = path.join(f.root, 'other'); await fs.mkdir(other);
  assert.notEqual(new Pipeline(other, f.cache).storage, p.storage);
  assert.equal((await new Pipeline(other, f.cache).status()).configured, false);
});

test('freshness includes git uncommitted/untracked files, but ignores generated files and respects gitignore', async t => {
  const f = await fixture(t); const { Pipeline, projectRoot } = load(); const p = new Pipeline(f.root, f.cache);
  const { execFileSync } = require('node:child_process');
  execFileSync('git', ['init', '-q', f.root]);
  await fs.writeFile(path.join(f.root, '.gitignore'), 'ignored.txt\ncoverage/\n');
  await fs.writeFile(path.join(f.root, 'tracked.txt'), 'original');
  execFileSync('git', ['add', '.'], { cwd: f.root });
  await p.configure(config(), approve); await p.run('unit');
  await fs.writeFile(path.join(f.root, 'ignored.txt'), 'ignored');
  assert.equal((await p.status()).suites.unit.stale, false);
  await fs.writeFile(path.join(f.root, 'tracked.txt'), 'modified');
  assert.equal((await p.status()).suites.unit.stale, true);
  await p.run('unit'); await fs.writeFile(path.join(f.root, 'untracked.txt'), 'new');
  assert.equal((await p.status()).suites.unit.stale, true);
  await fs.mkdir(path.join(f.root, 'nested'));
  assert.equal(await projectRoot(path.join(f.root, 'nested')), f.root);
});

test('already-aborted runs do not ask for approval or execute commands', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await p.configure(config(), approve);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(p.run('unit', { signal: controller.signal }), /cancelled/i);
  assert.equal((await p.status()).suites.unit.outcome, 'never');
});

test('refuses config changed during execution approval and invalid selections', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await p.configure(config(), approve);
  await fs.writeFile(f.configPath, require('yaml').stringify(config('process.exit(1)')));
  await assert.rejects(p.run('unit', { confirm: async () => {
    await fs.writeFile(f.configPath, require('yaml').stringify(config('process.exit(2)'))); return true;
  } }), /changed.*review/);
  await assert.rejects(p.run('missing'), /Unknown/);
  assert.equal(await p.isApproved(), false);
});

test('honours suite cwd and log retrieval without expiring unchanged results', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await fs.mkdir(path.join(f.root, 'sub'));
  const c = config('console.log(process.cwd())'); c.suites.unit.cwd = 'sub';
  await p.configure(c, approve); await p.run('unit');
  const logs = await p.logs('unit'); assert.match(logs.output, /\/sub/);
  const resultsPath = path.join(p.storage, 'results.json');
  const results = JSON.parse(await fs.readFile(resultsPath, 'utf8'));
  results.unit.startedAt = results.unit.finishedAt = '2000-01-01T00:00:00.000Z';
  await fs.writeFile(resultsPath, JSON.stringify(results));

  c.suites.unit.staleAfterMinutes = 1;
  await fs.writeFile(f.configPath, require('yaml').stringify(c));
  const status = await new Pipeline(f.root, f.cache).status();

  assert.equal(status.suites.unit.stale, false);
  assert.equal(Object.hasOwn(status.config.suites.unit, 'staleAfterMinutes'), false);
  assert.equal(await p.isApproved(), true);
  await assert.rejects(p.logs('missing'), /No run/);
});

test('new suites named constructor are never-run rather than inherited result properties', async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  await p.configure(config(), approve); await p.run('unit');
  const c = config(); c.suites.constructor = { command: [process.execPath, '-e', ''] };
  await p.configure(c, approve);
  assert.equal((await p.status()).suites.constructor.outcome, 'never');
});

test('timeout kills the process group including a child that ignores SIGTERM', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t); const { Pipeline } = load(); const p = new Pipeline(f.root, f.cache);
  const pidFile = path.join(f.root, 'child.pid');
  const childScript = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
  const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], {stdio:'ignore'}); setInterval(() => {}, 1000);`;
  const c = config(parent); c.suites.unit.timeoutSeconds = 0.3;
  await p.configure(c, approve);
  assert.equal((await p.run('unit'))[0].outcome, 'timed-out');
  const pid = Number(await fs.readFile(pidFile, 'utf8'));
  await waitFor(() => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
});

test('extension registers tools and command, uses native approval, and shuts down background runs', async t => {
  const f = await fixture(t);
  const Type = (await import('typebox')).Type;
  const { default: extension } = load('pipeline/index.ts', {
    typebox: { Type }, '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_path, fn) => fn() },
  });
  const tools = {}, events = {}, commands = {}, notices = [], confirmations = [];
  extension({ registerTool(spec) { tools[spec.name] = spec; }, registerCommand(name, spec) { commands[name] = spec; }, on(name, fn) { events[name] = fn; } });
  assert.deepEqual(Object.keys(tools).sort(), ['pipeline_configure', 'pipeline_run', 'pipeline_status']);
  const ctx = { cwd: f.root, hasUI: true, ui: { confirm: async (...args) => { confirmations.push(args); return true; }, notify: (...args) => notices.push(args) } };
  // Isolate extension state under the fixture cache by redirecting the host agent directory.
  const before = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = f.cache;
  t.after(() => { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; });
  const c = config('setTimeout(() => {}, 10000)');
  const saved = await tools.pipeline_configure.execute('id', { config: c }, undefined, undefined, ctx);
  assert.equal(saved.details.saved, true); assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0][0], 'Approve pipeline changes?');
  assert.match(confirmations[0][1], /Project: .*\nScope: this project directory only\n\nunit · timeout 300s\n/);
  assert.doesNotMatch(confirmations[0][1], /suites:|Suites with|Git common directory|Both run|Both may/);
  await commands.pipeline.handler('run unit', ctx);
  await waitFor(async () => (await tools.pipeline_status.execute('id', {}, undefined, undefined, ctx)).details.suites.unit.outcome === 'running');
  await events.session_shutdown({}, ctx);
  const status = await tools.pipeline_status.execute('id', {}, undefined, undefined, ctx);
  assert.equal(status.details.suites.unit.outcome, 'cancelled');
  assert.equal(confirmations.length, 1);
  assert.equal(commands.pipeline.description.includes('pipeline'), true);
  const completion = notices.find(([text]) => text.includes('unit: cancelled'));
  assert.ok(completion);
  assert.match(completion[0], /^unit: cancelled \(\d+ms\)$/);
  assert.doesNotMatch(completion[0], /Log:|\.log/);
  await commands.pipeline.handler('status', ctx);
  const statusNotice = notices.at(-1)[0];
  assert.match(statusNotice, /■ unit cancelled just now/);
  assert.doesNotMatch(statusNotice, /logPath|Fingerprint|command|startedAt|\.log|\{/);
  assert.equal(commands.pipeline.getArgumentCompletions('').some(item => item.value === 'logs'), false);
  assert.doesNotMatch(commands.pipeline.description, /logs/);
  await commands.pipeline.handler('logs unit', ctx);
  assert.match(notices.at(-1)[0], /Usage:/);
  assert.doesNotMatch(notices.at(-1)[0], /logs|logPath/);
});

test('shutdown dismisses a pending execution approval popup', async t => {
  const f = await fixture(t); const Type = (await import('typebox')).Type;
  const { default: extension } = load('pipeline/index.ts', {
    typebox: { Type }, '@earendil-works/pi-coding-agent': { withFileMutationQueue: (_path, fn) => fn() },
  });
  const events = {}, commands = {};
  extension({ registerTool() {}, registerCommand(name, spec) { commands[name] = spec; }, on(name, fn) { events[name] = fn; } });
  const before = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = f.cache;
  t.after(() => { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; });
  await fs.mkdir(path.dirname(f.configPath)); await fs.writeFile(f.configPath, require('yaml').stringify(config()));
  let popupSignal;
  const ctx = { cwd: f.root, hasUI: true, ui: { notify() {}, confirm: (_title, _text, opts) => {
    assert.equal(_title, 'Approve pipeline execution?');
    assert.doesNotMatch(_text, /Approve pipeline execution for|Configuration \(|Suites with/);
    popupSignal = opts?.signal;
    assert.ok(popupSignal, 'approval dialog must receive cancellation signal');
    return new Promise(resolve => popupSignal.addEventListener('abort', () => resolve(false), { once: true }));
  } } };
  await commands.pipeline.handler('run unit', ctx);
  await waitFor(() => popupSignal !== undefined);
  await events.session_shutdown({}, ctx);
  assert.equal(popupSignal.aborted, true);
});
