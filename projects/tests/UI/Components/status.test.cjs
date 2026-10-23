const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { loader } = require('../../load.cjs');
const render = () => loader()(resolve(__dirname, '../../../src/UI/Components/status.ts')).renderRepositoryStatus;

test('reports unconfigured, empty, unavailable and failed repository states without claiming success', () => {
  const format = render();
  assert.match(format('Repo', { configured: false, suites: {} }), /Local: not configured/);
  assert.match(format('Repo', { configured: true, suites: {} }), /no suites/);
  assert.match(format('Repo', undefined, 'missing checkout'), /unavailable: missing checkout/);
  assert.match(format('Repo', { configured: false, suites: {} }), /Remote: not available/);
});
test('renders status details without checkout paths or workflow/job URLs', () => {
  const text = render()('Repo', {
    root: '/checkouts/repo', configured: true, prepare: { outcome: 'passed', stale: false },
    suites: { test: { outcome: 'failed', stale: true }, lint: { outcome: 'never', stale: false } },
    github: { repository: 'owner/repo', branch: 'main', workflows: [{
      name: 'Tests', status: 'completed', conclusion: 'failure', url: 'https://example/run',
      jobs: [{ name: 'unit', status: 'in_progress', url: 'https://example/job' }],
    }, { name: 'Deploy', status: 'never', jobsError: 'jobs unavailable' }] },
  });
  for (const expected of ['prepare: passed', 'test: failed (stale)', 'lint: never', 'GitHub: owner/repo · main',
    'Tests: failed', 'unit: running', 'Deploy: never', 'jobs unavailable']) assert.ok(text.includes(expected), text);
  assert.ok(!text.includes('/checkouts/repo'), text);
  assert.ok(!text.includes('https://'), text);
});
test('keeps local results on remote errors and strips terminal controls from all supplied text', () => {
  const text = render()('Repo\x1b', { configured: true, suites: { test: { outcome: 'passed', stale: false } },
    github: { repository: 'o/r', branch: 'main', error: 'auth\x1b failed', workflows: [] } });
  assert.match(text, /test: passed/);
  assert.match(text, /GitHub unavailable: auth failed/);
  assert.ok(!text.includes('\x1b'));
  assert.match(render()('Repo', { configured: false, suites: {}, github: { repository: 'o/r', branch: 'main', workflows: [] } }), /no workflows/);
});
