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
global.CLAIM = 'claim';
global.ATTACK = 'attack';
global.RANGED_ATTACK = 'ranged_attack';
global.HEAL = 'heal';
global.TOUGH = 'tough';
global.FIND_MY_SPAWNS = 1;

global.Memory = { creeps: {} };
global.Game = { time: 5000, creeps: {} };

const colonyState = require('../game/colony.state.js');

function creep(name, parts, ttl) {
  return {
    name,
    ticksToLive: ttl,
    getActiveBodyparts(type) { return parts[type] || 0; }
  };
}

{
  const worker = creep('worker1', { work: 2, carry: 2, move: 2 }, 1200);
  const hauler = creep('hauler1', { carry: 4, move: 2 }, 900);
  const hostile = creep('enemy1', { attack: 3, move: 3, tough: 2 }, 1000);

  Game.creeps.spawning1 = {
    body: [{ type: 'work' }, { type: 'carry' }, { type: 'move' }]
  };

  const spawn = {
    my: true,
    structureType: 'spawn',
    spawning: { name: 'spawning1', remainingTime: 3 }
  };

  const sourceA = { id: 'sourceA', energy: 2500, ticksToRegeneration: 100 };
  const sourceB = { id: 'sourceB', energy: 3000, ticksToRegeneration: 200 };

  const room = {
    name: 'E1N1',
    controller: {
      my: true,
      level: 3,
      progress: 1000,
      progressTotal: 5000,
      ticksToDowngrade: 18000,
      safeMode: 0,
      safeModeAvailable: 2
    },
    find(type) {
      if (type === FIND_MY_SPAWNS) return [spawn];
      return [];
    }
  };

  const state = {
    room,
    rcl: 3,
    creeps: [worker, hauler],
    hostileCreeps: [hostile],
    sites: [{ structureType: 'extension', progress: 20, progressTotal: 100 }],
    structures: [
      spawn,
      { my: true, structureType: 'extension' },
      { my: false, structureType: 'road' }
    ],
    sources: [sourceA, sourceB],
    energyStored: 4200,
    energyAvailable: 300,
    energyCapacityAvailable: 550,
    emergency: false,
    economyModel: {
      mode: 'container-logistics',
      dedicatedHarvestCapacityPerTick: 18,
      productiveDemandPerTick: 12,
      haulerCarryParts: 4,
      recommendedHaulerCarryParts: 6,
      haulerCarryDeficit: 2,
      consumerRequestCount: 2,
      consumerWaitingCount: 1,
      consumerFallbackCount: 0,
      consumerDeliveryReservations: 1,
      sourceRoutes: [
        { sourceId: 'sourceA', spawnDistance: 10, containerReady: true, dedicatedIncomePerTick: 10 },
        { sourceId: 'sourceB', spawnDistance: 20, containerReady: false, dedicatedIncomePerTick: 8 }
      ]
    },
    health: { status: 'HEALTHY', overallScore: 91, reasons: [] },
    efficiency: { status: 'WATCH', overallScore: 70, reasons: ['UNDERUTILIZED'] }
  };

  const snapshot = colonyState.build(state, { tick: 5000, bucket: 8123 });

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.authority, 'SHADOW');
  assert.equal(snapshot.roomName, 'E1N1');
  assert.equal(snapshot.mode, 'DEFENSE');
  assert.equal(snapshot.controller.level, 3);
  assert.equal(snapshot.stores.energyStored, 4200);
  assert.equal(snapshot.structures.count, 3);
  assert.equal(snapshot.structures.byType.spawn, 1);
  assert.equal(snapshot.structures.byType.extension, 1);
  assert.equal(snapshot.structures.byType.road, 1);
  assert.equal(snapshot.structures.ownedByType.spawn, 1);
  assert.equal(snapshot.structures.ownedByType.extension, 1);
  assert.equal(snapshot.construction.siteCount, 1);
  assert.equal(snapshot.construction.remainingProgress, 80);
  assert.equal(snapshot.capacity.active.work, 2);
  assert.equal(snapshot.capacity.active.carry, 6);
  assert.equal(snapshot.capacity.active.move, 4);
  assert.equal(snapshot.capacity.ttl.min, 900);
  assert.equal(snapshot.capacity.ttl.max, 1200);
  assert.equal(snapshot.capacity.ttl.average, 1050);
  assert.equal(snapshot.capacity.spawning.work, 1);
  assert.equal(snapshot.capacity.spawning.carry, 1);
  assert.equal(snapshot.capacity.spawning.move, 1);
  assert.equal(snapshot.capacity.projected.available, false);
  assert.equal(snapshot.capacity.queued.available, false);
  assert.equal(snapshot.logistics.mode, 'container-logistics');
  assert.equal(snapshot.logistics.haulerCarryDeficit, 2);
  assert.equal(snapshot.logistics.consumerWaiting, 1);
  assert.equal(snapshot.sources[0].spawnDistance, 10);
  assert.equal(snapshot.sources[1].containerReady, false);
  assert.equal(snapshot.threat.hostileCount, 1);
  assert.equal(snapshot.threat.hostileActiveParts.attack, 3);
  assert.equal(snapshot.cpu.bucket, 8123);
  assert.equal(snapshot.health.status, 'HEALTHY');
  assert.equal(snapshot.efficiency.status, 'WATCH');
  assert.equal(snapshot.requests.available, false);

  const json = JSON.stringify(snapshot);
  assert.equal(typeof json, 'string');
  const parsed = JSON.parse(json);
  assert.equal(parsed.roomName, 'E1N1');
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'room'), false);
}

