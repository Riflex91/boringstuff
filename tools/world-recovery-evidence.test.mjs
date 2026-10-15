import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {inspectWorldRecoveryEvidence} from './world-recovery-evidence.mjs';
import {assessWorldRuntime,inspectWorldRuntime} from './world-next-runtime-diagnostics.mjs';

const original={deploymentId:'exact-deployment-123',
  telemetryJournal:{
    events:[
      {c:'R1_OWNED_SPAWN_REBUILD_SITE_INTENT',t:100,
        x:{room:'W37S79',siteIntentAccepted:true}},
      {c:'R2_SPAWNLESS_WORKER_DISPATCH',t:125,
        x:{from:'W37S79',to:'W37S78',assigned:true}},
      {c:'R1_OWNED_SPAWN_REBUILD_CONFIRMED',t:200,
        x:{room:'W37S78',oldSpawnId:'old',newSpawnId:'new',
          confirmedTick:200}},
      // A fabricated completion lacking a NEW physical Spawn ID is dropped.
      {c:'R1_OWNED_SPAWN_REBUILD_CONFIRMED',t:201,
        x:{room:'W37S78',oldSpawnId:'old',newSpawnId:'old',
          confirmedTick:201}},
      {c:'R1_OWNED_SPAWN_REBUILD_SITE_INTENT',t:202,
        x:{room:'W37S79',siteIntentAccepted:false}}
    ],
    snapshots:[{c:'STATUS_SNAPSHOT',t:200,x:{
      spawnlessWorkerRescue:{last:{status:'COMPLETED'}}
    }},{c:'STATUS_SNAPSHOT',t:300,x:{
      gcl:{level:1,progress:123456,progressTotal:1000000},
      rooms:{W37S79:{
        rcl:4,controllerProgress:180520,controllerProgressTotal:405000,
        energyAvailable:780,energyCapacity:1100,energyStored:2500,
        creeps:{harvester:2,hauler:1,upgrader:1},
        health:{status:'WATCH',overallScore:79,
          reasons:['HAULING_DEFICIT','CONTROLLER_STALLED']},
        economyModel:{haulerCarryDeficit:2,harvesterWorkDeficit:0}
      }},
      expansionReadiness:{
        ownedRooms:1,availableClaimSlots:0,status:'AT_CAPACITY',
        reasons:['NO_AVAILABLE_CLAIM_SLOT']
      },
      expansionCandidates:{status:'HOLD',
        reason:'EXPANSION_BUDGET_NOT_READY',candidateCount:0},
      expansionOperation:{phase:'NO_ACTIVE_SITE'},
      expansionClaimLaunch:{status:'HOLD',
        reason:'GCL_OR_EXISTING_CLAIMER_COMMITMENT'},
      expansionBootstrapRecoveryResult:{status:'HOLD',
        reason:'NO_VERIFIED_BLOCKED_BOOTSTRAP'}
    }}]
  },
  ownedSpawnRecovery:{schemaVersion:1,rooms:{
    W37S79:{lastSpawnId:'owned-1',pos:{roomName:'W37S79'}},
    W37S78:{lastSpawnId:'owned-2',pos:{roomName:'W37S78'}}
  }},
  spawnlessWorkerRescueLedger:{schemaVersion:1,active:null,history:[
    {status:'COMPLETED',home:'W37S79',target:'W37S78',
      assignedTick:125,arrivedTick:150,lastObservedTick:200,
      completedTick:200,oldSpawnId:'old'}
  ]}
};
const wrapped={data:JSON.stringify(original)};
const evidence=inspectWorldRecoveryEvidence(wrapped);
assert.equal(evidence.availability,'OBSERVED_IN_BOT_MEMORY');
assert.equal(evidence.observationScope,
  'RETAINED_EVENTS_AND_BOUNDED_MISSION_HISTORY_ONLY');
