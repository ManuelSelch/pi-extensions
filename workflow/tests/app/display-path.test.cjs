const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {load}=require('../support/load.cjs');
const home=path.resolve('test-home');
const {displayPath}=load('app/display-path.ts',{'node:os':{homedir:()=>home}});
test('home root and descendants use a tilde',()=>{
 assert.equal(displayPath(home),'~');
 assert.equal(displayPath(path.join(home,'project','.pi','workflow.json')),'~'+path.sep+path.join('project','.pi','workflow.json'));
});
test('paths outside home and home-prefix siblings remain unchanged',()=>{
 for(const file of [path.resolve('elsewhere','workflow.json'),home+'-other'+path.sep+'workflow.json','relative/workflow.json']) assert.equal(displayPath(file),file);
});
