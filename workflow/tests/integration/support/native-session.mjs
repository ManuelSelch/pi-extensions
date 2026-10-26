import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [sdkPath,agentDir,cwd,extensionPath]=process.argv.slice(2);
const sdk=await import(pathToFileURL(sdkPath).href);
const settingsManager=sdk.SettingsManager.inMemory({}, {projectTrusted:true});
const loader=new sdk.DefaultResourceLoader({cwd,agentDir,settingsManager,noExtensions:true,noSkills:true,noPromptTemplates:true,
 additionalExtensionPaths:[extensionPath]});
await loader.reload();
assert.deepEqual(loader.getExtensions().errors,[]);
const {session}=await sdk.createAgentSession({cwd,agentDir,settingsManager,resourceLoader:loader,tools:['read'],sessionManager:sdk.SessionManager.inMemory(cwd)});
const notifications=[],errors=[],dialogs=[];
let selections=['[x] mock','Save'];
const ui={notify:(text)=>notifications.push(text),select:async(title,options)=>{dialogs.push({title,options});const v=selections.shift();assert.ok(options.includes(v));return v;}};
try {
 await session.bindExtensions({uiContext:ui,mode:'rpc',onError:error=>errors.push(error)});
 assert.equal(loader.getSkills().skills.length,1);
 assert.ok(session.systemPrompt.includes('native-fixture'));
 assert.ok(!session.systemPrompt.includes('PRIVATE SKILL BODY'));
 const promptOptions={cwd,sections:{other:'PRESERVED'}};
 const before=()=>session.extensionRunner.emitBeforeAgentStart.length===3
  ?session.extensionRunner.emitBeforeAgentStart('test',undefined,promptOptions)
  :session.extensionRunner.emitBeforeAgentStart({prompt:'test'},promptOptions);
 const first=await before();
 assert.equal(first.systemPromptOptions.sections.workflow,'## mock\nNATIVE MOCK');
 assert.equal(first.systemPromptOptions.sections.other,'PRESERVED');
 assert.equal((await before()).systemPromptOptions.sections.workflow,first.systemPromptOptions.sections.workflow);
 await session.prompt('/workflow');
 assert.equal(dialogs.length,2);
 assert.ok(dialogs[0].title.includes('project'));
 assert.ok(dialogs[0].options.includes('[x] mock'));
 assert.ok(dialogs[1].options.includes('[ ] mock'));
 assert.equal(JSON.parse(await fs.readFile(path.join(cwd,'.pi/workflow.json'),'utf8')).steps.mock.enabled,false);
 await session.reload();
 assert.equal(loader.getSkills().skills.length,0);
 const after=await before();
 assert.equal(after.systemPromptOptions.sections.workflow,undefined);
 assert.equal(after.systemPromptOptions.sections.other,'PRESERVED');
 await fs.writeFile(path.join(agentDir,'workflow/skills/mockup-first/SKILL.md'),'---\nname: native-fixture\n---\nMISSING DESCRIPTION');
 await fs.writeFile(path.join(cwd,'.pi/workflow.json'),JSON.stringify({steps:{mock:{enabled:true}}}));
 await session.reload();
 assert.equal(loader.getSkills().skills.length,0);
 assert.ok(loader.getSkills().diagnostics.length>0,'Malformed native skills must retain Pi diagnostics');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({version:sdk.VERSION,skillsRemoved:true,lazy:true,popup:true,promptSections:true}));
} finally {session.dispose();}
