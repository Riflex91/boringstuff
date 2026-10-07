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

const shadow = require('../game/request.shadow.js');
const registry = require('../game/request.registry.js');

function makeStore(carried, capacity) {
  return {
    energy: carried,
    getFreeCapacity(resource) {
      assert.equal(resource, 'energy');
      return Math.max(0, capacity - carried);
    },
    getCapacity(resource) {
      assert.equal(resource, 'energy');
      return capacity;
    }
  };
}

function makeCreep(id, role, carried, capacity, wait, fallback, roomName = 'E1N1') {
  return {
    id,
    name: id,
    room: { name: roomName },
    pos: { x: 10, y: 20, roomName },
    memory: {
      role,
      waitingEnergyTicks: wait || 0,
      logisticsFallback: !!fallback
    },
    store: makeStore(carried, capacity)
  };
}

{
  const memory = {};
  const worker = makeCreep('worker1', 'worker', 0, 100, 3, true);
  const harvester = makeCreep('harvester1', 'harvester', 0, 50, 0, false);
  const state = {
    room: { name: 'E1N1' },
    emergency: true,
    creeps: [worker, harvester],
    economyModel: {
      recommendedHarvesterWorkParts: 5,
      harvesterWorkDeficit: 2,
      recommendedHaulerCarryParts: 6,
      haulerCarryDeficit: 3
    }
  };

  const result = shadow.produce(state, memory, { time: 100 });
  assert.equal(result.summary.authority, 'SHADOW');
  assert.equal(result.summary.total, 4);
  assert.equal(result.summary.open, 4);
  assert.equal(result.summary.blocked, 0);
  assert.equal(result.summary.byDomain.recovery, 1);
  assert.equal(result.summary.byDomain.economy, 1);
  assert.equal(result.summary.byDomain.logistics, 2);

  const requests = registry.list('E1N1', memory);
  const byKey = Object.fromEntries(requests.map(r => [r.dedupeKey, r]));
  assert.equal(byKey['recovery:bootstrap'].demand.capability, 'bootstrap');
  assert.equal(byKey['economy:harvest-capacity'].demand.amount, 5);
  assert.equal(byKey['economy:harvest-capacity'].utility.current, 2);
  assert.equal(byKey['logistics:haul-capacity'].demand.amount, 6);
  assert.equal(byKey['logistics:haul-capacity'].utility.current, 3);
  const delivery = byKey['logistics:consumer-energy:worker1'];
  assert.equal(delivery.demand.resourceType, 'energy');
  assert.equal(delivery.demand.amount, 100);
  assert.equal(delivery.demand.minimumUsefulAmount, 50);
  assert.equal(delivery.target.id, 'worker1');
  assert.equal(delivery.priority.strategicClass, 'CORE_ECONOMY');
  assert.equal(delivery.priority.base, 100);
  assert.equal(delivery.priority.urgency, 45);
  assert.equal(delivery.shadow, true);
}

{
  const memory = {};
  const activeWorker = makeCreep('worker2', 'worker', 100, 100, 0, false);
  const state = {
    room: { name: 'E2N2' },
    emergency: false,
    creeps: [activeWorker],
    economyModel: { recommendedHarvesterWorkParts: 0, harvesterWorkDeficit: 0, recommendedHaulerCarryParts: 0, haulerCarryDeficit: 0 }
  };
  const result = shadow.produce(state, memory, { time: 200 });
  assert.equal(result.summary.total, 0);
  assert.equal(result.summary.stored, 0);
}

