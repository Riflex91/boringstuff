import assert from 'node:assert/strict';
import {assessWorldRuntime} from './world-next-runtime-diagnostics.mjs';
const good={me:{_id:'me'},branches:{list:[{branch:'chatgpt',activeWorld:true}]},status:{status:'normal'},room:{objects:[{type:'spawn',x:37,y:26,name:'Spawn1',user:'me',energy:300,energyCapacity:300},{type:'creep',user:'me',memory:{role:'harvester'}},{type:'controller',level:1,progress:100}]},memory:{data:JSON.stringify({deploymentId:'test-deployment',telemetryJournal:{events:[],snapshots:[]}})}};
const result=assessWorldRuntime(good);
assert.equal(result.ok,true);
assert.equal(result.operationalReady,true);
assert.equal(result.expectedActiveWorldBranch,'chatgpt');
assert.equal(result.activeBranch,'chatgpt');
assert.equal(result.spawnVerified,true);
assert.equal(result.ownedCreepCount,1);
assert.equal(result.spawnEnergy,300);
assert.equal(result.recoveryEvidence.availability,'OBSERVED_IN_BOT_MEMORY');
assert.equal(result.recoveryEvidence.observedEventCount,0);
assert.equal(result.recoveryEvidence.observationScope,'RETAINED_EVENTS_AND_BOUNDED_MISSION_HISTORY_ONLY');
assert.equal(assessWorldRuntime({...good,memory:null}).recoveryEvidence.availability,'UNKNOWN');
assert.ok(assessWorldRuntime({...good,memory:null}).warnings.includes('RECOVERY_MEMORY_UNVERIFIED'));

for(const patch of [{room:{objects:[]}},{branches:{list:[{branch:'chatgpt-w37s79-stage',activeWorld:true}]}},{status:{status:'empty'}},{status:{status:'lost'}},{status:{status:'paused'}},{me:{_id:'other'}},{room:{objects:[{type:'spawn',x:37,y:26,name:'Spawn1',user:'me'},{type:'controller',level:3}]}}])
  assert.equal(assessWorldRuntime({...good,...patch}).ok,false);
const lost=assessWorldRuntime({...good,status:{status:'lost'}});
assert.ok(lost.failures.includes('WORLD_STATUS_NOT_NORMAL'));
assert.equal(lost.operationalReady,false);
const formerStage=assessWorldRuntime({...good,branches:{list:[
  {branch:'chatgpt-w37s79-stage',activeWorld:true},
  {branch:'chatgpt',activeWorld:false}]}});
assert.ok(formerStage.failures.includes('EXPECTED_WORLD_MAIN_BRANCH_NOT_ACTIVE'));
const noWorker=assessWorldRuntime({...good,room:{objects:[
  {type:'spawn',x:37,y:26,name:'Spawn1',user:'me'},
  {type:'controller',level:3}]}});
assert.ok(noWorker.failures.includes('OWNED_WORKFORCE_MISSING'));
assert.equal(noWorker.operationalReady,false);

console.log('W37S79 runtime diagnostics: PASS');
