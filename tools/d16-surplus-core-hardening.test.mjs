import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const src=fs.readFileSync(new URL('../game/tower.manager.js',import.meta.url),'utf8');
const ctx={module:{exports:{}},STRUCTURE_SPAWN:'spawn',
 STRUCTURE_TOWER:'tower',STRUCTURE_STORAGE:'storage',
 STRUCTURE_RAMPART:'rampart',STRUCTURE_WALL:'wall',
 STRUCTURE_ROAD:'road',STRUCTURE_CONTAINER:'container',
 RESOURCE_ENERGY:'energy',FIND_MY_CREEPS:'my_creeps',
 require(name){if(name==='logger')return {warn(){}};
 if(name==='defense.siege.triage')return require('../game/defense.siege.triage.js');
 throw Error(name);}};
vm.runInNewContext(src,ctx,{filename:'tower.manager.js'});
const mgr=ctx.module.exports;
const own=(id,type,x,hits,max=1000000)=>({id,my:true,structureType:type,
 pos:{x,y:10},hits,hitsMax:max});
const spawn=own('spawn','spawn',10,5000,5000);
const towerCore=own('towerCore','tower',11,3000,3000);
const storage=own('storage','storage',12,10000,10000);
const shieldSpawn=own('shieldSpawn','rampart',10,150000);
const shieldTower=own('shieldTower','rampart',11,150000);
const shieldStore=own('shieldStore','rampart',12,150000);
const remote=own('remote','rampart',22,100);
const road=own('road','road',24,10,5000);
const actions=[];
const t1={store:{energy:950},repair(x){actions.push(['repair',x.id]);return 0;},
 attack(x){actions.push(['attack',x.id]);return 0;},
 heal(x){actions.push(['heal',x.id]);return 0;}};
const t2={store:{energy:980},repair(x){actions.push(['repair',x.id]);return 0;},
 attack(x){actions.push(['attack',x.id]);return 0;},
 heal(x){actions.push(['heal',x.id]);return 0;}};
const state={room:{name:'E8N1',controller:{my:true,level:6,
 safeModeAvailable:1},find(){return [];}},
 structures:[spawn,towerCore,storage,shieldSpawn,shieldTower,
 shieldStore,remote,road],towers:[t1,t2],hostileCreeps:[],
 creeps:[],energyStored:5248};
const run=()=>{actions.length=0;mgr.run(state);
 return {actions:actions.slice(),status:state.defenseTowerAction.status};};
assert.equal(mgr._test.baseCoreShieldTarget(state),120000);
assert.equal(mgr._test.surplusCoreHardening(state),false);
assert.equal(mgr._test.coreRampartTarget(state),null,
 'actual E8N1 RCL6 three built shields >=150k must not waste energy on speculative extra hardening');
assert.deepEqual(run().actions,[['repair','road']],
 'current 5k stored still maintains ordinary road if actual core shields have surpassed baseline');
assert.equal(state.defenseTowerAction.status,'REPAIR_DISCRETIONARY');
// Save ammo and XP opportunities at low stored energy even with empty Safe Mode.
state.energyStored=11999;state.room.controller.safeModeAvailable=0;
assert.equal(mgr._test.surplusCoreHardening(state),false);
assert.equal(mgr._test.coreRampartTarget(state),null);
state.energyStored=12000;
assert.equal(mgr._test.surplusCoreHardening(state),true,
 'explicitly exhausted Safe Mode permits carefully buffered resilience investment');
assert.equal(mgr._test.coreRampartTarget(state).id,'shieldSpawn');
assert.deepEqual(run().actions,[['repair','shieldSpawn']],
 'fortification of actually owned Spawn overlay should preempt road maintenance');
assert.equal(state.defenseTowerAction.repairAttempts,1);
t1.store.energy=899;t2.store.energy=890;
assert.deepEqual(run().actions,[],
 'D16 surplus target cannot spend from a Tower below 900 energy');
