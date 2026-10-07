import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

global.WORK = 'work';
global.CARRY = 'carry';
global.HARVEST_POWER = 2;
global.CARRY_CAPACITY = 50;
global.BUILD_POWER = 5;
global.UPGRADE_CONTROLLER_POWER = 1;
global.SOURCE_ENERGY_CAPACITY = 3000;
global.ENERGY_REGEN_TIME = 300;
global.FIND_STRUCTURES = 1;
global.STRUCTURE_CONTAINER = 'container';
global.Memory = { rooms: {} };

function pos(distance, containerReady = false) {
  return {
    x: 10,
    y: 10,
    findInRange() {
      return containerReady ? [{ structureType: 'container' }] : [];
    },
    getRangeTo() { return distance; }
  };
}

const sources = [
  { id: 's1', pos: pos(20) },
  { id: 's2', pos: pos(9) }
];
const creeps = [
  { memory: { role: 'harvester', sourceId: 's1' }, getActiveBodyparts: p => p === WORK || p === CARRY ? 1 : 0 },
  { memory: { role: 'harvester', sourceId: 's2' }, getActiveBodyparts: p => p === WORK || p === CARRY ? 1 : 0 },
  { memory: { role: 'builder' }, getActiveBodyparts: p => p === WORK ? 1 : p === CARRY ? 1 : 0 },
  { memory: { role: 'upgrader' }, getActiveBodyparts: p => p === WORK ? 1 : p === CARRY ? 1 : 0 }
];

const state = {
  room: {
    name: 'E8N1',
    findPath(from) { return Array.from({ length: from === sources[0].pos ? 20 : 9 }, () => ({})); }
  },
  spawn: { id: 'spawn1', pos: { x: 20, y: 29 } },
  sources,
  creeps,
  sites: [{ id: 'site' }],
  energyCapacityAvailable: 300
};

const model = require('../game/economy.model.js').analyze(state);
assert.equal(model.theoreticalIncomePerTick, 20);
assert.equal(model.dedicatedHarvestCapacityPerTick, 4);
assert.equal(model.productiveDemandPerTick, 6);
assert.equal(model.recommendedHarvesterWorkParts, 3);
assert.equal(model.nextHarvesterWorkParts, 2);
assert.equal(model.recommendedHarvesterCount, 3);
assert.equal(model.harvesterWorkDeficit, 1);
assert.equal(model.consumerFallbackCount, 0);
assert.equal(model.recommendedHaulerCarryParts, 3);
assert.equal(model.nextHaulerCarryParts, 4);
assert.equal(model.haulerCarryDeficit, 3);
assert.equal(model.recommendedHaulerCount, 1);
assert.equal(model.mode, 'bootstrap-mobile-harvest');
assert.equal(model.sourceRoutes[0].spawnDistance, 20);
assert.equal(model.sourceRoutes[1].spawnDistance, 9);


// v0.2.14 live regression: at tick 3679900 the room had two source
// containers, full 20 e/t mining, and two live haulers with only 10 CARRY
// parts against 12 required. Count-only planning incorrectly considered two
// haulers sufficient. Capacity-aware planning must temporarily request a third
// 550-energy hauler (6 CARRY parts), then fall back to the ideal count of two
// once aggregate carrying capacity is sufficient.
function countedCreep(role, counts, sourceId) {
  return {
    memory: Object.assign({ role }, sourceId ? { sourceId } : {}),
    getActiveBodyparts(part) { return counts[part] || 0; }
  };
}

