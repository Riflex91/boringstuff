import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const priority=require('../game/work.priority.js');
const pos=(x,y)=>({x,y,getRangeTo(other){
 const p=other?.pos||other;
 return Math.max(Math.abs(x-p.x),Math.abs(y-p.y));
}});
const spawn={id:'owned-core',my:true,structureType:'spawn',pos:pos(10,10)};
const tower={id:'owned-tower',my:true,structureType:'tower',pos:pos(12,10)};
const storage={id:'owned-storage',my:true,structureType:'storage',pos:pos(13,10)};
const shield=(id,x,y,hits,my=true)=>({
 id,my,structureType:'rampart',pos:pos(x,y),
 hits,hitsMax:1000000
});
const coreShield=shield('spawn-shield',10,10,2500);
const towerShield=shield('tower-shield',12,10,2000);
const distantShield=shield('random-edge',5,5,1);
const structures=[spawn,tower,storage,coreShield,towerShield,distantShield];
const enemy=(id,x,y,parts)=>({id,pos:pos(x,y),body:parts.map(p=>
 typeof p==='string'?{type:p,hits:100}:p)});
const hostile=enemy('dismantler',11,10,['work','move']);
const invalid=enemy('passerby',11,10,['move']);
const dead=enemy('inactive',11,10,[{type:'attack',hits:0}]);
assert.deepEqual(priority.criticalCoreShieldTargets(structures,[hostile])
 .map(s=>s.id),['tower-shield','spawn-shield'],
 'the shield with the fewest actual remaining attack ticks comes first');
assert.equal(priority.hasCriticalCoreShieldThreat(structures,[hostile]),true);
for(const e of [[invalid],[dead],[enemy('far',20,20,['attack'])]]) {
 assert.deepEqual(priority.criticalCoreShieldTargets(structures,e),[],
  'passive, dead or distant enemy must not start emergency repair');
}
assert.deepEqual(priority.criticalCoreShieldTargets(structures,
 [hostile],).filter(s=>s.id==='random-edge'),[]);
assert.equal(priority.hasCriticalCoreShieldThreat(
 structures.map(s=>s.id==='spawn-shield'?{...s,my:false}:s),
 [enemy('nearSpawn',9,10,['attack'])]),false,
 'enemy proximity cannot authenticate enemy-owned shield');
assert.equal(priority.hasCriticalCoreShieldThreat([spawn,
 shield('remote',15,15,1)],[enemy('nearRemote',15,15,['attack'])]),false,
 'do not divert workers to an unverified perimeter shield');
assert.equal(priority.hasCriticalCoreShieldThreat([
 spawn,shield('healthy',10,10,100000)],
 [enemy('nearSpawn',11,10,['attack'])]),false,
 'healthy shield not considered urgently damaged');
assert.equal(priority.hasCriticalCoreShieldThreat([
 spawn,shield('uncovered',10,10,100000)],
 [enemy('nearSpawn',11,10,[{type:'attack',hits:100,boost:'XUH2O'}])]),false);
const boosted=enemy('boosted',11,10,[{type:'attack',hits:100,boost:'XUH2O'}]);
assert.equal(priority.hasCriticalCoreShieldThreat([
 spawn,shield('damaged',10,10,28000)],[boosted]),true,
 'an actively boosted siege requires earlier repair than ordinary damage');
const workerSource=fs.readFileSync(new URL('../game/role.worker.js',import.meta.url),'utf8');
const ctx={
 module:{exports:{}},RESOURCE_ENERGY:'energy',
 FIND_HOSTILE_CREEPS:'hostiles',FIND_STRUCTURES:'structures',
 OK:0,ERR_NOT_IN_RANGE:-9,
 require(name){
  if(name==='work.priority')return priority;
  if(name==='config')return {PATH_MAX_OPS:200};
  if(name==='energy')return {};
  throw Error(name);
 }};
vm.runInNewContext(workerSource,ctx,{filename:'role.worker.js'});
const repair=ctx.module.exports._test.repairCoreShield;
const calls=[];
const room={controller:{my:true,safeMode:0},find(which) {
 return which==='hostiles'?[hostile]:structures;
}};
const creep={room,memory:{role:'worker'},store:{energy:100},
 pos:{findClosestByPath(targets){return targets[0]||null;}},
 repair(target){calls.push(['repair',target.id]);return 0;},
 moveTo(target,opts){calls.push(['move',target.id,opts]);return 0;}};
assert.equal(repair(creep),true);
assert.deepEqual(calls.map(x=>x.slice(0,2)),[['repair','tower-shield']]);
calls.length=0;
creep.repair=target=>{calls.push(['repair',target.id]);return -9;};
assert.equal(repair(creep),true);
assert.equal(calls[1][0],'move');
assert.equal(calls[1][2].range,3,
 'move only to remote repair range, not blindly onto exposed shield');
assert.equal(calls[1][2].maxRooms,1);
calls.length=0;room.controller.safeMode=100;
assert.equal(repair(creep),false);assert.equal(calls.length,0);
room.controller.safeMode=0;creep.store.energy=0;
assert.equal(repair(creep),false);assert.equal(calls.length,0);
creep.store.energy=100;
const spawnSource=fs.readFileSync(new URL('../game/spawn.manager.js',import.meta.url),'utf8');
const sctx={module:{exports:{}},
 STRUCTURE_WALL:'constructedWall',STRUCTURE_RAMPART:'rampart',
 require(name) {
  if(name==='work.priority')return priority;
  if(name==='body.builder')return{};
  if(name==='logger')return {warn(){},info(){}};
  if(name==='config')return {MAX_BOOTSTRAP_HARVESTERS:5,
   MAX_BOOTSTRAP_HAULERS:3,MAX_BUILDERS:3,MAX_UPGRADERS:4,
   SCOUTS_AFTER_RCL:3,RCL1_SURPLUS_STREAK_TICKS:10,
   RCL1_SURPLUS_UPGRADERS:2,RCL2_PLUS_SURPLUS_STREAK_TICKS:25};
  throw Error(name);
 }};
vm.runInNewContext(spawnSource,sctx,{filename:'spawn.manager.js'});
const desired=sctx.module.exports.desired;
const base={room:{controller:{my:true}},rcl:6,emergency:false,
 sources:[{id:1},{id:2}],structures,sites:[],hostileCreeps:[hostile],
 energyStored:5000,energyCapacityAvailable:1050,
 byRole:{harvester:2,hauler:2,worker:1},
 economyModel:{recommendedHarvesterCount:2,recommendedHaulerCount:2},
 economyMetrics:{energyCappedStreak:0,spawnIdleStreak:0},
 towers:[{my:true},{my:true}]};
assert.equal(desired(base).repairer,1,
 'an actually threatened core shield must request one repair worker');
assert.equal(desired({...base,emergency:true}).repairer,0,
 'last productive worker outranks emergency siege-repair recruiting');
assert.equal(desired({...base,hostileCreeps:[invalid],
 structures:[spawn,tower,storage,coreShield,towerShield]}).repairer,0,
 'a harmless scout never triggers siege-repair demand');
assert.match(workerSource,/if \(repairCoreShield\(creep\)\) return;/);
const e=workerSource.indexOf('if (emergencyRepair(creep)) return;');
const s=workerSource.indexOf('if (repairCoreShield(creep)) return;');
const b=workerSource.indexOf("if (role === 'builder')");
assert.ok(e<s && s<b,
 'critical structure first, endangered shield second, optional site third');
console.log('D6 core Rampart actual weapon-pressure repair, safe range and one emergency repairer PASS');
