import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';

const root=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(root,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const d1=require('../game/defense.requests.shadow.js');
const registry=require('../game/request.registry.js');

const game={time:100};
function pos(x,y) {return {x,y,roomName:'W37N11'};}
function colony(){
 return {
  room:{name:'W37N11',controller:{my:true}},
  structures:[
    {id:'core',my:true,structureType:'spawn',pos:pos(10,10),
      hits:500,hitsMax:1000},
    {id:'tower',my:true,structureType:'tower',pos:pos(12,12),
      store:{energy:5,getCapacity(k){assert.equal(k,'energy');return 1000;}}},
    {id:'rampart',my:true,structureType:'rampart',pos:pos(11,10),
      hits:2000,hitsMax:100000},
    {id:'enemyTower',my:false,structureType:'tower',
      store:{energy:0,getCapacity(){return 1000;}}}
  ]
 };
}
function d0(changes={}){
 return {
  schemaVersion:3,
  authority:'SHADOW',actionAuthority:'NONE',status:'READY',
  roomName:'W37N11',tick:100,hostileCount:1,armedCount:1,
  aggregate:{meleeDps:30,rangedDps:10,dismantlePerTick:0,
    healPerTick:12,effectiveHits:1000},
  risk:{state:'DEFENSE',recommendedSafeMode:false},
  access:{criticalAssetsAtRisk:[{
    assetId:'core',earliestLossTick:120,impactTick:110
  }],earliestImpactTick:110},
  ...changes
 };
}
const owned=colony(),model=d0();
const initial=JSON.stringify(owned);
const d0Initial=JSON.stringify(model);
const result=d1.evaluate(owned,model,game);
assert.equal(result.authority,'SHADOW');
assert.equal(result.actionAuthority,'NONE');
assert.equal(result.defenseActionEnabled,false);
assert.equal(result.spawnActionEnabled,false);
assert.equal(result.safeModeActionEnabled,false);
assert.equal(result.status,'ADVISORY');
assert.equal(result.requestCount,6);
assert.equal(result.summary.requestCount,6);
assert.equal(result.summary.riskState,'DEFENSE');
assert.equal(result.summary.projectedAssetLossTick,120);
assert.equal(result.summary.towersWithVerifiedEnergy,1);
assert.equal(result.summary.armedThreatPressure,40);
assert.equal(result.summary.hasUnknownPathEvidence,false);
assert.equal(JSON.stringify(owned),initial,'D1 must not mutate room objects');
assert.equal(JSON.stringify(model),d0Initial,'D1 must not mutate D0 output');
const byKind=Object.fromEntries(result.specs.map(s=>[s.kind,s]));
assert.equal(byKind.DEFENSE_DAMAGE.demand.amount,32);
assert.equal(byKind.DEFENSE_DAMAGE.demand.capability,'damagePerTick');
assert.equal(byKind.DEFENSE_HEAL.demand.amount,20);
assert.equal(byKind.DEFENSE_TANKING.demand.amount,120);
assert.equal(byKind.DEFENSE_TOWER_ENERGY.demand.amount,15);
assert.equal(byKind.DEFENSE_REPAIR.demand.amount,500);
assert.equal(byKind.DEFENSE_RAMPART_OCCUPANCY.demand.amount,1);
for(const spec of result.specs){
 assert.equal(spec.domain,'defense');
 assert.equal(spec.shadow,true);
 assert.equal(spec.deadlineTick,120);
 assert.equal(spec.priority.base,85);
 assert.equal(spec.priority.strategicClass,'DEFENSE');
 assert.equal(spec.evidence.source,'D0_BOUNDED_THREAT_SHADOW');
 assert.equal(spec.target.roomName,'W37N11');
 assert.ok(spec.dedupeKey.startsWith('defense:'));
 assert.equal(spec.demand.minimumUsefulAmount,1);
 assert.equal(spec.demand.maximumUsefulAmount,spec.demand.amount);
}

// E0 interface compatibility: opt-in shadow requests fit registry contracts.
// Production D1 does NOT write to E0 registry or change legacy behavior.
{
 const memory={};
 for(const spec of result.specs){
   const record=registry.upsert('W37N11',spec,memory,game);
   assert.equal(record.domain,'defense');
   assert.equal(record.shadow,true);
   assert.ok(record.demand.amount>0);
 }
 assert.equal(registry.list('W37N11',memory).length,6);
}
assert.equal(d1.evaluate(colony(),d0({
  hostileCount:0,armedCount:0,risk:{state:'NORMAL'},
  aggregate:{meleeDps:0,rangedDps:0,dismantlePerTick:0,
    healPerTick:0,effectiveHits:0},
  access:{criticalAssetsAtRisk:[]}
}),game).status,'CLEAR');
assert.equal(d1.evaluate(colony(),d0({
  hostileCount:1,armedCount:0,risk:{state:'WATCH'}
}),game).status,'WATCH');
assert.equal(d1.evaluate(colony(),d0({
  status:'PARTIAL'
}),game).status,'INCOMPLETE');
assert.equal(d1.evaluate(colony(),d0({
  status:'PARTIAL'
}),game).requestCount,0);
assert.equal(d1.evaluate(colony(),d0({
  tick:99
}),game).status,'UNVERIFIED');
assert.equal(d1.evaluate(colony(),d0({
  roomName:'W35N11'
}),game).status,'UNVERIFIED');
assert.equal(d1.evaluate(colony(),d0({
  actionAuthority:'SPAWN'
}),game).status,'UNVERIFIED');
assert.equal(d1.evaluate(colony(),d0({
  schemaVersion:2
}),game).status,'UNVERIFIED');
assert.equal(d1.evaluate(colony(),d0({
  armedCount:2
}),game).status,'UNVERIFIED');
assert.equal(d1.evaluate(colony(),d0({
  aggregate:{...model.aggregate,healPerTick:-1}
}),game).status,'UNVERIFIED');
assert.equal(d1.evaluate({...colony(),room:{name:'W37N11',controller:{my:false}}},model,game).status,'UNVERIFIED');
const emergency=d1.evaluate(colony(),d0({
  risk:{state:'EMERGENCY'},
  access:{criticalAssetsAtRisk:[{assetId:'core',earliestLossTick:104}]}
}),game);
assert.equal(emergency.status,'ADVISORY');
assert.equal(emergency.summary.projectedAssetLossTick,104);
assert.equal(emergency.specs[0].priority.base,100);
assert.equal(emergency.specs[0].priority.urgency,100);
assert.equal(emergency.safeModeActionEnabled,false);
const unknownDeadline=d1.evaluate(colony(),d0({
  access:{criticalAssetsAtRisk:[]}
}),game);
assert.equal(unknownDeadline.specs[0].deadlineTick,null,
  'Never invent arrival timing from severity alone');

const emptyTower=colony();
delete emptyTower.structures[1].store.getCapacity;
const ignored=d1.evaluate(emptyTower,model,game);
assert.equal(ignored.summary.towersWithVerifiedEnergy,0);
assert.equal(ignored.specs.some(s=>s.kind==='DEFENSE_TOWER_ENERGY'),false,
  'Never fabricate tower reserves from unverified store capacity');

const noCurrentDamage=colony();
noCurrentDamage.structures[0].hits=1000;
const noRepair=d1.evaluate(noCurrentDamage,model,game);
assert.equal(noRepair.specs.some(s=>s.kind==='DEFENSE_REPAIR'),false,
  'Damage only reflects actual observed damaged own core assets');

const noRampart=colony();
noRampart.structures=noRampart.structures.filter(s=>s.structureType!=='rampart');
assert.equal(d1.evaluate(noRampart,model,game).specs.some(
  s=>s.kind==='DEFENSE_RAMPART_OCCUPANCY'),false);

const noObservedHostiles=d1.evaluate(colony(),d0({
  hostileCount:0,armedCount:0,risk:{state:'ALERT'}
}),game);
assert.equal(noObservedHostiles.status,'UNVERIFIED');

const abs=path.join(root,'../game/defense.requests.shadow.js');
const code=fs.readFileSync(abs,'utf8');
for(const forbidden of [
 /\.spawnCreep\s*\(/, /\.attack\s*\(/, /\.heal\s*\(/,
 /\.activateSafeMode\s*\(/, /\.reserve\s*\(/, /\.upsert\s*\(/,
 /\.moveTo\s*\(/, /\.transfer\s*\(/,
 /require\(['"]request\.registry['"]\)/
])assert.equal(forbidden.test(code),false,
 'D1 must not issue any action, registry write or creep intent');

const mainCode=fs.readFileSync(path.join(root,'../game/main.js'),'utf8');
assert.ok(mainCode.includes('state.defenseRequestsShadow = defenseRequestsShadow.evaluate('));
assert.ok(mainCode.includes('defenseRequests: defenseRequestsShadow.telemetrySummary('));
assert.equal(d1.telemetrySummary(result).requestCount,6);
console.log('U7/D1: bounded shadow defense requests, contracts, no-intent guard: PASS');
