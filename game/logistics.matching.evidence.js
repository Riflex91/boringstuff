'use strict';

const SCHEMA_VERSION = 1;
const WINDOW_TICKS = 100;

function round(value, digits) {
  const scale = Math.pow(10, digits === undefined ? 3 : digits);
  return Math.round((Number(value) || 0) * scale) / scale;
}

function tick(game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  return game && Number.isFinite(game.time) ? game.time : 0;
}

function newWindow(startTick) {
  return {
    startTick,
    ticks: 0,
    deferredTicks: 0,
    haulerTicks: 0,
    matchedHaulerTicks: 0,
    candidateTicks: 0,
    jobTicks: 0,
    pairedJobTicks: 0,
    directCarriedJobTicks: 0,
    balanceJobTicks: 0,
    criticalRequestTicks: 0,
    criticalMatchedTicks: 0,
    unmatchedCriticalTicks: 0,
    criticalCandidateRequestTicks: 0,
    criticalNoCandidateTicks: 0,
    criticalCandidateUnmatchedTicks: 0,
    criticalSlotCapacityTicks: 0,
    reservedAmountTicks: 0,
    transportTickTotal: 0,
    transportJobCount: 0,
    consumerWaitingTicks: 0,
    consumerCriticalTicks: 0,
    consumerFallbackTicks: 0,
    duplicateReservationTicks: 0
  };
}

function ensure(memoryRoot) {
  memoryRoot = memoryRoot || (typeof Memory !== 'undefined' ? Memory : null);
  if (!memoryRoot) return { schemaVersion: SCHEMA_VERSION, rooms: {} };
  if (!memoryRoot.bot) memoryRoot.bot = {};
  if (!memoryRoot.bot.logisticsMatchingEvidence || memoryRoot.bot.logisticsMatchingEvidence.schemaVersion !== SCHEMA_VERSION) {
    memoryRoot.bot.logisticsMatchingEvidence = { schemaVersion: SCHEMA_VERSION, rooms: {} };
  }
  if (!memoryRoot.bot.logisticsMatchingEvidence.rooms) memoryRoot.bot.logisticsMatchingEvidence.rooms = {};
  return memoryRoot.bot.logisticsMatchingEvidence;
}

function ensureRoom(roomName, memoryRoot, now) {
  const root = ensure(memoryRoot);
  if (!root.rooms[roomName]) {
    root.rooms[roomName] = {
      window: newWindow(now),
      lastWindow: null
    };
  }
  if (!root.rooms[roomName].window) root.rooms[roomName].window = newWindow(now);
  return root.rooms[roomName];
}

function duplicateReservationCount(jobs) {
  const seen = {};
  let duplicates = 0;
  for (const job of jobs || []) {
    for (const id of job && Array.isArray(job.reservationIds) ? job.reservationIds : []) {
      if (!id) continue;
      if (seen[id]) duplicates += 1;
      else seen[id] = true;
    }
  }
  return duplicates;
}

function accumulate(window, state) {
  const matching = state && state.logisticsMatchingShadow || null;
  const summary = matching && matching.summary || {};
  const jobs = matching && matching.jobs || [];
  const model = state && state.economyModel || {};

  window.ticks += 1;
  if (summary.deferred) window.deferredTicks += 1;
  window.haulerTicks += Math.max(0, Number(summary.haulerCount) || 0);
  window.matchedHaulerTicks += Math.max(0, Number(summary.matchedHaulerCount) || 0);
  window.candidateTicks += Math.max(0, Number(summary.candidateCount) || 0);
  window.jobTicks += Math.max(0, Number(summary.jobCount) || 0);
  window.pairedJobTicks += Math.max(0, Number(summary.pairedJobCount) || 0);
  window.directCarriedJobTicks += Math.max(0, Number(summary.directCarriedJobCount) || 0);
  window.balanceJobTicks += jobs.filter(job => job && job.mode === 'BALANCE').length;
  window.criticalRequestTicks += Math.max(0, Number(summary.criticalRequestCount) || 0);
  window.criticalMatchedTicks += Math.max(0, Number(summary.criticalMatchedCount) || 0);
  window.unmatchedCriticalTicks += Math.max(0, Number(summary.unmatchedCriticalCount) || 0);
  window.criticalCandidateRequestTicks += Math.max(0, Number(summary.criticalCandidateRequestCount) || 0);
  window.criticalNoCandidateTicks += Math.max(0, Number(summary.criticalNoCandidateCount) || 0);
  window.criticalCandidateUnmatchedTicks += Math.max(0, Number(summary.criticalCandidateUnmatchedCount) || 0);
  window.criticalSlotCapacityTicks += Math.max(0, Number(summary.criticalSlotCapacity) || 0);
  window.reservedAmountTicks += Math.max(0, Number(summary.reservedAmount) || 0);

  const jobCount = Math.max(0, Number(summary.jobCount) || 0);
  const averageTransportTicks = Math.max(0, Number(summary.averageTransportTicks) || 0);
  if (jobCount > 0) {
    window.transportTickTotal += averageTransportTicks * jobCount;
    window.transportJobCount += jobCount;
  }

  window.consumerWaitingTicks += Math.max(0, Number(model.consumerWaitingCount) || 0);
  window.consumerCriticalTicks += Math.max(0, Number(model.consumerCriticalCount) || 0);
  window.consumerFallbackTicks += Math.max(0, Number(model.consumerFallbackCount) || 0);

  if (duplicateReservationCount(jobs) > 0) window.duplicateReservationTicks += 1;
  return window;
}