Memory.rooms = {};
const liveSources = [
  { id: 'ls1', pos: pos(20, true) },
  { id: 'ls2', pos: pos(9, true) }
];
const liveBaseCreeps = [
  countedCreep('harvester', { [WORK]: 6, [CARRY]: 4 }, 'ls1'),
  countedCreep('harvester', { [WORK]: 6, [CARRY]: 4 }, 'ls2'),
  countedCreep('worker', { [WORK]: 2, [CARRY]: 2 }),
  countedCreep('worker', { [WORK]: 2, [CARRY]: 2 }),
  countedCreep('builder', { [WORK]: 2, [CARRY]: 2 }),
  countedCreep('upgrader', { [WORK]: 2, [CARRY]: 2 }),
  countedCreep('hauler', { [CARRY]: 6 }),
  countedCreep('hauler', { [CARRY]: 4 })
];
const liveState = {
  room: {
    name: 'E8N1-live',
    findPath(from) { return Array.from({ length: from === liveSources[0].pos ? 20 : 9 }, () => ({})); }
  },
  spawn: { id: 'spawn-live', pos: { x: 20, y: 29 } },
  sources: liveSources,
  creeps: liveBaseCreeps,
  sites: [{ id: 'site-live' }],
  energyCapacityAvailable: 550
};

const capacityDeficit = require('../game/economy.model.js').analyze(liveState);
assert.equal(capacityDeficit.mode, 'container-logistics');
assert.equal(capacityDeficit.dedicatedHarvestCapacityPerTick, 20);
assert.equal(capacityDeficit.recommendedHaulerCarryParts, 12);
assert.equal(capacityDeficit.haulerCarryParts, 10);
assert.equal(capacityDeficit.nextHaulerCarryParts, 6);
assert.equal(capacityDeficit.haulerCarryDeficit, 2);
assert.equal(capacityDeficit.recommendedHaulerCount, 3);

Memory.rooms = {};
const sufficientState = Object.assign({}, liveState, {
  room: Object.assign({}, liveState.room, { name: 'E8N1-sufficient' }),
  spawn: { id: 'spawn-sufficient', pos: { x: 20, y: 29 } },
  creeps: liveBaseCreeps.concat([countedCreep('hauler', { [CARRY]: 6 })])
});
const capacitySufficient = require('../game/economy.model.js').analyze(sufficientState);
assert.equal(capacitySufficient.haulerCarryParts, 16);
assert.equal(capacitySufficient.haulerCarryDeficit, 0);
assert.equal(capacitySufficient.recommendedHaulerCount, 2);



// shadow.8 live regression: aggregate source-route carrying capacity can be
// exactly sufficient with one 800-energy hauler (10 CARRY) while consumer
// service still starves. The legacy hauler policy only reserves consumer-first
// delivery when at least two haulers exist, so real waiting/fallback pressure
// must temporarily raise the service floor to two without changing E4 authority.
Memory.rooms = {};
const pressureSources = [
  { id: 'ps1', pos: pos(20, true) },
  { id: 'ps2', pos: pos(9, true) }
];
const pressureHarvesterA = countedCreep('harvester', { [WORK]: 4, [CARRY]: 2 }, 'ps1');
const pressureHarvesterB = countedCreep('harvester', { [WORK]: 5, [CARRY]: 2 }, 'ps2');
const pressureHauler = countedCreep('hauler', { [CARRY]: 10 });
const pressureBuilder = countedCreep('builder', { [WORK]: 2, [CARRY]: 1 });
const pressureUpgrader = countedCreep('upgrader', { [WORK]: 4, [CARRY]: 2 });
const pressureBase = {
  room: {
    name: 'E8N1-pressure',
    findPath(from) { return Array.from({ length: from === pressureSources[0].pos ? 20 : 9 }, () => ({})); }
  },
  spawn: { id: 'spawn-pressure', pos: { x: 20, y: 29 } },
  sources: pressureSources,
  creeps: [
    pressureHarvesterA,
    pressureHarvesterB,
    pressureHauler,
    pressureBuilder,
    pressureUpgrader
  ],
  sites: [{ id: 'site-pressure' }],
  energyCapacityAvailable: 800
};

