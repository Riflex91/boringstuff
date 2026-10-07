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
  global.Game = { time: 5000, creeps: { scout: { name:'scout', memory:{ role:'scout', home:'E8N1' }, room:{ name:'E8N1' } } } };
  const s = spawnState(20);
  assert.equal(spawnManager._test.productivePrespawnHorizon('worker', s.state), 39);
  assert.equal(spawnManager._test.countRoleAvailable(s.state, 'worker'), 0);
  assert.equal(spawnManager.spawnOne(s.state), true);
  assert.equal(s.spawned().opts.memory.role, 'worker');
}

{
  global.Game = { time: 5100, creeps: { scout: { name:'scout', memory:{ role:'scout', home:'E8N1' }, room:{ name:'E8N1' } } } };
  const s = spawnState(40);
  assert.equal(spawnManager._test.countRoleAvailable(s.state, 'worker'), 1);
  assert.equal(spawnManager.spawnOne(s.state), false);
}

{
  global.Game = { time: 5200, creeps: { scout: { name:'scout', memory:{ role:'scout', home:'E8N1' }, room:{ name:'E8N1' } } } };
  const s = spawnState(20);
  const spawningName = 'wor-E8N1-existing';
  s.state.spawn.spawning = { name: spawningName, remainingTime: 12 };
  Memory.creeps[spawningName] = { role: 'worker', home: 'E8N1' };
  assert.equal(spawnManager._test.countRoleAvailable(s.state, 'worker'), 1);
}


{
  // A productive prespawn shortfall may use the immediately-affordable
  // 200-energy replacement body instead of waiting for the normal 300-energy
  // degraded-body threshold and losing the remaining TTL window.
  global.Game = { time: 5300, creeps: { scout: { name:'scout', memory:{ role:'scout', home:'E8N1' }, room:{ name:'E8N1' } } } };
  const s = spawnState(500);
  const creeps = s.state.room.find(FIND_MY_CREEPS);
  const builder = creeps.find(c => c.memory.role === 'builder');
  builder.ticksToLive = 13;
  s.state.energyAvailable = 294;

  assert.equal(spawnManager._test.productivePrespawnShortfall(s.state, 'builder', 1), true);
  assert.equal(spawnManager.spawnOne(s.state), true);
  assert.equal(s.spawned().opts.memory.role, 'builder');
  assert.deepEqual(s.spawned().body, [WORK, CARRY, MOVE]);
}

{
  // The low-energy exception is prespawn-only. A role that is already absent
  // must retain the normal 300-energy non-emergency floor.
  global.Game = { time: 5400, creeps: { scout: { name:'scout', memory:{ role:'scout', home:'E8N1' }, room:{ name:'E8N1' } } } };
  const s = spawnState(500);
  const creeps = s.state.room.find(FIND_MY_CREEPS);
  const builderIndex = creeps.findIndex(c => c.memory.role === 'builder');
  creeps.splice(builderIndex, 1);
  s.state.byRole.builder = 0;
  s.state.energyAvailable = 294;

  assert.equal(spawnManager._test.productivePrespawnShortfall(s.state, 'builder', 1), false);
  assert.equal(spawnManager.spawnOne(s.state), false);
}

{
  // RCL2+ essential ordering must use prespawn-aware worker availability too;
  // otherwise an expiring sole worker can be delayed behind economy scaling.
  global.Game = { time: 5500, creeps: { scout: { name:'scout', memory:{ role:'scout', home:'E8N1' }, room:{ name:'E8N1' } } } };
  const s = spawnState(20);
  s.state.energyAvailable = 294;
  s.state.economyModel.recommendedHarvesterCount = 3;
  s.state.economyModel.recommendedHarvesterWorkParts = 6;
  s.state.economyModel.harvesterWorkParts = 4;

  assert.equal(spawnManager._test.productivePrespawnShortfall(s.state, 'worker', 1), true);
  assert.equal(spawnManager.spawnOne(s.state), true);
  assert.equal(s.spawned().opts.memory.role, 'worker');
  assert.deepEqual(s.spawned().body, [WORK, CARRY, MOVE]);
}


