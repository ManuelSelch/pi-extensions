const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { load } = require('../../support/load.cjs');
async function createWorkflowDriver(t) {
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workflow-dialog-')));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const agent=path.join(dir,'agent'),cwd=path.join(dir,'project');
 const write=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value));};
 await fs.mkdir(cwd,{recursive:true});
 for (const s of ['mock','plan','design','commit']) await write(path.join(agent,'workflow/prompts',s+'.md'),s+' instructions');
 for (const s of ['mockup-first','roles/analyst','roles/design-writing']) await write(path.join(agent,'workflow/skills',s,'SKILL.md'),'---\nname: '+s.split('/').at(-1)+'\ndescription: Example\n---\nSECRET SKILL BODY');
 const commands=new Map(),events=new Map(),notifications=[],dialogs=[];let choices=[],trusted=true,hasUI=true,lastEvent,discovered;
 const pi={registerCommand:(name,definition)=>commands.set(name,definition),on:(name,fn)=>events.set(name,fn)};
 load('index.ts',{'@earendil-works/pi-coding-agent':{getAgentDir:()=>agent},'node:os':{...os,homedir:()=>dir}}).default(pi);
 const ctx=()=>({cwd,hasUI,isProjectTrusted:()=>trusted,ui:{notify:(text,type)=>notifications.push({text,type}),select:async(title,options)=>{
   dialogs.push({title,options:[...options]});
   const choice=choices.shift();
   if (typeof choice==='function') return choice(options);
   if (choice===undefined) return undefined;
   const found=options.find(o=>o===choice||o.endsWith(' '+choice));
   assert.ok(found,'Missing option '+choice);return found;
 }}});
 return {
  async setProject(value){await write(path.join(cwd,'.pi/workflow.json'),value);},
  async setGlobal(value){await write(path.join(agent,'workflow.json'),value);},
  async deletePrompt(step){await fs.rm(path.join(agent,'workflow/prompts',step+'.md'));},
  async editPrompt(step,text){await write(path.join(agent,'workflow/prompts',step+'.md'),text);},
  setTrusted(value){trusted=value;},setUI(value){hasUI=value;},
  async discover(){discovered=await events.get('resources_discover')({cwd,reason:'startup'},ctx());return discovered;},
  async run({supported=true,sections={other:'preserved'}}={}){lastEvent={systemPromptOptions:supported?{sections}:{}};await events.get('before_agent_start')(lastEvent,ctx());return lastEvent;},
  async choose(actions=[],scope=''){choices=[...actions];await commands.get('workflow').handler(scope,ctx());assert.equal(choices.length,0);},
  async status(){await commands.get('workflow').handler('status',ctx());},
  async preview(){await commands.get('workflow').handler('preview',ctx());},
  thenPromptContains(text){assert.ok(lastEvent.systemPromptOptions.sections.workflow.includes(text));},
  thenNoPrompt(){assert.equal(lastEvent.systemPromptOptions.sections.workflow,undefined);},
  thenOtherSectionPreserved(){assert.equal(lastEvent.systemPromptOptions.sections.other,'preserved');},
  thenDiscoveredCount(count){assert.equal(discovered.skillPaths.length,count);},
  thenNotificationContains(text){assert.ok(notifications.some(n=>n.text.includes(text)),JSON.stringify(notifications));},
  thenNoDialog(){assert.equal(dialogs.length,0);},
  thenInitialChecks(values){for(const [step,value]of Object.entries(values))assert.ok(dialogs[0].options.includes('['+(value?'x':' ')+'] '+step));},
  thenScopeLabel(scope){
   assert.equal(dialogs.at(-1).title,scope==='project'?'Workflow project: ~/project/.pi/workflow.json':'Workflow global: ~/agent/workflow.json');
   assert.equal(dialogs.at(-1).options.includes('Restore'),scope==='project');
   assert.ok(!dialogs.at(-1).options.includes('Restore inherited enablement'));
  },
  thenCompactStatus(){
   const text=notifications.at(-1).text;
   assert.ok(text.startsWith('Workflow project: ~/project/.pi/workflow.json'));
   for(const step of ['mock','plan','design','commit']){
    assert.ok(text.includes(step+': on\n'));
    assert.ok(text.includes('  prompt: ~/agent/workflow/prompts/'+step+'.md'));
   }
   assert.ok(text.includes('  skills: ~/agent/workflow/skills/mockup-first/SKILL.md'));
   assert.ok(text.includes('  skills: none'));
   assert.ok(text.includes('Configured workflow skills: ~/agent/workflow/skills/'));
   assert.ok(text.includes('Last submitted to Pi discovery: ~/agent/workflow/skills/'));
   assert.ok(!text.includes(dir));
   for(const removed of ['(enabled:','(from ','Workflow skill selection submitted;','Prompts refresh on the next run.','Previously read instructions remain in context;']) assert.ok(!text.includes(removed),text);
  },
  async thenProjectConfig(value){assert.deepEqual(JSON.parse(await fs.readFile(path.join(cwd,'.pi/workflow.json'),'utf8')),value);},
  async thenGlobalConfig(value){assert.deepEqual(JSON.parse(await fs.readFile(path.join(agent,'workflow.json'),'utf8')),value);},
  async thenNoProjectConfig(){await assert.rejects(fs.stat(path.join(cwd,'.pi/workflow.json')),/ENOENT/);},
  thenPreviewOnlyPrompts(){const text=notifications.at(-1).text;assert.ok(text.includes('mock instructions'));assert.ok(!text.includes('SECRET'));},
  thenNoLegacyFallback(){assert.equal(lastEvent.systemPrompt,undefined);assert.equal(lastEvent.systemPromptOptions.appendSystemPrompt,undefined);},
  async revokeTrustDuringSave(){choices=['mock',()=>{trusted=false;return 'Save';}];await commands.get('workflow').handler('',ctx());},
  async toggleConcurrently(step){choices=[step,async options=>{await write(path.join(cwd,'.pi/workflow.json'),{steps:{[step]:{enabled:false}}});return 'Save';}];await commands.get('workflow').handler('',ctx());},
 };
}
module.exports={createWorkflowDriver};
