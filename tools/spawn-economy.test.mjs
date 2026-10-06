import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.WORK = 'work';
global.CARRY = 'carry';
global.MOVE = 'move';
global.BODYPART_COST = { work: 100, carry: 50, move: 50 };
global.CREEP_SPAWN_TIME = 3;
global.OK = 0;
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.ERR_BUSY = -4;
global.STRUCTURE_WALL = 'wall';
global.STRUCTURE_RAMPART = 'rampart';
global.FIND_MY_CREEPS = 1;
global.FIND_MY_SPAWNS = 2;
global.Memory = { creeps: {} };

const spawnManager = require('../game/spawn.manager.js');

const state = {
  rcl: 2,
  sites: Array.from({ length: 8 }, (_, i) => ({ id: 's' + i })),
  structures: [],
  hostileCreeps: [],
  sources: [{ id: 'a' }, { id: 'b' }],
  energyStored: 300,
  byRole: {
    harvester: 2,
    hauler: 1,
    worker: 2,
    builder: 2,
    upgrader: 1
  },
  economyMetrics: {
    energyCappedStreak: 25,
    spawnIdleStreak: 25
  },
  economyModel: {
    recommendedHarvesterCount: 6,
    recommendedHaulerCount: 3
  },
  emergency: false
};

const desired = spawnManager.desired(state);
assert.equal(desired.harvester, 5);
assert.equal(desired.hauler, 3);
assert.equal(desired.worker, 2);
assert.equal(desired.builder, 2);
assert.equal(desired.upgrader, 1);

{
  // Scouts roam outside the home room. They must still count against the
  // home colony's desired scout population.
  global.Game = {
    creeps: {
      local: {
        name: 'local',
        memory: { role: 'scout', home: 'E8N1', born: 100 },
        room: { name: 'E7N1' }
      },
      foreign: {
        name: 'foreign',
        memory: { role: 'scout', home: 'E9N1', born: 101 },
        room: { name: 'E8N1' }
      }
    }
  };
  const room = {
    name: 'E8N1',
    find(type) {
      if (type === FIND_MY_CREEPS) return [];
      if (type === FIND_MY_SPAWNS) return [];
      return [];
    }
  };
  assert.equal(spawnManager._test.countRole(room, 'scout'), 1);
}

console.log('spawn economy tests passed');


function mockRoom(creeps, spawn) {
  return {
    name: 'E8N1',
    find(type, opts) {
      let values = [];
      if (type === FIND_MY_CREEPS) values = creeps;
      else if (type === FIND_MY_SPAWNS) values = [spawn];
      return opts && opts.filter ? values.filter(opts.filter) : values;
    }
  };
}

function spawnState(workerTtl) {
  const creeps = [
    { name:'har-a', ticksToLive:500, memory:{role:'harvester'} },
    { name:'har-b', ticksToLive:500, memory:{role:'harvester'} },
    { name:'worker-old', ticksToLive:workerTtl, memory:{role:'worker'} },
    { name:'builder', ticksToLive:500, memory:{role:'builder'} },
    { name:'upgrader', ticksToLive:500, memory:{role:'upgrader'} }
  ];
  let spawned = null;
  const spawn = {
    spawning: null,
    spawnCreep(body, name, opts) {
      spawned = { body, name, opts };
      Memory.creeps[name] = opts.memory;
      return OK;
    }
  };
  return {
    state: {
      rcl: 3,
      sites: [{id:'site'}],
      structures: [],
      hostileCreeps: [],
      sources: [{id:'a'},{id:'b'}],
      energyStored: 1000,
      energyAvailable: 800,
      energyCapacityAvailable: 800,
      byRole: { harvester:2, worker:1, builder:1, upgrader:1, hauler:0 },
      economyMetrics: { energyCappedStreak: 0, spawnIdleStreak: 0 },
      economyModel: {
        recommendedHarvesterCount: 2,
        recommendedHarvesterWorkParts: 4,
        harvesterWorkParts: 4,
        recommendedHaulerCount: 0,
        sourceContainersReady: 2
      },
      emergency: false,
      spawn,
      room: mockRoom(creeps, spawn)
    },
    spawned: () => spawned
  };
}

{
  global.Game = { time: 5000, creeps: {} };
  const s = spawnState(20);
  assert.equal(spawnManager._test.productivePrespawnHorizon('worker', s.state), 39);
  assert.equal(spawnManager._test.countRoleAvailable(s.state, 'worker'), 0);
  assert.equal(spawnManager.spawnOne(s.state), true);
  assert.equal(s.spawned().opts.memory.role, 'worker');
}

{
  global.Game = { time: 5100, creeps: {} };
  const s = spawnState(40);
  assert.equal(spawnManager._test.countRoleAvailable(s.state, 'worker'), 1);
  assert.equal(spawnManager.spawnOne(s.state), false);
}

{
  global.Game = { time: 5200, creeps: {} };
  const s = spawnState(20);
  const spawningName = 'wor-E8N1-existing';
  s.state.spawn.spawning = { name: spawningName, remainingTime: 12 };
  Memory.creeps[spawningName] = { role: 'worker', home: 'E8N1' };
  assert.equal(spawnManager._test.countRoleAvailable(s.state, 'worker'), 1);
}
