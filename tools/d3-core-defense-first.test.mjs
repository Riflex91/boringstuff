import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../game/'+name,import.meta.url),'utf8');
const roomSource=read('room.manager.js');
const calls=[], warnings=[];
const roomCtx={
 module:{exports:{}},
 STRUCTURE_SPAWN:'spawn',STRUCTURE_STORAGE:'storage',STRUCTURE_TOWER:'tower',
 STRUCTURE_RAMPART:'rampart',
 require(name){
  if(name==='config')return {AUTO_SAFE_MODE:true};
  if(name==='logger')return {warn:(...x)=>warnings.push(x)};
  if(name==='tower.manager')return {run:()=>{calls.push('TOWER_ATTACK');}};
  return {};
 }
};
vm.runInNewContext(roomSource,roomCtx,{filename:'room.manager.js'});
const {immediateDefense}=roomCtx.module.exports._test;
const state={
 room:{name:'E8N1',controller:{my:true,safeMode:0,
   safeModeAvailable:1,safeModeCooldown:0,
   activateSafeMode(){calls.push('SAFE_MODE');return 0;}}},
 structures:[{id:'spawn-id',my:true,structureType:'spawn',
   hits:400,hitsMax:1000,pos:{x:10,y:10}}],
 hostileCreeps:[{pos:{getRangeTo(){return 1;}},
   body:[{type:'attack',hits:100}]}]
};
immediateDefense(state);
assert.deepEqual(calls,['SAFE_MODE','TOWER_ATTACK'],
 'immediate defense must protect core before issuing a tower attack');
const stateRead=roomSource.indexOf('return stateBuilder.get(room)');
const earliest=roomSource.indexOf('  immediateDefense(state);',stateRead);
const economy=roomSource.indexOf("profiler.detailSection('room.economy'",stateRead);
const shadows=roomSource.indexOf("profiler.detailSection('room.spawn-parallel-plan'",stateRead);
const legacy=roomSource.indexOf("profiler.detailSection('room.legacy'",stateRead);
assert.ok(stateRead>=0 && stateRead<earliest && earliest<economy &&
  economy<shadows && earliest<legacy,
  'tower / safe mode priority cannot be delayed by CPU-heavy optional work');
assert.equal((roomSource.match(/\btowerManager\.run\(state\)/g)||[]).length,1);
assert.equal((roomSource.match(/\bmaybeSafeMode\(state\);/g)||[]).length,1);
calls.length=0;
state.room.controller.activateSafeMode=()=>{throw Error('engine rejects activation');};
immediateDefense(state);
assert.deepEqual(calls,['TOWER_ATTACK'],
 'a failed Safe Mode API must not suppress towers');
assert.ok(warnings.some(x=>x[0]==='DEFENSE_SAFE_MODE_EXCEPTION'));
state.room.controller.activateSafeMode=()=>{calls.push('SAFE_MODE');return 0;};
state.hostileCreeps=[{pos:{getRangeTo(){return 4;}},
 body:[{type:'attack',hits:100}]}];
calls.length=0;
immediateDefense(state);
assert.deepEqual(calls,['TOWER_ATTACK'],
 'far-away melee must not consume scarce Safe Mode');

// Safe Mode is proactive when the ONLY shield covering the Spawn is
// observed near destruction under ACTUAL adjacent attacker pressure.
const shield={id:'owned-shield',my:true,structureType:'rampart',
  hits:180,hitsMax:100000,pos:{x:10,y:10}};
state.structures[0].hits=1000;
state.structures=[state.structures[0],shield];
state.hostileCreeps=[{pos:{getRangeTo(){return 1;}},
 body:[{type:'attack',hits:100}]}];
assert.equal(roomCtx.module.exports._test.safeModeDecision(state).reason,
 'CORE_RAMPART_BREACH_IMMINENT');
shield.hits=10000;
assert.equal(roomCtx.module.exports._test.safeModeDecision(state),null,
 'healthy shield must not consume Safe Mode prematurely');
shield.hits=180;
state.hostileCreeps=[{pos:{getRangeTo(){return 1;}},
 body:[{type:'attack',hits:0},{type:'move',hits:100}]}];
assert.equal(roomCtx.module.exports._test.safeModeDecision(state),null,
 'inactive attacker never triggers core rampart breach');
