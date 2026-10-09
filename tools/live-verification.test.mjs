import assert from 'node:assert/strict';
import { detectJseqGaps, evaluateLive, evaluateSmoke } from './live-verification-core.mjs';

function baseRoom(overrides = {}) {
  return {
    rcl: 2,
    constructionSites: 3,
    economy: {
      last100: {
        ticks: 100,
        controllerProgress: 180,
        constructionProgress: 1300,
        productiveFlow: {
          consumerTicks: 400,
          waitingConsumerTicks: 20,
          criticalConsumerTicks: 20,
          fallbackConsumerTicks: 0,
          averageConstructionCapacityPerTick: 15,
          averageDedicatedControllerCapacityPerTick: 3,
          actualProductiveThroughputPerTick: 14.8
        }
      }
    },
    economyModel: {
      theoreticalIncomePerTick: 20,
      dedicatedHarvestCapacityPerTick: 20,
      haulerCarryDeficit: 0,
      consumerFallbackCount: 0,
      consumerWaitingCount: 0,
      consumerCriticalCount: 0
    },
    health: { status: 'HEALTHY' },
    efficiency: {
      status: 'UNDERUTILIZED',
      metrics: { productiveThroughputPerTick: 14.8, dedicatedHarvestCapacityPerTick: 20 },
      reasons: ['ENERGY_SURPLUS_UNCONSUMED']
    },
    colonyState: {
      authority: 'SHADOW',
      requests: { available: true, authority: 'SHADOW' },
      assignments: { available: true, authority: 'SHADOW' },
      capacity: { projected: { available: true, authority: 'SHADOW' } },
      spawnPlan: { available: true, authority: 'SHADOW' },
      assignmentEvidence: { available: true, authority: 'SHADOW_EVIDENCE' }
    },
    ...overrides
  };
}

function event(tick, code, ctx, extra = {}) {
  return { tick, v: '0.3.0-shadow.13-node24', level: 'INFO', code, ctx, ...extra };
}

function evidence(start = 1000) {
  const room = baseRoom();
  room.economy.last100.startTick = start;
  room.economy.last100.endTick = start + 99;
  return [
    event(start, 'VERSION_CHANGE', { from: '0.2.19-node18', to: '0.3.0-shadow.13-node24' }, { jseq: 20 }),
    event(start, 'ROOM_HEARTBEAT', { room: 'E8N1', economyModel: room.economyModel, health: room.health }),
    event(start, 'BOT_HEARTBEAT', { cpu: 3.8, bucket: 10000 }),
    event(start + 24, 'ROOM_HEARTBEAT', { room: 'E8N1', economyModel: room.economyModel, health: room.health }),
    event(start + 24, 'BOT_HEARTBEAT', { cpu: 4.1, bucket: 10000 }),
    event(start + 99, 'STATUS_SNAPSHOT', {
      rooms: { E8N1: room },
      cpu: 3.9,
      bucket: 10000,
      capabilities: { schemaVersion: 1 },
      serverProfile: { schemaVersion: 1 },
      scheduler: { schemaVersion: 1 },
      worldIntel: { schemaVersion: 1 }
    }, { jseq: 21 })
  ];
}

