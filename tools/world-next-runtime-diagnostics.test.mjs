import assert from 'node:assert/strict';
import {assessWorldRuntime} from './world-next-runtime-diagnostics.mjs';
const good={me:{_id:'me'},branches:{list:[{branch:'chatgpt-w37s79-stage',activeWorld:true}]},status:{status:'normal'},room:{objects:[{type:'spawn',x:37,y:26,name:'Spawn1',user:'me',energy:300,energyCapacity:300},{type:'creep',user:'me',memory:{role:'harvester'}},{type:'controller',level:1,progress:100}]},memory:{data:JSON.stringify({deploymentId:'test-deployment',telemetryJournal:{events:[],snapshots:[]}})}};
const result=assessWorldRuntime(good);
assert.equal(result.ok,true);
assert.equal(result.spawnVerified,true);
assert.equal(result.ownedCreepCount,1);
assert.equal(result.spawnEnergy,300);
assert.equal(result.recoveryEvidence.availability,'OBSERVED_IN_BOT_MEMORY');
assert.equal(result.recoveryEvidence.observedEventCount,0);
assert.equal(result.recoveryEvidence.observationScope,'RETAINED_EVENTS_AND_BOUNDED_MISSION_HISTORY_ONLY');
assert.equal(assessWorldRuntime({...good,memory:null}).recoveryEvidence.availability,'UNKNOWN');
assert.ok(assessWorldRuntime({...good,memory:null}).warnings.includes('RECOVERY_MEMORY_UNVERIFIED'));

for(const patch of [{room:{objects:[]}},{branches:{list:[{branch:'chatgpt',activeWorld:true}]}},{status:{status:'empty'}},{me:{_id:'other'}}])
  assert.equal(assessWorldRuntime({...good,...patch}).ok,false);

// Regression: a Screeps World account can be LOST even while the room-object
// API still reports a matching historical spawn object. Never treat the
// matching object alone as proof of a healthy, deployable colony.
const lostMemory={data:JSON.stringify({
  deploymentId:'test-lost-deployment',
  telemetryJournal:{events:[],snapshots:[{
    c:'STATUS_SNAPSHOT',t:1000,x:{
      expansionReadiness:{status:'AT_CAPACITY',reasons:['NO_AVAILABLE_CLAIM_SLOT']},
      rooms:{W37S79:{rcl:4,energyAvailable:0,energyCapacity:0,
        health:{status:'CRITICAL',overallScore:45,
          reasons:['SPAWN_MISSING','MINING_DEFICIT']}}}
    }
  }]}
})};
const lost=assessWorldRuntime({...good,status:{status:'lost'},
  room:{objects:[good.room.objects[0],good.room.objects[2]]},
  memory:lostMemory});
assert.equal(lost.ok,false);
assert.ok(lost.failures.includes('WORLD_ACCOUNT_LOST'));
assert.equal(lost.spawnVerified,true);
assert.equal(lost.ownedCreepCount,0);
assert.equal(lost.operationalReady,false);
assert.equal(lost.spawnEvidenceDisagreement,true);
assert.equal(lost.spawnEvidenceSameTickVerified,false);
assert.ok(lost.warnings.includes('API_SPAWN_VS_RETAINED_SNAPSHOT_DISAGREE'));
assert.equal(lost.recoveryEvidence.expansion.home.healthStatus,'CRITICAL');
const staleButNormal=assessWorldRuntime({...good,memory:lostMemory});
assert.equal(staleButNormal.ok,true,'do not convert stale snapshot to a current game-state veto');
assert.equal(staleButNormal.operationalReady,false);
assert.equal(staleButNormal.spawnEvidenceDisagreement,true);
assert.equal(assessWorldRuntime(good).operationalReady,true);
assert.ok(assessWorldRuntime({...good,status:{status:'unrecognized'}})
  .failures.includes('WORLD_STATUS_INVALID'));

console.log('W37S79 runtime diagnostics: PASS');
