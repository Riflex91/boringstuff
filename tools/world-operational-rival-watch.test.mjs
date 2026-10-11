import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessOperationalRivalRing,inspectOperationalRivalRisk}
  from './world-operational-rival-watch.mjs';
import {threatRingRooms} from './world-threat-ring.mjs';

const ring={
 target:{shard:'shard0',room:'W37N11'},mode:'GET_ONLY',
 requestedRooms:24,verifiedRooms:24,coverageComplete:true,
 foreignOwnedRooms:1,foreignReservedRooms:1,
 unverifiedRooms:[],
 observations:threatRingRooms().map(({room,distance})=>({
   room,distance,verified:true,
   foreignOwner:room==='W35N11',
   foreignReservation:room==='W35N13',
   controllerLevel:room==='W35N11'?8:0
 }))
};
const input={
 account:{_id:'my-account'},
 branches:{list:[{branch:'default'},{branch:'chatgpt',activeWorld:true}]},
 roomObjects:{objects:[
   {type:'spawn',name:'Spawn1',user:'my-account',x:12,y:13},
   {type:'controller',user:'my-account',level:2}
 ]},
 ring
};
const x=assessOperationalRivalRing(input);
assert.equal(x.status,'WATCH');
assert.equal(x.verifiedRooms,24);
assert.equal(x.ownedSpawnVerified,true);
assert.equal(x.foreignOwnedRooms,1);
assert.equal(x.foreignReservedRooms,1);
assert.equal(x.foreignControl.length,2);
assert.ok(x.warnings.includes('FOREIGN_RESERVED_ROOMS_PRESENT'));
assert.ok(x.warnings.includes('FOREIGN_RCL8_WITHIN_TWO_ROOMS'));
assert.equal(x.gameMutationsAttempted,false);
assert.equal(JSON.stringify(x).includes('my-account'),false,
 'Identifiers must not appear in exported reports');
{
 const v=structuredClone(input);
 v.ring.observations.find(o=>o.room==='W35N13').foreignReservation=false;
 v.ring.foreignReservedRooms=0;
 const r=assessOperationalRivalRing(v);
 assert.equal(r.status,'WATCH','Known RCL8 must remain visible as a warning');
 assert.equal(r.foreignReservedRooms,0);
}
{
 const v=structuredClone(input);
 v.ring.observations.find(o=>o.room==='W36N11').foreignOwner=true;
 v.ring.foreignOwnedRooms=2;
 assert.equal(assessOperationalRivalRing(v).status,'ALERT');
 assert.ok(assessOperationalRivalRing(v).alerts.includes(
   'FOREIGN_CONTROL_IN_IMMEDIATE_NEIGHBOR_RING'));
}
{
 const v=structuredClone(input);
 v.ring.observations.find(o=>o.room==='W35N13').foreignReservation=false;
 v.ring.observations.find(o=>o.room==='W36N11').foreignReservation=true;
 assert.equal(assessOperationalRivalRing(v).status,'ALERT',
   'True foreign reservation inside radius one must alert');
}
for(const transform of [
  v=>{v.ring.verifiedRooms=23;v.ring.unverifiedRooms=['W36N11'];},
  v=>{v.ring.observations[3].verified=false;},
  v=>{v.ring.target.room='W36N11';},
  v=>{v.ring.observations=v.ring.observations.slice(1);},
  v=>{v.ring.observations[3].foreignReservation=null;},
]){
 const v=structuredClone(input);transform(v);
 assert.equal(assessOperationalRivalRing(v).status,'INCOMPLETE');
}
for(const transform of [
  v=>{v.branches.list[1].activeWorld=false;},
  v=>{v.roomObjects.objects[0].x=13;},
  v=>{v.roomObjects.objects[0].user='enemy';},
  v=>{v.account=null;}
]){
 const v=structuredClone(input);transform(v);
 assert.equal(assessOperationalRivalRing(v).status,'FAIL');
}
{
 const v=structuredClone(input);
 v.ring.observations[3].distance=1;
 assert.equal(assessOperationalRivalRing(v).status,'INCOMPLETE',
   'A false neighbor radius must not pass');
}
{
 const v=structuredClone(input);
 v.ring.observations[3].room=v.ring.observations[4].room;
 assert.equal(assessOperationalRivalRing(v).status,'INCOMPLETE',
   'Duplicate neighbors must never count as 24 complete distinct GETs');
}
{
 const v=structuredClone(input);
 v.ring.foreignReservedRooms=0;
 assert.equal(assessOperationalRivalRing(v).status,'INCOMPLETE',
   'Ring aggregate must match actual observations');
}
const calls=[];
const objectsFor=room=>room==='W37N11'?input.roomObjects:
 room==='W35N11'?{objects:[{type:'controller',user:'enemy',level:8}]}:
 room==='W35N13'?{objects:[{type:'controller',reservation:{user:'enemy'}}]}:
 {objects:[{type:'controller',level:0}]};
const api={defaultShard:'shard0',
 async authMe(){calls.push('GET_AUTH');return input.account;},
 async userBranches(){calls.push('GET_BRANCHES');return input.branches;},
 async gameRoomObjects(room,shard){
   calls.push('GET_OBJECTS');assert.equal(shard,'shard0');
   return {...objectsFor(room),users:{}};
 },
 async gameRoomStatus(room,shard){
   calls.push('GET_STATUS');assert.equal(shard,'shard0');
   return {room:{status:room.endsWith('N9')?'out of borders':'normal'}};
 }};
const result=await inspectOperationalRivalRisk(api);
assert.equal(result.ownedSpawnVerified,true);
assert.equal(result.verifiedRooms,24);
assert.ok(['PASS','WATCH','ALERT'].includes(result.status),JSON.stringify(result));
assert.ok(calls.length>=50);
assert.ok(calls.every(c=>c.startsWith('GET')),
 'GET-only watcher must never call POSTs');
await assert.rejects(()=>inspectOperationalRivalRisk(
 {...api,defaultShard:'shard1'}),/WRONG_SHARD/);
const code=fs.readFileSync(path.join(
 path.dirname(fileURLToPath(import.meta.url)),
 'world-operational-rival-watch.mjs'),'utf8');
for(const forbidden of [
 /\.userSetActiveBranch\s*\(/,
 /\.gamePlaceSpawn\s*\(/,
 /\.userSetCode\s*\(/,
 /\._request\s*\(\s*['"]POST['"]/
])assert.equal(forbidden.test(code),false);
console.log('World operational 24-room rival watch: GET-only, known RCL8 and new foreign reservation: PASS');
