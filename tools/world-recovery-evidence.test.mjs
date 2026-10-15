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
    }},{c:'STATUS_SNAPSHOT',t:300,x:{}}]
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
