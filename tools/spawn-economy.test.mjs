import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.STRUCTURE_WALL = 'wall';
global.STRUCTURE_RAMPART = 'rampart';
global.WORK = 'work';
global.CARRY = 'carry';
global.MOVE = 'move';
global.CREEP_SPAWN_TIME = 3;
global.BODYPART_COST = {
  [WORK]: 100,
  [CARRY]: 50,
  [MOVE]: 50
};

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

function mockHauler(ttl, carryParts, spawning = false) {
  const body = [];
  for (let i = 0; i < carryParts; i++) body.push({ type: CARRY, hits: 100 });
  return {
    memory: { role: 'hauler' },
    ticksToLive: ttl,
    spawning,
    body,
    getActiveBodyparts(part) {
      return part === CARRY ? carryParts : 0;
    }
  };
}

// Live v0.2.20 regression: three haulers can satisfy current carry capacity
// while one is close enough to natural retirement that the post-expiry fleet
// will fall below the already-modeled transport requirement. Replacement must
// start before the loss rather than waiting for a reactive deficit.
{
  const lifecycleState = {
    ...state,
    energyAvailable: 446,
    energyCapacityAvailable: 550,
    creeps: [
      mockHauler(110, 4),
      mockHauler(221, 4),
      mockHauler(400, 6)
    ],
    economyModel: {
      recommendedHaulerCarryParts: 12,
      dedicatedHarvestCapacityPerTick: 20,
      harvesterWorkDeficit: 0,
      sourceRoutes: [
        { spawnDistance: 20 },
        { spawnDistance: 9 }
      ]
    }
  };

  assert.equal(spawnManager._test.haulerReplacementLeadTicks(lifecycleState), 115);
  assert.equal(spawnManager._test.projectedHaulerCarryParts(lifecycleState, 115), 10);
  assert.equal(spawnManager._test.shouldPrespawnHauler(lifecycleState), true);

  lifecycleState.creeps[0].ticksToLive = 116;
  assert.equal(spawnManager._test.projectedHaulerCarryParts(lifecycleState, 115), 14);
  assert.equal(spawnManager._test.shouldPrespawnHauler(lifecycleState), false);

  lifecycleState.creeps[0].ticksToLive = 110;
  lifecycleState.economyModel.harvesterWorkDeficit = 1;
  assert.equal(spawnManager._test.shouldPrespawnHauler(lifecycleState), false);

  lifecycleState.economyModel.harvesterWorkDeficit = 0;
  lifecycleState.creeps.push(mockHauler(undefined, 4, true));
  assert.equal(spawnManager._test.projectedHaulerCarryParts(lifecycleState, 115), 14);
  assert.equal(spawnManager._test.shouldPrespawnHauler(lifecycleState), false);
}

console.log('spawn economy tests passed');
