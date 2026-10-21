import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);

Object.assign(global,{
 RESOURCE_ENERGY:'energy',
 STRUCTURE_SPAWN:'spawn',STRUCTURE_EXTENSION:'extension',
 STRUCTURE_TOWER:'tower',STRUCTURE_STORAGE:'storage',
 FIND_MY_STRUCTURES:1,FIND_HOSTILE_CREEPS:2,FIND_MY_CREEPS:3,
 OK:0,ERR_NOT_IN_RANGE:-9,ERR_INVALID_TARGET:-7,ERR_FULL:-8,
 ERR_NO_PATH:-2,
 Game:{time:5600000,getObjectById(){return null;}}
});
const energy=require('../game/energy.js');
const store=(cap,amount)=>({energy:amount,getCapacity(){return cap;},
 getFreeCapacity(){return cap-this.energy;}});
const s=(id,type,cap,amount,x)=>({id,my:true,
 structureType:type,store:store(cap,amount),
 pos:{x,y:10}});
const spawn=s('spawn','spawn',300,250,10);
const ext=s('extension','extension',50,10,12);
const tower=s('tower','tower',1000,600,11);
const storage=s('storage','storage',10000,6000,16);
const enemy=(parts,range=1)=>({body:parts.map(type=>typeof type==='string'
 ?{type,hits:100}:type),pos:{getRangeTo(){return range;}}});
const dismantler=enemy(['work','move']);
const room={name:'E8N1',controller:{my:true,level:6,safeMode:0,
 safeModeAvailable:0},energyAvailable:650,energyCapacityAvailable:1050,
 structures:[spawn,ext,tower,storage],hostiles:[dismantler],creeps:[],
 find(kind,options){
  const x=kind===FIND_MY_STRUCTURES?this.structures:
    kind===FIND_HOSTILE_CREEPS?this.hostiles:
    kind===FIND_MY_CREEPS?this.creeps:null;
  if(!x)throw Error('unsupported Room.find '+kind);
  return options?.filter?x.filter(options.filter):x.slice();
 }};
const hauler={id:'hauler',room,memory:{role:'hauler',delivering:true},
 spawning:false,pos:{getRangeTo(){return 3;}},store:store(300,240),
 transfer(){return OK;},moveTo(){return OK;}};
room.creeps=[hauler];
const targetIds=()=>energy.deliveryTargets(hauler).map(s=>s.id);
const critical=()=>energy._test.noSafeModeCoreTowerRefill(room);
assert.equal(critical(),true,
 'true owned near-core dismantler and actually empty Safe Mode stock');
assert.deepEqual(targetIds(),['spawn','tower','extension'],
 'Spawn ALWAYS first, then Tower ammo 60%-80%, then extension in no-Safe-Mode siege');
room.controller.safeModeAvailable=1;
assert.equal(critical(),false);
assert.deepEqual(targetIds(),['spawn','extension','tower'],
 'normal D7 >=80% room-energy condition retains extension reserve with Safe Mode');
room.controller.safeModeAvailable=undefined;
assert.equal(critical(),false,
 'unknown charges are never interpreted as actually zero');
assert.deepEqual(targetIds(),['spawn','extension','tower']);
room.controller.safeModeAvailable=0;
room.controller.safeMode=100;
assert.equal(critical(),false);
assert.deepEqual(targetIds(),['spawn','extension','tower']);
room.controller.safeMode=0;
room.energyAvailable=524; // 49.9% cap
assert.equal(critical(),false,
 'protect at least 50% of room spawn/extension energy');
assert.deepEqual(targetIds(),['spawn','extension','tower']);
room.energyAvailable=525;
assert.equal(critical(),true);
assert.deepEqual(targetIds(),['spawn','tower','extension']);
room.energyAvailable=450;
tower.store.energy=450;
assert.deepEqual(targetIds(),['spawn','tower','extension'],
 'original D7 truly critical <50% Tower ammo always takes precedence');
