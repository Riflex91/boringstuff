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
    logisticsGraph: { total: 5 },
    scoutingFrontier: { authority: 'SHADOW', requestCount: 2 }
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
assert.deepEqual(snapshot.scoutingFrontier, state.requestShadow.scoutingFrontier);
assert.deepEqual(snapshot.logisticsMatching, state.logisticsMatchingShadow.summary);
assert.deepEqual(snapshot.logisticsMatchingEvidence, state.logisticsMatchingEvidence.lastWindow);
assert.deepEqual(snapshot.assignmentEvidence, state.assignmentEvidence.lastWindow);
assert.equal(snapshot.colonyStateAvailable, true);

assert.equal(Object.hasOwn(snapshot, 'economy'), false);
assert.equal(Object.hasOwn(snapshot, 'colonyState'), false);
assert.equal(JSON.stringify(snapshot).includes('shouldNotBeSerializedIntoRoomHeartbeat'), false);

{
  const game = {
    cpu: {
      limit: 20,
      getUsed() { return 7; }
    }
  };
  assert.equal(
    roomManager._test.shadowCpuHeadroom('room.assignment', game, {}),
    true,
    'shadow assignment should run when measured work plus reserve fits the tick limit'
  );
}

{
  const game = {
    cpu: {
      limit: 20,
      getUsed() { return 10; }
    }
  };
  assert.equal(
    roomManager._test.shadowCpuHeadroom('room.assignment', game, {}),
    false,
    'shadow assignment should defer before consuming reserved authoritative headroom'
  );
}

{
  const memory = {
    bot: {
      cpu: {
        details: {
          'room.capacity-spawn': { avg: 4, last: 3 }
        }
      }
    }
  };
  const game = {
    cpu: {
      limit: 20,
      getUsed() { return 8; }
    }
  };
  assert.equal(
    roomManager._test.shadowCpuHeadroom('room.capacity-spawn', game, memory),
    false,
    'historical profiler cost should raise the estimated shadow-stage cost'
  );
}

{
  const game = { cpu: { getUsed() { return 100; } } };
  assert.equal(
    roomManager._test.shadowCpuHeadroom('room.assignment', game, {}),
    true,
    'missing runtime CPU limit must fail open rather than suppress SHADOW evidence'
  );
}

console.log('room heartbeat tests passed');