{
  const base = {
    room: {
      name: 'E2N2',
      controller: { my: true, level: 2 },
      find() { return []; }
    },
    rcl: 2, creeps: [], hostileCreeps: [], sites: [], structures: [], sources: [],
    energyStored: 0, energyAvailable: 0, energyCapacityAvailable: 300,
    economyModel: null, health: null, efficiency: null
  };

  assert.equal(colonyState.build({ ...base, emergency: true }).mode, 'RECOVERY');
  assert.equal(colonyState.build({ ...base, emergency: false, rcl: 1, room: { ...base.room, controller: { my: true, level: 1 } } }).mode, 'BOOTSTRAP');
  assert.equal(colonyState.build({ ...base, emergency: false }).mode, 'STABLE');
}

{
  const base = {
    room: {
      name: 'E3N3',
      controller: { my: true, level: 2 },
      find() { return []; }
    },
    rcl: 2,
    creeps: [],
    hostileCreeps: [],
    sites: [],
    structures: [],
    sources: [],
    energyStored: 0,
    energyAvailable: 300,
    energyCapacityAvailable: 550,
    emergency: false,
    economyModel: null,
    health: null,
    efficiency: null,
    requestShadow: {
      summary: {
        open: 3,
        blocked: 0,
        total: 3,
        stored: 3,
        terminal: 0,
        reservationCount: 0,
        byStatus: { OPEN: 3 },
        byDomain: { logistics: 3 }
      },
      logisticsGraph: {
        schemaVersion: 1,
        authority: 'SHADOW',
        total: 3,
        totalAmount: 650,
        byKind: { PICKUP: 1, DELIVER: 1, RESERVE: 1 },
        amountByKind: { PICKUP: 500, DELIVER: 100, RESERVE: 50 }
      }
    }
  };
  const snapshot = colonyState.build(base, { tick: 5500, bucket: 9000 });
  assert.equal(snapshot.logisticsRequests.available, true);
  assert.equal(snapshot.logisticsRequests.authority, 'SHADOW');
  assert.equal(snapshot.logisticsRequests.total, 3);
  assert.equal(snapshot.logisticsRequests.byKind.PICKUP, 1);
  assert.equal(snapshot.logisticsRequests.amountByKind.DELIVER, 100);
}