{
  // Live post-#69 regression: source-container logistics does not stop merely
  // because construction sites reached zero. The economy model can still
  // require haulers for source-route transport, spawn/extensions, and upgraders.
  const noSites = {
    rcl: 3,
    sites: [],
    structures: [],
    hostileCreeps: [],
    sources: [{ id:'a' }, { id:'b' }],
    energyStored: 6241,
    energyAvailable: 800,
    energyCapacityAvailable: 800,
    byRole: { harvester:2, worker:1, builder:0, upgrader:2, hauler:0 },
    economyMetrics: { energyCappedStreak: 28, spawnIdleStreak: 54 },
    economyModel: {
      recommendedHarvesterCount: 2,
      recommendedHarvesterWorkParts: 10,
      harvesterWorkParts: 10,
      recommendedHaulerCount: 2,
      sourceContainersReady: 2
    },
    emergency: false
  };
  const want = spawnManager.desired(noSites);
  assert.equal(want.builder, 0);
  assert.equal(want.hauler, 2);
}


{
  global.Game = { time: 5600, creeps: { scout: { name:'scout', memory:{ role:'scout', home:'E8N1' }, room:{ name:'E8N1' } } } };
  const s = spawnState(500);
  s.state.sites = [];
  s.state.economyModel.recommendedHaulerCount = 2;
  s.state.energyStored = 1000;
  assert.equal(spawnManager.spawnOne(s.state), true);
  assert.equal(s.spawned().opts.memory.role, 'hauler');
}


{
  // Post-#76 live surplus regression: once construction is complete and both
  // mining/logistics are healthy, sustained capped energy should buy exactly
  // one bounded extra upgrader instead of leaving the spawn idle indefinitely.
  const surplus = {
    rcl: 3,
    sites: [],
    structures: [],
    hostileCreeps: [],
    sources: [{ id:'a' }, { id:'b' }],
    energyStored: 5800,
    energyAvailable: 800,
    energyCapacityAvailable: 800,
    byRole: { harvester:2, worker:1, builder:0, upgrader:2, hauler:3 },
    economyMetrics: { energyCappedStreak: 75, spawnIdleStreak: 178 },
    economyModel: {
      recommendedHarvesterCount: 2,
      recommendedHarvesterWorkParts: 10,
      harvesterWorkParts: 10,
      harvesterWorkDeficit: 0,
      recommendedHaulerCount: 2,
      recommendedHaulerCarryParts: 12,
      haulerCarryParts: 20,
      haulerCarryDeficit: 0,
      consumerCriticalCount: 0,
      consumerFallbackCount: 0,
      sourceContainersReady: 2
    },
    emergency: false
  };
  const want = spawnManager.desired(surplus);
  assert.equal(want.upgrader, 3);

  const pressured = Object.assign({}, surplus, {
    economyModel: Object.assign({}, surplus.economyModel, { consumerCriticalCount: 1 })
  });
  assert.equal(spawnManager.desired(pressured).upgrader, 2);

  const building = Object.assign({}, surplus, { sites: [{ id:'site-live' }] });
  assert.equal(spawnManager.desired(building).upgrader, 2);
}

{
  global.Game = { time: 5700, creeps: { scout: { name:'scout', memory:{ role:'scout', home:'E8N1' }, room:{ name:'E8N1' } } } };
  const s = spawnState(500);
  const creeps = s.state.room.find(FIND_MY_CREEPS);
  creeps.push({ name:'upgrader-second', ticksToLive:500, memory:{role:'upgrader'} });
  s.state.byRole.upgrader = 2;
  s.state.sites = [];
  s.state.energyStored = 5800;
  s.state.economyMetrics.energyCappedStreak = 75;
  s.state.economyMetrics.spawnIdleStreak = 178;
  Object.assign(s.state.economyModel, {
    harvesterWorkDeficit: 0,
    haulerCarryDeficit: 0,
    consumerCriticalCount: 0,
    consumerFallbackCount: 0,
    sourceContainersReady: 2
  });

  assert.equal(spawnManager.desired(s.state).upgrader, 3);
  assert.equal(spawnManager.spawnOne(s.state), true);
  assert.equal(s.spawned().opts.memory.role, 'upgrader');
  assert.equal(s.spawned().body.filter(p => p === WORK).length, 4);
}


