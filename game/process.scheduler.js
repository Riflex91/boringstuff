'use strict';

const PRIORITY = Object.freeze({
  CRITICAL: 'CRITICAL',
  DEADLINE: 'DEADLINE',
  STANDARD: 'STANDARD',
  BACKGROUND: 'BACKGROUND',
  OVERFLOW: 'OVERFLOW'
});

const SCHEMA_VERSION = 1;

function ensure(memoryRoot) {
  memoryRoot = memoryRoot || (typeof Memory !== 'undefined' ? Memory : null);
  if (!memoryRoot) return { schemaVersion: SCHEMA_VERSION, processes: {} };
  if (!memoryRoot.bot) memoryRoot.bot = {};
  if (!memoryRoot.bot.scheduler || memoryRoot.bot.scheduler.schemaVersion !== SCHEMA_VERSION) {
    memoryRoot.bot.scheduler = { schemaVersion: SCHEMA_VERSION, processes: {} };
  }
  if (!memoryRoot.bot.scheduler.processes) memoryRoot.bot.scheduler.processes = {};
  return memoryRoot.bot.scheduler;
}

function processState(scheduler, id) {
  if (!scheduler.processes[id]) {
    scheduler.processes[id] = {
      lastRunTick: null,
      lastCpu: 0,
      cpuEMA: 0,
      runCount: 0,
      skippedCount: 0,
      lastDecision: null,
      lastSkipReason: null
    };
  }
  return scheduler.processes[id];
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function priorityFloor(priorityClass, thresholds) {
  switch (priorityClass) {
    case PRIORITY.CRITICAL: return -Infinity;
    case PRIORITY.DEADLINE: return thresholds.critical;
    case PRIORITY.STANDARD: return thresholds.critical;
    case PRIORITY.BACKGROUND: return thresholds.low;
    case PRIORITY.OVERFLOW: return thresholds.healthy;
    default: return thresholds.low;
  }
}

function decision(descriptor, state, context) {
  descriptor = descriptor || {};
  context = context || {};

  const tick = numberOr(context.tick, 0);
  const bucket = numberOr(context.bucket, 0);
  const thresholds = context.thresholds || { critical: 0, low: 0, healthy: 0 };
  const priorityClass = descriptor.priorityClass || PRIORITY.STANDARD;
  const minimumInterval = Math.max(0, numberOr(descriptor.minimumInterval, 0));
  const freshnessRequirement = Number.isFinite(descriptor.freshnessRequirement)
    ? Math.max(0, descriptor.freshnessRequirement)
    : null;
  const deadlineTick = Number.isFinite(descriptor.deadlineTick) ? descriptor.deadlineTick : null;

  const neverRun = state.lastRunTick === null;
  const age = neverRun ? Infinity : Math.max(0, tick - state.lastRunTick);
  const intervalDue = neverRun || age >= minimumInterval;
  const overdue = deadlineTick !== null && tick >= deadlineTick;
  const stale = freshnessRequirement !== null && (neverRun || age >= freshnessRequirement);

  if (priorityClass === PRIORITY.CRITICAL) {
    return { run: true, reason: 'CRITICAL', age, overdue, stale };
  }

  if (overdue) {
    return { run: true, reason: 'DEADLINE_OVERDUE', age, overdue, stale };
  }

  if (!intervalDue) {
    return { run: false, reason: 'MINIMUM_INTERVAL', age, overdue, stale };
  }

  const floor = Number.isFinite(descriptor.bucketFloor)
    ? descriptor.bucketFloor
    : priorityFloor(priorityClass, thresholds);

  if (bucket < floor) {
    if (stale && priorityClass !== PRIORITY.OVERFLOW && bucket >= thresholds.critical) {
      return { run: true, reason: 'FRESHNESS_DUE', age, overdue, stale };
    }
    return { run: false, reason: 'BUCKET_BELOW_FLOOR', age, overdue, stale };
  }

  return { run: true, reason: stale ? 'FRESHNESS_DUE' : 'READY', age, overdue, stale };
}

function run(descriptor, fn, context, memoryRoot) {
  if (!descriptor || !descriptor.id) throw new Error('process descriptor requires id');
  if (typeof fn !== 'function') throw new Error('process runner requires function');

  const scheduler = ensure(memoryRoot);
  const state = processState(scheduler, descriptor.id);
  const d = decision(descriptor, state, context);

  state.lastDecision = d.reason;
  if (!d.run) {
    state.skippedCount += 1;
    state.lastSkipReason = d.reason;
    return { ran: false, reason: d.reason, cpuUsed: 0 };
  }

  const game = context && context.game ? context.game : (typeof Game !== 'undefined' ? Game : null);
  const cpu = game && game.cpu && typeof game.cpu.getUsed === 'function' ? game.cpu : null;
  const start = cpu ? cpu.getUsed() : 0;
  const result = fn();
  const used = cpu ? Math.max(0, cpu.getUsed() - start) : 0;

  state.lastRunTick = numberOr(context && context.tick, game && game.time);
  state.lastCpu = Math.round(used * 1000) / 1000;
  state.cpuEMA = state.runCount === 0
    ? state.lastCpu
    : Math.round((state.cpuEMA * 0.9 + used * 0.1) * 1000) / 1000;
  state.runCount += 1;
  state.lastSkipReason = null;

  return { ran: true, reason: d.reason, cpuUsed: state.lastCpu, result };
}

function snapshot(memoryRoot) {
  const scheduler = ensure(memoryRoot);
  const processes = {};
  for (const id in scheduler.processes) {
    const p = scheduler.processes[id];
    processes[id] = {
      lastRunTick: p.lastRunTick,
      lastCpu: p.lastCpu,
      cpuEMA: p.cpuEMA,
      runCount: p.runCount,
      skippedCount: p.skippedCount,
      lastDecision: p.lastDecision,
      lastSkipReason: p.lastSkipReason
    };
  }
  return { schemaVersion: SCHEMA_VERSION, processes };
}

module.exports = {
  PRIORITY,
  SCHEMA_VERSION,
  ensure,
  decision,
  run,
  snapshot,
  _test: { priorityFloor, numberOr, processState }
};