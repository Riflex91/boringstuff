import assert from 'node:assert/strict';
import { summarizeUserRoomListing, summarizeCandidateRoom,
  summarizeRoomListingResponseShape, inspectWorldFootholds,
  compareWorldRoomGetPairs, summarizeWorldRetainedMemory,
  compareWorldRetainedMemoryPairs } from './world-footholds-getonly.mjs';

const p={ok:1,rooms:{shard0:['W37S79'],shard1:['E8N1']}};
assert.deepEqual(summarizeUserRoomListing(p).returnedRooms,[
  {room:'W37S79',shard:'shard0'},{room:'E8N1',shard:'shard1'}
]);
assert.equal(summarizeUserRoomListing({ok:1,rooms:[]}).listingComplete,true);
assert.equal(summarizeUserRoomListing({ok:1,rooms:{}}).status,'UNVERIFIED');
assert.equal(summarizeUserRoomListing({ok:1}).status,'UNVERIFIED');
assert.equal(summarizeUserRoomListing({ok:false,rooms:[]}).status,'UNVERIFIED');
assert.equal(summarizeUserRoomListing({ok:1,rooms:[
  {room:'W37S79',shard:'shard0'}
]}).listingComplete,true);
assert.equal(summarizeUserRoomListing({ok:1,rooms:{shard0:[
  'W37S79','W37S79'
]}}).status,'UNVERIFIED');
assert.equal(summarizeUserRoomListing({ok:1,rooms:[
  '<script>alert(1)</script>'
]}).status,'UNVERIFIED');
assert.equal(summarizeUserRoomListing({ok:1,rooms:{
  'weird-shard':['W37S79']
}}).status,'UNVERIFIED');
assert.equal(summarizeUserRoomListing({ok:1,rooms:
  Array(31).fill('W37S79')}).listingComplete,false);

const location={room:'W37S79',shard:'shard0'};
const owned=summarizeCandidateRoom({objects:[
  {type:'controller',user:'private-account',level:4},
  {type:'spawn',user:'private-account',name:'private-spawn'},
  {type:'creep',user:'private-account',name:'private-creep'},
  {type:'creep',user:'enemy',name:'private-enemy'}
]},'private-account',location);
assert.equal(owned.status,'ROOM_OBJECTS_OBSERVED');
assert.equal(owned.verifiedOwnController,true);
assert.equal(owned.verifiedOwnSpawn,true);
assert.equal(owned.ownCreepsObserved,1);
assert.ok(!JSON.stringify(owned).includes('private-'));
assert.equal(summarizeCandidateRoom({objects:null},
  'private-account',location).status,'UNVERIFIED');

function mock({rooms=p,first='lost',last='lost',failedRoom=false,
 failedList=false}={}) {
 const calls=[];
 const api={
  async authMe(){calls.push('GET auth');return {_id:'private-account'}},
  async userWorldStatus(){calls.push('GET status');return {
    status:calls.filter(x=>x==='GET status').length===1?first:last
  }},
  async userRooms(id){calls.push('GET user rooms');
    assert.equal(id,'private-account');
    if(failedList)throw Error('no user rooms');
    return rooms;
  },
  async gameRoomObjects(room,shard) {
    calls.push('GET room '+shard+':'+room);
    if(failedRoom)throw Error('no objects');
    return {objects:[
      {type:'controller',user:'private-account',level:4},
      {type:'spawn',name:'private-spawn',user:'private-account'}
    ]};
  },
  async _request(){throw Error('Unexpected HTTP mutation or raw request')}
 };
 return {api,calls};
}
const ok=mock();
const valid=await inspectWorldFootholds(ok.api,{observeDelayMs:0});
assert.equal(valid.status,'READONLY_LISTING_AND_ROOM_OBJECTS_VERIFIED');
assert.equal(valid.worldStatusBefore,'lost');
assert.equal(valid.worldStatusAfter,'lost');
assert.equal(valid.userRoomCount,2);
assert.equal(valid.roomsWithOwnController,2);
assert.equal(valid.roomsWithOwnSpawn,2);
assert.equal(valid.operationalFootholdVerified,false);
assert.equal(valid.noRecoverableFootholdVerified,false);
assert.equal(valid.apiMutationsAttempted,0);
assert.equal(valid.respawnAuthorized,false);
assert.deepEqual(ok.calls,[
 'GET auth','GET status','GET user rooms',
 'GET room shard0:W37S79','GET room shard1:E8N1',
 'GET room shard0:W37S79','GET room shard1:E8N1','GET status'
]);
assert.ok(!JSON.stringify(valid).includes('private-'));
const changed=await inspectWorldFootholds(
 mock({last:'normal'}).api,{observeDelayMs:0});
assert.equal(changed.status,'UNVERIFIED');
assert.equal(changed.accountStatusStable,false);
const missingList=await inspectWorldFootholds(
 mock({failedList:true}).api,{observeDelayMs:0});
assert.equal(missingList.status,'UNVERIFIED');
assert.equal(missingList.userRoomCount,null);
assert.equal(missingList.userRoomsReason,'USER_ROOMS_GET_FAILED');
const missingObjects=await inspectWorldFootholds(
 mock({failedRoom:true}).api,{observeDelayMs:0});
