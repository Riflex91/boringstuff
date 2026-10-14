import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const budget=require('../game/expansion.bootstrap.budget.shadow.js');
global.MOVE='move'; global.CLAIM='claim';
global.WORK='work'; global.CARRY='carry';
global.BODYPART_COST={move:50,claim:600,work:100,carry:50};
global.CREEP_SPAWN_TIME=3;
const ready={authority:'SHADOW',claimActionEnabled:false,
  status:'PLANNING_CANDIDATE',availableClaimSlots:1};
const route={authority:'SHADOW',claimActionEnabled:false,
  spawnActionEnabled:false,readyForClaim:false,
  phase:'SITE_VERIFIED_ADVISORY',spawnTileVerified:true,
  tilePathVerified:true,routeLevel:'ROOM_LEVEL_ONLY',
  candidateRoom:'E2N3',siteCandidatesChecked:1,pathCost:40,
  spawnSite:{x:25,y:25,roomName:'E2N3'},
  routeHops:1,parentRoom:'E2N2'};
const parent=()=>({room:{name:'E2N2',controller:{my:true}},
  spawn:{name:'First'},rcl:5,emergency:false,
  health:{status:'HEALTHY'},hostileCreeps:[],
  economyModel:{haulerCarryDeficit:0},
  energyCapacityAvailable:1050,energyAvailable:1050,
  energyStored:6000,
  creeps:[
    {memory:{role:'harvester'}},{memory:{role:'harvester'}},
    {memory:{role:'hauler'}},{memory:{role:'hauler'}},
    {memory:{role:'upgrader',waitingEnergyTicks:0,
      logisticsFallback:false}}
  ]});
const p=parent();
const tick=1050;
const continuity={
  schemaVersion:1,authority:'SHADOW_EVIDENCE',actionAuthority:'NONE',
  claimActionEnabled:false,status:'OBSERVATIONS_AVAILABLE',
  requiredTicks:100,lastTick:tick,rooms:[{
    room:'E2N2',status:'CONTINUOUS_SUPPORT_OBSERVED',reason:null,
    firstTick:tick-99,lastTick:tick,
    consecutiveSupportTicks:100,requiredTicks:100,
    actionAuthority:'NONE',claimActionEnabled:false
  }]
};
const assess=(r,o,source,proof=continuity,at=tick)=>
  budget.assess(r,o,source,proof,at);
const snapshot=JSON.stringify({ready,route,p,continuity});
const a=assess(ready,route,p);
assert.equal(a.status,'COST_ESTIMATE_ONLY');
assert.equal(a.authority,'SHADOW');
assert.equal(a.actionAuthority,'NONE');
assert.equal(a.claimActionEnabled,false);
assert.equal(a.spawnActionEnabled,false);
assert.equal(a.constructionActionEnabled,false);
assert.equal(a.readyForClaim,false);
assert.equal(a.totalCrewEnergy,1200,
  '650 claimer, 2x 200 pioneers, 150 supply carrier');
assert.equal(a.totalCrewSpawnTicks,33);
assert.deepEqual(a.crew.map(x=>[x.role,x.count,x.unitCost]),[
  ['claimer',1,650],['pioneer',2,200],['supplyHauler',1,150]
]);
assert.equal(a.parentReserveFloor,3150);
assert.equal(a.hypotheticalStoredEnergyAfterCrew,4800);
assert.ok(a.unverified.includes('actualCreepRouteTravelTime'));
assert.ok(a.unverified.includes('constructionEnergyBudget'));
assert.equal(JSON.stringify({ready,route,p,continuity}),snapshot,
  'budget must never mutate parent, readiness or operation');

// A fully funded expedition must still be held after a defensive emergency;
// an old positive 100-tick witness cannot override the current parent state.
for(const defensiveState of [{safeMode:120},{safeModeCooldown:450}]) {
  const crisis={...p,room:{name:'E2N2',controller:{my:true,...defensiveState}}};
  const result=assess(ready,route,crisis);
  assert.equal(result.status,'HOLD');
  assert.equal(result.reason,'PARENT_DEFENSE_RECOVERY_INCOMPLETE');
  assert.equal(result.readyForClaim,false);
  assert.equal(result.claimActionEnabled,false);
}

// A reserve that passes the old support preflight must still be rejected
// when future expansion crew costs would consume that reserve.
const drained=assess(ready,route,{...p,energyStored:3700});
assert.equal(drained.status,'HOLD');
assert.equal(drained.reason,'PARENT_CREW_COST_WOULD_EXHAUST_RESERVE');
assert.equal(drained.hypotheticalStoredEnergyAfterCrew,2500);
assert.equal(drained.readyForClaim,false);
assert.equal(assess(ready,route,{...p,energyAvailable:53}).reason,
  'PARENT_INFRASTRUCTURE_REFILL_PRESSURE');
assert.equal(assess(ready,route,{...p,
  creeps:p.creeps.slice(0,3)}).reason,
  'PARENT_MINING_OR_HAULING_REDUNDANCY_LOW');
assert.equal(assess(ready,route,{...p,
  creeps:p.creeps.map((c,i)=>i===4?{
    memory:{...c.memory,logisticsFallback:true}}:c)}).reason,
  'PARENT_CONSUMER_SUPPLY_PRESSURE');
assert.equal(assess(ready,route,{...p,energyStored:3000}).status,
  'HOLD');

// The component is not permission to claim even if the source room can
// afford a tiny body or the room has a path-verified spawn tile.
for(const blocked of [
  {...route,phase:'AWAITING_TILE_VALIDATION'},
  {...route,spawnTileVerified:false},
  {...route,parentRoom:'E5N5'},
  {...route,claimActionEnabled:true},
  {...route,readyForClaim:true}
]) {
  const x=assess(ready,blocked,p);
  assert.equal(x.status,'HOLD');
  assert.equal(x.readyForClaim,false);
}
assert.equal(assess({...ready,availableClaimSlots:0},route,p).status,
  'HOLD');
