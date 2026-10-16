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


// Even a PARTIAL shard-map must not bypass the total 30-room request cap,
// including when an additional unknown section (e.g. "sim") is present.
const overGlobal={ok:1,shards:{
 shard0:Array.from({length:16},(_,i)=>'W'+(i+1)+'S79'),
 shard1:Array.from({length:15},(_,i)=>'E'+(i+1)+'N1'),
 sim:['ignored']
}};
const rejected=summarizeUserRoomListing(overGlobal);
assert.equal(rejected.status,'UNVERIFIED');
assert.equal(rejected.reason,'USER_ROOMS_LIMIT_EXCEEDED');
assert.equal(rejected.returnedRooms.length,0,
 'unbounded partial lists must never reach API room GET fanout');
const duplicatePartial=summarizeUserRoomListing({ok:1,shards:{
 shard0:['W37S79','W37S79'],sim:[]}
});
assert.equal(duplicatePartial.status,'UNVERIFIED');
assert.equal(duplicatePartial.reason,'USER_ROOMS_DUPLICATES');


// The screeps.com /api/user/rooms result has a separate "sim" grouping.
// Only an explicitly EMPTY sim group can be safely ignored for complete
// World-shard coverage; a populated/unknown sim must not be silently dropped.
const worldWithEmptySim={ok:1,shards:{
 shard0:['W37S79'],shard1:[],shard2:[],shard3:[],sim:[]
}};
const completeWorld=summarizeUserRoomListing(worldWithEmptySim);
assert.equal(completeWorld.status,'EXPLICIT_USER_ROOMS_LIST');
assert.equal(completeWorld.listingComplete,true);
assert.equal(completeWorld.returnedRooms.length,1);
const shapeSim=summarizeRoomListingResponseShape(worldWithEmptySim);
assert.equal(shapeSim.shards.simGroup.explicitEmpty,true);
assert.equal(shapeSim.shards.simGroup.count,0);
assert.equal(shapeSim.shards.otherGroupKeyCount,0);
const verifiedComplete=await inspectWorldFootholds(
 mock({rooms:worldWithEmptySim}).api,{observeDelayMs:0});
assert.equal(verifiedComplete.status,'READONLY_LISTING_AND_ROOM_OBJECTS_VERIFIED');
assert.equal(verifiedComplete.userRoomCount,1);
assert.equal(verifiedComplete.allListedRoomsChecked,true);
assert.equal(verifiedComplete.worldStatusBefore,'lost');
assert.equal(verifiedComplete.operationalFootholdVerified,false);
assert.equal(verifiedComplete.noRecoverableFootholdVerified,false);
for(const nonemptySim of [['E1N1'],['secret'],{}]){
 const listing=summarizeUserRoomListing({ok:1,shards:{
  shard0:['W37S79'],sim:nonemptySim
 }});
 assert.equal(listing.status,'PARTIAL_USER_ROOMS_LIST');
 assert.equal(listing.listingComplete,false);
}
const unknownWorldGroup=summarizeUserRoomListing({ok:1,shards:{
 shard0:['W37S79'],sim:[],newUnknown:['E1N1']
}});
assert.equal(unknownWorldGroup.status,'PARTIAL_USER_ROOMS_LIST');
assert.equal(unknownWorldGroup.listingComplete,false);


const unknownExtraShape=summarizeRoomListingResponseShape({
 ok:1,shards:{shard0:['W37S79'],shard1:[],anonymousPrivateId:['W1N1']}
});
assert.equal(unknownExtraShape.shards.otherGroupKeyCount,1);
assert.deepEqual(unknownExtraShape.shards.otherGroupShapes,[{
 kind:'array',length:1,sampleItemKind:'string',sampleMatchesRoom:true
}]);
assert.ok(!JSON.stringify(unknownExtraShape).includes('anonymousPrivateId'));
assert.ok(!JSON.stringify(unknownExtraShape).includes('W1N1'));
const eventKinds=summarizeWorldRetainedMemory({data:JSON.stringify({
 deploymentId:'PRIVATE_ACCOUNT',
 telemetryJournal:{snapshots:[],events:[
  {c:'TOWER_ENGAGE',t:100,x:{creep:'PRIVATE_CREEP'}},
  {c:'SPAWN_OK',t:101,x:{name:'PRIVATE_NAME'}},
  {c:'PRIVATE_MESSAGE',t:102,x:{secret:'PRIVATE_DATA'}},
  {c:'TOWER_ENGAGE',t:102,x:{creep:'PRIVATE_CREEP'}}
 ]}
})});
assert.equal(eventKinds.recentRetainedEventCount,4);
assert.equal(eventKinds.recentRetainedEventTypes.TOWER_ENGAGE,2);
assert.equal(eventKinds.recentRetainedEventTypes.SPAWN_OK,1);
assert.equal(eventKinds.recentRetainedEventTypes.OTHER_OR_UNVERIFIED,1);
assert.ok(!JSON.stringify(eventKinds).includes('PRIVATE_'));
const boundedKinds=summarizeWorldRetainedMemory({data:JSON.stringify({
 deploymentId:'DEP',
 telemetryJournal:{snapshots:[],events:[
  {c:'SPAWN_OK',t:100,x:{}},
  {c:'SPAWN_OK',t:102,x:{}},
  {c:'TOWER_ENGAGE',t:150,x:{}}
 ]}
})});
assert.equal(boundedKinds.recentRetainedEventCount,1);
assert.equal(boundedKinds.recentRetainedEventTypes.TOWER_ENGAGE,1);
assert.equal(boundedKinds.recentRetainedEventTypes.SPAWN_OK,undefined);


