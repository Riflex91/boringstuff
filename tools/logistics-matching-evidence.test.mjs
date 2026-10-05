import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

const evidence = require('../game/logistics.matching.evidence.js');

function state(overrides = {}) {
  return {
    room: { name: 'E1N1' },
    economyModel: {
      consumerWaitingCount: 1,
      consumerCriticalCount: 1,
      consumerFallbackCount: 0
    },
    logisticsMatchingShadow: {
      jobs: [{
        mode: 'PICKUP_DELIVER',
        reservationIds: ['r1']
      }],
      summary: {
        deferred: false,
        haulerCount: 2,
        matchedHaulerCount: 1,
        candidateCount: 4,
        jobCount: 1,
        pairedJobCount: 1,
        directCarriedJobCount: 0,
        criticalRequestCount: 1,
        criticalMatchedCount: 1,
        unmatchedCriticalCount: 0,
        reservedAmount: 50,
        averageTransportTicks: 10
      }
    },
    ...overrides
  };
}

{
  const memory = {};
  let result = null;
  for (let t = 1000; t < 1100; t++) {
    result = evidence.observe(state(), memory, { time: t });
  }

  assert.ok(result.completed);
  assert.equal(result.completed.authority, 'SHADOW_EVIDENCE');
  assert.equal(result.completed.startTick, 1000);
  assert.equal(result.completed.endTick, 1099);
  assert.equal(result.completed.ticks, 100);
  assert.equal(result.completed.deferredRatio, 0);
  assert.equal(result.completed.averageHaulers, 2);
  assert.equal(result.completed.averageMatchedHaulers, 1);
  assert.equal(result.completed.haulerUtilization, 0.5);
  assert.equal(result.completed.averageCandidatesPerTick, 4);
  assert.equal(result.completed.averageJobsPerTick, 1);
  assert.equal(result.completed.averagePairedJobsPerTick, 1);
  assert.equal(result.completed.averageDirectCarriedJobsPerTick, 0);
  assert.equal(result.completed.averageBalanceJobsPerTick, 0);
  assert.equal(result.completed.criticalRequestTicks, 100);
  assert.equal(result.completed.criticalMatchedTicks, 100);
  assert.equal(result.completed.unmatchedCriticalTicks, 0);
  assert.equal(result.completed.criticalCoverageRatio, 1);
  assert.equal(result.completed.averageReservedAmountPerTick, 50);
  assert.equal(result.completed.averagePredictedTransportTicks, 10);
  assert.equal(result.completed.averageConsumerWaiting, 1);
  assert.equal(result.completed.averageConsumerCritical, 1);
  assert.equal(result.completed.averageConsumerFallback, 0);
  assert.equal(result.completed.duplicateReservationTicks, 0);
  assert.deepEqual(result.lastWindow, result.completed);

  const snap = evidence.snapshot('E1N1', memory);
  assert.equal(snap.lastWindow.endTick, 1099);
}

{
  const memory = {};
  const deferred = state({
    economyModel: {
      consumerWaitingCount: 0,
      consumerCriticalCount: 0,
      consumerFallbackCount: 0
    },
    logisticsMatchingShadow: {
      jobs: [],
      summary: {
        deferred: true,
        haulerCount: 0,
        matchedHaulerCount: 0,
        candidateCount: 0,
        jobCount: 0,
        pairedJobCount: 0,
        directCarriedJobCount: 0,
        criticalRequestCount: 0,
        criticalMatchedCount: 0,
        unmatchedCriticalCount: 0,
        reservedAmount: 0,
        averageTransportTicks: 0
      }
    }
  });
  const result = evidence.observe(deferred, memory, { time: 2000 });
  assert.equal(result.current.deferredRatio, 1);
  assert.equal(result.current.criticalCoverageRatio, 1);
  assert.equal(result.current.averageJobsPerTick, 0);
}

{
  assert.equal(evidence._test.duplicateReservationCount([
    { reservationIds: ['a', 'b'] },
    { reservationIds: ['b', 'c'] }
  ]), 1);
}

{
  const window = evidence._test.newWindow(3000);
  const s = state({
    logisticsMatchingShadow: {
      jobs: [
        { mode: 'DIRECT_CARRIED', reservationIds: ['x'] },
        { mode: 'BALANCE', reservationIds: ['y'] }
      ],
      summary: {
        deferred: false,
        haulerCount: 2,
        matchedHaulerCount: 2,
        candidateCount: 5,
        jobCount: 2,
        pairedJobCount: 1,
        directCarriedJobCount: 1,
        criticalRequestCount: 0,
        criticalMatchedCount: 0,
        unmatchedCriticalCount: 0,
        reservedAmount: 80,
        averageTransportTicks: 7.5
      }
    }
  });
  evidence._test.accumulate(window, s);
  const summary = evidence.summarize(window, 3000);
  assert.equal(summary.averageDirectCarriedJobsPerTick, 1);
  assert.equal(summary.averageBalanceJobsPerTick, 1);
  assert.equal(summary.averagePredictedTransportTicks, 7.5);
}

console.log('logistics matching evidence tests passed');
