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

console.log('economy model tests passed');
