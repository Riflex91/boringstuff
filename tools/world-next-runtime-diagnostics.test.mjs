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
 // Missing GET evidence is unknown, not proof of zero creeps or missing Spawn.
 // This distinction matters when World is lost and the API returns partial data.
 for(const [label,patch] of [
   ['room GET missing',{room:{}}],
   ['owner missing',{me:null}],
   ['owner malformed',{me:{_id:{untrusted:true}}}]
 ]) {
   const unknown=assessWorldRuntime({...good,...patch},WORLD_PROFILE.branch);
   assert.equal(unknown.ok,false,label);
   assert.equal(unknown.ownedCreepCount,null,label+' count');
   assert.equal(unknown.ownedCreepRoles,null,label+' roles');
   assert.equal(unknown.spawnVerified,null,label+' spawn');
   assert.equal(unknown.currentRoomCrewRisk.status,'UNVERIFIED',label);
   assert.equal(unknown.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),false,
     label+' must not claim empty crew');
   assert.equal(unknown.operationalReadiness.status,'HOLD',label);
   assert.equal(unknown.operationalReadiness.reasons.includes(
     'OWNED_PINNED_SPAWN_MISSING'),false,
     label+' must not claim missing Spawn from unverifiable GET');
 }
 const validEmpty=assessWorldRuntime({...good,room:{objects:
   good.room.objects.filter(o=>o.type!=='creep')
 }},WORLD_PROFILE.branch);
 assert.equal(validEmpty.spawnVerified,true);
 assert.equal(validEmpty.ownedCreepCount,0);
 assert.ok(validEmpty.warnings.includes('NO_OWNED_CREEPS_OBSERVED'));
 assert.equal(Object.getPrototypeOf(validEmpty.ownedCreepRoles),null);
 const validMissingSpawn=assessWorldRuntime({...good,room:{objects:
   good.room.objects.filter(o=>o.type!=='spawn')
 }},WORLD_PROFILE.branch);
 assert.equal(validMissingSpawn.spawnVerified,false);
 assert.equal(validMissingSpawn.ownedCreepCount,1);
 assert.equal(validMissingSpawn.warnings.includes('NO_OWNED_CREEPS_OBSERVED'),false);
 assert.ok(validMissingSpawn.operationalReadiness.reasons.includes(
   'OWNED_PINNED_SPAWN_MISSING'));

// GET creep memory may contain inherited object property names. Counting
// must preserve those literal labels without prototype pollution or coercion.
const reservedRoles=assessWorldRuntime({...good,room:{objects:[
  ...good.room.objects,
  {type:'creep',user:'me',memory:{role:'constructor'}},
  {type:'creep',user:'me',memory:{role:'__proto__'}},
  {type:'creep',user:'me',memory:{role:'__proto__'}},
  {type:'creep',user:'me',memory:{role:''}}
]}},WORLD_PROFILE.branch);
assert.equal(reservedRoles.ownedCreepCount,5);
assert.equal(Object.getPrototypeOf(reservedRoles.ownedCreepRoles),null);
assert.equal(reservedRoles.ownedCreepRoles.harvester,1);
assert.equal(reservedRoles.ownedCreepRoles.constructor,1);
assert.equal(reservedRoles.ownedCreepRoles.__proto__,2);
assert.equal(Object.hasOwn(reservedRoles.ownedCreepRoles,''),false);
assert.equal(JSON.parse(JSON.stringify(reservedRoles.ownedCreepRoles)).__proto__,2);
assert.equal(result.spawnEnergy,300);
assert.equal(result.controllerProgress,100);
// Controller level is untrusted GET evidence too. Negative, fractional,
// string, boolean and unsafe integer values must never be published as levels.
assert.equal(result.controllerLevel,1);
for(const [label,value] of [
  ['null',null],['missing',undefined],['string','1'],['boolean',true],
  ['negative',-1],['fraction',1.5],['unsafe',Number.MAX_SAFE_INTEGER+1]
]) {
  const malformed=assessWorldRuntime({...good,room:{objects:
    good.room.objects.map(o=>o.type==='controller'?{...o,level:value}:o)
  }},WORLD_PROFILE.branch);
  assert.equal(malformed.controllerLevel,null,label+' controller level');
  assert.equal(malformed.operationalReadiness.executionAuthority,false);
}
const zeroLevel=assessWorldRuntime({...good,room:{objects:
  good.room.objects.map(o=>o.type==='controller'?{...o,level:0}:o)
}},WORLD_PROFILE.branch);
assert.equal(zeroLevel.controllerLevel,0);

