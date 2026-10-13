const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(mocks = {}) {
  const source = readFileSync(join(__dirname, '..', 'calendar.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(id) {
      if (id in mocks) return mocks[id];
      if (id === '@earendil-works/pi-coding-agent') return {};
      if (id === 'typebox') return require('typebox');
      return require(id);
    },
  });
  return module.exports;
}

const { localDate, parseEvents } = load();

test('formats local dates without UTC timezone shifts', () => {
  assert.equal(localDate(0, new Date(2026, 0, 2, 23)), '2026-01-02');
  assert.equal(localDate(7, new Date(2026, 0, 29)), '2026-02-05');
});

test('flattens khal day buckets and keeps only UID-bearing events', () => {
  const events = parseEvents(JSON.stringify([
    [{ uid: 'event-1', summary: 'Meeting' }],
    [{ summary: 'invalid' }, { uid: 'event-2' }],
  ]));
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    { uid: 'event-1', summary: 'Meeting' },
    { uid: 'event-2' },
  ]);
});

test('rejects malformed khal JSON', () => {
  assert.throws(() => parseEvents('not json'));
});

function mockedCalendar(formatted = ['10/13/26', '10/13/26']) {
  const calls = [];
  const api = load({
    'node:fs/promises': { readFile: async () => '#!/example/khal-python\n' },
    'node:util': {
      promisify: fn => (...args) => new Promise((resolve, reject) => {
        fn(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
      }),
    },
    'node:child_process': {
      execFile(command, args, options, callback) {
        calls.push({ command, args: Array.from(args) });
        let stdout = '';
        if (command === 'which') stdout = '/example/khal\n';
        if (command === '/example/khal-python') stdout = JSON.stringify(formatted);
        if (command === 'khal') stdout = '[[{"uid":"event-1"}]]';
        callback(null, stdout, '');
      },
    },
  });
  const tools = {};
  api.default({ registerTool: tool => { tools[tool.name] = tool; } });
  return { api, calls, tools };
}

for (const name of ['calendar_list', 'calendar_read']) {
  test(`${name} translates ISO dates before calling khal`, async () => {
    const { calls, tools } = mockedCalendar();
    const result = await tools[name].execute('test', {
      start: '2026-10-13', end: '2026-10-13', uid: 'event-1',
    });
    assert.notEqual(result.isError, true);
    const conversion = calls.find(call => call.command === '/example/khal-python');
    assert.ok(conversion, 'uses the Python environment installed with khal');
    assert.deepEqual(conversion.args.slice(-2), ['2026-10-13', '2026-10-13']);
    assert.deepEqual(calls.find(call => call.command === 'khal').args,
      ['list', '--json', 'all', '10/13/26', '10/13/26']);
  });
}

test('date conversion uses khal configuration and Python strftime, including locale formats', () => {
  const { KHAL_DATE_SCRIPT } = load();
  assert.equal(typeof KHAL_DATE_SCRIPT, 'string');
  const { execFileSync } = require('node:child_process');
  for (const format of ['%m/%d/%Y', '%d.%m.%Y', '%Y-%m-%d', '%x', '%d %B %Y']) {
    const script = `
import sys, types, json
from datetime import date
settings = types.ModuleType('khal.settings')
settings.get_config = lambda: {'locale': {'longdateformat': ${JSON.stringify(format)}}}
sys.modules['khal.settings'] = settings
sys.argv = ['convert', '2028-02-29', '2028-03-01']
exec(${JSON.stringify(KHAL_DATE_SCRIPT)})
print(json.dumps([date(2028, 2, 29).strftime(${JSON.stringify(format)}), date(2028, 3, 1).strftime(${JSON.stringify(format)})]))
`;
    const lines = execFileSync('python3', ['-c', script], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(JSON.parse(lines[0]), JSON.parse(lines[1]));
  }
});

test('invalid calendar dates fail before subprocesses or synchronization', async () => {
  for (const start of ['2026-02-30', '2026-13-01', 'invalid']) {
    const { tools, calls } = mockedCalendar();
    const result = await tools.calendar_list.execute('test', { start, end: '2026-12-31' });
    assert.equal(result.isError, true);
    assert.equal(calls.length, 0);
  }
});

test('malformed converted dates fail without synchronization or khal list', async () => {
  const { tools, calls } = mockedCalendar(['10/13/26']);
  const result = await tools.calendar_list.execute('test', { start: '2026-10-13', end: '2026-10-13' });
  assert.equal(result.isError, true);
  assert(!calls.some(call => call.command === 'khal' || call.command === 'vdirsyncer'));
});
