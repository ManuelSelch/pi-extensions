const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {load, plain} = require('../support/load.cjs');
const { WorkflowStore } = load('infra/store.ts');
async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workflow-store-')));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const agent=path.join(dir,'agent'),cwd=path.join(dir,'project');
  await fs.mkdir(agent); await fs.mkdir(cwd);
  const store=new WorkflowStore(agent);
  const write=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value));};
  return {agent,cwd,store,write};
}
test('defaults point outside scanned skills and all steps are enabled', async t=>{
 const {store,cwd,agent}=await fixture(t);const s=await store.load(cwd,true);
 assert.equal(s.resolved.mock.prompt,path.join(agent,'workflow/prompts/mock.md'));
 assert.equal(s.resolved.design.skills[0],path.join(agent,'workflow/skills/roles/design-writing/SKILL.md'));
 assert.ok(Object.values(s.resolved).every(v=>v.enabled));
});
test('resolves inherited paths at their declaring file and never reads untrusted project config',async t=>{
 const {store,cwd,agent,write}=await fixture(t);
 await write(path.join(agent,'workflow.json'),{steps:{mock:{prompt:'global.md',enabled:false}}});
 await write(path.join(cwd,'.pi/workflow.json'),{steps:{mock:{skills:['local/SKILL.md']}}});
 const s=await store.load(cwd,true);
 assert.equal(s.resolved.mock.prompt,path.join(agent,'global.md'));
 assert.equal(s.resolved.mock.skills[0],path.join(cwd,'.pi/local/SKILL.md'));
 await fs.writeFile(path.join(cwd,'.pi/workflow.json'),'{broken');
 assert.equal((await store.load(cwd,false)).resolved.mock.enabled,false);
 await assert.rejects(store.load(cwd,true),/workflow.json/);
 await assert.rejects(store.load(cwd,false,'project',true),/trust/);
});
test('skips disabled missing resources and deduplicates canonical prompt and skill paths',async t=>{
 const {store,cwd,write,agent}=await fixture(t);
 const prompt=path.join(agent,'one.md'),skill=path.join(agent,'one/SKILL.md');
 await fs.writeFile(prompt,'same prompt');await fs.mkdir(path.dirname(skill));await fs.writeFile(skill,'---\nname: one\ndescription: test\n---\nbody');
 await fs.symlink(prompt,path.join(agent,'alias.md'));
 await write(path.join(agent,'workflow.json'),{steps:{mock:{prompt:'one.md',skills:['one/SKILL.md']},plan:{prompt:'alias.md',skills:['one/SKILL.md']},design:{enabled:false},commit:{enabled:false}}});
 const resources=await store.resources((await store.load(cwd,true)).resolved);
 assert.deepEqual(plain(resources.skillPaths),[skill]);assert.equal(resources.prompt,'## mock\nsame prompt');
 await fs.rm(skill);await assert.rejects(store.resources((await store.load(cwd,true)).resolved),/SKILL.md/);
});
test('saves minimal patches, preserves unknown and resource fields, and supports inheritance reset',async t=>{
 const {store,cwd,write}=await fixture(t);const file=path.join(cwd,'.pi/workflow.json');
 await write(file,{note:'keep',steps:{mock:{prompt:null,skills:[],extra:4}}});
 const s=await store.load(cwd,true);
 await store.save(s,{mock:false});
 assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{note:'keep',steps:{mock:{prompt:null,skills:[],extra:4,enabled:false}}});
 await store.save(await store.load(cwd,true),{mock:null});
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).steps.mock.enabled,undefined);
});
test('rejects edited-field conflicts but merges unrelated concurrent edits',async t=>{
 const {store,cwd,write}=await fixture(t);const file=path.join(cwd,'.pi/workflow.json');const s=await store.load(cwd,true);
 await write(file,{steps:{mock:{enabled:false}}});
 await assert.rejects(store.save(s,{mock:false}),/changed/);
 await store.save(s,{plan:false});
 assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')).steps,{mock:{enabled:false},plan:{enabled:false}});
});
test('manual edits during the atomic write are detected and owned temporary files/locks are released',async t=>{
 const {cwd,agent,write}=await fixture(t);const file=path.join(cwd,'.pi/workflow.json');
 await write(file,{steps:{}});
 const {WorkflowStore: InterferedStore}=load('infra/store.ts',{'node:fs/promises':{...fs,writeFile:async(target,...args)=>{
  await fs.writeFile(target,...args);
  if(target.startsWith(file+'.')&&target.endsWith('.tmp'))await fs.writeFile(file,JSON.stringify({note:'external edit'}));
 }}});
 const store=new InterferedStore(agent);const snapshot=await store.load(cwd,true);
 await assert.rejects(store.save(snapshot,{mock:false}),/changed during save/);
 assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{note:'external edit'});
 assert.deepEqual(await fs.readdir(path.dirname(file)),['workflow.json']);
});
test('no-op saves create nothing, invalid files stay untouched, locks are never stolen',async t=>{
 const {store,cwd,write}=await fixture(t);const file=path.join(cwd,'.pi/workflow.json');const s=await store.load(cwd,true);
 assert.equal(await store.save(s,{}),false);await assert.rejects(fs.stat(path.dirname(file)),/ENOENT/);
 await write(file,{steps:{}});await fs.mkdir(file+'.lock');
 await assert.rejects(store.save(s,{mock:false}),/busy/);assert.ok(await fs.stat(file+'.lock'));
 await fs.rm(file+'.lock',{recursive:true});await fs.writeFile(file,'{broken');
 await assert.rejects(store.save(s,{mock:false}),/workflow.json/);assert.equal(await fs.readFile(file,'utf8'),'{broken');
 await assert.rejects(fs.stat(file+'.lock'),/ENOENT/);
});
