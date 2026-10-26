const {test}=require('node:test');
const {createWorkflowDriver}=require('./support/workflow-driver.cjs');
test('multiple popup toggles save a minimal patch; other sections survive',async t=>{
 const app=await createWorkflowDriver(t);await app.discover();app.thenDiscoveredCount(3);
 await app.choose(['mock','commit','Save']);app.thenInitialChecks({mock:true,plan:true,design:true,commit:true});app.thenScopeLabel('project');
 await app.thenProjectConfig({steps:{mock:{enabled:false},commit:{enabled:false}}});
 await app.run();app.thenPromptContains('plan instructions');app.thenOtherSectionPreserved();
 await app.status();app.thenNotificationContains('/reload');
 await app.discover();app.thenDiscoveredCount(2);
});
test('Escape, Cancel and unchanged Save create no config',async t=>{
 for(const end of [undefined,'Cancel','Save']){const app=await createWorkflowDriver(t);await app.choose(end==='Save'?['Save']:['mock',end]);await app.thenNoProjectConfig();}
});
test('global popup ignores project overrides; restoration only removes enablement',async t=>{
 const app=await createWorkflowDriver(t);await app.setProject({steps:{mock:{enabled:false,prompt:null,skills:[]}}});
 await app.choose(['commit','Save'],'global');app.thenInitialChecks({mock:true});app.thenScopeLabel('global');
 await app.thenGlobalConfig({steps:{commit:{enabled:false}}});
 await app.choose(['Restore inherited enablement','Save']);
 await app.thenProjectConfig({steps:{mock:{prompt:null,skills:[]}}});
});
test('all-off removes only workflow; prompt edits refresh without reload',async t=>{
 const app=await createWorkflowDriver(t);await app.run();app.thenPromptContains('mock instructions');
 await app.editPrompt('mock','NEW');await app.run();app.thenPromptContains('NEW');
 await app.choose(['mock','plan','design','commit','Save']);await app.run();app.thenNoPrompt();app.thenOtherSectionPreserved();
 await app.discover();app.thenDiscoveredCount(0);
});
test('malformed project config is ignored when untrusted; project writes are refused',async t=>{
 const app=await createWorkflowDriver(t);await app.setProject('{broken');app.setTrusted(false);
 await app.run();app.thenPromptContains('mock instructions');await app.choose();app.thenNoDialog();app.thenNotificationContains('trust');
 await app.choose(['mock','Save'],'global');await app.thenGlobalConfig({steps:{mock:{enabled:false}}});
});
test('headless UI is refused; native discovery and injection still work',async t=>{
 const app=await createWorkflowDriver(t);app.setUI(false);await app.choose();app.thenNoDialog();app.thenNotificationContains('interactive');
 await app.discover();app.thenDiscoveredCount(3);await app.run();app.thenPromptContains('mock instructions');
});
test('errors replace last-good workflow content and clear discovery contributions',async t=>{
 const app=await createWorkflowDriver(t);await app.run();await app.deletePrompt('mock');
 await app.run({sections:{other:'preserved',workflow:'STALE'}});app.thenPromptContains('unavailable');app.thenPromptContains('mock.md');app.thenOtherSectionPreserved();
 await app.discover();app.thenDiscoveredCount(0);app.thenNotificationContains('mock.md');
});
test('unsupported runtime is explicit without full prompt replacement',async t=>{
 const app=await createWorkflowDriver(t);await app.run({supported:false});app.thenNotificationContains('structured');app.thenNoLegacyFallback();
});
test('preview contains exactly prompt contributions, not lazy skill bodies',async t=>{
 const app=await createWorkflowDriver(t);await app.preview();app.thenPreviewOnlyPrompts();
});
test('trust revoked while the popup is open prevents saving',async t=>{
 const app=await createWorkflowDriver(t);await app.revokeTrustDuringSave();app.thenNotificationContains('trust');await app.thenNoProjectConfig();
});
test('concurrent edited-field changes reject saving',async t=>{
 const app=await createWorkflowDriver(t);await app.toggleConcurrently('mock');app.thenNotificationContains('changed');await app.thenProjectConfig({steps:{mock:{enabled:false}}});
});
