import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.RESOURCE_ENERGY = 'energy';
global.FIND_MY_CREEPS = 1;
global.FIND_MY_CONSTRUCTION_SITES = 2;
global.FIND_DROPPED_RESOURCES = 10;
global.FIND_STRUCTURES = 3;
global.STRUCTURE_SPAWN = 'spawn';
global.STRUCTURE_EXTENSION = 'extension';
global.STRUCTURE_CONTAINER = 'container';
global.STRUCTURE_TOWER = 'tower';
global.STRUCTURE_STORAGE = 'storage';
global.STRUCTURE_LINK = 'link';
global.STRUCTURE_TERMINAL = 'terminal';
global.STRUCTURE_ROAD = 'road';
global.STRUCTURE_RAMPART = 'rampart';
global.STRUCTURE_WALL = 'wall';
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.WORK = 'work';

const energy = require('../game/energy.js');
const worker = require('../game/role.worker.js');
const config = require('../game/config.js');

let fallbackAcquireCalls = 0;
const originalAcquireForConsumer = energy.acquireForConsumer;
energy.acquireForConsumer = () => false;
energy.acquire = () => {
  fallbackAcquireCalls += 1;
  return true;
};

const liveHauler = { spawning: false, memory: { role: 'hauler' } };
const creep = {
  memory: { role: 'builder' },
  store: {
    energy: 0,
    getFreeCapacity() { return 50; }
  },
  room: {
    controller: null,
    find(type) {
      if (type === FIND_MY_CREEPS) return [liveHauler];
      if (type === FIND_MY_CONSTRUCTION_SITES) return [];
      return [];
    }
  },
  pos: {
    findClosestByPath() { return null; }
  }
};

for (let i = 0; i < config.CONSUMER_HAULER_WAIT_TICKS; i++) {
  worker._test.acquireWorkEnergy(creep);
}
assert.equal(fallbackAcquireCalls, 0);
assert.equal(Boolean(creep.memory.logisticsFallback), false);

worker._test.acquireWorkEnergy(creep);
assert.equal(fallbackAcquireCalls, 1);
assert.equal(creep.memory.logisticsFallback, true);

// Critical regression check: once fallback starts, the very next tick must
// continue self-acquiring instead of waiting another 12 ticks.
worker._test.acquireWorkEnergy(creep);
assert.equal(fallbackAcquireCalls, 2);
assert.equal(creep.memory.logisticsFallback, true);

// Filling the store ends fallback and switches the creep to working mode.
creep.store.energy = 50;
creep.store.getFreeCapacity = () => 0;
assert.equal(worker._test.needsEnergy(creep), false);
assert.equal(creep.memory.working, true);
assert.equal(creep.memory.logisticsFallback, false);

// Accepted local pickup or movement intents are NOT proof of received energy.
// The consumer must remain critical and eventually enter self-supply fallback
// if CARRY remains empty for the entire bounded hauler wait interval.
{
  creep.memory.working = false;
  creep.memory.waitingEnergyTicks = 0;
  creep.memory.logisticsFallback = false;
  creep.store.energy = 0;
  creep.store.getFreeCapacity = () => 50;
  let acquisitionAttempts = 0;
  energy.acquireForConsumer = () => { acquisitionAttempts++; return true; };
  const beforeFallbackActions = fallbackAcquireCalls;
  for (let n=1;n<=config.CONSUMER_HAULER_WAIT_TICKS;n++) {
    assert.equal(worker._test.acquireWorkEnergy(creep),true);
    assert.equal(creep.memory.waitingEnergyTicks,n,
      'an accepted local acquisition intent must not acknowledge energy');
    assert.equal(energy.isCriticalConsumerRequest(creep),true);
    assert.equal(creep.memory.logisticsFallback,false);
  }
  worker._test.acquireWorkEnergy(creep);
  assert.equal(acquisitionAttempts,config.CONSUMER_HAULER_WAIT_TICKS+1);
  assert.equal(creep.memory.logisticsFallback,true);
  assert.equal(creep.memory.waitingEnergyTicks,0);
  assert.equal(fallbackAcquireCalls,beforeFallbackActions,
    'do not issue a competing pickup/harvest after an active local intent');
  worker._test.acquireWorkEnergy(creep);
  assert.equal(fallbackAcquireCalls,beforeFallbackActions+1,
    'next tick must sustain independent self-supply fallback');
  assert.equal(creep.memory.logisticsFallback,true);
}

// Real acquireForConsumer() may return true solely because moveTo() accepted
// a route toward room.storage. Progress the starvation clock on that path,
// but do not replace the local move with a competing waitNearWork() command.
{
  creep.memory.working = false;
  creep.memory.waitingEnergyTicks = 0;
  creep.memory.logisticsFallback = false;
  creep.store.energy = 0;
  creep.store.getFreeCapacity = () => 50;
  creep.pos.findInRange = () => [];
  let moves = 0;
  creep.moveTo = () => { moves++; return OK; };
  creep.withdraw = () => ERR_NOT_IN_RANGE;
  creep.room.storage = {store:{energy:500}};
  energy.acquireForConsumer = originalAcquireForConsumer;
  for(let n=1;n<=3;n++){
    assert.equal(worker._test.acquireWorkEnergy(creep),true);
    assert.equal(creep.memory.waitingEnergyTicks,n);
    assert.equal(moves,n,'one bounded route movement, not two contradictory moves');
  }
  delete creep.room.storage;
  // A genuinely full store, unlike accepted movement, ends the request.
  creep.store.energy = 50;
  creep.store.getFreeCapacity = () => 0;
  assert.equal(worker._test.needsEnergy(creep),false);
  assert.equal(creep.memory.working,true);
  assert.equal(creep.memory.waitingEnergyTicks,0);
  assert.equal(creep.memory.logisticsFallback,false);
}

console.log('logistics fallback tests passed');
