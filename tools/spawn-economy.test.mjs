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