assert.equal(missingObjects.status,'UNVERIFIED');
assert.equal(missingObjects.allListedRoomsChecked,false);
assert.equal(missingObjects.roomsWithOwnSpawn,null);
const explicitEmpty=await inspectWorldFootholds(
 mock({rooms:{ok:1,rooms:[]}}).api,{observeDelayMs:0});
assert.equal(explicitEmpty.userRoomCount,0);
assert.equal(explicitEmpty.noRecoverableFootholdVerified,false);
assert.equal(explicitEmpty.operationalFootholdVerified,false);

const schema=summarizeRoomListingResponseShape({
  ok:1,rooms:{shard0:{rooms:['W37S79'],secret:'hidden-room-value'}},
  privateAccountId:'private-account',token:'private-token'
});
assert.deepEqual(schema.knownTopFields,['ok','rooms']);
assert.equal(schema.rooms.kind,'object');
assert.deepEqual(schema.rooms.shardKeys,['shard0']);
assert.equal(schema.rooms.firstShardValueKind,'object');
assert.deepEqual(schema.rooms.firstShardKnownFields,['rooms']);
assert.ok(!JSON.stringify(schema).includes('private'),
  'schema probe must not expose user data or raw list values');


const partialListing=summarizeUserRoomListing({ok:1,shards:{
 shard0:['W37S79'],shard1:[],shard2:[],shard3:[],sim:['sim']
}});
assert.equal(partialListing.status,'PARTIAL_USER_ROOMS_LIST');
assert.equal(partialListing.listingComplete,false);
assert.deepEqual(partialListing.returnedRooms,[{room:'W37S79',shard:'shard0'}]);
const observedPartial=await inspectWorldFootholds(mock({
  rooms:{ok:1,shards:{shard0:['W37S79'],sim:['untrusted']}}
}).api,{observeDelayMs:0});
assert.equal(observedPartial.status,'UNVERIFIED');
assert.equal(observedPartial.recognizedShardRoomCount,1);
assert.equal(observedPartial.userRoomCount,null);
assert.equal(observedPartial.sampledRooms.length,1);
assert.equal(observedPartial.sampledRooms[0].verifiedOwnSpawn,true);
assert.equal(observedPartial.noRecoverableFootholdVerified,false);


const sameRoom={objects:[
 {type:'controller',id:'private-controller',user:'private-account',level:4},
 {type:'spawn',id:'private-spawn',user:'private-account',energy:1000}
]};
const paired=compareWorldRoomGetPairs(sameRoom,
 structuredClone(sameRoom),'private-account',location);
assert.equal(paired.status,'TWO_ROOM_OBJECT_GETS_OBSERVED');
assert.equal(paired.ownSpawnObservedBoth,true);
assert.equal(paired.ownControllerObservedBoth,true);
assert.equal(paired.sameSpawnIdVerified,true);
assert.equal(paired.sameControllerIdVerified,true);
assert.equal(paired.controllerDowngradeTicksDelta,null,
  'missing decay field remains unknown, not zero');
assert.equal(paired.spawnEnergyDelta,0,
  'same validated energy is a net observation, not a functionality claim');
assert.equal(paired.liveOperationalSpawnVerified,false);
assert.equal(paired.gameTickAlignedWithRoomObjects,false);
assert.ok(!JSON.stringify(paired).includes('private-'));
const changedRoom={objects:[
 {type:'controller',id:'private-controller',user:'private-account',level:4},
 {type:'spawn',id:'second-spawn',user:'private-account',energy:1000}
]};
const changedRoomPair=compareWorldRoomGetPairs(sameRoom,changedRoom,
 'private-account',location);
assert.equal(changedRoomPair.sameSpawnIdVerified,false);
assert.equal(changedRoomPair.sameControllerIdVerified,true);
assert.equal(compareWorldRoomGetPairs(sameRoom,null,
 'private-account',location).status,'UNVERIFIED');


// The memory endpoint may contain gz: JSON, but only public bounded tick
// summaries are emitted. No raw Memory or deployment IDs may be logged.
const worldMemory=t=>({data:JSON.stringify({
  deploymentId:'PRIVATE_WORLD_DEPLOYMENT',
  telemetryJournal:{
    snapshots:[{c:'STATUS_SNAPSHOT',t:t-10,x:{
      rooms:{W37S79:{health:{status:'CRITICAL'}}}
    }}],
    events:[{c:'TOWER_ENGAGE',t,x:{creep:'PRIVATE_CREEP_ID'}}]
  }
})});
const oldMemory=worldMemory(78345200);
const newMemory=worldMemory(78345205);
const progress=compareWorldRetainedMemoryPairs(
 oldMemory,newMemory,78345202,78345208);