{
  const base = {
    room: {
      name: 'E4N4',
      controller: { my: true, level: 3 },
      find() { return []; }
    },
    rcl: 3,
    creeps: [],
    hostileCreeps: [],
    sites: [],
    structures: [],
    sources: [],
    energyStored: 0,
    energyAvailable: 300,
    energyCapacityAvailable: 550,
    emergency: false,
    economyModel: null,
    health: null,
    efficiency: null,
    capacitySpawnShadow: {
      deficits: [{
        id: 'deficit|harvest',
        capability: 'workHarvest',
        required: 5,
        active: 5,
        projectedSurviving: 0,
        queued: 0,
        spawning: 0,
        deficit: 5,
        proposedCapacity: 5,
        uncoveredAfterPlan: 0,
        preSpawn: true
      }],
      spawnRequests: [{
        id: 'spawn|E4N4|harvest|0',
        role: 'harvester',
        capacityDelivered: 5
      }],
      summary: {
        deferred: false,
        requirementCount: 1,
        deficitCount: 1,
        spawnRequestCount: 1,
        preSpawnCount: 1,
        proposedCapacity: 5,
        uncoveredAfterPlan: 0,
        proposedByRole: { harvester: 1 },
        bodySource: 'LEGACY_BODY_ADAPTER'
      }
    }
  };

  const snapshot = colonyState.build(base, { tick: 6000, bucket: 9000 });
  assert.equal(snapshot.capacity.projected.available, true);
  assert.equal(snapshot.capacity.projected.authority, 'SHADOW');
  assert.equal(snapshot.capacity.projected.deficits[0].preSpawn, true);
  assert.equal(snapshot.capacity.queued.available, false);
  assert.equal(snapshot.capacity.queued.reason, 'SHADOW_PROPOSALS_ARE_NOT_REAL_QUEUE');
  assert.equal(snapshot.spawnPlan.available, true);
  assert.equal(snapshot.spawnPlan.summary.spawnRequestCount, 1);
  assert.equal(snapshot.spawnPlan.requests[0].role, 'harvester');
}


{
  const base = {
    room: {
      name: 'E5N5',
      controller: { my: true, level: 3 },
      find() { return []; }
    },
    rcl: 3,
    creeps: [],
    hostileCreeps: [],
    sites: [],
    structures: [],
    sources: [],
    energyStored: 0,
    energyAvailable: 300,
    energyCapacityAvailable: 550,
    emergency: false,
    economyModel: null,
    health: null,
    efficiency: null,
    logisticsMatchingShadow: {
      jobs: [{
        id: 'e4|E5N5|h1|7000',
        authority: 'SHADOW',
        haulerId: 'h1',
        mode: 'PICKUP_DELIVER',
        amount: 50,
        demandRequestId: 'req|demand'
      }],
      summary: {
        planTick: 7000,
        deferred: false,
        deferReason: null,
        haulerCount: 2,
        candidateCount: 4,
        jobCount: 1,
        matchedHaulerCount: 1,
        haulerUtilization: 0.5,
        pairedJobCount: 1,
        directCarriedJobCount: 0,
        criticalRequestCount: 1,
        criticalMatchedCount: 1,
        unmatchedCriticalCount: 0,
        reservedAmount: 50,
        averageTransportTicks: 12
      }
    }
  };

  const snapshot = colonyState.build(base, { tick: 7000, bucket: 9500 });
  assert.equal(snapshot.logisticsMatching.available, true);
  assert.equal(snapshot.logisticsMatching.authority, 'SHADOW');
  assert.equal(snapshot.logisticsMatching.jobCount, 1);
  assert.equal(snapshot.logisticsMatching.haulerUtilization, 0.5);
  assert.equal(snapshot.logisticsMatching.criticalMatchedCount, 1);
  assert.equal(snapshot.logisticsMatching.jobs[0].mode, 'PICKUP_DELIVER');
}

console.log('colony state tests passed');