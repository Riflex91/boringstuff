'use strict';

const SCHEMA_VERSION = 2;
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
    // The evidence window represents exactly one observed game tick per row.
    // Persistent version 2 explicitly invalidates older count-only windows.
    lastObservedTick: null,
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
      lastWindow: null,
      lastProcessedTick: null
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

// Reconcile *individual* non-executable E4 jobs with their claimed totals.
// A copied or malformed summary is not evidence that independent haulers
// received independent capacity/reservations. This scans only the jobs already
// bounded by the colony's live hauler count and issues no game actions.
function validatedJobAccounting(jobs, summary) {
  if (!Array.isArray(jobs) || !summary ||
      !Number.isSafeInteger(summary.haulerCount) ||
      summary.haulerCount < 0 ||
      jobs.length > summary.haulerCount) return false;
  const haulerIds = new Set(), reservationIds = new Set();
  const criticalDemandIds = new Set();
  let paired = 0, direct = 0, totalAmount = 0, totalTransport = 0;
  for (const job of jobs) {
    if (!job || job.authority !== 'SHADOW' ||
        job.schemaVersion !== 1 ||
        typeof job.haulerId !== 'string' || !job.haulerId ||
        haulerIds.has(job.haulerId) ||
        typeof job.demandRequestId !== 'string' || !job.demandRequestId ||
        !Number.isFinite(job.amount) || job.amount <= 0 ||
        !job.predicted || !Number.isFinite(job.predicted.transportTicks) ||
        job.predicted.transportTicks < 0 ||
        !Array.isArray(job.reservationIds)) return false;
    haulerIds.add(job.haulerId);
    let expectedReservations;
    if (job.mode === 'PICKUP_DELIVER') {
      if (typeof job.supplyRequestId !== 'string' || !job.supplyRequestId ||
          job.supplyRequestId === job.demandRequestId) return false;
      paired++;
      expectedReservations = 2;
    } else if (job.mode === 'BALANCE') {
      if (job.supplyRequestId !== job.demandRequestId) return false;
      paired++;
      expectedReservations = 1;
    } else if (job.mode === 'DIRECT_CARRIED') {
      if (job.supplyRequestId !== null) return false;
      direct++;
      expectedReservations = 1;
    } else return false;
    if (job.reservationIds.length !== expectedReservations) return false;
    for (const id of job.reservationIds) {
      if (typeof id !== 'string' || !id || reservationIds.has(id))
        return false;
      reservationIds.add(id);
    }
    if (typeof job.critical !== 'boolean' ||
        job.critical !== (job.requestKind === 'EMERGENCY_DELIVER'))
      return false;
    if (job.critical) criticalDemandIds.add(job.demandRequestId);
    totalAmount += job.amount;
    totalTransport += job.predicted.transportTicks;
  }
  // Shadow matcher deliberately rounds both economy totals to cents / 2 dp.
  const round2 = x => Math.round(x * 100) / 100;
  return summary.pairedJobCount === paired &&
    summary.directCarriedJobCount === direct &&
    summary.jobCount === jobs.length &&
    summary.matchedHaulerCount === jobs.length &&
    summary.criticalMatchedCount === criticalDemandIds.size &&
    summary.reservedAmount === round2(totalAmount) &&
    summary.averageTransportTicks ===
      (jobs.length ? round2(totalTransport / jobs.length) : 0);
}