// An unknown grouping key can be considered complete ONLY if it contains
// literally zero values. We do not need to reveal or trust its key to know
// there are no missing room locators inside an empty array.
const secretExtraEmpty={ok:1,shards:{
 shard0:['W37S79'],shard1:[],shard2:[],shard3:[],
 privateSecretGroup:[]
}};
const safeListing=summarizeUserRoomListing(secretExtraEmpty);
assert.equal(safeListing.status,'EXPLICIT_USER_ROOMS_LIST');
assert.equal(safeListing.listingComplete,true);
assert.equal(safeListing.returnedRooms.length,1);
const safeProbe=await inspectWorldFootholds(
 mock({rooms:secretExtraEmpty}).api,{observeDelayMs:0});
assert.equal(safeProbe.status,'READONLY_LISTING_AND_ROOM_OBJECTS_VERIFIED');
assert.equal(safeProbe.userRoomCount,1);
assert.equal(safeProbe.worldStatusBefore,'lost');
assert.equal(safeProbe.worldAccountOperational,false);
assert.equal(safeProbe.operationalFootholdVerified,false);
assert.equal(safeProbe.noRecoverableFootholdVerified,false);
assert.equal(safeProbe.respawnAuthorized,false);
assert.ok(!JSON.stringify(safeProbe).includes('privateSecretGroup'));
for(const dangerousExtra of [['W1N1'],{rooms:[]},'unverified',null]){
 const unsafeListing=summarizeUserRoomListing({ok:1,shards:{
  shard0:['W37S79'],privateSecretGroup:dangerousExtra
 }});
 assert.equal(unsafeListing.status,'PARTIAL_USER_ROOMS_LIST');
 assert.equal(unsafeListing.listingComplete,false);
}


// BOT_HEARTBEAT is emitted by production game/main.js inside Game.time loop
// with logger.info(...,{force:true,journal:true,dedupeTicks:0}). Decode only
// numeric room/creep/cpu/bucket figures, not raw event context.
const recentHeartbeat={
 data:JSON.stringify({
  deploymentId:'private-deployment-id',
  telemetryJournal:{
   snapshots:[{c:'STATUS_SNAPSHOT',t:500,x:{rooms:{}}}],
   events:[
    {c:'BOT_HEARTBEAT',t:525,x:{rooms:0,creeps:0,cpu:2.315,
      bucket:10000,name:'PRIVATE_OBJECT_ID'}},
    {c:'BOT_HEARTBEAT',t:530,x:{rooms:0,creeps:0,cpu:1.124,
      bucket:9990,name:'PRIVATE_OBJECT_ID'}},
    {c:'OTHER_PRIVATE_CODE',t:530,x:{creep:'PRIVATE_CREEP'}}
   ]
  }
 })
};
const hb=summarizeWorldRetainedMemory(recentHeartbeat);
assert.equal(hb.recentRetainedEventTypes.BOT_HEARTBEAT,2);
assert.equal(hb.recentRetainedEventTypes.OTHER_OR_UNVERIFIED,1);
assert.equal(hb.latestRetainedHeartbeat.tick,530);
assert.equal(hb.latestRetainedHeartbeat.roomCount,0);
assert.equal(hb.latestRetainedHeartbeat.creepCount,0);
assert.equal(hb.latestRetainedHeartbeat.cpuUsed,1.124);
assert.equal(hb.latestRetainedHeartbeat.bucket,9990);
assert.equal(hb.latestRetainedHeartbeat.sameServerResponseTickVerified,false);
assert.ok(!JSON.stringify(hb).includes('PRIVATE_'));
const fresh=compareWorldRetainedMemoryPairs(recentHeartbeat,
 recentHeartbeat,529,534);
assert.equal(fresh.executableBotHeartbeatRecentlyObserved,true);
assert.equal(fresh.latestHeartbeatAgeFromServerClock,4);
assert.equal(fresh.ownSpawnOperationalVerified,false);
assert.equal(fresh.gameCodeExecutingNowVerified,false);
const aged=compareWorldRetainedMemoryPairs(recentHeartbeat,
 recentHeartbeat,555,560);
assert.equal(aged.executableBotHeartbeatRecentlyObserved,false);
assert.equal(aged.latestHeartbeatAgeFromServerClock,30);
const missing=compareWorldRetainedMemoryPairs(worldMemory(100),
 worldMemory(105),100,110);
assert.equal(missing.executableBotHeartbeatRecentlyObserved,null);

console.log('World O22 GET-only cross-shard foothold safety regression PASS');