assert.equal(evidence.observedEventCount,3);
assert.deepEqual(evidence.events.map(e=>e.code),[
  'R1_OWNED_SPAWN_REBUILD_SITE_INTENT',
  'R2_SPAWNLESS_WORKER_DISPATCH',
  'R1_OWNED_SPAWN_REBUILD_CONFIRMED'
]);
assert.equal(evidence.rescue.last.status,'COMPLETED');
assert.equal(evidence.rescue.last.completedTick,200);
assert.equal(evidence.rescue.active,null);
assert.equal(evidence.witnessedSpawnRoomCount,2);
assert.equal(evidence.latestSnapshotTick,300);
assert.equal(evidence.expansion.source,
  'LIVE_STATUS_SNAPSHOT_NOT_CLAIM_AUTHORITY');
assert.equal(evidence.expansion.tick,300);
assert.equal(evidence.expansion.gclLevel,1);
assert.equal(evidence.expansion.gclProgress,123456);
assert.equal(evidence.expansion.gclProgressTotal,1000000);
assert.equal(evidence.expansion.home.room,'W37S79');
assert.equal(evidence.expansion.home.rcl,4);
assert.equal(evidence.expansion.home.healthStatus,'WATCH');
assert.equal(evidence.expansion.home.healthScore,79);
assert.deepEqual(evidence.expansion.home.healthReasons,
  ['HAULING_DEFICIT','CONTROLLER_STALLED']);
assert.equal(evidence.expansion.home.haulingDeficit,2);
assert.equal(evidence.expansion.home.harvesterCount,2);
assert.equal(evidence.expansion.home.haulerCount,1);
assert.equal(evidence.expansion.home.upgraderCount,1);
assert.equal(evidence.expansion.home.energyAvailable,780);
assert.equal(evidence.expansion.home.energyCapacity,1100);
assert.equal(evidence.expansion.home.energyStored,2500);
assert.equal(evidence.expansion.home.controllerProgressTotal,405000);

assert.equal(evidence.expansion.ownedRooms,1);
assert.equal(evidence.expansion.availableClaimSlots,0);
assert.equal(evidence.expansion.readinessStatus,'AT_CAPACITY');
assert.deepEqual(evidence.expansion.readinessReasons,
  ['NO_AVAILABLE_CLAIM_SLOT']);
assert.equal(evidence.expansion.candidateCount,0);
assert.equal(evidence.expansion.candidatesReason,'EXPANSION_BUDGET_NOT_READY');
assert.equal(evidence.expansion.launchReason,
  'GCL_OR_EXISTING_CLAIMER_COMMITMENT');
assert.equal(evidence.expansion.bootstrapRecoveryReason,
  'NO_VERIFIED_BLOCKED_BOOTSTRAP');

assert.ok(!JSON.stringify(evidence).includes('exact-deployment-123'),
  'do not expose user memory contents or deployment identifiers');
const compressed={data:'gz:'+gzipSync(
  JSON.stringify(original)).toString('base64')};
assert.equal(inspectWorldRecoveryEvidence(compressed).observedEventCount,3,
  'Screeps gzip-compressed reply is the common server representation');
const invalid=[null,{},'not-json',{data:'gz:not-base64'},
  {data:JSON.stringify({telemetryJournal:{events:[]}})}];
for(const value of invalid) {
  const v=inspectWorldRecoveryEvidence(value);
  assert.equal(v.availability,'UNKNOWN');
  assert.equal(v.observedEventCount,null,
    'unreadable memory cannot be interpreted as zero incidents');
}
const empty=inspectWorldRecoveryEvidence({data:JSON.stringify({
  deploymentId:'exact-deployment-123',
  telemetryJournal:{events:[],snapshots:[]}
})});
assert.equal(empty.observedEventCount,0);
assert.equal(empty.rescue,null);
assert.equal(empty.latestSnapshotTick,null);
assert.equal(empty.expansion,null,
  'no STATUS_SNAPSHOT does not equal absent expansion intent');
const invalidStatus=structuredClone(original);
invalidStatus.telemetryJournal.snapshots[1].x.expansionReadiness.reasons=[
  'NORMAL_REASON', '<script>bad</script>',
  'VERY_LONG_'+ 'X'.repeat(300)
];
invalidStatus.telemetryJournal.snapshots[1].x.expansionClaimLaunch.reason=
  '<hostile arbitrary text>';
