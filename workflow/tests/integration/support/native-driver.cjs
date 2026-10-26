const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const root=path.resolve(__dirname,'../../../..');
async function createNativeDriver(t) {
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'workflow-native-')));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const agent=path.join(dir,'agent'),cwd=path.join(dir,'project');
 await fs.mkdir(path.join(agent,'workflow/skills/mockup-first'),{recursive:true});
 await fs.mkdir(path.join(agent,'workflow/prompts'),{recursive:true});
 await fs.mkdir(cwd);
 await fs.writeFile(path.join(agent,'workflow/skills/mockup-first/SKILL.md'),'---\nname: native-fixture\ndescription: Native workflow skill\n---\nPRIVATE SKILL BODY');
 await fs.writeFile(path.join(agent,'workflow/prompts/mock.md'),'NATIVE MOCK');
 await fs.writeFile(path.join(agent,'workflow.json'),JSON.stringify({steps:{plan:{enabled:false},design:{enabled:false},commit:{enabled:false}}}));
 let result;
 return {
  async runNativeSession(sdkPath){
   const {stdout}=await promisify(execFile)(process.execPath,[path.join(__dirname,'native-session.mjs'),sdkPath,agent,cwd,path.join(root,'workflow/index.ts')],
    {cwd,env:{...process.env,PI_CODING_AGENT_DIR:agent},timeout:60000});
   result=JSON.parse(stdout.trim().split('\n').at(-1));
  },
  thenNativeWorkflowWorks(){assert.equal(result.skillsRemoved,true);assert.equal(result.lazy,true);assert.equal(result.popup,true);assert.equal(result.promptSections,true);},
 };
}
module.exports={createNativeDriver};
