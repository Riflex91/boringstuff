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
global.FIND_DROPPED_RESOURCES=1;
global.FIND_STRUCTURES=2;
global.STRUCTURE_CONTAINER='container';
global.OK=0;
global.ERR_NOT_IN_RANGE=-9;
global.ERR_NOT_ENOUGH_RESOURCES=-6;
const energy=require('../game/energy.js');
function make({role='upgrader',storageRange=14,controllerBufferEnergy=120,
  storageEnergy=500,withController=true}={}) {
  const controllerBuffer={id:'controller-buffer',structureType:STRUCTURE_CONTAINER,
    store:{energy:controllerBufferEnergy}};
  const storage={id:'central-storage',store:{energy:storageEnergy}};
  const calls=[];
  const creep={
    memory:{role},store:{energy:0,getFreeCapacity(){return 100;}},
    room:{storage,controller:withController?{
      pos:{findInRange(type,range,opts){
        assert.equal(type,FIND_STRUCTURES);
        assert.equal(range,1);
        return [controllerBuffer].filter(opts.filter);
      }}
    }:null},
    pos:{
      findInRange(type){assert.equal(type,FIND_DROPPED_RESOURCES);return [];},
      findClosestByPath(xs){return xs[0]||null;},
      getRangeTo(obj){return obj===storage?storageRange:2;}
    },
    withdraw(obj){calls.push(['withdraw',obj.id]);return OK;},
    moveTo(obj){calls.push(['move',obj.id]);return OK;}
  };
  return {creep,calls,storage,controllerBuffer};
}
{
  const {creep,calls}=make();
  assert.equal(energy.acquireForConsumer(creep),true);
  assert.deepEqual(calls,[['withdraw','controller-buffer']],
    'funded controller buffer outranks far storage for active upgraders');
}
{
  const {creep,calls}=make({controllerBufferEnergy:0,storageRange:14});
  assert.equal(energy.acquireForConsumer(creep),false);
  assert.deepEqual(calls,[],
    'empty controller-side buffer must not initiate a long upgrader storage trip');
}
{
  const {creep,calls}=make({controllerBufferEnergy:0,storageRange:3});
  assert.equal(energy.acquireForConsumer(creep),true);
  assert.deepEqual(calls,[['withdraw','central-storage']],
    'nearby storage remains a valid local energy source');
}
{
  const {creep,calls}=make({role:'worker',withController:false,storageRange:20});
  assert.equal(energy.acquireForConsumer(creep),true);
  assert.deepEqual(calls,[['withdraw','central-storage']],
    'normal workers retain their previous acquisition policy');
}
{
  const {creep,calls}=make({storageRange:2});
  creep.withdraw=target=>{calls.push(['withdraw',target.id]);return ERR_NOT_IN_RANGE;};
  assert.equal(energy.acquireForConsumer(creep),true);
  assert.deepEqual(calls,[['withdraw','controller-buffer'],['move','controller-buffer']],
    'accepted controller-buffer travel must not be overwritten by storage');
}
{
  const {creep,calls}=make({controllerBufferEnergy:100,storageRange:2});
  creep.withdraw=target=>{calls.push(['withdraw',target.id]);return ERR_NOT_ENOUGH_RESOURCES;};
  assert.equal(energy.acquireForConsumer(creep),false);
  assert.deepEqual(calls,[['withdraw','controller-buffer'],['withdraw','central-storage']],
    'raced-empty controller buffer can fall back only to a genuinely nearby source');
}
{
  const {creep,calls}=make({controllerBufferEnergy:0,storageRange:5});
  assert.equal(energy.acquireForConsumer(creep),false);
  assert.deepEqual(calls,[], 'storage distance >4 never authorizes an upgrader trek');
}
console.log('E12 upgrader controller-local energy selection regressions PASS');