state.hostileCreeps=[{pos:{getRangeTo(){return 4;}},
 body:[{type:'attack',hits:100}]}];
assert.equal(roomCtx.module.exports._test.safeModeDecision(state),null,
 'distant melee cannot damage shield this tick');
state.hostileCreeps=[{pos:{getRangeTo(){return 1;}},
 body:[{type:'attack',hits:100}]}];
shield.pos={x:29,y:29};
assert.equal(roomCtx.module.exports._test.safeModeDecision(state),null,
 'remote ramparts cannot trigger expensive Safe Mode');
shield.pos={x:10,y:10};

const towerSource=read('tower.manager.js');
const tctx={module:{exports:{}},
 STRUCTURE_SPAWN:'spawn',STRUCTURE_TOWER:'tower',
 STRUCTURE_STORAGE:'storage',STRUCTURE_RAMPART:'rampart',
 STRUCTURE_WALL:'wall',RESOURCE_ENERGY:'energy',
 FIND_MY_CREEPS:'my_creeps',
 require(name){if(name==='logger')return{warn:()=>{}};throw Error(name);}};
vm.runInNewContext(towerSource,tctx,{filename:'tower.manager.js'});
const towers=tctx.module.exports;
function core(type,id,x,y,hits=1000){
 return {id,structureType:type,my:true,hits,hitsMax:100000,
  pos:{x,y}};
}
const primary=core('spawn','sp',10,10,100000);
const towerCore=core('tower','tw',11,10,100000);
const ramp1=core('rampart','r-sp',10,10,15000);
const ramp2=core('rampart','r-tw',11,10,6000);
const remote=core('rampart','r-exit',2,2,1000);
const unit=(id,types)=>({id,
 pos:{getRangeTo(){return 3;}},
 body:types.map(type=>({type,hits:100}))});
const active=unit('armed',['attack','move']);
const scout=unit('scout',['move']);
const dead=unit('dead',['ranged_attack']);
dead.body[0].hits=0;
const towerCalls=[];
const tower=(id,energy)=>({id,store:{energy},
 attack(h){towerCalls.push(['attack',id,h.id]);return 0;},
 heal(h){towerCalls.push(['heal',id,h.id]);return 0;},
 repair(h){towerCalls.push(['repair',id,h.id]);return 0;}});
const ts=[tower('t1',850),tower('t2',950)];
const st={room:{name:'E8N1',controller:{level:6},
 find(){return[];}},towers:ts,structures:[primary,towerCore,ramp1,ramp2,remote],
 energyStored:5000,hostileCreeps:[active,scout,dead]};
towers.run(st);
assert.deepEqual(towerCalls,[['attack','t1','armed'],['attack','t2','armed']],
 'all towers focus an armed attacker, not an unarmed scout');
towerCalls.length=0;
st.hostileCreeps=[scout,dead];
const hurt={id:'hurt-worker',hits:500,hitsMax:1000};
st.room.find=()=>[hurt];
towers.run(st);
assert.deepEqual(towerCalls,[['heal','t1','hurt-worker'],['heal','t2','hurt-worker']],
 'passive hostiles must not drain ammunition needed to heal colony');
towerCalls.length=0;st.hostileCreeps=[];st.room.find=()=>[];
towers.run(st);
assert.deepEqual(towerCalls,[['repair','t1','r-tw']],
 'only one surplus-energy tower repairs the weakest CORE rampart');
towerCalls.length=0;st.energyStored=1200;
towers.run(st);
assert.deepEqual(towerCalls,[],'do not starve the colony of stored energy');
towerCalls.length=0;st.energyStored=5000;
ts[0].store.energy=750;ts[1].store.energy=790;
towers.run(st);
assert.deepEqual(towerCalls,[],'hold all ammunition when towers have low reserves');
assert.equal(towers._test.coreRampartTarget({...st,structures:[remote]}),null,
 'remote perimeter walls cannot divert core tower ammunition');

