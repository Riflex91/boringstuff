import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);

global.RESOURCE_ENERGY='energy';
global.STRUCTURE_SPAWN='spawn';
global.STRUCTURE_EXTENSION='extension';
global.STRUCTURE_TOWER='tower';
global.STRUCTURE_CONTAINER='container';
global.FIND_MY_STRUCTURES=1;
global.FIND_HOSTILE_CREEPS=2;
global.FIND_MY_CREEPS=3;
global.OK=0;
global.ERR_NOT_IN_RANGE=-9;
global.ERR_INVALID_TARGET=-7;
global.ERR_FULL=-8;
global.ERR_NO_PATH=-2;
global.Game={time:123456,getObjectById(){return null;}};
const energy=require('../game/energy.js');

function store(capacity,energyAmount){
 return{energy:energyAmount,getCapacity(){return capacity;},
  getFreeCapacity(){return capacity-this.energy;}};
}
const spawn={id:'spawn',structureType:'spawn',store:store(300,250)};
const extension={id:'extension',structureType:'extension',store:store(50,10)};
const tower={id:'tower',structureType:'tower',store:store(1000,600)};
const hostiles=[];
const room={name:'E8N1',energyAvailable:980,energyCapacityAvailable:1050,
 structures:[spawn,extension,tower],hostiles,creeps:[],
 find(kind,opts){
  const collection=kind===FIND_MY_STRUCTURES?this.structures:
   kind===FIND_HOSTILE_CREEPS?this.hostiles:
   kind===FIND_MY_CREEPS?this.creeps:null;
  if(!collection)throw Error('unexpected Room.find '+kind);
  return opts?.filter?collection.filter(opts.filter):collection.slice();
 }};
const creep=(id,role,amount=240)=>{
 const x={id,name:id,room,spawning:false,pos:{getRangeTo(){return 3;}},
  memory:{role,delivering:role==='hauler'},
  store:store(role==='hauler'?300:100,amount),
  transfer(){return OK;},moveTo(){return OK;}};
 if(role==='worker'){
  x.store.energy=0;
  x.memory.waitingEnergyTicks=7;
  x.memory.logisticsFallback=true;
 }
 return x;
};
const h1=creep('ready1','hauler');
const h2=creep('ready2','hauler');
const worker=creep('worker','worker');
room.creeps=[h1,h2,worker];
const attack={body:[{type:'attack',hits:100},{type:'move',hits:100}]};
const scout={body:[{type:'move',hits:100}]};
const targetIds=()=>energy.deliveryTargets(h1).map(x=>x.id);
const guards=()=>energy._test.selectConsumerGuardHaulers(room).map(x=>x.id);
assert.deepEqual(targetIds(),['spawn','extension','tower'],
 'peace: no overfilling Tower over ordinary extension demand');
assert.equal(guards().length,1,'peace: keep one critical consumer guard');
room.hostiles=[scout];
assert.deepEqual(targetIds(),['spawn','extension','tower']);
assert.equal(guards().length,1,
 'harmless scout does not reroute infrastructure logistics');
room.hostiles=[attack];
assert.deepEqual(targetIds(),['spawn','tower','extension'],
 'active attacker + near-full room unlocks 80%-Tower top-up behind Spawn');
assert.deepEqual(guards(),[],
 'sustained siege suspends consumer diversion below 80%-Tower reserve');
assert.equal(energy.shouldPrioritizeConsumer(h1),false);
assert.equal(energy.shouldRescueConsumer(h2),false);
room.energyAvailable=450;
assert.deepEqual(targetIds(),['spawn','extension','tower'],
 'when spawn/extension reserve is low, do not top up 60%-Tower first');
assert.deepEqual(guards(),[],
 'armed siege still preserves ready carrier for hard infrastructure');
tower.store.energy=450;
assert.deepEqual(targetIds(),['spawn','tower','extension'],
 'below-half emergency Tower refill still outranks extension while Spawn first');
tower.store.energy=850;
assert.deepEqual(guards().length,1,
 'when Tower ammunition recovers, critical consumer guard resumes');
assert.deepEqual(targetIds(),['spawn','extension','tower']);
tower.store.energy=600;
room.hostiles=[{body:[{type:'attack',hits:0},{type:'move',hits:100}]}];
assert.equal(guards().length,1,'destroyed attack body is not siege');
room.hostiles=[attack];
room.energyAvailable=1050;
delete tower.store.getCapacity;
assert.deepEqual(targetIds(),['spawn','extension','tower'],
 'unknown Tower capacity cannot reorder extension demand');
assert.deepEqual(guards(),[],
 'unknown Tower capacity during active siege fails closed for consumer diversion');
tower.store.getCapacity=()=>1000;
room.structures=[spawn,extension];
assert.equal(guards().length,1,'rooms without Towers retain legacy consumer routing');
room.structures=[spawn,extension,tower];
room.hostiles=[];
assert.equal(guards().length,1,'peace resumes normal consumer service');
console.log('D7 live-siege ammo-reserve logistics: Spawn priority, partial Tower top-up, guards suspended only under authentic pressure PASS');