// World GET values are untrusted observations: null, strings, booleans,
// negative values and fractions cannot be converted into fabricated energy
// or controller progress. A genuine numeric zero remains observable.
for(const [label,value] of [
  ['null',null],['missing',undefined],['numeric-string','300'],
  ['boolean',false],['negative',-1],['fraction',0.5]
]) {
  const malformed=assessWorldRuntime({...good,room:{objects:
    good.room.objects.map(o=>o.type==='spawn'?
      {...o,energy:value,energyCapacity:value}:
      o.type==='controller'?{...o,progress:value}:o)
  }},WORLD_PROFILE.branch);
  assert.equal(malformed.spawnEnergy,null,label+' spawn energy');
  assert.equal(malformed.spawnEnergyCapacity,null,label+' spawn capacity');
  assert.equal(malformed.controllerProgress,null,label+' controller progress');
  assert.equal(malformed.operationalReadiness.executionAuthority,false);
}
const zero=assessWorldRuntime({...good,room:{objects:
  good.room.objects.map(o=>o.type==='spawn'?
    {...o,energy:0,energyCapacity:0}:
    o.type==='controller'?{...o,progress:0}:o)
}},WORLD_PROFILE.branch);
assert.equal(zero.spawnEnergy,0);
assert.equal(zero.spawnEnergyCapacity,0);
assert.equal(zero.controllerProgress,0);
assert.equal(result.recoveryEvidence.availability,'OBSERVED_IN_BOT_MEMORY');
assert.equal(result.recoveryEvidence.observedEventCount,0);
assert.equal(result.recoveryEvidence.observationScope,'RETAINED_EVENTS_AND_BOUNDED_MISSION_HISTORY_ONLY');
assert.equal(assessWorldRuntime({...good,memory:null},WORLD_PROFILE.branch).recoveryEvidence.availability,'UNKNOWN');
assert.ok(assessWorldRuntime({...good,memory:null}).warnings.includes('RECOVERY_MEMORY_UNVERIFIED'));

// Failed GET prerequisites must be reflected in the operational HOLD gate,
// not merely in result.ok. Reasons remain deduplicated and non-authoritative.
for(const [patch,expectedReason] of [
  [{room:{objects:[]}},'OWNED_PINNED_SPAWN_MISSING'],
  [{room:{}},'ROOM_OBJECTS_UNAVAILABLE'],
  [{branches:{list:[{branch:'chatgpt-w37s79-stage',activeWorld:true}]}},
    'EXPECTED_BRANCH_NOT_ACTIVE'],
  [{status:{status:'empty'}},'WORLD_STATUS_INVALID'],
  [{me:null},'AUTH_UNVERIFIED'],
  [{me:{_id:'other'}},'OWNED_PINNED_SPAWN_MISSING']
]) {
  const invalid=assessWorldRuntime({...good,...patch},WORLD_PROFILE.branch);
  assert.equal(invalid.ok,false,expectedReason+' must fail inspection');
  assert.equal(invalid.operationalReadiness.status,'HOLD',expectedReason);
  assert.ok(invalid.operationalReadiness.reasons.includes(expectedReason));
  assert.equal(invalid.operationalReadiness.executionAuthority,false);
  assert.equal(new Set(invalid.operationalReadiness.reasons).size,
    invalid.operationalReadiness.reasons.length,
    'operational HOLD reasons must not be duplicated');
}
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