const sanitized=inspectWorldRecoveryEvidence({
  data:JSON.stringify(invalidStatus)
});
assert.deepEqual(sanitized.expansion.readinessReasons,['NORMAL_REASON'],
  'untrusted long or dangerous text is never printed as live diagnostics');
assert.equal(sanitized.expansion.launchReason,null);
const unsafeHome=structuredClone(original);
unsafeHome.telemetryJournal.snapshots[1].x.rooms.W37S79.health.reasons=[
  'HAULING_DEFICIT','<invalid-script>','X'.repeat(400)
];
unsafeHome.telemetryJournal.snapshots[1].x.rooms.W37S79.health.status=
  'NONSENSE';
unsafeHome.telemetryJournal.snapshots[1].x.rooms.W37S79.health.overallScore=999;
unsafeHome.telemetryJournal.snapshots[1].x.rooms.W37S79.economyModel.haulerCarryDeficit='many';
const filteredHome=inspectWorldRecoveryEvidence({
  data:JSON.stringify(unsafeHome)
}).expansion.home;
assert.equal(filteredHome.healthStatus,null);
assert.equal(filteredHome.healthScore,null);
assert.deepEqual(filteredHome.healthReasons,['HAULING_DEFICIT']);
assert.equal(filteredHome.haulingDeficit,null,
  'missing numeric evidence cannot become an invented zero');
const unknownRoom=structuredClone(original);
delete unknownRoom.telemetryJournal.snapshots[1].x.rooms.W37S79;
assert.equal(inspectWorldRecoveryEvidence({
  data:JSON.stringify(unknownRoom)
}).expansion.home,null,'missing own room is UNKNOWN');
const delayed=structuredClone(original);
delayed.telemetryJournal.snapshots[1].x={};
const absent=inspectWorldRecoveryEvidence({data:JSON.stringify(delayed)});
assert.equal(absent.expansion,null,
  'a newer snapshot without readiness never inherits stale old claim reasons');
const bounded=structuredClone(original);
bounded.spawnlessWorkerRescueLedger.history.push(
  ...Array.from({length:7},()=>({status:'LOST'})));
const oversized=inspectWorldRecoveryEvidence({data:JSON.stringify(bounded)});
assert.equal(oversized.rescue.retainedReceiptCount,null,
  'overlong mission history is NOT treated as trusted evidence');
assert.equal(oversized.rescue.last,null);

const realRoom={objects:[
  {type:'spawn',user:'me',name:'Spawn1',x:37,y:26},
  {type:'creep',user:'me'}, {type:'controller',level:4,progress:300}
]};
const results=assessWorldRuntime({
  me:{_id:'me'},
  branches:{list:[{branch:'chatgpt-w37s79-stage',activeWorld:true}]},
  status:{status:'normal'},room:realRoom,memory:wrapped
});
assert.equal(results.ok,true);
assert.equal(results.memoryAvailable,true);
assert.equal(results.recoveryEvidence.rescue.last.status,'COMPLETED');
let writes=0,reads=0,pathUsed=null,shardUsed=null;
const api={
  defaultShard:'shard0',
  authMe:async()=>({_id:'me'}),
  userBranches:async()=>({list:[{branch:'chatgpt-w37s79-stage',
    activeWorld:true}]}),
  userWorldStatus:async()=>({status:'normal'}),
  gameRoomObjects:async()=>realRoom,
  userMemory:async(path,shard)=>{
    reads++;pathUsed=path;shardUsed=shard;return wrapped;
  },
  setMemory:()=>{writes++;throw Error('read-only violated');},
  createConstructionSite:()=>{writes++;throw Error('read-only violated');}
};
const live=await inspectWorldRuntime(api);
assert.equal(live.ok,true);
assert.equal(reads,1);
assert.equal(pathUsed,'bot','only the precisely relevant Memory.bot subtree');
assert.equal(shardUsed,'shard0');
assert.equal(writes,0);
assert.equal(live.recoveryEvidence.events.length,3);
console.log('R5 GET-only real bot journal and mission receipts / missing provenance UNKNOWN PASS');
