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
test('numbered repository labels disambiguate names while status lives in the title table', () => {
  const data = { version: 1, projects: [{...project,repositories:['/git','/second']}], repositories: [repo,{...repo,identity:'/second'}] };
  const results = new Map([['/git',{status:status({test:result('passed')})}],['/second',{error:'missing'}]]);
  const menu = load().browseMenu(view({data,results,projectId:'p'}));
  assert.equal(menu.options[0].label, '1. Backend');
  assert.equal(menu.options[1].label, '2. Backend');
  assert.match(menu.title, /Repository\s+│ Local\s+│ GitHub/);
  assert.match(menu.title, /1\. Backend\s+│ ✓\s+│ —/);
  assert.match(menu.title, /2\. Backend\s+│ !\s+│ !/);
  assert.doesNotMatch(menu.title, /passed|failed|stale|unavailable/);
  assert.notEqual(menu.options[0].action.repositoryId,menu.options[1].action.repositoryId);
});
test('summaries preserve running, failed, stale, never, cancelled and unconfigured results', () => {
  const summary = load().localSummary;
  for (const [outcome, icon] of [['passed','✓'],['running','›'],['failed','✗'],['never','○'],['cancelled','■'],['timed-out','⌛']]) assert.equal(summary(status({test:result(outcome)})), icon);
  assert.equal(summary(status({test:result('passed',true)})), '⚠');
  assert.equal(summary(status({test:result('failed',true)})), '⚠');
  assert.equal(summary({configured:false,suites:{}}),'—');
  assert.equal(summary(status({})),'—');
  assert.equal(summary(status({test:result('never')},{prepare:result('passed')})), '○');
  assert.equal(summary(status({test:result('passed')},{prepare:result('failed')})), '✗');
});
test('GitHub summary never hides errors, missing runs, incomplete jobs or unknown outcomes', () => {
  const summary = load().githubSummary;
  const github = workflows => ({repository:'o/r',branch:'main',workflows});
  assert.equal(summary(undefined),'—');
  assert.equal(summary(github([])),'—');
  assert.equal(summary({...github([]),error:'auth'}),'!');
  assert.equal(summary(github([{name:'CI',status:'completed',conclusion:'success'}])), '✓');
  assert.equal(summary(github([{name:'CI',status:'in_progress'}])), '›');
  assert.equal(summary(github([{name:'CI',status:'completed',conclusion:'success',jobsError:'oops'}])), '!');
  assert.equal(summary(github([{name:'CI',status:'completed',conclusion:'action_required'}])), '?');
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
test('table padding uses terminal columns for wide and combining names and multi-column icons', () => {
  const {visibleWidth} = require('@earendil-works/pi-tui');
  const names = ['倉庫', 'e\u0301', 'Long repository', '🚀 API'];
  const repositories = names.map((name,index) => ({...repo,name,identity:`/git-${index}`}));
  const data = {version:1,projects:[{...project,repositories:repositories.map(repo => repo.identity)}],repositories};
  const results = new Map(repositories.map(repo => [repo.identity,{status:status({test:result('timed-out')})}]));
  const menu = load().browseMenu(view({data,results,projectId:'p'}));
  const rows = menu.title.split('\n').filter(line => line.includes(' │ '));
  assert.equal(rows.length,5);
  for (let column=0; column<3; column++) {
    const widths = rows.map(line => visibleWidth(line.split(' │ ')[column]));
    assert.equal(new Set(widths).size,1);
  }
  assert.equal(menu.options[0].label,'1. 倉庫');
  assert.ok(!menu.title.includes('\t'), 'use padded title text, not host-dependent tab stops');
});
test('table sanitizes external names without changing their identity mapping', () => {
  const data = {version:1,projects:[project],repositories:[{...repo,name:'Back\x1bend\nName'}]};
  const menu = load().browseMenu(view({data,projectId:'p'}));
  assert.equal(menu.options[0].label,'1. BackendName');
  assert.equal(menu.options[0].action.repositoryId,'/git');
  assert.doesNotMatch(menu.title,/\x1b/);
  assert.equal(menu.title.split('\n').length,3);
});