// Only a verified, fresh E4 shadow plan represents one genuine sampled
// decision tick. Missing, stale or self-contradictory summaries are gaps,
// NOT zero-demand / perfect-coverage proof.
function validatedMatching(state, now) {
  const matching = state && state.logisticsMatchingShadow;
  const summary = matching && matching.summary;
  if (!matching || matching.authority !== 'SHADOW' ||
      !Array.isArray(matching.jobs) ||
      matching.schemaVersion !== 1 ||
      !summary || summary.authority !== 'SHADOW' ||
      summary.schemaVersion !== 1 ||
      typeof summary.deferred !== 'boolean') return false;
  if (summary.deferred) {
    return summary.planTick === null &&
      typeof summary.deferReason === 'string' && !!summary.deferReason &&
      matching.jobs.length === 0 && summary.jobCount === 0;
  }
  if (summary.planTick !== now) return false;
  const keys = ['haulerCount','matchedHaulerCount','candidateCount',
    'jobCount','pairedJobCount','directCarriedJobCount',
    'criticalRequestCount','criticalMatchedCount','unmatchedCriticalCount',
    'criticalCandidateRequestCount','criticalNoCandidateCount',
    'criticalCandidateUnmatchedCount','criticalSlotCapacity'];
  if (keys.some(key => !Number.isSafeInteger(summary[key]) ||
      summary[key] < 0)) return false;
  if (!Number.isFinite(summary.reservedAmount) || summary.reservedAmount < 0 ||
      !Number.isFinite(summary.averageTransportTicks) ||
      summary.averageTransportTicks < 0) return false;
  return validatedJobAccounting(matching.jobs, summary) &&
    summary.jobCount === matching.jobs.length &&
    summary.matchedHaulerCount === summary.jobCount &&
    summary.jobCount <= summary.haulerCount &&
    summary.criticalMatchedCount + summary.unmatchedCriticalCount ===
      summary.criticalRequestCount &&
    summary.criticalCandidateRequestCount + summary.criticalNoCandidateCount ===
      summary.criticalRequestCount &&
    summary.criticalCandidateUnmatchedCount <= summary.unmatchedCriticalCount &&
    summary.criticalMatchedCount <= summary.criticalCandidateRequestCount &&
    summary.criticalSlotCapacity <=
      Math.min(summary.criticalRequestCount, summary.haulerCount);
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
    // An entirely deferred window proves nothing about matching quality.
    criticalCoverageRatio: window.deferredTicks === window.ticks
      ? null : (critical ? round(criticalMatched / critical) : 1),
    criticalCandidateRatio: window.deferredTicks === window.ticks
      ? null : (critical ? round(criticalCandidates / critical) : 1),
    criticalCandidateCoverageRatio: window.deferredTicks === window.ticks
      ? null : (criticalCandidates
        ? round(criticalMatched / criticalCandidates) : (critical ? 0 : 1)),
    criticalSlotCoverageRatio: window.deferredTicks === window.ticks
      ? null : (criticalSlotCapacity
        ? round(criticalMatched / criticalSlotCapacity) : (critical ? 0 : 1)),
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
  const now = game && game.time;
  const roomName = state && state.room && state.room.name;
  if (!Number.isSafeInteger(now) || now < 0 || !roomName)
    return { current: null, completed: null, lastWindow: null };

  const room = ensureRoom(roomName, memoryRoot, now);
  // A skipped/broken E4 plan is not a zero-work tick. Invalidate any
  // incomplete streak and withhold a current snapshot rather than projecting
  // a false 100-tick complete matching record.
  if (!validatedMatching(state, now)) {
    room.window = newWindow(now + 1);
    room.lastProcessedTick = now;
    return { current: null, completed: null,
      lastWindow: room.lastWindow || null,
      invalidReason: 'MISSING_STALE_OR_INCONSISTENT_SHADOW_PLAN' };
  }
  // Keep a boundary guard after 100th-tick rollover, otherwise a second
  // observer call on the completed tick would start another false window.
  if (room.lastProcessedTick === now) {
    return { current: summarize(room.window, now), completed: null,
      lastWindow: room.lastWindow };
  }
  if (Number.isSafeInteger(room.lastProcessedTick) &&
      now < room.lastProcessedTick) {
    room.window = newWindow(now);
    room.lastWindow = null;
  }
  // This also repairs malformed previous v2 records rather than treating
  // arbitrary counters or replayed snapshot data as a verified tick window.
  let w = room.window;
  const valid = w && Number.isSafeInteger(w.startTick) &&
    Number.isSafeInteger(w.ticks) && w.ticks >= 0 &&
    w.ticks < WINDOW_TICKS &&
    (w.ticks === 0 ? w.lastObservedTick === null :
      Number.isSafeInteger(w.lastObservedTick) &&
      w.lastObservedTick - w.startTick === w.ticks - 1);
  if (!valid) {
    room.window = newWindow(now);
    w = room.window;
  }
  // Duplicate observation in one tick is idempotent. Never complete an
  // artificial "100-tick" window by observing a single tick repeatedly.
  if (w.lastObservedTick === now) {
    return { current: summarize(w, now), completed: null,
      lastWindow: room.lastWindow };
  }
  if (w.lastObservedTick !== null &&
      now !== w.lastObservedTick + 1) {
    // Missing or reversed tick breaks evidence. Do not splice together
    // histories across observation gaps, respawns or simulation resets.
    if (now < w.lastObservedTick) room.lastWindow = null;
    room.window = newWindow(now);
    w = room.window;
  } else if (w.lastObservedTick === null && w.startTick !== now) {
    // Recover from an empty window left after a completed 100-tick batch.
    // If the next call is late, restart at the actual observed tick.
    room.window = newWindow(now);
    w = room.window;
  }
  accumulate(w, state);
  w.lastObservedTick = now;
  room.lastProcessedTick = now;

  let completed = null;
  if (w.ticks === WINDOW_TICKS) {
    // A full window must have 100 distinct, contiguous actual timestamps.
    completed = summarize(w, now);
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
    validatedMatching,
    validatedJobAccounting,
    accumulate
  }
};
