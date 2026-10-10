// READ-ONLY scenario study of energy left after two observed expensive
// spawn starts. Does not alter body.builder, spawn.manager or game state.
// Node model output is NOT proof of live future throughput or safe policy.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const P31 = 'c5ef8c5a1fd2daa49793922771bf5d959c347fb8';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('git', ['diff', '--exit-code', P31, '--',
  'game/body.builder.js', 'game/spawn.manager.js'], { cwd: projectRoot,
  encoding: 'utf8' });

const require = createRequire(import.meta.url);
const costs = { work: 100, carry: 50, move: 50 };
global.WORK = 'work';
global.CARRY = 'carry';
global.MOVE = 'move';
global.BODYPART_COST = costs;
const body = require('../game/body.builder.js');
const SPRAWN_PART_TICKS = 3; // Screeps CREEP_SPAWN_TIME default.

function plan(role, energyAvailable, bodyBudget, variant) {
  assert.ok(Number.isInteger(energyAvailable) && energyAvailable > 0);
  assert.ok(Number.isInteger(bodyBudget) && bodyBudget > 0 && bodyBudget <= energyAvailable);
  assert.ok(role === 'hauler' || role === 'upgrader');
  const parts = body[role](bodyBudget);
  const used = parts.reduce((n, item) => n + costs[item], 0);
  assert.ok(parts.length && parts.length <= 50);
  assert.ok(used <= bodyBudget, 'generated body cannot exceed selected budget');
  return {
    role, variant, energyAvailable, bodyBudget, parts: parts.length,
    carry: parts.filter(x => x === 'carry').length,
    work: parts.filter(x => x === 'work').length,
    move: parts.filter(x => x === 'move').length,
    energySpent: used,
    energyImmediatelyLeft: energyAvailable - used,
    reserveAtLeast300: energyAvailable - used >= 300,
    nominalSpawnDurationTicks: parts.length * SPRAWN_PART_TICKS,
    // This is a capacity proxy, NOT actual energy/tick transportation.
    note: 'Body-part proxy only; ignores TTL, route length, traffic, energy refills and prespawn urgency.'
  };
}
function diff(before, after) {
  assert.equal(before.role, after.role);
  const percentLoss = (base, next) => base === 0 ? null :
    Math.round((base - next) / base * 1000) / 10;
  return {
    role: before.role,
    beforeVariant: before.variant,
    afterVariant: after.variant,
    savedEnergy: before.energySpent - after.energySpent,
    additionalImmediateReserve: after.energyImmediatelyLeft - before.energyImmediatelyLeft,
    fewerCarryParts: before.carry - after.carry,
    fewerWorkParts: before.work - after.work,
    carryCapacityProxyLossPercent: percentLoss(before.carry, after.carry),
    workCapacityProxyLossPercent: percentLoss(before.work, after.work),
    shorterNominalSpawnTicks: before.nominalSpawnDurationTicks - after.nominalSpawnDurationTicks
  };
}

const haulerFull = plan('hauler', 1050, 1050, 'current-full-room-capacity');
const haulerFloor = plan('hauler', 1050, 750, 'hypothetical-300-reserve');
const haulerAt850 = plan('hauler', 850, 750, 'observed-budget-750-at-850-available');
const upgraderFull = plan('upgrader', 1050, 1050, 'current-full-room-capacity');
const upgraderFloor = plan('upgrader', 1050, 750, 'naive-300-reserve-budget');
const upgraderThreshold = plan('upgrader', 1050, 800, 'alternative-800-body-budget');

assert.deepEqual(
  [haulerFull.parts, haulerFull.carry, haulerFull.move,
    haulerFull.energySpent, haulerFull.energyImmediatelyLeft,
    haulerFull.nominalSpawnDurationTicks],
  [21, 14, 7, 1050, 0, 63]);
assert.deepEqual(
  [haulerFloor.parts, haulerFloor.carry, haulerFloor.move,
    haulerFloor.energySpent, haulerFloor.energyImmediatelyLeft,
    haulerFloor.nominalSpawnDurationTicks],
  [15, 10, 5, 750, 300, 45]);
assert.deepEqual(
  [upgraderFull.parts, upgraderFull.work, upgraderFull.carry,
    upgraderFull.energySpent, upgraderFull.energyImmediatelyLeft,
    upgraderFull.nominalSpawnDurationTicks],
  [12, 6, 3, 900, 150, 36]);
assert.deepEqual(
  [upgraderFloor.parts, upgraderFloor.work, upgraderFloor.carry,
    upgraderFloor.energySpent, upgraderFloor.energyImmediatelyLeft,
    upgraderFloor.nominalSpawnDurationTicks],
  [9, 3, 3, 600, 450, 27]);
assert.deepEqual(
  [upgraderThreshold.parts, upgraderThreshold.work, upgraderThreshold.carry,
    upgraderThreshold.energySpent, upgraderThreshold.energyImmediatelyLeft,
    upgraderThreshold.nominalSpawnDurationTicks],
  [8, 4, 2, 600, 450, 24]);
// A fixed 750-body-cost cap only leaves 300 reserve when at least
// 1050 energy is ACTUALLY available. At 850 energy it leaves only 100.
assert.deepEqual([
  haulerAt850.energySpent, haulerAt850.energyImmediatelyLeft,
  haulerAt850.reserveAtLeast300, haulerAt850.carry
], [750, 100, false, 10]);
assert.equal(haulerAt850.nominalSpawnDurationTicks, 45);
assert.equal(upgraderFull.reserveAtLeast300, false);
assert.equal(haulerFull.reserveAtLeast300, false);
assert.ok(haulerFloor.reserveAtLeast300);
assert.ok(upgraderFloor.reserveAtLeast300);
assert.ok(upgraderThreshold.reserveAtLeast300);
assert.equal(diff(haulerFull, haulerFloor).carryCapacityProxyLossPercent, 28.6);
assert.equal(diff(upgraderFull, upgraderFloor).workCapacityProxyLossPercent, 50);
assert.equal(diff(upgraderFull, upgraderThreshold).workCapacityProxyLossPercent, 33.3);

console.log('SPAWN ENERGY RESERVE: offline body-budget tradeoffs only');
console.log(JSON.stringify({
  pinnedP31: P31,
  runtimeSourceChanges: 'NONE',
  simulationOnly: true,
  observedTransitions: [
    { spawnStartTick: 3826738, role: 'hauler', energyCost: 1050,
      nextHeartbeatTick: 3826750, nextEnergy: 12,
      e3EmergencyCount: 19, E4CriticalCoverage: 0.123 },
    { spawnStartTick: 3826947, role: 'upgrader', energyCost: 900,
      nextHeartbeatTick: 3826950, nextEnergy: 153,
      e3EmergencyCount: 14, E4CriticalCoverage: 0.217 },
    { spawnStartTick: 3827175, role: 'hauler', energyCost: 750,
      lastSampledBefore: 850, nextHeartbeatTick: 3827200,
      nextEnergy: 131, e3EmergencyCount: 16,
      note: '850 minus 750 leaves only 100 immediate energy; later 131 is sampled after refills.' }
  ],
  scenarios: [haulerFull, haulerFloor, haulerAt850, upgraderFull, upgraderFloor, upgraderThreshold],
  comparisons: [diff(haulerFull, haulerFloor),
    diff(upgraderFull, upgraderFloor),
    diff(upgraderFull, upgraderThreshold)],
  decision: 'A nominal 750 energy body cap does not ensure 300 reserve at 850 available. No policy recommendation before role urgency, prespawn TTL, hauler readiness, delivery latency, refill and real productive verification.'
}, null, 2));