// R1 site intent is not a completed Spawn, and WORK/CARRY/MOVE upgraders
// are not proof that a builder executes the site. Historical risk only.
const stalledMemory={data:JSON.stringify({
  deploymentId:'test-deployment',
  telemetryJournal:{
    events:[{c:'R1_OWNED_SPAWN_REBUILD_SITE_INTENT',t:175,
      x:{room:'W37S79',siteIntentAccepted:true}}],
    snapshots:[{c:'STATUS_SNAPSHOT',t:200,x:{
      expansionReadiness:{status:'HOLD',reasons:[]},
      rooms:{W37S79:{
        health:{status:'DEGRADED',reasons:['CONSTRUCTION_STALLED','SPAWN_MISSING']},
        creeps:{upgrader:2},constructionSites:15,
        economyModel:{dedicatedHarvestCapacityPerTick:0}
      }}
    }}]
  }
})};
const stalled=assessWorldRuntime({...good,status:{status:'lost'},
  memory:stalledMemory},WORLD_PROFILE.branch);
assert.equal(stalled.recoveryConstructionRisk.status,'POTENTIAL_STALL');
assert.equal(stalled.recoveryConstructionRisk.lastSnapshotTick,200);
assert.equal(stalled.recoveryConstructionRisk.lastSiteIntentTick,175);
assert.equal(stalled.recoveryConstructionRisk.currentBuilderAvailability,'UNVERIFIED');
assert.equal(stalled.recoveryConstructionRisk.executionAuthority,false);
assert.ok(stalled.warnings.includes('RETAINED_RECOVERY_CONSTRUCTION_STALL_RISK'));
assert.equal(stalled.operationalReadiness.status,'HOLD');
// Latest World GET can show zero owned creeps while the retained snapshot
// reports stalled construction and zero modeled harvest. This is a bounded
// cross-source risk, not a current construction observation or a build order.
const emptyPinnedRoom={...good,status:{status:'lost'},
  room:{objects:good.room.objects.filter(o=>o.type!=='creep')},
  memory:stalledMemory};
const emptyCrew=assessWorldRuntime(emptyPinnedRoom,WORLD_PROFILE.branch);
assert.equal(emptyCrew.ok,true,'valid GET-only inspection still succeeds');
assert.equal(emptyCrew.ownedCreepCount,0);
assert.equal(emptyCrew.currentRoomCrewRisk.status,'POTENTIAL_STALL');
assert.equal(emptyCrew.currentRoomCrewRisk.observedRoomCreepCount,0);
assert.equal(emptyCrew.currentRoomCrewRisk.lastSnapshotTick,200);
assert.equal(emptyCrew.currentRoomCrewRisk.executionAuthority,false);
assert.equal(emptyCrew.currentRoomCrewRisk.evidenceType,
  'PINNED_ROOM_GET_CREW_PLUS_RETAINED_STATUS_SNAPSHOT');
assert.ok(emptyCrew.warnings.includes('PINNED_ROOM_CREW_ABSENT_RETAINED_STALL'));
assert.equal(emptyCrew.operationalReadiness.status,'HOLD');
// The newer CRITICAL snapshot has no verified upgrader count; do not force
// the older upgrader-specific R1 risk, but preserve the independent GET risk.
const criticalMemory=JSON.parse(stalledMemory.data);
criticalMemory.telemetryJournal.snapshots[0].x.rooms.W37S79.health.status='CRITICAL';
criticalMemory.telemetryJournal.snapshots[0].x.rooms.W37S79.creeps={};
const criticalEmpty=assessWorldRuntime({...emptyPinnedRoom,
  memory:{data:JSON.stringify(criticalMemory)}},WORLD_PROFILE.branch);
