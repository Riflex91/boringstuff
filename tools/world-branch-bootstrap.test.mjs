import assert from 'node:assert/strict';
import {assessWorldCodeBootstrap,verifyUploadedWorldModules,
  stageInactiveWorldCode,classifyWorldStageFailure} from './world-branch-bootstrap.mjs';
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

const modules={
  main:'module.exports.loop = function() {}',
  config:"module.exports = { VERSION: 'test' };",
  a:'a',b:'b',c:'c',d:'d',e:'e',f:'f'
};
function createMock({
  worldEmpty=true,activeClone=false,cloneFailure=false,
  uploadFailure=false,wrongUpload=false,missingDefault=false
}={}) {
  const calls=[];
  const state={
    status:worldEmpty?'empty':'normal',
    branches:missingDefault?[]:[{branch:'default',activeWorld:true}],
    modules:{main:'legacy'}
  };
  const api={
    async authMe(){calls.push(['GET','authMe']);return {_id:'me',ok:1};},
    async userWorldStatus(){calls.push(['GET','userWorldStatus']);
      return {ok:1,status:state.status};},
    async userBranches(){calls.push(['GET','userBranches']);
      return {ok:1,list:state.branches.map(x=>({...x}))};},
    async _request(method,endpoint,payload){
      calls.push([method,endpoint,payload]);
      if (method==='GET'&&endpoint==='/api/user/code'){
        if(payload.branch==='default')return {modules:{main:'legacy'}};
        assert.equal(payload.branch,'chatgpt');
        return {modules:state.modules};
      }
      if (method==='POST'&&endpoint==='/api/user/clone-branch'){
        assert.deepEqual(payload,{
          branch:'default',newName:'chatgpt',defaultModules:false
        });
        if(cloneFailure)throw Object.assign(new Error('secret token failure'),{
          statusCode:403});
        state.branches.push({branch:'chatgpt',activeWorld:activeClone});
        return {ok:1};
      }
      if (method==='POST'&&endpoint==='/api/user/code'){
        assert.equal(payload.branch,'chatgpt','Never overwrite default');
        if(uploadFailure)throw Object.assign(new Error('token leak'),{
          statusCode:409});
        state.modules=wrongUpload?{main:'tampered'}:{...payload.modules};
        return {ok:1};
      }
      throw new Error('Unexpected endpoint '+endpoint);
    }
  };
  return {api,calls,state};
}
{
  const {api,calls,state}=createMock();
  const phases=[];
  const result=await stageInactiveWorldCode(api,modules,p=>phases.push(p));
  assert.deepEqual(result,{
    status:'PASS',branch:'chatgpt',moduleCount:8,
    exactByteMatch:true,activeWorld:'default',spawnPlaced:false});
  const writes=calls.filter(c=>c[0]==='POST');
  assert.deepEqual(writes.map(c=>c[1]),[
    '/api/user/clone-branch','/api/user/code'
  ]);
  assert.equal(phases.at(-1),'STAGED_INACTIVE_VERIFIED');
  assert.equal(state.branches[0].activeWorld,true);
  assert.equal(state.branches[1].activeWorld,false);
  await assert.rejects(()=>stageInactiveWorldCode(api,modules),
    /INITIAL_WORLD_GATE_BLOCKED/,'Re-run fails when branch exists');
  assert.equal(calls.filter(c=>c[0]==='POST').length,2,
    'Idempotence gate blocks duplicate mutation');
}
{
  const {api,calls}=createMock({worldEmpty:false});
  await assert.rejects(()=>stageInactiveWorldCode(api,modules),
    /INITIAL_WORLD_GATE_BLOCKED/);
  assert.equal(calls.filter(c=>c[0]==='POST').length,0);
}
{
  const {api,calls}=createMock({missingDefault:true});
  await assert.rejects(()=>stageInactiveWorldCode(api,modules),
    /INITIAL_WORLD_GATE_BLOCKED/);
  assert.equal(calls.filter(c=>c[0]==='POST').length,0);
}
{
  const {api,calls}=createMock({cloneFailure:true});
  await assert.rejects(()=>stageInactiveWorldCode(api,modules),/secret/);
  assert.deepEqual(calls.filter(c=>c[0]==='POST').map(c=>c[1]),
    ['/api/user/clone-branch']);
}
{
  const {api,calls}=createMock({activeClone:true});
  await assert.rejects(()=>stageInactiveWorldCode(api,modules),
    /WORLD_CLONE_NOT_INACTIVE/);
  assert.equal(calls.filter(c=>c[0]==='POST').length,1,
    'Must not upload to unexpectedly active code branch');
}
{
  const {api,calls}=createMock({uploadFailure:true});
  await assert.rejects(()=>stageInactiveWorldCode(api,modules),/token leak/);
  assert.deepEqual(calls.filter(c=>c[0]==='POST').map(c=>c[1]),
    ['/api/user/clone-branch','/api/user/code']);
  assert.equal(calls.some(c=>c[1]==='/api/user/set-active-branch'),false);
}
{
  const {api}=createMock({wrongUpload:true});
  await assert.rejects(()=>stageInactiveWorldCode(api,modules),
    /WORLD_EXACT_UPLOAD_VERIFICATION_FAILED/);
}
{
  const {api,calls}=createMock();
  await assert.rejects(()=>stageInactiveWorldCode(api,{main:'bad'}),
    /INVALID_LOCAL_GAME_MODULE_SET/);
  assert.equal(calls.length,0);
}
assert.deepEqual(classifyWorldStageFailure(
  Object.assign(new Error('secret token x'),{statusCode:403})),{
    kind:'AUTHORIZATION_OR_SCOPE',httpStatus:403
});
assert.deepEqual(classifyWorldStageFailure(
  Object.assign(new Error('private code error'),{statusCode:404})),{
    kind:'ENDPOINT_OR_BRANCH_NOT_FOUND',httpStatus:404
});
assert.equal(classifyWorldStageFailure(new Error('some secret')).httpStatus,null);

console.log('World branch preparation policy (offline only): PASS');
