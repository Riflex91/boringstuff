import assert from 'node:assert/strict';
import {assessAutoDeployGate} from './world-next-auto-deploy-guard.mjs';
const base={me:{_id:'me'},branches:{list:[{branch:'chatgpt-w37s79-stage',activeWorld:true}]},
status:{status:'normal'},room:{objects:[
{type:'spawn',x:37,y:26,name:'Spawn1',user:'me'},
{type:'controller',user:'me',level:1}]},
code:{modules:Object.fromEntries(Array.from({length:8},(_,i)=>['module'+i,'code']))}};
assert.equal(assessAutoDeployGate(base).ok,true);
for(const patch of [
{me:{_id:'other'}},{status:{status:'empty'}},
{branches:{list:[{branch:'chatgpt',activeWorld:true}]}},
{room:{objects:[{type:'spawn',x:37,y:26,name:'Spawn1',user:'me'}]}},
{code:{modules:{}}}])
 assert.equal(assessAutoDeployGate({...base,...patch}).ok,false);
console.log('W37S79 automatic deployment guard: PASS');
