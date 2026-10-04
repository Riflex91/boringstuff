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

const registry = require('../game/feature.registry.js');

{
  const game = {
    market: {},
    powerCreeps: {},
    cpu: { getHeapStatistics() {} },
    map: { getRoomStatus() {} }
  };
  const observed = registry.probe(game);
  assert.equal(observed.market, true);
  assert.equal(observed.powerCreeps, true);
  assert.equal(observed.factories, true);
  assert.equal(observed.labs, true);
  assert.equal(observed.observers, true);
  assert.equal(observed.nukers, true);
  assert.equal(observed.segments, true);
  assert.equal(observed.interShardMemory, true);
  assert.equal(observed.roomStatus, true);
  assert.equal(observed.heapStats, true);
}

{
  const capabilities = {
    systems: { marketAvailable: true, labsAvailable: false },
    persistence: { segmentsAvailable: true },
    world: { roomStatusAvailable: false },
    cpu: { heapStatsAvailable: true }
  };
  assert.equal(registry.isAvailable(capabilities, 'market'), true);
  assert.equal(registry.isAvailable(capabilities, 'labs'), false);
  assert.equal(registry.isAvailable(capabilities, 'unknown'), false);
  assert.deepEqual(registry.requirements(capabilities, ['market', 'segments']), { ready: true, missing: [] });
  assert.deepEqual(registry.requirements(capabilities, ['market', 'labs', 'roomStatus']), {
    ready: false,
    missing: ['labs', 'roomStatus']
  });
}

{
  delete global.STRUCTURE_FACTORY;
  delete global.STRUCTURE_LAB;
  delete global.STRUCTURE_OBSERVER;
  delete global.STRUCTURE_NUKER;
  delete global.POWER_CREEP_LIFE_TIME;
  delete global.RawMemory;
  delete global.InterShardMemory;
  const observed = registry.probe({ cpu: {}, map: {} });
  assert.equal(observed.market, false);
  assert.equal(observed.powerCreeps, false);
  assert.equal(observed.factories, false);
  assert.equal(observed.labs, false);
  assert.equal(observed.observers, false);
  assert.equal(observed.nukers, false);
  assert.equal(observed.segments, false);
  assert.equal(observed.interShardMemory, false);
  assert.equal(observed.roomStatus, false);
  assert.equal(observed.heapStats, false);
}

console.log('feature registry tests passed');