{
  const r = evaluateSmoke({ events: evidence(), startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.outcome, 'PASS');
  assert.equal(r.endTick, 1024);
}

{
  const r = evaluateLive({ events: evidence(), startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.outcome, 'WATCH');
  assert.equal(r.checks.find(c => c.id === 'productive-attribution').status, 'PASS');
  assert.equal(r.checks.find(c => c.id === 'productive-throughput').status, 'PASS');
  assert.equal(r.checks.find(c => c.id === 'efficiency-status').status, 'WATCH');
  assert.equal(r.checks.find(c => c.id === 'vnext-platform-shadow').status, 'PASS');
  assert.equal(r.checks.find(c => c.id === 'vnext-shadow-authority').status, 'PASS');
  assert.equal(r.counts.fail, 0);
}

{
  const rows = evidence();
  rows.push(event(1010, 'UNCAUGHT_RUNTIME', { error: 'boom' }, { level: 'ERROR', jseq: 22 }));
  const r = evaluateSmoke({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.outcome, 'FAIL');
  assert.equal(r.checks.find(c => c.id === 'runtime-errors').status, 'FAIL');
}

{
  const rows = evidence();
  rows[2] = event(1000, 'BOT_HEARTBEAT', { cpu: 3.8, bucket: 500 });
  const r = evaluateSmoke({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.outcome, 'FAIL');
  assert.equal(r.checks.find(c => c.id === 'cpu-bucket').status, 'FAIL');
}

{
  const rows = evidence();
  rows[2] = event(1000, 'BOT_HEARTBEAT', {
    cpu: 23.6,
    bucket: 10000,
    profile: {
      sections: { rooms: 8.5, creeps: 4.2 },
      details: { 'room.logistics-match': 0.3 },
      attributed: 12.7,
      unattributed: 10.9
    }
  });
  const r = evaluateSmoke({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  const cpu = r.checks.find(c => c.id === 'cpu-bucket');
  assert.equal(cpu.status, 'FAIL');
  assert.match(cpu.message, /CPU>20: 1000=23\.6/);
  assert.equal(cpu.data.badCpu[0].profile.sections.rooms, 8.5);
  assert.equal(cpu.data.badCpu[0].profile.details['room.logistics-match'], 0.3);
}

{
  const rows = evidence();
  rows[0].jseq = 20;
  rows.at(-1).jseq = 23;
  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0', droppedThroughSeq: 0 });
  assert.equal(r.outcome, 'FAIL');
  assert.equal(r.checks.find(c => c.id === 'telemetry-continuity').status, 'FAIL');
}

{
  const gap = detectJseqGaps([{ jseq: 20 }, { jseq: 23 }], 22);
  assert.deepEqual(gap.gaps, [{ from: 21, to: 22, coveredByRetention: true }]);
}

{
  const rows = evidence();
  const status = rows.at(-1);
  status.ctx.rooms.E8N1.economyModel.consumerWaitingCount = 3;
  status.ctx.rooms.E8N1.economyModel.consumerCriticalCount = 3;
  status.ctx.rooms.E8N1.consumerSupply = {
    criticalConsumers: [{ name: 'builder-a', role: 'builder', energy: 0, waiting: 3, fallback: false }],
    consumerReservations: [{ hauler: 'hauler-a', targetId: 'builder-a', carried: 100, delivering: true }]
  };
  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.outcome, 'WATCH');
  const supply = r.checks.find(c => c.id === 'consumer-supply');
  assert.equal(supply.status, 'WATCH');
  assert.equal(supply.data.diagnostics.criticalConsumers[0].name, 'builder-a');
  assert.equal(supply.data.diagnostics.consumerReservations[0].hauler, 'hauler-a');
  assert.equal(r.counts.fail, 0);
}

{
  const r = evaluateSmoke({ events: evidence(), startTick: 1000, nodeVersion: '22.16.0' });
  assert.equal(r.outcome, 'FAIL');
  assert.equal(r.checks.find(c => c.id === 'node-version').status, 'FAIL');
}

{
  const rows = evidence();
  const sparse = rows.filter(e => e.tick === 1000 || e.tick === 1024 || e.tick === 1099);
  const r = evaluateSmoke({ events: sparse, startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.outcome, 'PASS');
  assert.equal(r.checks.find(c => c.id === 'window-complete').status, 'PASS');
}

{
  const rows = [
    event(1005, 'SPAWN_IDLE_SURPLUS', { room: 'E8N1' })
  ];
  const r = evaluateSmoke({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.complete, false);
  assert.equal(r.outcome, 'WATCH');
  assert.equal(r.checks.find(c => c.id === 'window-complete').status, 'WATCH');
  assert.equal(r.checks.find(c => c.id === 'cpu-bucket').status, 'WATCH');
  assert.equal(r.checks.find(c => c.id === 'mining-active').status, 'WATCH');
  assert.equal(r.counts.fail, 0);
}

{
  const r = evaluateSmoke({
    events: evidence(),
    startTick: 1000,
    nodeVersion: '24.21.0',
    collectorErrors: ['2026-10-04T10:21:30.000Z collector parse warning']
  });
  assert.equal(r.checks.find(c => c.id === 'runtime-errors').status, 'PASS');
  assert.equal(r.checks.find(c => c.id === 'collector-health').status, 'WATCH');
  assert.equal(r.counts.fail, 0);
}



{
  const rows = evidence();
  delete rows.at(-1).ctx.rooms.E8N1.economy.last100.productiveFlow;
  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.outcome, 'FAIL');
  const attribution = r.checks.find(c => c.id === 'productive-attribution');
  assert.equal(attribution.status, 'FAIL');
  assert.match(attribution.message, /consumerTicks/);
}

{
  const rows = evidence();
  rows.at(-1).ctx.rooms.E8N1.colonyState.spawnPlan.authority = 'AUTHORITATIVE';
  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.outcome, 'FAIL');
  assert.equal(r.checks.find(c => c.id === 'vnext-shadow-authority').status, 'FAIL');
}

{
  const rows = evidence();
  rows.at(-1).ctx.rooms.E8N1.colonyState.logisticsMatching = {
    available: true,
    authority: 'AUTHORITATIVE'
  };
  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.outcome, 'FAIL');
  const authority = r.checks.find(c => c.id === 'vnext-shadow-authority');
  assert.equal(authority.status, 'FAIL');
  assert.ok(authority.data.failures.includes('logisticsMatching'));
}

{
  const rows = evidence();
  rows.at(-1).ctx.rooms.E8N1.colonyState.logisticsMatching = {
    available: true,
    authority: 'SHADOW',
    evidence: {
      authority: 'AUTHORITATIVE'
    }
  };
  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.outcome, 'FAIL');
  const authority = r.checks.find(c => c.id === 'vnext-shadow-authority');
  assert.equal(authority.status, 'FAIL');
  assert.ok(authority.data.failures.includes('logisticsMatching.evidence'));
}

{
  const rows = evidence();
  rows.at(-1).ctx.rooms.E8N1.colonyState.logisticsMatching = {
    available: true,
    authority: 'SHADOW',
    evidence: {
      authority: 'SHADOW_EVIDENCE',
      current: null,
      lastWindow: {
        authority: 'SHADOW_EVIDENCE',
        startTick: 1000,
        endTick: 1099,
        ticks: 100,
        averageHaulers: 2,
        averageMatchedHaulers: 1.5,
        haulerUtilization: 0.75,
        averageCandidatesPerTick: 4,
        averageJobsPerTick: 1,
        criticalRequestTicks: 40,
        criticalCoverageRatio: 1,
        averageReservedAmountPerTick: 125,
        averagePredictedTransportTicks: 9.5,
        averageConsumerWaiting: 0.2,
        averageConsumerCritical: 0.3,
        averageConsumerFallback: 0,
        duplicateReservationTicks: 0
      }
    }
  };
  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  const e4 = r.checks.find(c => c.id === 'e4-matching-evidence');
  assert.equal(e4.status, 'PASS');
  assert.equal(e4.data.averageHaulers, 2);
  assert.equal(e4.data.averageMatchedHaulers, 1.5);
  assert.equal(e4.data.averageCandidatesPerTick, 4);
  assert.equal(e4.data.averageReservedAmountPerTick, 125);
  assert.equal(e4.data.averageConsumerCritical, 0.3);
  assert.equal(e4.data.duplicateReservationTicks, 0);
}

{
  // Missing duplicate-reservation evidence must remain unknown. In particular,
  // an exact 100-tick E4 window must not coerce a truncated/missing field to 0
  // and claim a duplicate-free PASS.
  const rows = evidence();
  rows.at(-1).ctx.rooms.E8N1.colonyState.logisticsMatching = {
    available: true,
    authority: 'SHADOW',
    evidence: {
      authority: 'SHADOW_EVIDENCE',
      current: null,
      lastWindow: {
        authority: 'SHADOW_EVIDENCE',
        startTick: 1000,
        endTick: 1099,
        ticks: 100,
        haulerUtilization: 1,
        averageJobsPerTick: 2,
        criticalRequestTicks: 40,
        criticalCoverageRatio: 1,
        averagePredictedTransportTicks: 4,
        averageConsumerWaiting: 0,
        averageConsumerFallback: 0
      }
    }
  };
  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  const e4 = r.checks.find(c => c.id === 'e4-matching-evidence');
  assert.equal(e4.status, 'WATCH');
  assert.equal(e4.data.duplicateReservationTicks, null);
  assert.match(e4.message, /duplicate-reservation evidence is unavailable/i);
  assert.equal(r.counts.fail, 0);
}

{
  const rows = evidence();
  rows.at(-1).ctx.rooms.E8N1.colonyState.logisticsMatching = {
    available: true,
    authority: 'SHADOW',
    evidence: {
      authority: 'SHADOW_EVIDENCE',
      current: null,
      lastWindow: {
        authority: 'SHADOW_EVIDENCE',
        startTick: 1000,
        endTick: 1099,
        ticks: 100,
        haulerUtilization: 0.5,
        averageJobsPerTick: 1,
        criticalRequestTicks: 40,
        criticalCoverageRatio: 1,
        averagePredictedTransportTicks: 9.5,
        averageConsumerWaiting: 0.2,
        averageConsumerFallback: 0,
        duplicateReservationTicks: 1
      }
    }
  };
  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.outcome, 'FAIL');
  assert.equal(r.checks.find(c => c.id === 'e4-matching-evidence').status, 'FAIL');
}

{
  const rows = evidence();
  rows.at(-1).ctx.rooms.E8N1.colonyState.logisticsMatching = {
    available: true,
    authority: 'SHADOW',
    evidence: {
      authority: 'SHADOW_EVIDENCE',
      current: {
        authority: 'SHADOW_EVIDENCE',
        startTick: 1080,
        endTick: 1099,
        ticks: 20
      },
      lastWindow: null
    }
  };
  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.checks.find(c => c.id === 'e4-matching-evidence').status, 'WATCH');
}

{
  const rows = evidence();
  delete rows.at(-1).ctx.scheduler;
  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  assert.equal(r.outcome, 'FAIL');
  assert.equal(r.checks.find(c => c.id === 'vnext-platform-shadow').status, 'FAIL');
}

{
  const staleRoom = baseRoom();
  staleRoom.economy.last100.startTick = 1000;
  staleRoom.economy.last100.endTick = 1099;
  staleRoom.economy.last100.ticks = 100;

  const rows = [
    event(1101, 'ROOM_HEARTBEAT', {
      room: 'E8N1',
      economy: staleRoom.economy,
      economyModel: staleRoom.economyModel,
      health: staleRoom.health,
      efficiency: staleRoom.efficiency,
      colonyState: staleRoom.colonyState
    }),
    event(1150, 'BOT_HEARTBEAT', { cpu: 3.8, bucket: 10000 })
  ];

  const r = evaluateLive({ events: rows, startTick: 1101, nodeVersion: '24.21.0' });
  assert.equal(r.complete, false);
  assert.equal(r.attributionWindow.matches, false);
  assert.equal(r.attributionWindow.observedStartTick, 1000);
  assert.equal(r.attributionWindow.observedEndTick, 1099);
  assert.equal(r.checks.find(c => c.id === 'productive-attribution').status, 'WATCH');
  assert.equal(r.checks.find(c => c.id === 'controller-progress').status, 'WATCH');
  assert.equal(r.checks.find(c => c.id === 'productive-throughput').status, 'WATCH');
}

{
  // Runtime economy windows have their own fixed 100-tick cadence. A complete
  // verifier window can therefore end with a valid last100 block that does not
  // share the verifier's exact start/end ticks. That is an evidence-alignment
  // WATCH, not proof that productive-flow telemetry is missing.
  const rows = evidence(1101);
  const status = rows.at(-1);
  status.ctx.rooms.E8N1.economy.last100.startTick = 1000;
  status.ctx.rooms.E8N1.economy.last100.endTick = 1099;
  status.ctx.rooms.E8N1.economy.last100.ticks = 100;

  const r = evaluateLive({ events: rows, startTick: 1101, nodeVersion: '24.21.0' });
  assert.equal(r.complete, true);
  assert.equal(r.attributionWindow.matches, false);
  assert.equal(r.attributionWindow.observedStartTick, 1000);
  assert.equal(r.attributionWindow.observedEndTick, 1099);
  assert.equal(r.checks.find(c => c.id === 'productive-attribution').status, 'WATCH');
  assert.equal(r.checks.find(c => c.id === 'controller-progress').status, 'WATCH');
  assert.equal(r.checks.find(c => c.id === 'construction-progress').status, 'WATCH');
  assert.equal(r.checks.find(c => c.id === 'productive-throughput').status, 'WATCH');
  assert.equal(r.counts.fail, 0);
}


{
  // STATUS_SNAPSHOT logger depth can preserve the nested E4 evidence object
  // while truncating its window fields. The shallow room-level mirror must be
  // preferred so the verifier sees the real 100-tick evidence values.
  const rows = evidence();
  const status = rows.at(-1);
  status.ctx.rooms.E8N1.colonyState.logisticsMatching = {
    available: true,
    authority: 'SHADOW',
    evidence: {
      authority: 'SHADOW_EVIDENCE',
      current: '[depth-limit]',
      lastWindow: '[depth-limit]'
    }
  };
  status.ctx.rooms.E8N1.logisticsMatchingEvidence = {
    authority: 'SHADOW_EVIDENCE',
    current: null,
    lastWindow: {
      authority: 'SHADOW_EVIDENCE',
      startTick: 1000,
      endTick: 1099,
      ticks: 100,
      haulerUtilization: 0.75,
      averageJobsPerTick: 1.5,
      criticalRequestTicks: 40,
      criticalCoverageRatio: 0.9,
      averagePredictedTransportTicks: 7.5,
      averageConsumerWaiting: 0.1,
      averageConsumerFallback: 0,
      duplicateReservationTicks: 0
    }
  };

  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  const e4 = r.checks.find(c => c.id === 'e4-matching-evidence');
  assert.equal(e4.status, 'WATCH');
  assert.match(e4.message, /did not cover every critical logistics request/i);
  assert.equal(e4.data.criticalCoverageRatio, 0.9);
  assert.equal(e4.data.duplicateReservationTicks, 0);
}


{
  // A valid completed E4 window may be cadence-shifted relative to the verifier
  // window. Keep WATCH semantics, but surface the completed window's quality
  // metrics so live diagnosis can compare coverage without another data dump.
  const rows = evidence(1101);
  const status = rows.at(-1);
  status.ctx.rooms.E8N1.colonyState.logisticsMatching = {
    available: true,
    authority: 'SHADOW',
    evidence: { authority: 'SHADOW_EVIDENCE' }
  };
  status.ctx.rooms.E8N1.logisticsMatchingEvidence = {
    authority: 'SHADOW_EVIDENCE',
    current: {
      authority: 'SHADOW_EVIDENCE',
      startTick: 1200,
      endTick: 1207,
      ticks: 8
    },
    lastWindow: {
      authority: 'SHADOW_EVIDENCE',
      startTick: 1100,
      endTick: 1199,
      ticks: 100,
      averageHaulers: 2,
      averageMatchedHaulers: 2,
      haulerUtilization: 1,
      averageCandidatesPerTick: 26.23,
      averageJobsPerTick: 2.5,
      criticalRequestTicks: 80,
      criticalMatchedTicks: 72,
      unmatchedCriticalTicks: 8,
      criticalCandidateRequestTicks: 80,
      criticalNoCandidateTicks: 0,
      criticalCandidateUnmatchedTicks: 8,
      criticalSlotCapacityTicks: 72,
      criticalCoverageRatio: 0.9,
      criticalCandidateRatio: 1,
      criticalCandidateCoverageRatio: 0.9,
      criticalSlotCoverageRatio: 1,
      averageReservedAmountPerTick: 149.13,
      averagePredictedTransportTicks: 3.25,
      averageConsumerWaiting: 0.4,
      averageConsumerCritical: 1.6,
      averageConsumerFallback: 0,
      duplicateReservationTicks: 0
    }
  };

  const r = evaluateLive({ events: rows, startTick: 1101, nodeVersion: '24.21.0' });
  const e4 = r.checks.find(c => c.id === 'e4-matching-evidence');
  assert.equal(e4.status, 'WATCH');
  assert.equal(e4.data.observedLastWindow.startTick, 1100);
  assert.equal(e4.data.observedLastWindow.endTick, 1199);
  assert.equal(e4.data.observedMetrics.averageHaulers, 2);
  assert.equal(e4.data.observedMetrics.averageMatchedHaulers, 2);
  assert.equal(e4.data.observedMetrics.averageCandidatesPerTick, 26.23);
  assert.equal(e4.data.observedMetrics.criticalCoverageRatio, 0.9);
  assert.equal(e4.data.observedMetrics.criticalMatchedTicks, 72);
  assert.equal(e4.data.observedMetrics.criticalCandidateRequestTicks, 80);
  assert.equal(e4.data.observedMetrics.criticalNoCandidateTicks, 0);
  assert.equal(e4.data.observedMetrics.criticalCandidateUnmatchedTicks, 8);
  assert.equal(e4.data.observedMetrics.criticalSlotCapacityTicks, 72);
  assert.equal(e4.data.observedMetrics.criticalCandidateRatio, 1);
  assert.equal(e4.data.observedMetrics.criticalCandidateCoverageRatio, 0.9);
  assert.equal(e4.data.observedMetrics.criticalSlotCoverageRatio, 1);
  assert.equal(e4.data.observedMetrics.averageReservedAmountPerTick, 149.13);
  assert.equal(e4.data.observedMetrics.averageConsumerCritical, 1.6);
  assert.equal(e4.data.observedMetrics.duplicateReservationTicks, 0);
  assert.equal(e4.data.currentTicks, 8);
}

console.log('live-verification tests passed');


{
  // A completed ASSIGNMENT_EVIDENCE_WINDOW can exactly cover the requested
  // verifier window even when the latest STATUS_SNAPSHOT still carries the
  // previous fixed economy last100 block. Use the exact event for progress and
  // useful-work checks without pretending the richer productiveFlow payload is
  // available for the same window.
  const rows = evidence(1101);
  const status = rows.at(-1);
  status.ctx.rooms.E8N1.economy.last100.startTick = 1000;
  status.ctx.rooms.E8N1.economy.last100.endTick = 1099;
  status.ctx.rooms.E8N1.economy.last100.ticks = 100;
  rows.push(event(1200, 'ASSIGNMENT_EVIDENCE_WINDOW', {
    room: 'E8N1',
    evidence: {
      authority: 'SHADOW_EVIDENCE',
      startTick: 1101,
      endTick: 1200,
      ticks: 100,
      controllerProgress: 260,
      constructionProgress: 949,
      usefulWorkPerTick: 12.09
    }
  }, { jseq: 22 }));

  const r = evaluateLive({ events: rows, startTick: 1101, nodeVersion: '24.21.0' });
  assert.equal(r.checks.find(c => c.id === 'productive-attribution').status, 'WATCH');
  assert.equal(r.checks.find(c => c.id === 'controller-progress').status, 'PASS');
  assert.equal(r.checks.find(c => c.id === 'controller-progress').data.controllerProgress, 260);
  assert.equal(r.checks.find(c => c.id === 'construction-progress').status, 'PASS');
  assert.equal(r.checks.find(c => c.id === 'construction-progress').data.constructionProgress, 949);
  assert.equal(r.checks.find(c => c.id === 'productive-throughput').status, 'WATCH');
  assert.equal(r.checks.find(c => c.id === 'productive-throughput').data.throughput, 12.09);
  assert.deepEqual(r.assignmentEvidenceWindow, {
    startTick: 1101,
    endTick: 1200,
    ticks: 100,
    controllerProgress: 260,
    constructionProgress: 949,
    usefulWorkPerTick: 12.09
  });
  assert.equal(r.counts.fail, 0);
}

{
  // Explicit null is unknown evidence, not numeric zero.
  const rows = evidence();
  const status = rows.at(-1);
  status.ctx.rooms.E8N1.colonyState.logisticsMatching = {
    available: true,
    authority: 'SHADOW',
    evidence: { authority: 'SHADOW_EVIDENCE' }
  };
  status.ctx.rooms.E8N1.logisticsMatchingEvidence = {
    authority: 'SHADOW_EVIDENCE',
    current: null,
    lastWindow: {
      authority: 'SHADOW_EVIDENCE',
      startTick: 1000,
      endTick: 1099,
      ticks: 100,
      averageHaulers: 2,
      averageMatchedHaulers: 2,
      haulerUtilization: 1,
      averageCandidatesPerTick: 4,
      averageJobsPerTick: 2,
      criticalRequestTicks: 0,
      criticalCoverageRatio: 1,
      averageReservedAmountPerTick: 100,
      averagePredictedTransportTicks: 2,
      averageConsumerWaiting: 0,
      averageConsumerCritical: 0,
      averageConsumerFallback: 0,
      duplicateReservationTicks: null
    }
  };

  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  const e4 = r.checks.find(c => c.id === 'e4-matching-evidence');
  assert.equal(e4.status, 'WATCH');
  assert.equal(e4.data.duplicateReservationTicks, null);
  assert.match(e4.message, /unavailable/i);
}


{
  // A runtime last100 window may only be serialized after the verifier window
  // has ended. Recover the exact immutable block from a later STATUS_SNAPSHOT,
  // but do not let that later snapshot affect safety/current-state checks.
  const rows = evidence(1101);
  const selectedStatus = rows.at(-1);
  selectedStatus.ctx.rooms.E8N1.economy.last100.startTick = 1000;
  selectedStatus.ctx.rooms.E8N1.economy.last100.endTick = 1099;
  selectedStatus.ctx.rooms.E8N1.economy.last100.ticks = 100;

  const carrierRoom = baseRoom();
  carrierRoom.economy.last100.startTick = 1101;
  carrierRoom.economy.last100.endTick = 1200;
  carrierRoom.economy.last100.ticks = 100;
  carrierRoom.economy.last100.controllerProgress = 260;
  carrierRoom.economy.last100.constructionProgress = 949;
  carrierRoom.economy.last100.productiveFlow.actualProductiveThroughputPerTick = 12.09;
  carrierRoom.efficiency.metrics.productiveThroughputPerTick = 12.09;

  rows.push(event(1225, 'STATUS_SNAPSHOT', {
    rooms: { E8N1: carrierRoom },
    cpu: 99,
    bucket: 0,
    capabilities: { schemaVersion: 1 },
    serverProfile: { schemaVersion: 1 },
    scheduler: { schemaVersion: 1 },
    worldIntel: { schemaVersion: 1 }
  }, { jseq: 22 }));
  rows.push(event(1226, 'UNCAUGHT_RUNTIME', { error: 'future-only' }, { level: 'ERROR', jseq: 23 }));

  const r = evaluateLive({ events: rows, startTick: 1101, nodeVersion: '24.21.0' });
  assert.equal(r.attributionWindow.matches, true);
  assert.equal(r.attributionWindow.observedStartTick, 1101);
  assert.equal(r.attributionWindow.observedEndTick, 1200);
  assert.equal(r.attributionWindow.carrierTick, 1225);
  assert.equal(r.attributionWindow.carrierAfterWindow, true);
  assert.equal(r.checks.find(c => c.id === 'productive-attribution').status, 'PASS');
  assert.equal(r.checks.find(c => c.id === 'controller-progress').status, 'PASS');
  assert.equal(r.checks.find(c => c.id === 'controller-progress').data.controllerProgress, 260);
  assert.equal(r.checks.find(c => c.id === 'construction-progress').status, 'PASS');
  assert.equal(r.checks.find(c => c.id === 'construction-progress').data.constructionProgress, 949);
  assert.equal(r.checks.find(c => c.id === 'productive-throughput').data.throughput, 12.09);
  assert.equal(r.checks.find(c => c.id === 'runtime-errors').status, 'PASS');
  assert.equal(r.checks.find(c => c.id === 'cpu-bucket').status, 'PASS');
}


{
  // Productive progress and mining income are different units. A window that
  // would look healthy against a small mining number must still be compared
  // against same-unit modeled productive WORK capacity.
  const rows = evidence();
  const status = rows.at(-1);
  const room = status.ctx.rooms.E8N1;
  room.economy.last100.productiveFlow.averageBuilderWorkParts = 4;
  room.economy.last100.productiveFlow.averageWorkerWorkParts = 1;
  room.economy.last100.productiveFlow.averageUpgraderWorkParts = 4;
  room.economy.last100.productiveFlow.averageConstructionCapacityPerTick = 25;
  room.economy.last100.productiveFlow.averageDedicatedControllerCapacityPerTick = 4;
  room.economy.last100.productiveFlow.constructionBacklogRatio = 1;
  room.economy.last100.productiveFlow.controllerDemandRatio = 1;
  room.economy.last100.productiveFlow.actualProductiveThroughputPerTick = 14.8;
  room.economyModel.productiveDemandPerTick = 29;
  room.economyModel.dedicatedHarvestCapacityPerTick = 10;
  room.efficiency.metrics.dedicatedHarvestCapacityPerTick = 10;
  room.efficiency.metrics.productiveThroughputPerTick = 14.8;

  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  const throughput = r.checks.find(c => c.id === 'productive-throughput');
  assert.equal(throughput.status, 'WATCH');
  assert.equal(throughput.data.throughput, 14.8);
  assert.equal(throughput.data.productiveCapacity, 29);
  assert.equal(throughput.data.mining, 10);
  assert.ok(Math.abs(throughput.data.utilization - (14.8 / 29)) < 1e-12);
  assert.match(throughput.message, /productive work capacity/i);
}


{
  // Controller-only windows must use controller capacity, not construction WORK
  // that has no active construction backlog.
  const rows = evidence();
  const room = rows.at(-1).ctx.rooms.E8N1;
  room.constructionSites = 0;
  room.economy.last100.controllerProgress = 376;
  room.economy.last100.constructionProgress = 0;
  room.economy.last100.productiveFlow.averageBuilderWorkParts = 0;
  room.economy.last100.productiveFlow.averageWorkerWorkParts = 4;
  room.economy.last100.productiveFlow.averageUpgraderWorkParts = 6;
  room.economy.last100.productiveFlow.averageConstructionCapacityPerTick = 0;
  room.economy.last100.productiveFlow.averageDedicatedControllerCapacityPerTick = 6;
  room.economy.last100.productiveFlow.constructionBacklogRatio = 0;
  room.economy.last100.productiveFlow.controllerDemandRatio = 1;
  room.economy.last100.productiveFlow.actualProductiveThroughputPerTick = 3.76;
  room.economyModel.productiveDemandPerTick = 6;
  room.efficiency.metrics.productiveThroughputPerTick = 3.76;

  const r = evaluateLive({ events: rows, startTick: 1000, nodeVersion: '24.21.0' });
  const throughput = r.checks.find(c => c.id === 'productive-throughput');
  assert.equal(throughput.status, 'PASS');
  assert.equal(throughput.data.throughput, 3.76);
  assert.equal(throughput.data.productiveCapacity, 6);
  assert.ok(Math.abs(throughput.data.utilization - (3.76 / 6)) < 1e-12);
}
