import assert from 'node:assert/strict';
import { discoverLiveWindows } from './live-cadence-inspector-core.mjs';

const receipt = { server: 'newbieland', branch: 'chatgpt',
  version: '0.3.0-shadow.15-node24', deploymentId: 'real-123' };
const marker = { tick: 1000, v: receipt.version,
  code: 'DEPLOYMENT_MARKER', ctx: { version: receipt.version,
    deploymentId: receipt.deploymentId } };
const block = (startTick, extra = {}) => ({
  startTick, endTick: startTick + 99, ticks: 100, ...extra
});
function snapshot(t, { economyStart = 1010, e4Start = 1011,
  p2Run = 1080, p2Plan = p2Run, i2Run = 1090, i2Plan = i2Run } = {}) {
  return {
    tick: t, v: receipt.version, code: 'STATUS_SNAPSHOT', ctx: {
      scheduler: { processes: {
        'planner-vnext-shadow': { lastRunTick: p2Run, lastCpu: 6.149 },
        'remote-roi-shadow': { lastRunTick: i2Run, lastCpu: 5.522 }
      } },
      rooms: { E8N1: {
        economy: { last100: block(economyStart, {
          controllerProgress: 42, constructionProgress: 3,
          productiveFlow: { actualProductiveThroughputPerTick: 8.5,
            consumerTicks: 100, waitingConsumerTicks: 7,
            criticalConsumerTicks: 5, fallbackConsumerTicks: 2 }
        }) },
        logisticsMatchingEvidence: { lastWindow: block(e4Start, {
          duplicateReservationTicks: 0, criticalRequestTicks: 42,
          criticalMatchedTicks: 38, unmatchedCriticalTicks: 4,
          criticalCandidateRequestTicks: 40, criticalNoCandidateTicks: 2,
          criticalCandidateUnmatchedTicks: 2, criticalSlotCapacityTicks: 38,
          criticalCandidateRatio: 0.952, criticalCandidateCoverageRatio: 0.95,
          criticalSlotCoverageRatio: 1, criticalCoverageRatio: 0.905,
          averageHaulers: 3, averageMatchedHaulers: 2,
          averageConsumerWaiting: 0.07, averageConsumerFallback: 0.02,
          averageConsumerCritical: 0.05
        }) },
        plannerVNext: { planTick: p2Plan, status: 'READY' },
        remoteRoi: { evaluatedTick: i2Plan, status: 'READY' },
        efficiency: { status: 'WATCH', overallScore: 65,
          reasons: ['PRODUCTIVE_THROUGHPUT_LOW'] }
      } }
    }
  };
}
function evalRows(events, config = {}) {
  return discoverLiveWindows({ events, receipt, ...config });
}
assert.throws(() => discoverLiveWindows({ events: [], receipt: {} }), /exact deployment receipt/);
assert.throws(() => discoverLiveWindows({ receipt }), /events array/);
assert.throws(() => evalRows([marker], { limit: 0 }), /limit/);
assert.equal(evalRows([snapshot(1125)]).reason, 'MATCHING_DEPLOYMENT_MARKER_MISSING');
const events = [marker, snapshot(1125),
  { tick: 1300, v: receipt.version, code: 'BOT_HEARTBEAT' }];
const outcome = evalRows(events);
assert.equal(outcome.state, 'READY');
assert.equal(outcome.latestTick, 1300);
assert.equal(outcome.markerTick, 1000);
assert.equal(outcome.economyWindows.length, 1);
assert.equal(outcome.economyWindows[0].startTick, 1010);
assert.equal(outcome.economyWindows[0].productiveThroughput, 8.5);
assert.equal(outcome.e4Windows.length, 1);
assert.equal(outcome.e4Windows[0].startTick, 1011);
assert.equal(outcome.e4Windows[0].duplicateReservationTicks, 0);
assert.equal(outcome.e4Windows[0].criticalMatchedTicks, 38);
assert.equal(outcome.e4Windows[0].unmatchedCriticalTicks, 4);
assert.equal(outcome.e4Windows[0].criticalNoCandidateTicks, 2);
assert.equal(outcome.e4Windows[0].criticalCandidateUnmatchedTicks, 2);
assert.equal(outcome.e4Windows[0].criticalSlotCapacityTicks, 38);
assert.equal(outcome.e4Windows[0].criticalCoverageRatio, 0.905);
assert.equal(outcome.e4Windows[0].averageConsumerFallback, 0.02);
assert.equal(outcome.economyWindows[0].fallbackConsumerTicks, 2);
assert.equal(outcome.economyWindows[0].waitingConsumerTicks, 7);
assert.equal(outcome.overlappingEconomyE4Windows.length, 0,
  'different cadence windows do not secretly align');
