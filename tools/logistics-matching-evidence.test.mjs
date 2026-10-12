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
        criticalCandidateRequestCount: 1,
        criticalNoCandidateCount: 0,
        criticalCandidateUnmatchedCount: 0,
        criticalSlotCapacity: 1,
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
  assert.equal(result.completed.criticalCandidateRequestTicks, 100);
  assert.equal(result.completed.criticalNoCandidateTicks, 0);
  assert.equal(result.completed.criticalCandidateUnmatchedTicks, 0);
  assert.equal(result.completed.criticalSlotCapacityTicks, 100);
  assert.equal(result.completed.criticalCoverageRatio, 1);
  assert.equal(result.completed.criticalCandidateRatio, 1);
  assert.equal(result.completed.criticalCandidateCoverageRatio, 1);
  assert.equal(result.completed.criticalSlotCoverageRatio, 1);
  assert.equal(result.completed.averageReservedAmountPerTick, 50);
  assert.equal(result.completed.averagePredictedTransportTicks, 10);
  assert.equal(result.completed.averageConsumerWaiting, 1);
  assert.equal(result.completed.averageConsumerCritical, 1);
  assert.equal(result.completed.averageConsumerFallback, 0);
  assert.equal(result.completed.duplicateReservationTicks, 0);
  // logger.slim() truncates object keys after the first 30. Keep the duplicate
  // metric inside that visible budget so live verification never has to infer it.
  assert.ok(Object.keys(result.completed).slice(0, 30).includes('duplicateReservationTicks'));
  assert.equal(Object.keys(result.completed).at(-1), 'averageBalanceJobsPerTick');
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
        criticalCandidateRequestCount: 0,
        criticalNoCandidateCount: 0,
        criticalCandidateUnmatchedCount: 0,
        criticalSlotCapacity: 0,
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
        criticalCandidateRequestCount: 0,
        criticalNoCandidateCount: 0,
        criticalCandidateUnmatchedCount: 0,
        criticalSlotCapacity: 0,
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


{
  const window = evidence._test.newWindow(4000);
  evidence._test.accumulate(window, state({
    logisticsMatchingShadow: {
      jobs: [
        { mode: 'PICKUP_DELIVER', reservationIds: ['c1'] },
        { mode: 'PICKUP_DELIVER', reservationIds: ['c2'] }
      ],
      summary: {
        deferred: false,
        haulerCount: 2,
        matchedHaulerCount: 2,
        candidateCount: 8,
        jobCount: 2,
        pairedJobCount: 2,
        directCarriedJobCount: 0,
        criticalRequestCount: 3,
        criticalMatchedCount: 2,
        unmatchedCriticalCount: 1,
        criticalCandidateRequestCount: 3,
        criticalNoCandidateCount: 0,
        criticalCandidateUnmatchedCount: 1,
        criticalSlotCapacity: 2,
        reservedAmount: 100,
        averageTransportTicks: 4
      }
    }
  }));
  const summary = evidence.summarize(window, 4000);
  assert.equal(summary.criticalCoverageRatio, 0.667);
  assert.equal(summary.criticalCandidateRatio, 1);
  assert.equal(summary.criticalCandidateCoverageRatio, 0.667);
  assert.equal(summary.criticalSlotCoverageRatio, 1);
  assert.equal(summary.criticalNoCandidateTicks, 0);
  assert.equal(summary.criticalCandidateUnmatchedTicks, 1);
}

// Release-grade windows require exactly 100 distinct, consecutive game ticks.
// Repeated calls may happen through multiple process schedulers or replay.
{
  const memory={};
  let observed=evidence.observe(state(),memory,{time:1000});
  assert.equal(observed.current.ticks,1);
  for(let i=0;i<200;i++){
    observed=evidence.observe(state(),memory,{time:1000});
    assert.equal(observed.completed,null,'Duplicate ticks cannot complete a window');
    assert.equal(observed.current.ticks,1);
  }
  for(let t=1001;t<=1099;t++) observed=evidence.observe(state(),memory,{time:t});
  assert.equal(observed.completed.ticks,100);
  assert.equal(observed.completed.startTick,1000);
  assert.equal(observed.completed.endTick,1099);
  for(let i=0;i<3;i++){
    const repeat=evidence.observe(state(),memory,{time:1099});
    assert.equal(repeat.completed,null,'100th tick replay cannot begin another window');
    assert.equal(repeat.lastWindow.endTick,1099);
    assert.equal(memory.bot.logisticsMatchingEvidence.rooms.E1N1.window.ticks,0);
  }
  const next=evidence.observe(state(),memory,{time:1100});
  assert.equal(next.completed,null);
  assert.equal(next.current.ticks,1);
  assert.equal(next.current.startTick,1100);
}
{
  const memory={};
  let result=null;
  for(let t=2000;t<=2049;t++) result=evidence.observe(state(),memory,{time:t});
  assert.equal(result.current.ticks,50);
  // One skipped observation invalidates the prior 50 actual observations.
  result=evidence.observe(state(),memory,{time:2051});
  assert.equal(result.current.startTick,2051);
  assert.equal(result.current.ticks,1);
  assert.equal(result.completed,null);
  for(let t=2052;t<=2149;t++) result=evidence.observe(state(),memory,{time:t});
  assert.equal(result.completed,null);
  result=evidence.observe(state(),memory,{time:2150});
  assert.equal(result.completed.ticks,100);
  assert.equal(result.completed.startTick,2051);
  assert.equal(result.completed.endTick,2150);
  assert.equal(result.completed.endTick-result.completed.startTick,99);
}
{
  const memory={};
  let result=null;
  for(let t=3000;t<=3099;t++) result=evidence.observe(state(),memory,{time:t});
  assert.ok(result.completed);
  // Server simulation rewind clears stale completed history and starts fresh.
  result=evidence.observe(state(),memory,{time:2000});
  assert.equal(result.lastWindow,null);
  assert.equal(result.current.ticks,1);
  assert.equal(result.current.startTick,2000);
  result=evidence.observe(state(),memory,{time:1999});
  assert.equal(result.lastWindow,null);
  assert.equal(result.current.startTick,1999);
  assert.equal(result.current.ticks,1);
}
{
  const memory={bot:{logisticsMatchingEvidence:{schemaVersion:1,rooms:{
    E1N1:{window:{startTick:7,ticks:99},lastWindow:{
      startTick:1,endTick:100,ticks:100
    }}
  }}}};
  const r=evidence.observe(state(),memory,{time:5000});
  assert.equal(memory.bot.logisticsMatchingEvidence.schemaVersion,2);
  assert.equal(r.current.ticks,1,'Migrate invalid count-only windows by reset');
  assert.equal(r.lastWindow,null);
  assert.equal(r.completed,null);
  const room=memory.bot.logisticsMatchingEvidence.rooms.E1N1;
  room.window.ticks=99;
  room.window.lastObservedTick=50;
  const repaired=evidence.observe(state(),memory,{time:5001});
  assert.equal(repaired.current.ticks,1);
  assert.equal(repaired.current.startTick,5001);
  assert.equal(repaired.completed,null,
    'Corrupted persistent tick counters cannot manufacture full windows');
  const before=JSON.stringify(memory);
  assert.deepEqual(evidence.observe(state(),memory,{time:NaN}),{
    current:null,completed:null,lastWindow:null
  });
  assert.equal(JSON.stringify(memory),before,
    'Invalid game time must not mutate telemetry Memory');
}
console.log('logistics matching evidence tests passed');
