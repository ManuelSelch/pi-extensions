const {test}=require('node:test');
const {createWorkflowDriver}=require('./support/workflow-driver.cjs');

test('project selector saves project workflow settings',async t=>{
 const app=await createWorkflowDriver(t);
 await app.choose(['mock','Save'],'project');
 await app.thenProjectConfig({steps:{mock:{enabled:false}}});
});

test('session toggle disables a workflow step without changing project settings',async t=>{
 const app=await createWorkflowDriver(t);
 await app.toggleSessionStep('mock');
 await app.thenSessionStepEnabled('mock',false);
 await app.thenWorkflowTransitionMessage('mock',false);
 await app.thenNoProjectConfig();
});

test('session toggle enables a workflow step with its instructions',async t=>{
 const app=await createWorkflowDriver(t);
 await app.setProject({steps:{mock:{enabled:false}}});
 await app.toggleSessionStep('mock');
 await app.thenSessionStepEnabled('mock',true);
 await app.thenWorkflowTransitionMessage('mock',true);
 await app.thenProjectConfig({steps:{mock:{enabled:false}}});
});

test('session overrides do not leak into a new session',async t=>{
 const app=await createWorkflowDriver(t);
 await app.toggleSessionStep('mock');
 await app.startNewSession();
 await app.thenSessionStepEnabled('mock',true);
});

test('workflow changes preserve the existing model request prefix',async t=>{
 const app=await createWorkflowDriver(t);
 await app.run();
 await app.toggleSessionStep('mock');
 await app.run();
 await app.thenCachedPrefixPreserved();
});