function summarize(window, endTick) {
  const ticks = Math.max(1, Number(window.ticks) || 0);
  const critical = Math.max(0, Number(window.criticalRequestTicks) || 0);
  const criticalCandidates = Math.max(0, Number(window.criticalCandidateRequestTicks) || 0);
  const criticalSlotCapacity = Math.max(0, Number(window.criticalSlotCapacityTicks) || 0);
  const criticalMatched = Math.max(0, Number(window.criticalMatchedTicks) || 0);
  const haulers = Math.max(0, Number(window.haulerTicks) || 0);
  return {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW_EVIDENCE',
    startTick: window.startTick,
    endTick,
    ticks: window.ticks,
    deferredRatio: round(window.deferredTicks / ticks),
    averageHaulers: round(window.haulerTicks / ticks, 2),
    averageMatchedHaulers: round(window.matchedHaulerTicks / ticks, 2),
    haulerUtilization: round(window.matchedHaulerTicks / Math.max(1, haulers)),
    averageCandidatesPerTick: round(window.candidateTicks / ticks, 2),
    averageJobsPerTick: round(window.jobTicks / ticks, 2),
    averagePairedJobsPerTick: round(window.pairedJobTicks / ticks, 2),
    averageDirectCarriedJobsPerTick: round(window.directCarriedJobTicks / ticks, 2),
    criticalRequestTicks: critical,
    criticalMatchedTicks: criticalMatched,
    unmatchedCriticalTicks: Math.max(0, Number(window.unmatchedCriticalTicks) || 0),
    criticalCandidateRequestTicks: criticalCandidates,
    criticalNoCandidateTicks: Math.max(0, Number(window.criticalNoCandidateTicks) || 0),
    criticalCandidateUnmatchedTicks: Math.max(0, Number(window.criticalCandidateUnmatchedTicks) || 0),
    criticalSlotCapacityTicks: criticalSlotCapacity,
    criticalCoverageRatio: critical
      ? round(criticalMatched / critical)
      : 1,
    criticalCandidateRatio: critical
      ? round(criticalCandidates / critical)
      : 1,
    criticalCandidateCoverageRatio: criticalCandidates
      ? round(criticalMatched / criticalCandidates)
      : (critical ? 0 : 1),
    criticalSlotCoverageRatio: criticalSlotCapacity
      ? round(criticalMatched / criticalSlotCapacity)
      : (critical ? 0 : 1),
    averageReservedAmountPerTick: round(window.reservedAmountTicks / ticks, 2),
    averagePredictedTransportTicks: window.transportJobCount
      ? round(window.transportTickTotal / window.transportJobCount, 2)
      : 0,
    averageConsumerWaiting: round(window.consumerWaitingTicks / ticks, 2),
    averageConsumerCritical: round(window.consumerCriticalTicks / ticks, 2),
    averageConsumerFallback: round(window.consumerFallbackTicks / ticks, 2),
    // logger.slim() preserves only the first 30 object keys. Keep duplicate
    // reservation evidence inside that durable telemetry budget; the balance
    // job average is diagnostic-only and may be the truncated trailing field.
    duplicateReservationTicks: Math.max(0, Number(window.duplicateReservationTicks) || 0),
    averageBalanceJobsPerTick: round(window.balanceJobTicks / ticks, 2)
  };
}

function observe(state, memoryRoot, game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const now = tick(game);
  const roomName = state && state.room && state.room.name;
  if (!roomName) return { current: null, completed: null, lastWindow: null };

  const room = ensureRoom(roomName, memoryRoot, now);
  accumulate(room.window, state);

  let completed = null;
  if (room.window.ticks >= WINDOW_TICKS) {
    completed = summarize(room.window, now);
    room.lastWindow = completed;
    room.window = newWindow(now + 1);
  }

  return {
    current: summarize(room.window, now),
    completed,
    lastWindow: room.lastWindow
  };
}

function snapshot(roomName, memoryRoot) {
  const root = ensure(memoryRoot);
  const room = root.rooms[roomName];
  if (!room) return { current: null, lastWindow: null };
  const now = typeof Game !== 'undefined' && Number.isFinite(Game.time)
    ? Game.time
    : (room.window.startTick || 0) + (room.window.ticks || 0) - 1;
  return {
    current: summarize(room.window, now),
    lastWindow: room.lastWindow || null
  };
}

module.exports = {
  SCHEMA_VERSION,
  WINDOW_TICKS,
  ensure,
  observe,
  snapshot,
  summarize,
  _test: {
    newWindow,
    ensureRoom,
    duplicateReservationCount,
    accumulate
  }
};