assert.equal(criticalEmpty.recoveryConstructionRisk.status,'UNVERIFIED');
assert.equal(criticalEmpty.currentRoomCrewRisk.status,'POTENTIAL_STALL');
// No false empty-crew risk from a current creep, missing bot memory, failed
// room GET, absent pinned Spawn, unverified owner, or absent retained stall.
for(const [label,patch] of [
  ['creep-present',{room:good.room}],
  ['memory-unknown',{memory:null}],
  ['room-unavailable',{room:{}}],
  ['spawn-missing',{room:{objects:[{type:'controller',level:1}]}}],
  ['owner-unverified',{me:null}],
  ['no-stall',{memory:good.memory}]
]) {
  const observed=assessWorldRuntime({...emptyPinnedRoom,...patch},
    WORLD_PROFILE.branch);
  assert.equal(observed.currentRoomCrewRisk.status,'UNVERIFIED',label);
  assert.equal(observed.currentRoomCrewRisk.executionAuthority,false,label);
  assert.equal(observed.warnings.includes('PINNED_ROOM_CREW_ABSENT_RETAINED_STALL'),
    false,label);
}
assert.equal(assessWorldRuntime({...emptyPinnedRoom,room:{}},
  WORLD_PROFILE.branch).currentRoomCrewRisk.observedRoomCreepCount,null);
const noIntent=JSON.parse(stalledMemory.data);
noIntent.telemetryJournal.events=[];
const noIntentResult=assessWorldRuntime({...good,
  memory:{data:JSON.stringify(noIntent)}},WORLD_PROFILE.branch);
assert.equal(noIntentResult.recoveryConstructionRisk.status,'UNVERIFIED');
const futureIntent=JSON.parse(stalledMemory.data);
futureIntent.telemetryJournal.events[0].t=225;
const future=assessWorldRuntime({...good,
  memory:{data:JSON.stringify(futureIntent)}},WORLD_PROFILE.branch);
assert.equal(future.recoveryConstructionRisk.status,'UNVERIFIED',
  'a post-snapshot intent cannot prove earlier construction stall');
const confirmed=JSON.parse(stalledMemory.data);
confirmed.telemetryJournal.events.push({
  c:'R1_OWNED_SPAWN_REBUILD_CONFIRMED',t:190,
  x:{room:'W37S79',oldSpawnId:'old',newSpawnId:'new',confirmedTick:190}
});
const rebuilt=assessWorldRuntime({...good,
  memory:{data:JSON.stringify(confirmed)}},WORLD_PROFILE.branch);
assert.equal(rebuilt.recoveryConstructionRisk.status,'UNVERIFIED',
  'a later confirmed rebuild supersedes retained site-intent risk');
// A valid confirmation event may be newer than the latest retained snapshot.
// It cannot retroactively settle the earlier construction-stall observation.
const postSnapshotConfirmation=JSON.parse(stalledMemory.data);
postSnapshotConfirmation.telemetryJournal.events.push({
  c:'R1_OWNED_SPAWN_REBUILD_CONFIRMED',t:225,
  x:{room:'W37S79',oldSpawnId:'old',newSpawnId:'new',confirmedTick:225}
});
const postSnapshot=assessWorldRuntime({...good,
  memory:{data:JSON.stringify(postSnapshotConfirmation)}},WORLD_PROFILE.branch);
assert.equal(postSnapshot.recoveryConstructionRisk.status,'POTENTIAL_STALL',
  'a post-snapshot confirmation cannot suppress retained R1 stall risk');
assert.ok(postSnapshot.warnings.includes('RETAINED_RECOVERY_CONSTRUCTION_STALL_RISK'));
const sameTickConfirmation=JSON.parse(stalledMemory.data);
sameTickConfirmation.telemetryJournal.events.push({
  c:'R1_OWNED_SPAWN_REBUILD_CONFIRMED',t:200,
  x:{room:'W37S79',oldSpawnId:'old',newSpawnId:'new',confirmedTick:200}
});
const atSnapshot=assessWorldRuntime({...good,
  memory:{data:JSON.stringify(sameTickConfirmation)}},WORLD_PROFILE.branch);
assert.equal(atSnapshot.recoveryConstructionRisk.status,'UNVERIFIED',
  'a valid confirmation at the snapshot tick supersedes the earlier intent');
assert.equal(result.recoveryConstructionRisk.status,'UNVERIFIED');

console.log('W37S79 runtime diagnostics: PASS');