tower.store.energy=600;
room.energyAvailable=650;
room.hostiles=[enemy(['move'])];
assert.equal(critical(),false);
assert.deepEqual(targetIds(),['spawn','extension','tower'],
 'scout never diverts supply from Spawn and Extensions');
room.hostiles=[enemy([{type:'work',hits:0},'move'])];
assert.equal(critical(),false,'dead WORK cannot trigger no-mode override');
room.hostiles=[enemy(['heal','move'])];
assert.equal(critical(),false,'HEAL-only foreign parts cannot damage a core');
room.hostiles=[enemy(['work'],2)];
assert.equal(critical(),false,'melee dismantler range 2 cannot damage core yet');
room.hostiles=[enemy(['attack'],2)];
assert.equal(critical(),false);
room.hostiles=[enemy(['ranged_attack'],3)];
assert.equal(critical(),true,'live RANGED_ATTACK part within 3 tiles is genuine core threat');
room.hostiles=[enemy(['ranged_attack'],4)];
assert.equal(critical(),false,'ranged enemy out of range does not reroute');
room.hostiles=[dismantler];
room.controller.my=false;
assert.equal(critical(),false,'no owned room, no resupply exception');
room.controller.my=true;
spawn.my=false;tower.my=false;storage.my=false;
assert.equal(critical(),false,'no authenticated owned core buildings');
spawn.my=true;tower.my=true;storage.my=true;
room.structures=[ext];
assert.equal(critical(),false,'cannot invent core structures or core threat');
room.structures=[spawn,ext,tower,storage];
room.energyAvailable=250;
assert.equal(critical(),false,'<300 room energy cannot be sacrificed for Tower top-up');
room.energyAvailable=650;
// Unknown/invalid game snapshots keep D7 conservative.
const saved=room.find;
room.find=()=>{throw Error('room observation unavailable');};
assert.equal(critical(),false);
room.find=saved;
room.hostiles=Array.from({length:41},()=>dismantler);
assert.equal(critical(),false,'bounded 40 hostiles avoids CPU spiral');
room.hostiles=[enemy(Array.from({length:51},()=> 'work'))];
assert.equal(critical(),false,'bounded 50 parts avoids massive hostile scan');
room.hostiles=[dismantler];
tower.store.energy=850;
assert.deepEqual(targetIds(),['spawn','extension','tower'],
 'Tower already at >=80% does not outrank extension');
tower.store.energy=600;
const originalPos=dismantler.pos;
dismantler.pos={getRangeTo(){return NaN;}};
assert.equal(critical(),false,'invalid hostile range cannot authorize override');
dismantler.pos=originalPos;
// Demonstrate the actual hauler target policy over twelve synthetic ticks.
// A mocked transfer does not establish settled Screeps energy transfers.
spawn.store.energy=250;ext.store.energy=10;tower.store.energy=600;
room.energyAvailable=650;
let spawnRefill=0,towerRefill=0,extensionRefill=0;
for(let tick=0;tick<12;tick++){
  const target=energy.deliveryTargets(hauler)[0];
  assert.ok(target);
  const moved=Math.min(100,target.store.getFreeCapacity());
  target.store.energy+=moved;
  if(target===spawn)spawnRefill+=moved;
  if(target===tower)towerRefill+=moved;
  if(target===ext)extensionRefill+=moved;
  if(spawn.store.energy===300)room.energyAvailable=Math.min(1050,
    room.energyAvailable+moved);
  if(target===tower) tower.store.energy=Math.max(0,tower.store.energy-10);
}
assert.equal(spawnRefill,50,'real policy serves Spawn first');
assert.ok(towerRefill>=200,
 'D17 refills at least 200 hypothetical ammo before extension work');
assert.equal(tower.store.energy>=800,true);
assert.ok(extensionRefill>=0);
console.log('D17 actual hauler target ordering under no-Safe-Mode core combat, strict 50%-room reserve and 12-tick synthetic refill PASS');
