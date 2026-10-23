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
// World can be LOST while the pinned spawn is still visible to room GET.
// A successful read-only inspection must never imply deployment readiness.
assert.deepEqual(result.operationalReadiness,{
  status:'UNVERIFIED',reasons:[],
  evidenceType:'CURRENT_GET_ONLY_STATUS_AND_ROOM_OBJECTS',
  executionAuthority:false
});
const lost=assessWorldRuntime({...good,status:{status:'lost'}},WORLD_PROFILE.branch);
assert.equal(lost.ok,true,'GET-only evidence collection can succeed during loss');
assert.equal(lost.worldStatus,'lost');
assert.equal(lost.spawnVerified,true);
assert.deepEqual(lost.operationalReadiness.reasons,['WORLD_STATUS_NOT_NORMAL']);
assert.equal(lost.operationalReadiness.status,'HOLD');
assert.equal(lost.operationalReadiness.executionAuthority,false);
const missingSpawn=assessWorldRuntime({...good,
  room:{objects:good.room.objects.slice(1)}},WORLD_PROFILE.branch);
assert.equal(missingSpawn.ok,false);
assert.ok(missingSpawn.operationalReadiness.reasons.includes(
  'OWNED_PINNED_SPAWN_MISSING'));
assert.equal(missingSpawn.operationalReadiness.status,'HOLD');
// Retained STATUS_SNAPSHOT is historical, never a current spawn-state claim.
const retainedSpawnLoss={data:JSON.stringify({
  deploymentId:'test-deployment',
  telemetryJournal:{events:[],snapshots:[{
    c:'STATUS_SNAPSHOT',t:100,x:{
      expansionReadiness:{status:'HOLD',reasons:['NO_HEALTHY_SUPPORTING_PARENT']},
      rooms:{W37S79:{health:{status:'DEGRADED',
        reasons:['SPAWN_MISSING']}}}
    }
  }]}
})};
const historical=assessWorldRuntime({...good,memory:retainedSpawnLoss},
  WORLD_PROFILE.branch);
assert.equal(historical.ok,true);
assert.equal(historical.operationalReadiness.status,'UNVERIFIED',
  'historical spawn loss must not override a current normal status');
assert.ok(historical.warnings.includes('RETAINED_SNAPSHOT_SPAWN_MISSING'));
const lostWithHistory=assessWorldRuntime({...good,status:{status:'lost'},
  memory:retainedSpawnLoss},WORLD_PROFILE.branch);
assert.equal(lostWithHistory.operationalReadiness.status,'HOLD');
assert.ok(lostWithHistory.warnings.includes('RETAINED_SNAPSHOT_SPAWN_MISSING'));
assert.equal(lostWithHistory.operationalReadiness.executionAuthority,false);

console.log('W37S79 runtime diagnostics: PASS');