const noConsumerPressure = require('../game/economy.model.js').analyze(pressureBase);
assert.equal(noConsumerPressure.dedicatedHarvestCapacityPerTick, 18);
assert.equal(noConsumerPressure.recommendedHaulerCarryParts, 10);
assert.equal(noConsumerPressure.haulerCarryParts, 10);
assert.equal(noConsumerPressure.haulerCarryDeficit, 0);
assert.equal(noConsumerPressure.consumerCriticalCount, 0);
assert.equal(noConsumerPressure.consumerServiceHaulerFloor, 0);
assert.equal(noConsumerPressure.recommendedHaulerCount, 1);

pressureUpgrader.memory.logisticsFallback = true;
const withConsumerPressure = require('../game/economy.model.js').analyze(pressureBase);
assert.equal(withConsumerPressure.consumerCriticalCount, 1);
assert.equal(withConsumerPressure.consumerServiceHaulerFloor, 2);
assert.equal(withConsumerPressure.haulerCarryDeficit, 0);
assert.equal(withConsumerPressure.recommendedHaulerCount, 2);

// Post-#55 live evidence: two haulers can remain fully utilized while fallback
// persists across completed windows. Escalate only after the two-hauler reserve
// is actually live and severe pressure is concrete: at least one fallback and
// at least two critical consumers. The bootstrap cap still bounds this at 3.
const pressureSecondHauler = countedCreep('hauler', { [CARRY]: 10 });
pressureBuilder.memory.waitingEnergyTicks = 3;
pressureBase.creeps.push(pressureSecondHauler);
const severeConsumerPressure = require('../game/economy.model.js').analyze(pressureBase);
assert.equal(severeConsumerPressure.haulerCarryDeficit, 0);
assert.equal(severeConsumerPressure.consumerFallbackCount, 1);
assert.equal(severeConsumerPressure.consumerCriticalCount, 2);
assert.equal(severeConsumerPressure.consumerServiceHaulerFloor, 3);
assert.equal(severeConsumerPressure.recommendedHaulerCount, 3);

// The same consumer pressure must not jump a one-hauler recovery fleet directly
// to three. Removing the redundant hauler falls back to the existing floor 2.
pressureBase.creeps.pop();
const singleHaulerSeverePressure = require('../game/economy.model.js').analyze(pressureBase);
assert.equal(singleHaulerSeverePressure.consumerFallbackCount, 1);
assert.equal(singleHaulerSeverePressure.consumerCriticalCount, 2);
assert.equal(singleHaulerSeverePressure.consumerServiceHaulerFloor, 2);
assert.equal(singleHaulerSeverePressure.recommendedHaulerCount, 2);

console.log('economy model tests passed');


// Post-#80 live regression: once both source containers are online, a
// degraded harvester body must not make reduced mining self-confirming.
// Live evidence had 2 WORK on the long source and 5 WORK on the short source:
// 7 total WORK / 14 e/t was reported as zero deficit despite 20 e/t source
// capacity. Containerized rooms should recover back to full source throughput.
Memory.rooms = {};
const recoverySources = [
  { id: 'rs1', pos: pos(20, true) },
  { id: 'rs2', pos: pos(9, true) }
];
const degradedMiningState = {
  room: {
    name: 'E8N1-mining-recovery',
    findPath(from) { return Array.from({ length: from === recoverySources[0].pos ? 20 : 9 }, () => ({})); }
  },
  spawn: { id: 'spawn-mining-recovery', pos: { x: 20, y: 29 } },
  sources: recoverySources,
  creeps: [
    countedCreep('harvester', { [WORK]: 2, [CARRY]: 1 }, 'rs1'),
    countedCreep('harvester', { [WORK]: 5, [CARRY]: 1 }, 'rs2'),
    countedCreep('worker', { [WORK]: 4, [CARRY]: 2 }),
    countedCreep('upgrader', { [WORK]: 4, [CARRY]: 2 }),
    countedCreep('upgrader', { [WORK]: 4, [CARRY]: 2 }),
    countedCreep('hauler', { [CARRY]: 8 }),
    countedCreep('hauler', { [CARRY]: 8 }),
    countedCreep('hauler', { [CARRY]: 8 })
  ],
  sites: [],
  energyCapacityAvailable: 800
};
const degradedMining = require('../game/economy.model.js').analyze(degradedMiningState);
assert.equal(degradedMining.theoreticalIncomePerTick, 20);
assert.equal(degradedMining.dedicatedHarvestCapacityPerTick, 14);
assert.equal(degradedMining.productiveDemandPerTick, 8);
assert.equal(degradedMining.harvesterWorkParts, 7);
assert.equal(degradedMining.recommendedHarvesterWorkParts, 10);
assert.equal(degradedMining.nextHarvesterWorkParts, 5);
assert.equal(degradedMining.harvesterWorkDeficit, 3);
assert.equal(degradedMining.recommendedHarvesterCount, 3);