assert.equal(state.defenseTowerAction.status,'RESERVE_ENERGY');
t2.store.energy=900;
assert.deepEqual(run().actions,[['repair','shieldSpawn']],
 'exactly 900 ammo allows one preemptive repair with healthy storage');
state.energyStored=19999;state.room.controller.safeModeAvailable=1;
assert.equal(mgr._test.surplusCoreHardening(state),false,
 'with Safe Mode available save surplus until 20k actual stored energy');
assert.equal(mgr._test.coreRampartTarget(state),null);
state.energyStored=20000;
assert.equal(mgr._test.surplusCoreHardening(state),true);
assert.equal(mgr._test.coreRampartTarget(state).id,'shieldSpawn');
// A weak shield under baseline is repairable on old D3 thresholds even
// while D16 surplus hardening is disabled.
state.energyStored=3100;t1.store.energy=800;t2.store.energy=790;
shieldSpawn.hits=110000;
assert.equal(mgr._test.coreRampartTarget(state).id,'shieldSpawn');
assert.deepEqual(run().actions,[['repair','shieldSpawn']],
 'legacy under-120k core shield still gets >=800 ammo Tower');
shieldSpawn.hits=150000;
assert.equal(mgr._test.coreRampartTarget(state),null);
state.energyStored=20000;t1.store.energy=950;t2.store.energy=970;
shieldSpawn.hits=300000;
assert.equal(mgr._test.coreRampartTarget(state).id,'shieldTower',
 '300k target stops work on adequately reinforced shield');
shieldTower.hits=300000;shieldStore.hits=300000;
assert.equal(mgr._test.coreRampartTarget(state),null,
 'once every built core shield is 300k no excess hit-wall chase');
// Foreign and remotely placed Ramparts must never become targets.
shieldTower.my=false;shieldStore.my=false;
assert.equal(mgr._test.coreRampartTarget(state),null);
shieldTower.my=true;shieldStore.my=true;
shieldTower.hits=250000;shieldTower.pos.x=25;
assert.equal(mgr._test.coreRampartTarget(state),null,
 'remote standalone Rampart is no substitute for the actual Tower overlay');
shieldTower.pos.x=11;
// Energy-starved room and hostile fights do not promote hardening.
state.energyStored=10000;state.room.controller.safeModeAvailable=0;
shieldTower.hits=250000;
assert.equal(mgr._test.surplusCoreHardening(state),false);
state.energyStored=25000;
state.hostileCreeps=[{id:'hostile',owner:{username:'bad'},
 body:[{type:'work',hits:100}],pos:{getRangeTo(){return 1;}}}];
assert.deepEqual(run().actions,[['attack','hostile'],['attack','hostile']],
 'real armed hostile keeps attack priority above surplus fortification');
state.hostileCreeps=[];
state.creeps=[{id:'ally',hits:70,hitsMax:100}];
assert.deepEqual(run().actions,[['heal','ally'],['heal','ally']],
 'wounded ally healing remains ahead of surplus investment');
state.creeps=[];
state.room.controller.my=false;
assert.equal(mgr._test.surplusCoreHardening(state),false);
state.room.controller.my=true;
// RCL 4 and absent/untrusted controller data never authorize expensive target.
state.room.controller.level=4;
assert.equal(mgr._test.surplusCoreHardening(state),false);
state.room.controller.level=6;
state.room.controller.safeModeAvailable=undefined;
state.energyStored=14000;
assert.equal(mgr._test.surplusCoreHardening(state),false,
 'unknown Safe Mode stock is not conflated with zero charges');
assert.match(src,/Math\.max\(baseTarget,300000\)/);
assert.equal((src.match(/const hostile = selectHostile\(state\)/g)||[]).length,1);
console.log('D16 surplus-only 300k own core hardening, explicit zero Safe Mode reserve and combat/upgrade safety regression PASS');
