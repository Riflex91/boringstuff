import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_TARGET } from './world-target-selection.mjs';
import { threatRingRooms,inspectThreatRing,threatRiskExitCode } from './world-threat-ring.mjs';

const actual=threatRingRooms();
assert.equal(actual.length,24);
assert.equal(new Set(actual.map(x=>x.room)).size,24);
assert.ok(actual.some(x=>x.room==='W35N11' && x.distance===2));
assert.ok(actual.some(x=>x.room==='W36N13' && x.distance===2));
assert.equal(actual.some(x=>x.room===WORLD_TARGET.room),false);
assert.equal(actual.filter(x=>x.distance===1).length,8);
assert.equal(actual.filter(x=>x.distance===2).length,16);
assert.equal(threatRingRooms().every(x=>/^W(?:3[5-9])N(?:9|1[0-3])$/.test(x.room)),true);
assert.throws(()=>threatRingRooms({...WORLD_TARGET,room:'E1S1'}),/read-only|pinned/);

const plain=(owner=null,reservation=null,level=0)=>({
  objects:[
    {type:'controller',level,...(owner?{user:owner}:{}) ,
      ...(reservation?{reservation:{user:reservation}}:{})}
  ],
  users:{}
});
function mocked({
  unavailable=[], ownedRooms=['W35N11'],
  reservedRooms=['W36N13'], noControllerRooms=[]
}={}) {
  const calls=[];
  const api={defaultShard:'shard0',
    async gameRoomStatus(room,shard) {
      calls.push({method:'GET',kind:'status',room,shard});
      assert.equal(shard,'shard0');
      if(unavailable.includes(room))throw new Error('private api error');
      return {room:{status:'normal'}};
    },
    async gameRoomObjects(room,shard) {
      calls.push({method:'GET',kind:'objects',room,shard});
      assert.equal(shard,'shard0');
      if(unavailable.includes(room))throw new Error('private api error');
      if(noControllerRooms.includes(room))return {objects:[],users:{}};
      return ownedRooms.includes(room)?plain('enemy',null,8):
        reservedRooms.includes(room)?plain(null,'enemy',0):
        plain();
    }
  };
  return {api,calls};
}
{
  const f=mocked();
  const r=await inspectThreatRing(f.api,'me');
  assert.equal(r.mode,'GET_ONLY');
  assert.equal(r.verifiedRooms,24);
  assert.equal(r.coverageComplete,true);
  assert.deepEqual(r.unverifiedRooms,[]);
  assert.equal(r.foreignOwnedRooms,1);
  assert.equal(r.foreignReservedRooms,1);
  assert.equal(r.risk,'NEARBY_FOREIGN_RCL8');
  assert.deepEqual(r.nearbyRcl8ForeignOwned,['W35N11']);
  assert.equal(r.readyForPlacement,false);
  assert.equal(r.placementAttempted,false);
  assert.equal(r.branchActivationAttempted,false);
  assert.ok(f.calls.every(c=>c.method==='GET'));
  assert.equal(f.calls.length,48,'Exactly two GETs per room');
  assert.ok(r.observations.every(x=>x.verified));
  assert.equal(JSON.stringify(r).includes('enemy'),false,
    'Never disclose rival user ids or usernames');
}
{
  const f=mocked({unavailable:['W36N13'],ownedRooms:[],reservedRooms:[]});
  const r=await inspectThreatRing(f.api,'me');
  assert.equal(r.coverageComplete,false);
  assert.equal(r.verifiedRooms,23);
  assert.deepEqual(r.unverifiedRooms,['W36N13']);
  assert.equal(r.risk,'INCOMPLETE_THREAT_EVIDENCE');
  assert.equal(JSON.stringify(r).includes('private api error'),false);
}
{
  const f=mocked({ownedRooms:[],reservedRooms:[],noControllerRooms:['W35N11']});
  const r=await inspectThreatRing(f.api,'me');
  assert.equal(r.foreignOwnedRooms,0);
  assert.equal(r.foreignReservedRooms,0);
  assert.equal(r.risk,'NO_FOREIGN_CONTROL_IN_SAMPLED_RING');
  assert.equal(r.operatorRiskAccepted,false);
  assert.equal(r.readyForPlacement,false);
}
{
  const f=mocked({ownedRooms:[],reservedRooms:['W36N13']});
  const r=await inspectThreatRing(f.api,'me');
  assert.equal(r.risk,'NEARBY_FOREIGN_CONTROL');
}
{
  const f=mocked({ownedRooms:['W35N11'],reservedRooms:[]});
  const r=await inspectThreatRing(f.api,'enemy');
  assert.equal(r.foreignOwnedRooms,0,
    'Own controller must not be classified as foreign');
}
{
  const f=mocked();
  f.api.defaultShard='shard2';
  await assert.rejects(()=>inspectThreatRing(f.api,'me'),/shard-pinned/);
}
{
  const f=mocked();
  await assert.rejects(()=>inspectThreatRing(f.api,''),/authenticated/);
}
assert.equal(threatRiskExitCode({
  fixedTargetSitePassed:true,exactInactiveCode:true,
  ring:{coverageComplete:true}
}),0);
for (const denied of [
  {fixedTargetSitePassed:false,exactInactiveCode:true,ring:{coverageComplete:true}},
  {fixedTargetSitePassed:true,exactInactiveCode:false,ring:{coverageComplete:true}},
  {fixedTargetSitePassed:true,exactInactiveCode:true,ring:{coverageComplete:false}},
  {fixedTargetSitePassed:true,exactInactiveCode:true,ring:{}},
  {}
]) assert.equal(threatRiskExitCode(denied),2,
  'Missing ring or code evidence MUST fail the workflow even when GETs returned');
const file=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),
  'world-threat-ring.mjs'),'utf8');
for(const forbidden of [
  /\.gamePlaceSpawn\s*\(/,
  /\.gameCheckUniqueObjectName\s*\(/,
  /\.userSetActiveBranch\s*\(/,
  /\._request\s*\(\s*['"]POST['"]/,
  /\.userSetCode\s*\(/
]) assert.equal(forbidden.test(file),false,'Read-only dossier must not mutate World');
console.log('World W37N11 5x5 live threat ring GET-only tests: PASS');