Memory.rooms = {};
const restoredMiningState = Object.assign({}, degradedMiningState, {
  room: Object.assign({}, degradedMiningState.room, { name: 'E8N1-mining-restored' }),
  spawn: { id: 'spawn-mining-restored', pos: { x: 20, y: 29 } },
  creeps: [
    countedCreep('harvester', { [WORK]: 5, [CARRY]: 1 }, 'rs1'),
    countedCreep('harvester', { [WORK]: 5, [CARRY]: 1 }, 'rs2'),
    countedCreep('worker', { [WORK]: 4, [CARRY]: 2 }),
    countedCreep('upgrader', { [WORK]: 4, [CARRY]: 2 }),
    countedCreep('upgrader', { [WORK]: 4, [CARRY]: 2 }),
    countedCreep('hauler', { [CARRY]: 8 }),
    countedCreep('hauler', { [CARRY]: 8 }),
    countedCreep('hauler', { [CARRY]: 8 })
  ]
});
const restoredMining = require('../game/economy.model.js').analyze(restoredMiningState);
assert.equal(restoredMining.dedicatedHarvestCapacityPerTick, 20);
assert.equal(restoredMining.recommendedHarvesterWorkParts, 10);
assert.equal(restoredMining.harvesterWorkDeficit, 0);
assert.equal(restoredMining.recommendedHarvesterCount, 2);


Memory.rooms = {};
const overRecoveredMiningState = Object.assign({}, degradedMiningState, {
  room: Object.assign({}, degradedMiningState.room, { name: 'E8N1-mining-over-recovered' }),
  spawn: { id: 'spawn-mining-over-recovered', pos: { x: 20, y: 29 } },
  creeps: [
    countedCreep('harvester', { [WORK]: 2, [CARRY]: 1 }, 'rs1'),
    countedCreep('harvester', { [WORK]: 2, [CARRY]: 1 }, 'rs1'),
    countedCreep('harvester', { [WORK]: 2, [CARRY]: 1 }, 'rs1'),
    countedCreep('harvester', { [WORK]: 2, [CARRY]: 1 }, 'rs2'),
    countedCreep('harvester', { [WORK]: 3, [CARRY]: 2 }, 'rs2'),
    countedCreep('worker', { [WORK]: 4, [CARRY]: 2 }),
    countedCreep('upgrader', { [WORK]: 4, [CARRY]: 2 }),
    countedCreep('upgrader', { [WORK]: 4, [CARRY]: 2 }),
    countedCreep('hauler', { [CARRY]: 8 }),
    countedCreep('hauler', { [CARRY]: 8 }),
    countedCreep('hauler', { [CARRY]: 8 })
  ]
});
const overRecoveredMining = require('../game/economy.model.js').analyze(overRecoveredMiningState);
assert.equal(overRecoveredMining.dedicatedHarvestCapacityPerTick, 20);
assert.equal(overRecoveredMining.harvesterWorkParts, 11);
assert.equal(overRecoveredMining.recommendedHarvesterWorkParts, 10);
assert.equal(overRecoveredMining.harvesterWorkDeficit, 0);
assert.equal(overRecoveredMining.nextHarvesterWorkParts, 5);
assert.equal(overRecoveredMining.recommendedHarvesterCount, 2);