assert.equal(progress.status,'TWO_RETAINED_MEMORY_GETS_OBSERVED');
assert.equal(progress.retainedJournalTickDelta,5);
assert.equal(progress.retainedJournalAdvanced,true);
assert.equal(progress.approximateRetainedLagAtFirstGet,2);
assert.equal(progress.approximateRetainedLagAtSecondGet,3);
assert.equal(progress.getResponsesSameServerTickVerified,false);
assert.equal(progress.gameCodeExecutingNowVerified,false);
assert.equal(progress.ownSpawnOperationalVerified,false);
assert.equal(progress.firstSnapshotTick,78345190);
assert.equal(summarizeWorldRetainedMemory(oldMemory).storedDeploymentIdKnown,
 true);
assert.ok(!JSON.stringify(progress).includes('PRIVATE_'));
const identical=compareWorldRetainedMemoryPairs(
 oldMemory,oldMemory,78345202,78345208);
assert.equal(identical.retainedJournalTickDelta,0);
assert.equal(identical.retainedJournalAdvanced,false);
assert.equal(identical.gameCodeExecutingNowVerified,false,
 'absence of new retained events is NOT proof the bot stopped');
const backward=compareWorldRetainedMemoryPairs(
 newMemory,oldMemory,78345205,78345208);
assert.equal(backward.retainedJournalTickDelta,null,
 'retained journal rollback must not be treated as time progress');
assert.equal(backward.retainedJournalAdvanced,null);
const malformed=compareWorldRetainedMemoryPairs(
 {data:JSON.stringify({deploymentId:'PRIVATE',telemetryJournal:{
  events:[{c:'BAD',t:-1}],snapshots:[]
 }})},newMemory,100,110);
assert.equal(malformed.status,'UNVERIFIED');
assert.equal(malformed.retainedJournalAdvanced,null);
const unavailable=compareWorldRetainedMemoryPairs(null,null,100,110);
assert.equal(unavailable.status,'UNVERIFIED');
assert.equal(unavailable.approximateRetainedLagAtFirstGet,null);

// Read-only integration checks both separate Memory.bot GETs and independent
// shard game time. World lost remains a hard operational veto.
const memoryCalls=[];
const memoryProbe={
 async authMe(){return {_id:'private-account'};},
 async userWorldStatus(){return {status:'lost'};},
 async userRooms(){return {ok:1,rooms:[]};},
 async gameRoomObjects(){throw Error('no rooms must be requested');},
 async userMemory(path,shard) {
  memoryCalls.push([path,shard]);
  return memoryCalls.length===1?oldMemory:newMemory;
 },
 async _request(method,endpoint) {
  assert.equal(method,'GET');
  assert.equal(endpoint,'/api/game/time');
  this.clock=(this.clock||0)+1;
  return {time:this.clock===1?78345202:78345208};
 }
};
const observedMemory=await inspectWorldFootholds(memoryProbe,{observeDelayMs:0});
assert.equal(observedMemory.worldStatusBefore,'lost');
assert.equal(observedMemory.retainedBotMemoryProgress.retainedJournalAdvanced,true);
assert.deepEqual(memoryCalls,[['bot','shard0'],['bot','shard0']]);
assert.equal(observedMemory.apiMutationsAttempted,0);
assert.equal(observedMemory.respawnAuthorized,false);


// Two fully identified API object pairs allow bounded field deltas only;
// neither decay nor energy delta authorizes operation or destructive reset.
const changingRoom1={objects:[
 {type:'controller',id:'private-controller',user:'private-account',
  level:4,ticksToDowngrade:12345},
 {type:'spawn',id:'private-spawn',user:'private-account',
  energy:250,hits:5000}
]};
const changingRoom2={objects:[
 {type:'controller',id:'private-controller',user:'private-account',
  level:4,ticksToDowngrade:12340},
 {type:'spawn',id:'private-spawn',user:'private-account',
  energy:245,hits:4985}
]};
const delta=compareWorldRoomGetPairs(changingRoom1,changingRoom2,
 'private-account',location);
assert.equal(delta.sameSpawnIdVerified,true);
assert.equal(delta.sameControllerIdVerified,true);
assert.equal(delta.controllerDowngradeTicksDelta,-5);
assert.equal(delta.spawnEnergyDelta,-5);
assert.equal(delta.spawnHitsDelta,-15);
assert.equal(delta.liveOperationalSpawnVerified,false);
assert.ok(!JSON.stringify(delta).includes('private-'));
const unavailableEnergy=compareWorldRoomGetPairs(changingRoom1,
 {objects:[
  {type:'controller',id:'private-controller',user:'private-account',
   level:4,ticksToDowngrade:12340},
  {type:'spawn',id:'private-spawn',user:'private-account',energy:'245'}
 ]},'private-account',location);
assert.equal(unavailableEnergy.spawnEnergyDelta,null,
  'string energy is UNKNOWN, never numeric conversion to valid ammo');
const idChanged=compareWorldRoomGetPairs(changingRoom1,
 {objects:[
  {type:'controller',id:'new-ctrl',user:'private-account',level:4,
   ticksToDowngrade:12340},
  {type:'spawn',id:'new-spawn',user:'private-account',energy:240}
 ]},'private-account',location);
assert.equal(idChanged.controllerDowngradeTicksDelta,null);
assert.equal(idChanged.spawnEnergyDelta,null);

console.log('World O22 GET-only cross-shard foothold safety regression PASS');
