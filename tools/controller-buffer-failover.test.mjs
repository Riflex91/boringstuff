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
global.FIND_STRUCTURES=3;
global.STRUCTURE_CONTAINER='container';
global.OK=0;
global.ERR_NOT_IN_RANGE=-9;
global.ERR_NO_PATH=-2;
global.ERR_INVALID_TARGET=-7;
global.ERR_BUSY=-4;
global.ERR_TIRED=-11;

const energy=require('../game/energy.js');
const role=require('../game/role.hauler.js');
const config=require('../game/config.js');
const buffer={
  structureType:STRUCTURE_CONTAINER,
  store:{getFreeCapacity(resource) {
    assert.equal(resource,RESOURCE_ENERGY);
    return 100;
  }}
};
const storage={id:'storage'};
const room={
  storage,
  controller:{pos:{findInRange(type,range,options) {
    assert.equal(type,FIND_STRUCTURES);
    assert.equal(range,1);
    return [buffer].filter(options.filter);
  }}}
};
const calls=[];
let bufferMovement=OK,storageTransfer=OK;
const hauler={
  room,
  memory:{role:'hauler',delivering:true},
  store:{energy:80,getFreeCapacity(){return 20;},getCapacity(){return 100;}},
  transfer(target,resource) {
    assert.equal(resource,RESOURCE_ENERGY);
    calls.push(['transfer',target]);
    return target===buffer ? ERR_NOT_IN_RANGE : storageTransfer;
  },
  moveTo(target,options) {
    assert.equal(options.maxOps,config.PATH_MAX_OPS);
    calls.push(['move',target]);
    return target===buffer ? bufferMovement : OK;
  }
};
const reset=() => { calls.length=0; bufferMovement=OK; storageTransfer=OK; };
for(const rc of [OK,ERR_BUSY,ERR_TIRED,-99]) {
  reset();bufferMovement=rc;
  assert.equal(energy.deliverToControllerBuffer(hauler),true,
    'nonterminal or indeterminate movement must occupy the tick, not fall through');
  assert.deepEqual(calls,[['transfer',buffer],['move',buffer]]);
}
for(const rc of [ERR_NO_PATH,ERR_INVALID_TARGET]) {
  reset();bufferMovement=rc;
  assert.equal(energy.deliverToControllerBuffer(hauler),false,
    'permanent route failure must permit the existing alternate storage path');
  assert.deepEqual(calls,[['transfer',buffer],['move',buffer]]);
}
// Role-level integration: a path-impossible controller buffer cannot
// strand a delivering carrier with a reachable storage fallback.
const oldPriority=energy.shouldPrioritizeConsumer;
const oldDeliver=energy.deliver;
const oldConsumer=energy.deliverToConsumer;
energy.shouldPrioritizeConsumer=()=>false;
energy.deliver=()=>false;
energy.deliverToConsumer=()=>false;
try {
  for(const terminal of [ERR_NO_PATH,ERR_INVALID_TARGET]) {
    reset();bufferMovement=terminal;
    role.run(hauler);
    assert.deepEqual(calls,[
      ['transfer',buffer],['move',buffer],['transfer',storage]
    ],'one impossible buffer route may retry a distinct storage transfer');
  }
  reset();bufferMovement=ERR_NO_PATH;storageTransfer=ERR_NOT_IN_RANGE;
  role.run(hauler);
  assert.deepEqual(calls,[
    ['transfer',buffer],['move',buffer],['transfer',storage],['move',storage]
  ],'alternate storage movement is bounded and follows terminal buffer failure');
  for(const transient of [OK,ERR_BUSY,ERR_TIRED,-99]) {
    reset();bufferMovement=transient;
    role.run(hauler);
    assert.deepEqual(calls,[['transfer',buffer],['move',buffer]],
      'accepted/transient/unknown first route must never issue a second movement');
  }
} finally {
  energy.shouldPrioritizeConsumer=oldPriority;
  energy.deliver=oldDeliver;
  energy.deliverToConsumer=oldConsumer;
}
// No controller means there is no valid buffer target and no movement intent.
const previousController=room.controller;
room.controller=null;
reset();
assert.equal(energy.deliverToControllerBuffer(hauler),false);
assert.deepEqual(calls,[]);
room.controller=previousController;
console.log('E4 controller-buffer terminal route and storage fallback regression PASS');
