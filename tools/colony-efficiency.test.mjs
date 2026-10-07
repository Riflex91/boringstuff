import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

const efficiency = require('../game/colony.efficiency.js');

function liveState() {
  return {
    room: { controller: { my: true } },
    rcl: 2,
    spawn: { id: 'spawn1' },
    byRole: { harvester: 5, hauler: 3, worker: 2, builder: 2, upgrader: 1 },
    sites: Array.from({ length: 7 }, (_, i) => ({ id: 's' + i })),
    economyMetrics: {
      last100: {
        ticks: 100,
        spawnUtilization: 0,
        energyCappedRatio: 0.97,
        controllerProgress: 49,
        constructionProgress: 628,
        sitesCompleted: 1
      }
    },
    economyModel: {
      dedicatedHarvestCapacityPerTick: 18,
      productiveDemandPerTick: 21,
      recommendedHarvesterWorkParts: 10,
      harvesterWorkDeficit: 0,
      haulerCarryParts: 12,
      recommendedHaulerCarryParts: 11,
      consumerFallbackCount: 1
    }
  };
}

const live = efficiency.evaluate(liveState());
assert.equal(live.metrics.productiveThroughputPerTick, 6.77);
assert.equal(live.components.productiveUse, 32);
assert.equal(live.components.energyUse, 3);
assert.equal(live.components.spawnUse, 0);
assert.equal(live.components.flow, 85);
assert.equal(live.overallScore, 28);
assert.equal(live.status, 'UNDERUTILIZED');
assert.equal(live.pressure.state, 'SURPLUS');
assert.ok(live.pressure.score >= 90);
assert.ok(live.reasons.includes('ENERGY_SURPLUS_UNCONSUMED'));
assert.ok(live.reasons.includes('SPAWN_IDLE_WITH_SURPLUS'));
assert.ok(live.reasons.includes('PRODUCTIVE_THROUGHPUT_LOW'));
assert.ok(live.reasons.includes('MODELED_DEMAND_NOT_REALIZED'));
assert.ok(live.reasons.includes('CONSUMER_FALLBACK_ACTIVE'));

const efficient = liveState();
efficient.economyMetrics.last100 = {
  ticks: 100,
  spawnUtilization: 0.08,
  energyCappedRatio: 0.05,
  controllerProgress: 300,
  constructionProgress: 1320,
  sitesCompleted: 2
};
efficient.economyModel.consumerFallbackCount = 0;
const good = efficiency.evaluate(efficient);
assert.equal(good.components.productiveUse, 77);
assert.equal(good.components.energyUse, 95);
assert.equal(good.components.spawnUse, 100);
assert.equal(good.components.flow, 100);
assert.equal(good.status, 'EFFICIENT');
assert.equal(good.pressure.state, 'BALANCED');

// Prefer exact-window productive WORK capacity over harvest energy or a stale
// current economy model. Builder/worker construction capacity and upgrader
// capacity share the same progress-per-tick unit as productiveThroughput.
const exact = liveState();
exact.economyMetrics.last100 = {
  ticks: 100,
  spawnUtilization: 0.13,
  energyCappedRatio: 0,
  controllerProgress: 202,
  constructionProgress: 805,
  sitesCompleted: 0,
  productiveFlow: {
    averageBuilderWorkParts: 4,
    averageWorkerWorkParts: 1,
    averageUpgraderWorkParts: 4,
    averageConstructionCapacityPerTick: 25,
    averageDedicatedControllerCapacityPerTick: 4,
    constructionBacklogRatio: 1,
    controllerDemandRatio: 1
  }
};
exact.economyModel.productiveDemandPerTick = 999;
exact.economyModel.consumerFallbackCount = 0;
const exactResult = efficiency.evaluate(exact);
assert.equal(exactResult.modelVersion, 3);
assert.equal(exactResult.metrics.productiveThroughputPerTick, 10.07);
assert.equal(exactResult.metrics.productiveCapacityPerTick, 29);
assert.equal(exactResult.components.productiveUse, 35);
assert.equal(efficiency.productiveCapacity(exact, exact.economyMetrics.last100), 29);

// Controller-only workload: construction-capable WORK must not inflate the
// achievable capacity once the construction backlog is gone.
const controllerOnly = liveState();
controllerOnly.sites = [];
controllerOnly.economyMetrics.last100 = {
  ticks: 100,
  spawnUtilization: 0.7,
  energyCappedRatio: 0.2,
  controllerProgress: 376,
  constructionProgress: 0,
  productiveFlow: {
    averageBuilderWorkParts: 0,
    averageWorkerWorkParts: 4,
    averageUpgraderWorkParts: 6,
    averageConstructionCapacityPerTick: 0,
    averageDedicatedControllerCapacityPerTick: 6,
    constructionBacklogRatio: 0,
    controllerDemandRatio: 1
  }
};
controllerOnly.economyModel.productiveDemandPerTick = 6;
controllerOnly.economyModel.consumerFallbackCount = 0;
const controllerOnlyResult = efficiency.evaluate(controllerOnly);
assert.equal(controllerOnlyResult.metrics.productiveThroughputPerTick, 3.76);
assert.equal(controllerOnlyResult.metrics.productiveCapacityPerTick, 6);
assert.equal(controllerOnlyResult.components.productiveUse, 63);
assert.equal(controllerOnlyResult.reasons.includes('PRODUCTIVE_THROUGHPUT_LOW'), false);

const demand = liveState();
demand.economyMetrics.last100 = {
  ticks: 100,
  spawnUtilization: 0.35,
  energyCappedRatio: 0.02,
  controllerProgress: 100,
  constructionProgress: 200,
  sitesCompleted: 0
};
demand.economyModel.recommendedHarvesterWorkParts = 10;
demand.economyModel.harvesterWorkDeficit = 5;
demand.economyModel.haulerCarryParts = 5;
demand.economyModel.recommendedHaulerCarryParts = 10;
demand.economyModel.consumerFallbackCount = 3;
const constrained = efficiency.evaluate(demand);
assert.equal(constrained.pressure.state, 'DEMAND');
assert.ok(constrained.pressure.demand >= 60);
assert.ok(constrained.reasons.includes('HAULING_PRESSURE'));

const pending = liveState();
pending.economyMetrics = {};
const wait = efficiency.evaluate(pending);
assert.equal(wait.status, 'PENDING');
assert.ok(wait.reasons.includes('EFFICIENCY_WINDOW_PENDING'));

console.log('colony efficiency tests passed');
