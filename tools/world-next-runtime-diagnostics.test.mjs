import assert from 'node:assert/strict';
import {assessWorldRuntime} from './world-next-runtime-diagnostics.mjs';
const good={me:{_id:'me'},branches:{list:[{branch:'chatgpt-w37s79-stage',activeWorld:true}]},status:{status:'normal'},room:{objects:[{type:'spawn',x:37,y:26,name:'Spawn1',user:'me',energy:300,energyCapacity:300},{type:'creep',user:'me',memory:{role:'harvester'}},{type:'controller',level:1,progress:100}]},memory:{}};
const result=assessWorldRuntime(good);
assert.equal(result.ok,true);
assert.equal(result.spawnVerified,true);
assert.equal(result.ownedCreepCount,1);
assert.equal(result.spawnEnergy,300);
for(const patch of [{room:{objects:[]}},{branches:{list:[{branch:'chatgpt',activeWorld:true}]}},{status:{status:'empty'}},{me:{_id:'other'}}])
  assert.equal(assessWorldRuntime({...good,...patch}).ok,false);
console.log('W37S79 runtime diagnostics: PASS');