const planSource=read('room.planner.js');
const pctx={module:{exports:{}}, 
 STRUCTURE_SPAWN:'spawn',STRUCTURE_TOWER:'tower',
 STRUCTURE_STORAGE:'storage',STRUCTURE_RAMPART:'rampart',
 STRUCTURE_WALL:'wall',
 LOOK_STRUCTURES:'structures',LOOK_CONSTRUCTION_SITES:'sites',
 FIND_MY_CONSTRUCTION_SITES:'my-sites',TERRAIN_MASK_WALL:1,
 CONTROLLER_STRUCTURES:{spawn:{7:2,8:3}},
 OK:0,ERR_FULL:-8,ERR_INVALID_TARGET:-7,ERR_RCL_NOT_ENOUGH:-14,
 require(name){
  if(name==='config')return{};
  if(name==='logger')return{warn(){},info(){}};
  throw Error(name);
 }};
vm.runInNewContext(planSource,pctx,{filename:'room.planner.js'});
const fortify=pctx.module.exports._test.fortifyCore;
const sites=[], placed=[];
const building=[primary,towerCore,core('storage','stor',12,10)];
const room={
 name:'E8N1',controller:{my:true,level:6},
 getTerrain(){return {get(){return 0;}};},
 find(kind,options){
  const rows=kind==='my-sites' ? sites : [];
  return typeof options?.filter==='function' ? rows.filter(options.filter) : rows;
 },
 lookForAt(kind,x,y){
  if(kind==='structures')return building.filter(s=>s.pos.x===x&&s.pos.y===y);
  if(kind==='sites')return sites.filter(s=>s.x===x&&s.y===y);
  throw Error(kind);
 },
 createConstructionSite(x,y,type){
  placed.push({x,y,type});sites.push({x,y,type,structureType:type});
  return 0;
 }
};
const base={room,rcl:6,structures:building,hostileCreeps:[],
 energyStored:5000,emergency:false};
let budget={remaining:5};
assert.equal(fortify(base,budget),2,'max two new core shields per plan');
assert.equal(budget.remaining,3);
assert.deepEqual(placed.map(x=>x.x),[10,11],
 'defend spawn first, tower second, no walls or speculative edge tiles');
assert.equal(fortify(base,{remaining:5}),1,
 'skip sites already accepted, finish remaining eligible core overlay');
assert.equal(fortify(base,{remaining:5}),0,
 'never issue another site at an already covered coordinate');
assert.equal(fortify({...base,energyStored:500},{remaining:10}),0);
assert.equal(fortify({...base,emergency:true},{remaining:10}),0);
assert.equal(fortify({...base,hostileCreeps:[active]},{remaining:10}),0);
assert.equal(fortify({...base,rcl:3},{remaining:10}),0);
assert.equal(fortify({...base,room:{...room,controller:{my:false}}},
 {remaining:10}),0);
assert.equal(fortify(base,{remaining:0}),0);
// RCL7: production redundancy must come from genuine controller quota,
// available stored energy, an owned anchor, and a vacant >=3-tile site.
const secondary=pctx.module.exports._test.secondarySpawnSite;
const grown={...base,rcl:7,energyStored:15000,spawn:primary,
 spawns:[primary]};
room.controller.level=7;
let extra={remaining:3};
assert.equal(secondary(grown,extra),true,
 'RCL7 stockpiled colony should construct the second allowed Spawn');
assert.equal(extra.remaining,2);
const site=placed.at(-1);
assert.equal(site.type,'spawn');
assert.ok(Math.max(Math.abs(site.x-primary.pos.x),
 Math.abs(site.y-primary.pos.y))>=3,
 'do not block primary Spawn immediate exits');
assert.equal(secondary(grown,{remaining:3}),false,
 'a pending second Spawn site consumes its controller quota');
for(const invalid of [
 {...grown,rcl:6}, {...grown,energyStored:5000},
 {...grown,emergency:true},
 {...grown,hostileCreeps:[active]},
 {...grown,room:{...room,controller:{my:false}}}
])assert.equal(secondary(invalid,{remaining:3}),false,
 'a recovery or unstable colony must not create redundant Spawn sites');
assert.match(planSource,/changed \+= fortifyCore\(state,budget\)/,
 'fortification must be integrated before optional road stage');
const where=planSource.indexOf('changed += fortifyCore(state,budget)');
const roads=planSource.indexOf('roadBudget');
assert.ok(where>0&&where<roads,
 'critical fortifications must not be crowded out by new roads');
console.log('D3 first-intent defense, defensive tower targeting/heal, reserve-safe core ramps PASS');