{
  const memory = {};
  const worker = makeCreep('worker3', 'worker', 0, 100, 0, false, 'E3N3');
  const first = shadow.produce({
    room: { name: 'E3N3' },
    emergency: false,
    creeps: [worker],
    economyModel: { recommendedHarvesterWorkParts: 1, harvesterWorkDeficit: 1, recommendedHaulerCarryParts: 0, haulerCarryDeficit: 0 }
  }, memory, { time: 300 });
  assert.equal(first.summary.total, 2);

  worker.store = makeStore(100, 100);
  const second = shadow.produce({
    room: { name: 'E3N3' },
    emergency: false,
    creeps: [worker],
    economyModel: { recommendedHarvesterWorkParts: 0, harvesterWorkDeficit: 0, recommendedHaulerCarryParts: 0, haulerCarryDeficit: 0 }
  }, memory, { time: 301 });
  assert.equal(second.summary.total, 0);
  assert.equal(second.summary.stored, 2);
  assert.equal(second.summary.terminal, 2);
  assert.equal(second.summary.byStatus.SATISFIED, 2);
}

{
  const memory = {};
  const result = shadow.produce({
    room: { name: 'E5N5' },
    emergency: false,
    creeps: [],
    economyModel: {
      recommendedHarvesterWorkParts: 5,
      harvesterWorkDeficit: 0,
      recommendedHaulerCarryParts: 6,
      haulerCarryDeficit: 0
    }
  }, memory, { time: 400 });
  const requests = registry.list('E5N5', memory);
  const byKey = Object.fromEntries(requests.map(r => [r.dedupeKey, r]));
  assert.equal(result.summary.total, 2);
  assert.equal(byKey['economy:harvest-capacity'].demand.amount, 5);
  assert.equal(byKey['economy:harvest-capacity'].utility.current, 0);
  assert.equal(byKey['logistics:haul-capacity'].demand.amount, 6);
  assert.equal(byKey['logistics:haul-capacity'].utility.current, 0);
}

{
  const normal = makeCreep('w-normal', 'worker', 0, 100, 0, false);
  const waiting = makeCreep('w-wait', 'worker', 0, 100, 4, false);
  const fallback = makeCreep('w-fallback', 'worker', 0, 100, 2, true);
  assert.equal(shadow._test.consumerPriority(normal).base, 75);
  assert.equal(shadow._test.consumerPriority(waiting).base, 85);
  assert.equal(shadow._test.consumerPriority(fallback).base, 100);
  assert.ok(shadow._test.consumerPriority(fallback).urgency > shadow._test.consumerPriority(waiting).urgency);
}

{
  // I1 registry integration belongs here as well as in the dedicated scout
  // suite: request.shadow must publish the scouting domain and expose the
  // compact frontier summary without disturbing the existing E0/E3 contracts.
  const memory = {
    bot: {
      worldIntel: {
        schemaVersion: 1,
        rooms: {
          E6N6: {
            schemaVersion: 1,
            roomName: 'E6N6',
            observation: { lastSeenTick: 600, confidence: 1, source: 'test' },
            topology: { exits: [{ direction: 1, roomName: 'E6N7' }] }
          }
        }
      }
    }
  };
  const result = shadow.produce({
    room: { name: 'E6N6' },
    emergency: false,
    creeps: [],
    structures: [],
    economyModel: {
      recommendedHarvesterWorkParts: 0,
      harvesterWorkDeficit: 0,
      recommendedHaulerCarryParts: 0,
      haulerCarryDeficit: 0
    }
  }, memory, { time: 600, map: {} });

  assert.equal(result.summary.total, 1);
  assert.equal(result.summary.byDomain.scouting, 1);
  assert.equal(result.scoutingFrontier.authority, 'SHADOW');
  assert.equal(result.scoutingFrontier.homeRoom, 'E6N6');
  assert.equal(result.scoutingFrontier.requestCount, 1);

  const requests = registry.list('E6N6', memory);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, 'SCOUT_INTEL');
  assert.equal(requests[0].domain, 'scouting');
  assert.equal(requests[0].source.roomName, 'E6N6');
  assert.equal(requests[0].target.roomName, 'E6N7');
  assert.equal(requests[0].shadow, true);
}

console.log('request shadow tests passed');