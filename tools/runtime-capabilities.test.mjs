import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.STRUCTURE_FACTORY = 'factory';
global.STRUCTURE_LAB = 'lab';
global.STRUCTURE_OBSERVER = 'observer';
global.STRUCTURE_NUKER = 'nuker';
global.POWER_CREEP_LIFE_TIME = 5000;
global.RawMemory = { setActiveSegments() {} };
global.InterShardMemory = { getLocal() { return '{}'; } };

const capabilities = require('../game/runtime.capabilities.js');

{
  const game = {
    time: 12345,
    shard: { name: 'shard-test' },
    cpu: { limit: 20, bucket: 9876, getHeapStatistics() {} },
    gcl: { level: 4 },
    market: {},
    powerCreeps: {},
    map: { getRoomStatus() { return { status: 'normal' }; } },
    rooms: {
      E1N1: { controller: { my: true } },
      E1N2: { controller: { my: false } },
      E2N1: { controller: { my: true } }
    }
  };

  const observed = capabilities.observe(game);
  assert.equal(observed.schemaVersion, 1);
  assert.equal(observed.environment.shardName, 'shard-test');
  assert.equal(observed.cpu.limit, 20);
  assert.equal(observed.cpu.bucket, 9876);
  assert.equal(observed.cpu.heapStatsAvailable, true);
  assert.equal(observed.persistence.segmentsAvailable, true);
  assert.equal(observed.persistence.interShardMemoryAvailable, true);
  assert.equal(observed.systems.marketAvailable, true);
  assert.equal(observed.systems.powerCreepsAvailable, true);
  assert.equal(observed.systems.factoriesAvailable, true);
  assert.equal(observed.systems.labsAvailable, true);
  assert.equal(observed.systems.observersAvailable, true);
  assert.equal(observed.systems.nukersAvailable, true);
  assert.equal(observed.ownership.gclLevel, 4);
  assert.equal(observed.ownership.ownedRooms, 2);
  assert.equal(observed.ownership.activeClaimCommitments, 0);
  assert.equal(observed.ownership.discoveredClaimLimit, null);
  assert.equal(observed.world.roomStatusAvailable, true);
  assert.equal(observed.observed.lastUpdatedTick, 12345);
}

{
  delete global.STRUCTURE_FACTORY;
  delete global.STRUCTURE_LAB;
  delete global.STRUCTURE_OBSERVER;
  delete global.STRUCTURE_NUKER;
  delete global.POWER_CREEP_LIFE_TIME;
  delete global.RawMemory;
  delete global.InterShardMemory;

  const game = {
    time: 7,
    cpu: {},
    rooms: {}
  };

  const observed = capabilities.observe(game);
  assert.equal(observed.environment.shardName, null);
  assert.equal(observed.cpu.limit, null);
  assert.equal(observed.cpu.bucket, null);
  assert.equal(observed.cpu.heapStatsAvailable, false);
  assert.equal(observed.persistence.segmentsAvailable, false);
  assert.equal(observed.persistence.interShardMemoryAvailable, false);
  assert.equal(observed.systems.marketAvailable, false);
  assert.equal(observed.systems.powerCreepsAvailable, false);
  assert.equal(observed.systems.factoriesAvailable, false);
  assert.equal(observed.systems.labsAvailable, false);
  assert.equal(observed.systems.observersAvailable, false);
  assert.equal(observed.systems.nukersAvailable, false);
  assert.equal(observed.ownership.gclLevel, null);
  assert.equal(observed.ownership.ownedRooms, 0);
  assert.equal(observed.world.roomStatusAvailable, false);
  assert.equal(observed.observed.lastUpdatedTick, 7);
}

console.log('runtime capabilities tests passed');