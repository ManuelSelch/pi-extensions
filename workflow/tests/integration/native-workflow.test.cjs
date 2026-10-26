const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {createNativeDriver}=require('./support/native-driver.cjs');
const root=path.resolve(__dirname,'../../..');
const sdks=process.env.PI_WORKFLOW_SDK_ENTRIES
 ?process.env.PI_WORKFLOW_SDK_ENTRIES.split(path.delimiter)
 :[path.resolve(root,'../git/pi-chat/node_modules/@earendil-works/pi-coding-agent/dist/index.js'),
   path.resolve(root,'../install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js')];
for(const sdk of sdks)test('native workflow: '+sdk,{skip:!fs.existsSync(sdk)},async t=>{
 const app=await createNativeDriver(t);
 await app.runNativeSession(sdk);
 app.thenNativeWorkflowWorks();
});
