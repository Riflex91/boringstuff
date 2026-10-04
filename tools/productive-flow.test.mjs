import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

global.WORK = 'work';
global.RESOURCE_ENERGY = 'energy';
global.BUILD_POWER = 5;
global.UPGRADE_CONTROLLER_POWER = 1;

function store(capacity, energy) {
  return {
    energy,
    getCapacity(resource) {
      assert.equal(resource, RESOURCE_ENERGY);
      return capacity;
    }
  };
}

function creep(role, workParts, energy, capacity, waiting = 0, fallback = false) {
  return {
    memory: { role, waitingEnergyTicks: waiting, logisticsFallback: fallback },
    store: store(capacity, energy),
    getActiveBodyparts(part) { return part === WORK ? workParts : 0; }
  };
}

const flow = require('../game/productive.flow.js');

const state = {
  rcl: 2,
  room: {
    controller: {
      my: true,
      level: 2,
      progress: 1200,
      progressTotal: 45000,
      ticksToDowngrade: 18000
    }
  },
  creeps: [
    creep('builder', 2, 50, 100, 4, false),
    creep('worker', 2, 0, 100, 0, false),
    creep('repairer', 1, 100, 100, 0, false),
    creep('upgrader', 3, 0, 150, 0, true),
    creep('hauler', 0, 200, 300)
  ],
  sites: [
    { structureType: 'extension', progress: 50, progressTotal: 200 },
    { structureType: 'road', progress: 100, progressTotal: 300 },
    { structureType: 'extension', progress: 0, progressTotal: 200 }
  ]
};

const current = flow.observe(state);
assert.equal(current.consumers.count, 4);
assert.equal(current.consumers.waitingCount, 1);
assert.equal(current.consumers.criticalCount, 2);
assert.equal(current.consumers.fallbackCount, 1);
assert.equal(current.consumers.emptyCount, 2);
assert.equal(current.consumers.waitingAgeTotal, 4);
assert.equal(current.consumers.maxWaitingEnergyTicks, 4);
assert.equal(current.consumers.byRole.builder.workParts, 2);
assert.equal(current.consumers.byRole.upgrader.workParts, 3);
assert.equal(current.work.productiveWorkParts, 8);
assert.equal(current.work.constructionCapableWorkParts, 5);
assert.equal(current.work.dedicatedControllerWorkParts, 3);
assert.equal(current.work.constructionCapacityPerTick, 25);
assert.equal(current.work.dedicatedControllerCapacityPerTick, 3);
assert.equal(current.construction.siteCount, 3);
assert.equal(current.construction.remainingProgress, 550);
assert.deepEqual(current.construction.byType.extension, { count: 2, remainingProgress: 350 });
assert.deepEqual(current.construction.byType.road, { count: 1, remainingProgress: 200 });
assert.equal(current.controller.demandActive, true);
assert.equal(current.controller.remainingProgress, 43800);

const window = flow.newWindow();
flow.accumulate(window, current);
flow.accumulate(window, current);
const summary = flow.summarize(window, 2, current, {
  controllerProgress: 4,
  constructionProgress: 30
});

assert.equal(summary.consumerSupply.consumerTicks, 8);
assert.equal(summary.consumerSupply.waitingConsumerTicks, 2);
assert.equal(summary.consumerSupply.criticalConsumerTicks, 4);
assert.equal(summary.consumerSupply.fallbackConsumerTicks, 2);
assert.equal(summary.consumerSupply.waitingRatio, 0.25);
assert.equal(summary.consumerSupply.criticalRatio, 0.5);
assert.equal(summary.consumerSupply.fallbackRatio, 0.25);
assert.equal(summary.consumerSupply.averageWaitingAgeWhenWaiting, 4);
assert.equal(summary.consumerSupply.maxWaitingEnergyTicks, 4);
assert.deepEqual(summary.workCapacity.averageWorkPartsByRole, {
  builder: 2,
  worker: 2,
  repairer: 1,
  upgrader: 3
});
assert.equal(summary.workCapacity.averageProductiveWorkParts, 8);
assert.equal(summary.workCapacity.averageConstructionCapacityPerTick, 25);
assert.equal(summary.workCapacity.averageDedicatedControllerCapacityPerTick, 3);
assert.equal(summary.workCapacity.constructionBacklogRatio, 1);
assert.equal(summary.workCapacity.controllerDemandRatio, 1);
assert.equal(summary.actualThroughput.constructionPerTick, 15);
assert.equal(summary.actualThroughput.controllerPerTick, 2);
assert.equal(summary.actualThroughput.totalPerTick, 17);
assert.equal(summary.ending, current);

console.log('productive flow tests passed');