assert.deepEqual(outcome.p2Runs.map(x => x.runTick), [1080]);
assert.deepEqual(outcome.i2Runs.map(x => x.runTick), [1090]);
assert.equal(outcome.p2Runs[0].cpu, 6.149);
assert.equal(outcome.i2Runs[0].cpu, 5.522);
assert.deepEqual(outcome.latestEfficiency.reasons, ['PRODUCTIVE_THROUGHPUT_LOW']);
assert.equal(evalRows([marker, snapshot(1125, { p2Plan: 1079,
  i2Plan: 1089 }), events.at(-1)]).p2Runs.length, 0,
  'cached P2 CPU without a matching plan tick must be excluded');
assert.equal(evalRows([marker, snapshot(1125, { p2Plan: 1079,
  i2Plan: 1089 }), events.at(-1)]).i2Runs.length, 0);
assert.equal(evalRows([marker, snapshot(1180, {
  economyStart: 1200, e4Start: 1200
}), events.at(-1)]).economyWindows.length, 0,
'future completed window is invalid');
const laterSame = snapshot(1200);
const duplicate = evalRows([...events, laterSame, laterSame]);
assert.equal(duplicate.p2Runs.length, 1, 'one scheduler run cannot multiply');
const newInterval = evalRows([marker, snapshot(1220, {
  economyStart: 1111, e4Start: 1111, p2Run: 1150, i2Run: 1160
}), { tick: 1350, v: receipt.version, code: 'BOT_HEARTBEAT' }]);
assert.equal(newInterval.overlappingEconomyE4Windows.length, 1);
assert.equal(newInterval.overlappingEconomyE4Windows[0].startTick, 1111);
const bad = { tick: 1280, v: receipt.version, code: 'DEPLOYMENT_MARKER',
  ctx: { version: receipt.version, deploymentId: 'foreign' } };
assert.equal(evalRows([...events, bad]).state, 'BLOCKED');
const old = snapshot(1125);
old.v = '0.3.0-shadow.14-node24';
assert.equal(evalRows([marker, old, events.at(-1)]).economyWindows.length, 0);
const preRelease = snapshot(1125, {
  economyStart: 900, e4Start: 900, p2Run: 900, i2Run: 900
});
const stale = evalRows([marker, preRelease, events.at(-1)]);
assert.equal(stale.economyWindows.length, 0);
assert.equal(stale.e4Windows.length, 0);
assert.equal(stale.p2Runs.length, 0);
assert.equal(stale.i2Runs.length, 0);

