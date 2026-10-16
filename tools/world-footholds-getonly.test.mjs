import assert from 'node:assert/strict';
import { summarizeUserRoomListing, summarizeCandidateRoom,
  summarizeRoomListingResponseShape, inspectWorldFootholds } from './world-footholds-getonly.mjs';

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
const valid=await inspectWorldFootholds(ok.api);
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
 'GET room shard0:W37S79','GET room shard1:E8N1','GET status'
]);
assert.ok(!JSON.stringify(valid).includes('private-'));
const changed=await inspectWorldFootholds(
 mock({last:'normal'}).api);
assert.equal(changed.status,'UNVERIFIED');
assert.equal(changed.accountStatusStable,false);
const missingList=await inspectWorldFootholds(
 mock({failedList:true}).api);
assert.equal(missingList.status,'UNVERIFIED');
assert.equal(missingList.userRoomCount,null);
assert.equal(missingList.userRoomsReason,'USER_ROOMS_GET_FAILED');
const missingObjects=await inspectWorldFootholds(
 mock({failedRoom:true}).api);
assert.equal(missingObjects.status,'UNVERIFIED');
assert.equal(missingObjects.allListedRoomsChecked,false);
assert.equal(missingObjects.roomsWithOwnSpawn,null);
const explicitEmpty=await inspectWorldFootholds(
 mock({rooms:{ok:1,rooms:[]}}).api);
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

console.log('World O22 GET-only cross-shard foothold safety regression PASS');
