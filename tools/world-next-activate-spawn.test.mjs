import assert from 'node:assert/strict';
import {assessActivationState,ACTIVATION_APPROVAL} from './world-next-activate-spawn.mjs';
const expected={main:'hello',config:'world'};
const good={approval:ACTIVATION_APPROVAL,branches:{list:[{branch:'chatgpt',activeWorld:true},{branch:'chatgpt-w37s79-stage',activeWorld:false}]},objects:{objects:[{type:'spawn',x:37,y:26,name:'Spawn1',user:'123'}]},me:{_id:'123'},code:{modules:expected},status:{status:'normal'},expected};
assert.equal(assessActivationState(good).ok,true);
for(const patch of [{approval:''},{status:{status:'empty'}},
  {status:{status:'lost'}},{status:{status:'paused'}},
  {status:{status:null}},{status:{}},{status:null},
  {code:{modules:{main:'bad',config:'world'}}},
  {objects:{objects:[]}},
  {branches:{list:[{branch:'chatgpt-w37s79-stage',activeWorld:true}]}}])
  assert.equal(assessActivationState({...good,...patch}).ok,false);

// LOST remains blocked even when the exact previous spawn object is still
// returned by the external room API, staged branch code matches exactly and
// caller supplies the nominal manual approval token.
const lostWithPinnedSpawn=assessActivationState({
  ...good,status:{status:'lost'}
});
assert.equal(lostWithPinnedSpawn.ok,false);
assert.equal(lostWithPinnedSpawn.ownedSpawnVerified,true);
assert.ok(lostWithPinnedSpawn.failures.includes('WORLD_STATUS_NOT_NORMAL'));
assert.equal(assessActivationState(good).ok,true,
  'normal post-placement state stays operable; no permitted path is weakened');

console.log('W37S79 post-spawn activation gates: PASS');
