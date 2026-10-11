import assert from 'node:assert/strict';
import {assessWorldCodeBootstrap,verifyUploadedWorldModules} from './world-branch-bootstrap.mjs';
const baseline={account:{_id:'me',ok:1},status:{ok:1,status:'empty'},
  branches:{list:[{branch:'default',activeWorld:true},{branch:'tutorial-1'}]},
  backup:{modules:{main:'old'}}};
assert.equal(assessWorldCodeBootstrap(baseline).ok,true);
for (const [change,reason] of [
  [{status:{status:'normal'}},'ACCOUNT_NOT_EMPTY'],
  [{branches:{list:[{branch:'default',activeWorld:true},{branch:'chatgpt'}]}},'WORLD_BRANCH_ALREADY_EXISTS'],
  [{branches:{list:[{branch:'default',activeWorld:false}]}},'DEFAULT_BRANCH_NOT_ACTIVE'],
  [{backup:{error:'not allowed'}},'CURRENT_CODE_BACKUP_NOT_READABLE'],
  [{account:{username:'not-enough'}},'ACCOUNT_UNVERIFIED']
]) {
  const result=assessWorldCodeBootstrap({...baseline,...change});
  assert.equal(result.ok,false,reason);
  assert.ok(result.failures.includes(reason),JSON.stringify(result));
}
assert.equal(verifyUploadedWorldModules({main:'a',config:'b'}, {config:'b',main:'a'}),true);
assert.equal(verifyUploadedWorldModules({main:'a',config:'b'}, {config:'b',main:'changed'}),false);
assert.equal(verifyUploadedWorldModules({main:'a'}, {main:'a',extra:'x'}),false);
console.log('World branch preparation policy (offline only): PASS');