{
  // The third RCL2+ surplus upgrader is optional throughput. If only that
  // optional creep enters its prespawn horizon while the two base upgraders
  // remain healthy, do not create an overlapping replacement and drain room
  // energy. Let it expire, then recreate it only if surplus still exists.
  global.Game = { time: 5800, creeps: { scout: { name:'scout', memory:{ role:'scout', home:'E8N1' }, room:{ name:'E8N1' } } } };
  const s = spawnState(500);
  const creeps = s.state.room.find(FIND_MY_CREEPS);
  const first = creeps.find(c => c.memory.role === 'upgrader');
  first.ticksToLive = 500;
  creeps.push({ name:'upgrader-second', ticksToLive:500, memory:{role:'upgrader'} });
  creeps.push({ name:'upgrader-surplus-old', ticksToLive:20, memory:{role:'upgrader'} });
  s.state.byRole.upgrader = 3;
  s.state.sites = [];
  s.state.energyStored = 5800;
  s.state.economyMetrics.energyCappedStreak = 75;
  s.state.economyMetrics.spawnIdleStreak = 178;
  Object.assign(s.state.economyModel, {
    harvesterWorkDeficit: 0,
    haulerCarryDeficit: 0,
    consumerCriticalCount: 0,
    consumerFallbackCount: 0,
    sourceContainersReady: 2
  });

  const want = spawnManager.desired(s.state);
  assert.equal(want.upgrader, 3);
  assert.equal(spawnManager._test.baseUpgraderTarget(s.state), 2);
  assert.equal(spawnManager._test.countRoleAvailable(s.state, 'upgrader'), 2);
  assert.equal(spawnManager._test.countRoleForDesired(s.state, 'upgrader', want.upgrader), 3);
  assert.equal(spawnManager._test.productivePrespawnShortfall(s.state, 'upgrader', want.upgrader), false);
  assert.equal(spawnManager.spawnOne(s.state), false);
}

{
  // Base upgrader continuity is still protected. With only the two required
  // upgraders present, one entering the prespawn horizon must still trigger a
  // replacement even when the surplus third upgrader is not required.
  global.Game = { time: 5900, creeps: { scout: { name:'scout', memory:{ role:'scout', home:'E8N1' }, room:{ name:'E8N1' } } } };
  const s = spawnState(500);
  const creeps = s.state.room.find(FIND_MY_CREEPS);
  const first = creeps.find(c => c.memory.role === 'upgrader');
  first.ticksToLive = 20;
  creeps.push({ name:'upgrader-second', ticksToLive:500, memory:{role:'upgrader'} });
  s.state.byRole.upgrader = 2;
  s.state.sites = [];
  s.state.energyStored = 5800;
  s.state.economyMetrics.energyCappedStreak = 0;
  s.state.economyMetrics.spawnIdleStreak = 0;
  Object.assign(s.state.economyModel, {
    harvesterWorkDeficit: 0,
    haulerCarryDeficit: 0,
    consumerCriticalCount: 0,
    consumerFallbackCount: 0,
    sourceContainersReady: 2
  });

  const want = spawnManager.desired(s.state);
  assert.equal(want.upgrader, 2);
  assert.equal(spawnManager._test.baseUpgraderTarget(s.state), 2);
  assert.equal(spawnManager._test.countRoleForDesired(s.state, 'upgrader', want.upgrader), 1);
  assert.equal(spawnManager._test.productivePrespawnShortfall(s.state, 'upgrader', want.upgrader), true);
  assert.equal(spawnManager.spawnOne(s.state), true);
  assert.equal(s.spawned().opts.memory.role, 'upgrader');
}
