import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const readiness=require('../game/expansion.readiness.shadow.js');

const owned=()=>({
  room:{name:'E1N1',controller:{my:true}},spawn:{name:'Spawn1'},
  emergency:false,rcl:5,health:{status:'HEALTHY'},hostileCreeps:[],
  economyModel:{haulerCarryDeficit:0}
});
const observed=(overrides={})=>({
  cpu:{limit:40,bucket:10000},
  ownership:{gclLevel:2,ownedRooms:1,activeClaimCommitments:0,
    discoveredClaimLimit:null,claimPolicyConfidence:0},
  ...overrides
});
{
  const r=readiness.evaluate(observed(),[owned()],12);
  assert.equal(r.authority,'SHADOW');
  assert.equal(r.status,'PLANNING_CANDIDATE');
  assert.equal(r.claimActionEnabled,false);
  assert.equal(r.selectedRoom,null);
  assert.equal(r.availableClaimSlots,1);
  assert.equal(r.cpuLimit,40);
  assert.equal(r.cpuHeadroom,28);
  assert.equal(r.minimumHeadroom,14);
  assert.deepEqual(r.reasons,[]);
}
{
  const r=readiness.evaluate(observed({ownership:{
    gclLevel:2,ownedRooms:2,activeClaimCommitments:0,discoveredClaimLimit:null
  }}),[owned(),owned()],12);
  assert.equal(r.status,'AT_CAPACITY');
  assert.equal(r.availableClaimSlots,0);
}
{
  const r=readiness.evaluate(observed({ownership:{
    gclLevel:2,ownedRooms:1,activeClaimCommitments:1,discoveredClaimLimit:null
  }}),[owned()],12);
  assert.equal(r.status,'AT_CAPACITY');
}
{
  const r=readiness.evaluate(observed({ownership:{
    gclLevel:2,ownedRooms:1,activeClaimCommitments:0,
    discoveredClaimLimit:1,claimPolicyConfidence:1
  }}),[owned()],12);
  assert.equal(r.capacitySource,'GCL_AND_VERIFIED_SERVER_POLICY');
  assert.equal(r.status,'AT_CAPACITY');
}
{
  const r=readiness.evaluate(observed({ownership:{
    gclLevel:2,ownedRooms:1,activeClaimCommitments:0,
    discoveredClaimLimit:1,claimPolicyConfidence:0.3
  }}),[owned()],12);
  assert.equal(r.status,'HOLD');
  assert.ok(r.reasons.includes('CLAIM_POLICY_UNVERIFIED'));
}
{
  const r=readiness.evaluate(observed({cpu:{limit:40,bucket:10000}}),[owned()],34);
  assert.equal(r.status,'HOLD');
  assert.ok(r.reasons.includes('CPU_HEADROOM_INSUFFICIENT'));
}
{
  const r=readiness.evaluate(observed({cpu:{limit:40,bucket:2200}}),[owned()],12);
  assert.equal(r.status,'HOLD');
  assert.ok(r.reasons.includes('CPU_BUCKET_NOT_HEALTHY'));
}
{
  const r=readiness.evaluate(observed(),[{...owned(),health:{status:'WATCH'}}],12);
  assert.equal(r.status,'HOLD');
  assert.ok(r.reasons.includes('NO_HEALTHY_SUPPORTING_PARENT'));
}
{
  const r=readiness.evaluate(observed(),[],12);
  assert.equal(r.status,'HOLD');
  assert.ok(r.reasons.includes('OWNED_ROOM_STATES_INCOMPLETE'));
}
{
  const r=readiness.evaluate(observed({ownership:{
    gclLevel:null,ownedRooms:1,activeClaimCommitments:0
  }}),[owned()],12);
  assert.equal(r.status,'UNVERIFIED');
  assert.equal(r.availableClaimSlots,null);
}
{
  const r=readiness.evaluate(observed({cpu:{limit:null,bucket:null}}),[owned()],12);
  assert.equal(r.status,'UNVERIFIED');
  assert.equal(r.cpuHeadroom,null);
}
{
  const r=readiness.evaluate(observed(),[owned()],12);
  assert.equal(r.claimActionEnabled,false,
    'Capacity is not claim authorization even with strong parent and CPU');
}
// The parent cannot be offered for expansion while Safe Mode is active
// or the emergency cooldown is running, even with healthy economy and GCL.
for(const controllerChange of [{safeMode:75},{safeModeCooldown:300}]) {
  const source=owned();
  source.room.controller={...source.room.controller,...controllerChange};
  const result=readiness.evaluate(observed(),[source],12);
  assert.equal(result.status,'HOLD');
  assert.ok(result.reasons.includes('NO_HEALTHY_SUPPORTING_PARENT'));
  assert.equal(result.claimActionEnabled,false);
}
console.log('read-only expansion readiness (GCL 2 / CPU 40) tests passed');
