import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

const roomManager = require('../game/room.manager.js');

const state = {
  room: { name: 'E8N1' },
  rcl: 3,
  energyAvailable: 300,
  energyCapacityAvailable: 650,
  energyStored: 4200,
  byRole: { harvester: 5, hauler: 3 },
  sites: [{}, {}],
  hostileCreeps: [],
  economyMetrics: {
    last100: {
      ticks: 100,
      productiveFlow: {
        consumerTicks: 500
      }
    }
  },
  economyModel: { dedicatedHarvestCapacityPerTick: 18, haulerCarryDeficit: 0 },
  health: { status: 'HEALTHY' },
  efficiency: { status: 'WATCH' },
  requestShadow: {
    summary: { open: 10 },
    logisticsGraph: { total: 5 }
  },
  capacitySpawnShadow: { summary: { spawnRequestCount: 1 } },
  assignmentShadow: { summary: { assignmentCount: 4 } },
  logisticsMatchingShadow: { summary: { jobCount: 3, authority: 'SHADOW' } },
  logisticsMatchingEvidence: {
    current: { ticks: 20, authority: 'SHADOW_EVIDENCE' },
    lastWindow: { ticks: 100, authority: 'SHADOW_EVIDENCE' }
  },
  assignmentEvidence: {
    current: { ticks: 20 },
    lastWindow: { ticks: 100 }
  },
  colonyState: {
    hugeNestedPayload: {
      shouldNotBeSerializedIntoRoomHeartbeat: true
    }
  }
};

const snapshot = roomManager._test.status(state);

assert.equal(snapshot.room, 'E8N1');
assert.equal(snapshot.energy, '300/650');
assert.deepEqual(snapshot.economyModel, state.economyModel);
assert.deepEqual(snapshot.logisticsMatching, state.logisticsMatchingShadow.summary);
assert.deepEqual(snapshot.logisticsMatchingEvidence, state.logisticsMatchingEvidence.lastWindow);
assert.deepEqual(snapshot.assignmentEvidence, state.assignmentEvidence.lastWindow);
assert.equal(snapshot.colonyStateAvailable, true);

assert.equal(Object.hasOwn(snapshot, 'economy'), false);
assert.equal(Object.hasOwn(snapshot, 'colonyState'), false);
assert.equal(JSON.stringify(snapshot).includes('shouldNotBeSerializedIntoRoomHeartbeat'), false);

console.log('room heartbeat tests passed');
