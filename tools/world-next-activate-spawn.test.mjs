import assert from 'node:assert/strict';
import {assessActivationState,ACTIVATION_APPROVAL} from './world-next-activate-spawn.mjs';
const expected={main:'hello',config:'world'};
const good={approval:ACTIVATION_APPROVAL,branches:{list:[{branch:'chatgpt',activeWorld:true},{branch:'chatgpt-w37s79-stage',activeWorld:false}]},objects:{objects:[{type:'spawn',x:37,y:26,name:'Spawn1',user:'123'}]},me:{_id:'123'},code:{modules:expected},status:{status:'normal'},expected};
assert.equal(assessActivationState(good).ok,true);
for(const patch of [{approval:''},{status:{status:'empty'}},{code:{modules:{main:'bad',config:'world'}}},{objects:{objects:[]}},{branches:{list:[{branch:'chatgpt-w37s79-stage',activeWorld:true}]}}])
  assert.equal(assessActivationState({...good,...patch}).ok,false);
console.log('W37S79 post-spawn activation gates: PASS');
