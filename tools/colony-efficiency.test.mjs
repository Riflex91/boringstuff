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
assert.equal(live.components.productiveUse, 38);
assert.equal(live.components.energyUse, 3);
assert.equal(live.components.spawnUse, 0);
assert.equal(live.components.flow, 85);
assert.equal(live.overallScore, 31);
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
assert.equal(good.components.productiveUse, 90);
assert.equal(good.components.energyUse, 95);
assert.equal(good.components.spawnUse, 100);
assert.equal(good.components.flow, 100);
assert.equal(good.status, 'EFFICIENT');
assert.equal(good.pressure.state, 'BALANCED');

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
