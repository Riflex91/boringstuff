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
const snapshot=JSON.stringify({ready,route,p});
const a=budget.assess(ready,route,p);
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
assert.equal(JSON.stringify({ready,route,p}),snapshot,
  'budget must never mutate parent, readiness or operation');

// A reserve that passes the old support preflight must still be rejected
// when future expansion crew costs would consume that reserve.
const drained=budget.assess(ready,route,{...p,energyStored:3700});
assert.equal(drained.status,'HOLD');
assert.equal(drained.reason,'PARENT_CREW_COST_WOULD_EXHAUST_RESERVE');
assert.equal(drained.hypotheticalStoredEnergyAfterCrew,2500);
assert.equal(drained.readyForClaim,false);
assert.equal(budget.assess(ready,route,{...p,energyAvailable:53}).reason,
  'PARENT_INFRASTRUCTURE_REFILL_PRESSURE');
assert.equal(budget.assess(ready,route,{...p,
  creeps:p.creeps.slice(0,3)}).reason,
  'PARENT_MINING_OR_HAULING_REDUNDANCY_LOW');
assert.equal(budget.assess(ready,route,{...p,
  creeps:p.creeps.map((c,i)=>i===4?{
    memory:{...c.memory,logisticsFallback:true}}:c)}).reason,
  'PARENT_CONSUMER_SUPPLY_PRESSURE');
assert.equal(budget.assess(ready,route,{...p,energyStored:3000}).status,
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
  const x=budget.assess(ready,blocked,p);
  assert.equal(x.status,'HOLD');
  assert.equal(x.readyForClaim,false);
}
assert.equal(budget.assess({...ready,availableClaimSlots:0},route,p).status,
  'HOLD');
assert.equal(budget.assess({...ready,status:'HOLD'},route,p).status,'HOLD');

// All cost components MUST be discovered from the actual server's table;
// never use a hard-coded 650/200 guess for missing capability values.
const originalCost=global.BODYPART_COST;
const originalRate=global.CREEP_SPAWN_TIME;
try {
  global.BODYPART_COST={...originalCost,claim:undefined};
  assert.equal(budget.assess(ready,route,p).reason,
    'BODY_COST_OR_SPAWN_RATE_UNVERIFIED');
  global.BODYPART_COST={...originalCost,claim:800};
  const expensive=budget.assess(ready,route,p);
  assert.equal(expensive.totalCrewEnergy,1400);
  assert.equal(expensive.readyForClaim,false);
  global.CREEP_SPAWN_TIME=undefined;
  assert.equal(budget.assess(ready,route,p).status,'UNVERIFIED');
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
