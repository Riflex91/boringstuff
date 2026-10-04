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

console.log('logistics fallback tests passed');