assert.equal(assess({...ready,status:'HOLD'},route,p).status,'HOLD');

// The I4 operation itself is read-only, and its geometry is not an
// independent continuity witness. Fail closed on absent/stale/foreign proof.
{
  const cases=[
    [null,tick],
    [{...continuity,status:'STALE'},tick],
    [{...continuity,lastTick:tick-1},tick],
    [{...continuity,claimActionEnabled:true},tick],
    [{...continuity,actionAuthority:'CLAIM'},tick],
    [{...continuity,rooms:[]},tick],
    [{...continuity,rooms:[{...continuity.rooms[0],room:'E2N4'}]},tick],
    [{...continuity,rooms:[{...continuity.rooms[0],consecutiveSupportTicks:99}]},tick],
    [{...continuity,rooms:[{...continuity.rooms[0],firstTick:tick-98}]},tick],
    [{...continuity,rooms:continuity.rooms.concat(continuity.rooms)},tick],
    [continuity,tick+1]
  ];
  for(const [proof,at] of cases) {
    const blocked=assess(ready,route,p,proof,at);
    assert.equal(blocked.status,'HOLD');
    assert.equal(blocked.reason,'PARENT_SUPPORT_CONTINUITY_UNVERIFIED');
    assert.equal(blocked.totalCrewEnergy,null);
    assert.deepEqual(blocked.crew,[]);
    assert.equal(blocked.actionAuthority,'NONE');
    assert.equal(blocked.readyForClaim,false);
  }
  assert.equal(assess(ready,route,p).status,'COST_ESTIMATE_ONLY',
    'fresh 100-tick proof permits only passive affordability estimate');
  const mainText=fs.readFileSync(path.resolve(here,'../game/main.js'),'utf8');
  assert.ok(mainText.includes('expansionParentStability,Game.time);'),
    'status snapshot must pass the current actual observed window and tick');
}

// A route-level score, an arbitrary spawn-position object or a mismatched
// candidate cannot be promoted to an "affordable" I4 operation.
{
  const invalidSites=[
    {candidateRoom:'E9N9'},
    {candidateRoom:'not-a-room'},
    {candidateRoom:'E2N2'},
    {spawnSite:{x:25,y:25,roomName:'E2N4'}},
    {spawnSite:{x:NaN,y:25,roomName:'E2N3'}},
    {spawnSite:{x:25.5,y:25,roomName:'E2N3'}},
    {spawnSite:{x:1,y:25,roomName:'E2N3'}},
    {spawnSite:{x:48,y:25,roomName:'E2N3'}},
    {spawnSite:{x:25,y:49,roomName:'E2N3'}},
    {spawnSite:{}},
    {tilePathVerified:false},
    {routeLevel:'UNVERIFIED'},
    {pathCost:null},
    {pathCost:-1},
    {pathCost:Infinity},
    {siteCandidatesChecked:-1},
    {siteCandidatesChecked:16},
    {siteCandidatesChecked:null}
  ];
  for(const changes of invalidSites) {
    const blocked=assess(ready,{...route,...changes},p);
    assert.equal(blocked.status,'HOLD',JSON.stringify(changes));
    assert.equal(blocked.reason,'EXPANSION_GEOMETRY_OR_BUDGET_UNVERIFIED',
      JSON.stringify(changes));
    assert.equal(blocked.totalCrewEnergy,null);
    assert.equal(blocked.readyForClaim,false);
    assert.equal(blocked.actionAuthority,'NONE');
  }
  assert.equal(assess(ready,{...route,siteCandidatesChecked:0},p).status,
    'COST_ESTIMATE_ONLY','first possible site candidate may be index zero');
  assert.equal(assess(ready,{...route,siteCandidatesChecked:15},p).status,
    'COST_ESTIMATE_ONLY','last bounded site candidate remains valid');
}

// All cost components MUST be discovered from the actual server's table;
// never use a hard-coded 650/200 guess for missing capability values.
const originalCost=global.BODYPART_COST;
const originalRate=global.CREEP_SPAWN_TIME;
try {
  global.BODYPART_COST={...originalCost,claim:undefined};
  assert.equal(assess(ready,route,p).reason,
    'BODY_COST_OR_SPAWN_RATE_UNVERIFIED');
  global.BODYPART_COST={...originalCost,claim:800};
  const expensive=assess(ready,route,p);
  assert.equal(expensive.totalCrewEnergy,1400);
  assert.equal(expensive.readyForClaim,false);
  global.CREEP_SPAWN_TIME=undefined;
  assert.equal(assess(ready,route,p).status,'UNVERIFIED');
} finally {
  global.BODYPART_COST=originalCost;
  global.CREEP_SPAWN_TIME=originalRate;
}
const moduleText=fs.readFileSync(path.resolve(here,
  '../game/expansion.bootstrap.budget.shadow.js'),'utf8');
const mainText=fs.readFileSync(path.resolve(here,'../game/main.js'),'utf8');
for(const forbidden of ['.claimController(','.reserveController(',
  '.spawnCreep(','.createConstructionSite(','.moveTo(']) {
  assert.equal(moduleText.includes(forbidden),false,
    'passive bootstrap estimate must not issue gameplay actions');
}
assert.ok(mainText.includes("require('expansion.bootstrap.budget.shadow')"));
assert.ok(mainText.includes('const expansionBootstrapBudget = expansionBootstrapBudgetShadow.assess('));
assert.ok(mainText.includes('    expansionBootstrapBudget,'));
console.log('I4 passive minimal-colony crew cost and reserve estimate PASS');
