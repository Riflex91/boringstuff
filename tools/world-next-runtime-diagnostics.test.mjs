import assert from 'node:assert/strict';
import {assessWorldRuntime} from './world-next-runtime-diagnostics.mjs';
import {WORLD_PROFILE} from './world-deployment-profile.mjs';
const good={me:{_id:'me'},branches:{list:[{branch:'chatgpt',activeWorld:true}]},status:{status:'normal'},room:{objects:[{type:'spawn',x:37,y:26,name:'Spawn1',user:'me',energy:300,energyCapacity:300},{type:'creep',user:'me',memory:{role:'harvester'}},{type:'controller',level:1,progress:100}]},memory:{data:JSON.stringify({deploymentId:'test-deployment',telemetryJournal:{events:[],snapshots:[]}})}};
const result=assessWorldRuntime(good,WORLD_PROFILE.branch);
assert.equal(assessWorldRuntime(good).ok,false,
 'staging-only default must reject active production branch');
assert.equal(WORLD_PROFILE.branch,'chatgpt');
assert.equal(result.ok,true);
assert.equal(result.activeBranch,WORLD_PROFILE.branch);
assert.equal(result.spawnVerified,true);
assert.equal(result.ownedCreepCount,1);
assert.equal(result.spawnEnergy,300);
assert.equal(result.recoveryEvidence.availability,'OBSERVED_IN_BOT_MEMORY');
assert.equal(result.recoveryEvidence.observedEventCount,0);
assert.equal(result.recoveryEvidence.observationScope,'RETAINED_EVENTS_AND_BOUNDED_MISSION_HISTORY_ONLY');
assert.equal(assessWorldRuntime({...good,memory:null},WORLD_PROFILE.branch).recoveryEvidence.availability,'UNKNOWN');
assert.ok(assessWorldRuntime({...good,memory:null}).warnings.includes('RECOVERY_MEMORY_UNVERIFIED'));

for(const patch of [{room:{objects:[]}},{branches:{list:[{branch:'chatgpt-w37s79-stage',activeWorld:true}]}},{status:{status:'empty'}},{me:{_id:'other'}}])
  assert.equal(assessWorldRuntime({...good,...patch},WORLD_PROFILE.branch).ok,false);
console.log('W37S79 runtime diagnostics: PASS');
