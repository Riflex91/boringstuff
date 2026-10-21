import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const source=fs.readFileSync(new URL('../game/tower.manager.js',import.meta.url),'utf8');
const siege=require('../game/defense.siege.triage.js');
const ctx={module:{exports:{}},
 STRUCTURE_SPAWN:'spawn',STRUCTURE_TOWER:'tower',STRUCTURE_STORAGE:'storage',
 STRUCTURE_RAMPART:'rampart',STRUCTURE_WALL:'wall',
 STRUCTURE_ROAD:'road',STRUCTURE_CONTAINER:'container',RESOURCE_ENERGY:'energy',
 FIND_MY_CREEPS:'my_creeps',
 require(name){if(name==='logger')return{warn(){}};if(name==='defense.siege.triage')return siege;throw Error(name);}};
vm.runInNewContext(source,ctx,{filename:'tower.manager.js'});
const ai=ctx.module.exports;
const hits=(id,type,hits,hitsMax=100000,x=10,y=10,my=true)=>({id,my,structureType:type,hits,hitsMax,pos:{x,y}});
const primary=hits('spawn','spawn',5000,5000,10);
const towerCore=hits('tower-core','tower',3000,3000,11);
const shield=hits('spawn-rampart','rampart',3000,1000000,10);
const road=hits('damaged-road','road',100,5000,13,10,undefined);
const container=hits('damaged-container','container',200,5000,14,10,undefined);
const extension=hits('damaged-extension','extension',100,1000,15);
const events=[];
const tower=(id,energy)=>({id,store:{energy},
 repair(target){events.push({tower:id,kind:'repair',target:target.id});return 0;},
 heal(target){events.push({tower:id,kind:'heal',target:target.id});return 0;},
 attack(target){events.push({tower:id,kind:'attack',target:target.id});return 0;}});
const a=tower('tower-a',920),c=tower('tower-b',970);
const state={room:{name:'E8N1',controller:{my:true,level:6},find(){return[];}},
 towers:[a,c],structures:[primary,towerCore,shield,road,container,extension],
 creeps:[],hostileCreeps:[],energyStored:5500};
const act=()=>{events.length=0;ai.run(state);return events.map(e=>[e.tower,e.kind,e.target]);};

// With two fully stocked towers the OLD D14 Tower logic spends BOTH on a
// scratch road first every peaceful tick. D15 must fortify our Spawn shield
// using only ONE surplus-energy Tower while keeping the other ready.
assert.deepEqual(act(),[['tower-a','repair','spawn-rampart']],
 'essential Spawn Rampart preempts damaged roads and extension');
assert.equal(state.defenseTowerAction.status,'FORTIFY_CORE');
assert.equal(state.defenseTowerAction.repairAttempts,1);

// Truly critical direct Spawn health remains superior to shield hardening.
primary.hits=1500;
assert.deepEqual(act(),[['tower-a','repair','spawn'],['tower-b','repair','spawn']],
 'real owned Spawn below 35% retains dual-tower immediate protection');
assert.equal(state.defenseTowerAction.status,'REPAIR_CORE');
primary.hits=5000;

// A local shield at its actual RCL6 target is sufficiently fortified.
// Routine maintenance is allowed only with 5k+ stored and a >=900 Tower.
shield.hits=120000;
assert.deepEqual(act(),[['tower-a','repair','damaged-road']],
 'one surplus-energy tower may maintain a road after core fortification');
assert.equal(state.defenseTowerAction.status,'REPAIR_DISCRETIONARY');
assert.equal(state.defenseTowerAction.repairAttempts,1);
a.store.energy=870;c.store.energy=890;
assert.deepEqual(act(),[],
 'no Tower below the 900 emergency-ammo reserve repairs discretionary roads');
assert.equal(state.defenseTowerAction.status,'RESERVE_ENERGY');
c.store.energy=1000;
state.energyStored=4900;
assert.deepEqual(act(),[],'stored energy below 5k prevents discretionary repairs');
state.energyStored=5500;

// Foreign/unknown-ownership non-road structures cannot spend our Tower ammo.
state.structures=[primary,towerCore,extension];
extension.my=false;
assert.deepEqual(act(),[],'do not repair non-owned damaged extension');
extension.my=true;
assert.deepEqual(act(),[['tower-b','repair','damaged-extension']],
 'owned critical consumer can be fixed after core is safe');
state.structures=[primary,towerCore,road];
road.my=false;
assert.deepEqual(act(),[],
 'do not repair explicitly foreign road');
road.my=undefined;

// A tower with 800 energy may fortify a core when stored energy >=3k,
// but cannot spend ammo repairing a road when other systems are tight.
state.structures=[primary,towerCore,shield,road];
shield.hits=3000;
a.store.energy=800;c.store.energy=780;
state.energyStored=3100;
assert.deepEqual(act(),[['tower-a','repair','spawn-rampart']],
 'fortification remains available under modest but real storage surplus');
shield.hits=120000;
assert.deepEqual(act(),[],
 'discretionary roads stay blocked with only a 3.1k store');
state.energyStored=1200;
shield.hits=3000;
assert.deepEqual(act(),[],
 'core fortification respects the existing 3k stored-energy reserve');
assert.equal(state.defenseTowerAction.status,'RESERVE_ENERGY',
 'depleted stores also block discretionary maintenance without spending ammo');

// No fighting behavior is reordered; danger always outranks fortification.
state.energyStored=9000;
a.store.energy=1000;c.store.energy=1000;
state.hostileCreeps=[{id:'enemy',body:[{type:'work',hits:100}],
 pos:{getRangeTo(){return 1;}},owner:{username:'enemy'}}];
assert.deepEqual(act(),[['tower-a','attack','enemy'],['tower-b','attack','enemy']],
 'both towers still attack observed living combat enemy');
state.hostileCreeps=[{id:'scout',body:[{type:'move',hits:100}],
 pos:{getRangeTo(){return 1;}}}];
assert.deepEqual(act(),[['tower-a','repair','spawn-rampart']],
 'harmless scout does not steal tower ammo; safe fortification may resume');

// D5 emergency healing of real vulnerable creep remains ahead of all peace
// maintenance and is not diminished by D15.
state.hostileCreeps=[];
state.creeps=[{id:'wounded',hits:100,hitsMax:300}];
assert.deepEqual(act(),[['tower-a','heal','wounded'],['tower-b','heal','wounded']]);
state.creeps=[];
assert.ok(source.indexOf('const coreDamaged =')<source.indexOf('const rampart = coreRampartTarget(state)'));
assert.ok(source.indexOf('const rampart = coreRampartTarget(state)')<
 source.indexOf('const ordinary ='));
assert.equal((source.match(/const hostile = selectHostile\(state\)/g)||[]).length,1);
console.log('D15 Fortify owned critical core before discretionary road repair; reserve and hostile/heal priorities preserved PASS');