// Surface observed room capacity and spawn decisions without fabricating
// a job shortage from a 0%-busy window. Historical logs can be incomplete.
const observedRoom = snapshot(1125);
const observed = observedRoom.ctx.rooms.E8N1;
observed.rcl = 3;
observed.energyAvailable = 500;
observed.energyCapacity = 550;
observed.energyStored = 1500;
observed.spawnBusy = false;
observed.constructionSites = 3;
observed.creeps = { harvester: 2, hauler: 2, worker: 1, upgrader: 1 };
observed.economy.last100.spawnUtilization = 0;
observed.economy.last100.energyCappedRatio = 0.35;
observed.economyModel = {
  productiveDemandPerTick: 18,
  dedicatedHarvestCapacityPerTick: 18,
  harvesterWorkDeficit: 0,
  haulerCarryDeficit: 0,
  consumerCriticalCount: 0,
  consumerWaitingCount: 0,
  consumerFallbackCount: 0,
  recommendedHarvesterCount: 2,
  recommendedHaulerCount: 2
};
const spawnEvents = [
  { tick: 1100, v: receipt.version, code: 'SPAWN_IDLE_SURPLUS',
    ctx: { room: 'E8N1', energy: 550, capacity: 550,
      energyCappedStreak: 25, spawnIdleStreak: 35,
      desired: { harvester: 2, upgrader: 1 },
      actual: { harvester: 2, upgrader: 1 } } },
  { tick: 1110, v: receipt.version, code: 'SPAWN_OK',
    ctx: { room: 'E8N1', role: 'worker', cost: 300 } },
  { tick: 1111, v: receipt.version, code: 'SPAWN_RC',
    ctx: { room: 'E8N1', role: 'builder', rc: -6 } },
  { tick: 1111, v: 'other-version', code: 'SPAWN_OK',
    ctx: { room: 'E8N1', role: 'other', cost: 100 } },
  { tick: 1101, v: receipt.version, code: 'SPAWN_OK',
    ctx: { room: 'E9N1', role: 'other', cost: 200 } }
];
const spawnDiagnostic = evalRows([marker, observedRoom, events.at(-1), ...spawnEvents]);
assert.equal(spawnDiagnostic.latestProductiveContext.energyAvailable, 500);
assert.equal(spawnDiagnostic.latestProductiveContext.spawnBusy, false);
assert.equal(spawnDiagnostic.latestProductiveContext.economyWindow.spawnUtilization, 0);
assert.equal(spawnDiagnostic.latestProductiveContext.economyWindow.energyCappedRatio, 0.35);
assert.equal(spawnDiagnostic.latestProductiveContext.economyModel.haulerCarryDeficit, 0);
assert.equal(spawnDiagnostic.latestProductiveContext.creepsByRole.upgrader, 1);
assert.deepEqual(spawnDiagnostic.recentSpawnEvents.counts, {
  SPAWN_IDLE_SURPLUS: 1, SPAWN_OK: 1, SPAWN_RC: 1
});
assert.deepEqual(spawnDiagnostic.recentSpawnEvents.latestIdleSurplus.desired,
  { harvester: 2, upgrader: 1 });
assert.deepEqual(spawnDiagnostic.recentSpawnEvents.latestSpawnOk,
  [{ tick: 1110, role: 'worker', cost: 300 }]);
assert.deepEqual(spawnDiagnostic.recentSpawnEvents.latestSpawnRc,
  [{ tick: 1111, role: 'builder', rc: -6 }]);
const missing = evalRows(events);
assert.equal(missing.economyWindows[0].fallbackConsumerTicks, 2);
assert.equal(missing.e4Windows[0].criticalCandidateUnmatchedTicks, 2);
assert.equal(missing.latestProductiveContext.spawnBusy, null);
assert.equal(missing.latestProductiveContext.economyWindow.spawnUtilization, null);
assert.equal(missing.latestProductiveContext.economyModel.harvesterWorkDeficit, null);
assert.equal(missing.recentSpawnEvents.latestIdleSurplus, null,
  'missing logged event does not become observed absence of surplus');
const staleSpawn = evalRows([marker, snapshot(2025), {
  tick: 1002, v: receipt.version, code: 'SPAWN_IDLE_SURPLUS',
  ctx: { room: 'E8N1', desired: { harvester: 9 } }
}]);
assert.equal(staleSpawn.recentSpawnEvents.counts.SPAWN_IDLE_SURPLUS, 0,
  'log evidence older than 500 ticks is not included');

const partialE4 = snapshot(1125);
partialE4.ctx.rooms.E8N1.logisticsMatchingEvidence.lastWindow = block(1011, {
  duplicateReservationTicks: 0, criticalRequestTicks: 5,
  criticalCoverageRatio: 0.6
});
const partialResult = evalRows([marker, partialE4, events.at(-1)]);
assert.equal(partialResult.e4Windows[0].criticalNoCandidateTicks, null);
assert.equal(partialResult.e4Windows[0].criticalCandidateUnmatchedTicks, null);
assert.equal(partialResult.e4Windows[0].criticalMatchedTicks, null);
assert.equal(partialResult.e4Windows[0].criticalCoverageRatio, 0.6);
assert.equal(partialResult.e4Windows[0].duplicateReservationTicks, 0,
  'known duplicate evidence should remain independent of missing cause counters');

console.log('Exact-release live cadence discovery tests passed');
