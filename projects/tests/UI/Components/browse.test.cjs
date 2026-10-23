const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { loader } = require('../../load.cjs');
const load = () => loader()(resolve(__dirname, '../../../src/UI/Components/browse.ts'));
const repo = { identity: '/git', name: 'Backend', path: '/checkout' };
const project = { id: 'p', name: 'Project', repositories: ['/git'] };
const view = (extra = {}) => ({ data: { version: 1, projects: [project], repositories: [repo] }, results: new Map(), ...extra });
const status = (suites, extra = {}) => ({ configured: true, suites, ...extra });
const result = (outcome, stale = false) => ({ outcome, stale });

test('populated Projects menu has exactly the title and no subtitle', () => {
  const menu = load().browseMenu(view());
  assert.equal(menu.title, 'Projects');
  assert.deepEqual(menu.options.map(o => o.label), ['1. Project — 1 repositories', '↻ Refresh catalogue', 'Close']);
  assert.equal(menu.options[0].action.projectId, 'p');
});
test('empty catalogue and project have native guidance and usable actions', () => {
  const build = load().browseMenu;
  assert.match(build(view({ data: { version: 1, projects: [], repositories: [] } })).title, /No registered projects/);
  const empty = { ...project, repositories: [] };
  const menu = build(view({ data: { version: 1, projects: [empty], repositories: [] }, projectId: 'p' }));
  assert.match(menu.title, /No repositories/);
  assert.deepEqual(menu.options.map(o => o.label), ['← Back to projects', '↻ Refresh status', 'Close']);
});
test('numbered repository labels disambiguate identical names and show separate summaries', () => {
  const data = { version: 1, projects: [{...project,repositories:['/git','/second']}], repositories: [repo,{...repo,identity:'/second'}] };
  const results = new Map([['/git',{status:status({test:result('passed')})}],['/second',{error:'missing'}]]);
  const menu = load().browseMenu(view({data,results,projectId:'p'}));
  assert.match(menu.options[0].label, /^1\. Backend — Local: ✓ passed · GitHub: not available$/);
  assert.match(menu.options[1].label, /^2\. Backend — Local: unavailable · GitHub: unavailable$/);
  assert.notEqual(menu.options[0].action.repositoryId,menu.options[1].action.repositoryId);
});
test('summaries preserve running, failed, stale, never, cancelled and unconfigured results', () => {
  const summary = load().localSummary;
  for (const outcome of ['running','failed','never','cancelled','timed-out']) assert.match(summary(status({test:result(outcome)})), new RegExp(outcome.replace('-',' ')));
  assert.match(summary(status({test:result('passed',true)})), /stale.*passed/);
  assert.match(summary(status({test:result('failed',true)})), /stale.*failed/);
  assert.equal(summary({configured:false,suites:{}}),'not configured');
  assert.equal(summary(status({})),'no suites');
  assert.match(summary(status({test:result('never')},{prepare:result('passed')})), /never/);
  assert.match(summary(status({test:result('passed')},{prepare:result('failed')})), /failed/);
});
test('GitHub summary never hides errors, missing runs, incomplete jobs or unknown outcomes', () => {
  const summary = load().githubSummary;
  const github = workflows => ({repository:'o/r',branch:'main',workflows});
  assert.equal(summary(undefined),'not available');
  assert.equal(summary(github([])),'no runs');
  assert.equal(summary({...github([]),error:'auth'}),'unavailable');
  assert.match(summary(github([{name:'CI',status:'completed',conclusion:'success'}])),/passed/);
  assert.match(summary(github([{name:'CI',status:'in_progress'}])),/running/);
  assert.match(summary(github([{name:'CI',status:'completed',conclusion:'success',jobsError:'oops'}])),/unavailable/);
  assert.match(summary(github([{name:'CI',status:'completed',conclusion:'action_required'}])),/action required/);
});
test('details reuse suite/workflow/job formatting, hide URLs and sanitize supplied text', () => {
  const results = new Map([['/git',{status:status({'test\x1b':result('failed')},{github:{repository:'o/r',branch:'main',workflows:[{name:'CI',status:'completed',conclusion:'failure',url:'https://example/run',jobs:[{name:'unit',status:'queued',url:'https://example/job'}]}]}})}]]);
  const menu = load().browseMenu(view({results,projectId:'p',repositoryId:'/git'}));
  assert.match(menu.title,/^Backend\n/);
  assert.match(menu.title,/✗ test[\s\S]*✗ CI[\s\S]*○ unit queued/);
  assert.match(menu.title,/60 seconds[\s\S]*does not run tests/);
  assert.doesNotMatch(menu.title,/\x1b|https:\/\/|\/checkout/);
  assert.deepEqual(menu.options.map(o => o.label),['← Back to Project','↻ Refresh status','Close']);
});
test('checkout errors do not expose registered paths in browser titles', () => {
  const menu = load().browseMenu(view({projectId:'p',repositoryId:'/git',results:new Map([['/git',{error:"ENOENT: stat '/checkout'"}]])}));
  assert.match(menu.title,/unavailable.*ENOENT/);
  assert.doesNotMatch(menu.title,/\/checkout/);
});
