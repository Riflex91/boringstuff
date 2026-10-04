import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.Game = { cpu: { bucket: 10000 } };

const health = require('../game/colony.health.js');

function baseState() {
  return {
    room: { controller: { my: true, ticksToDowngrade: 9970 } },
    rcl: 2,
    spawn: { id: 'spawn1' },
    emergency: false,
    byRole: { harvester: 5, hauler: 2, worker: 2, builder: 2, upgrader: 1 },
    hostileCreeps: [],
    towers: [],
    sites: Array.from({ length: 8 }, (_, i) => ({ id: 's' + i })),
    economyMetrics: {
      controllerIdleTicks: 80,
      last100: {
        controllerProgress: 50,
        constructionProgress: 5,
        sitesCompleted: 0
      }
    },
    economyModel: {
      theoreticalIncomePerTick: 20,
      dedicatedHarvestCapacityPerTick: 16,
      productiveDemandPerTick: 21,
      harvesterWorkDeficit: 2,
      haulerCarryParts: 8,
      recommendedHaulerCarryParts: 11,
      consumerFallbackCount: 2
    }
  };
}

const liveLike = health.evaluate(baseState());
assert.equal(liveLike.scores.economy, 80);
assert.equal(liveLike.scores.logistics, 53);
assert.equal(liveLike.scores.infrastructure, 70);
assert.equal(liveLike.scores.controller, 100);
assert.equal(liveLike.scores.defense, 100);
assert.equal(liveLike.scores.recovery, 100);
assert.equal(liveLike.scores.cpu, 100);
assert.equal(liveLike.overallScore, 81);
assert.equal(liveLike.status, 'WATCH');
assert.ok(liveLike.reasons.includes('MINING_DEFICIT'));
assert.ok(liveLike.reasons.includes('HAULING_DEFICIT'));
assert.ok(liveLike.reasons.includes('CONSUMER_FALLBACK_ACTIVE'));

const stalled = baseState();
stalled.economyModel.dedicatedHarvestCapacityPerTick = 4;
stalled.economyModel.harvesterWorkDeficit = 8;
stalled.economyModel.haulerCarryParts = 4;
stalled.economyModel.recommendedHaulerCarryParts = 4;
stalled.economyModel.consumerFallbackCount = 3;
stalled.economyMetrics.controllerIdleTicks = 300;
stalled.economyMetrics.last100 = { controllerProgress: 0, constructionProgress: 0, sitesCompleted: 0 };
const stalledHealth = health.evaluate(stalled);
assert.equal(stalledHealth.scores.economy, 20);
assert.equal(stalledHealth.scores.logistics, 70);
assert.equal(stalledHealth.scores.infrastructure, 30);
assert.equal(stalledHealth.scores.controller, 25);
assert.equal(stalledHealth.status, 'DEGRADED');
assert.ok(stalledHealth.reasons.includes('CONSTRUCTION_STALLED'));
assert.ok(stalledHealth.reasons.includes('CONTROLLER_STALLED'));

global.Game.cpu.bucket = 500;
const emergency = baseState();
emergency.emergency = true;
emergency.hostileCreeps = [{ id: 'h1' }];
emergency.byRole.defender = 0;
const critical = health.evaluate(emergency);
assert.equal(critical.scores.recovery, 25);
assert.equal(critical.scores.defense, 10);
assert.equal(critical.scores.cpu, 15);
assert.ok(critical.reasons.includes('RECOVERY_EMERGENCY'));
assert.ok(critical.reasons.includes('HOSTILES_PRESENT'));
assert.ok(critical.reasons.includes('CPU_BUCKET_CRITICAL'));

console.log('colony health tests passed');
