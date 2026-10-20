'use strict';

// O65: real-tick-aligned *passive* Spawn job witness for incident #369.
// Does not call spawnCreep/dryRun/cancel/recycle, alter creep memory,
// or infer a stuck engine from old HTTP room-object snapshots.
const MODEL_VERSION = 1;
const MAX_SPAWNS = 64;
const MAX_SPAWN_TICKS = 150; // 50 max body parts x 3 ticks/part.
const MAX_NAME_LENGTH = 128;

function integer(n, min, max) {
  return Number.isSafeInteger(n) && n >= min && n <= max;
}
function emptyWatch() {
  return { modelVersion: MODEL_VERSION, observedAtTick: null, bySpawn: {} };
}
function safeSnapshot(entry) {
  if (!entry) return {
    status: 'UNOBSERVED', observedTicks: 0, timerSamples: 0,
    warning: false, authority: 'SHADOW'
  };
  return {
    status: entry.status, observedTicks: entry.observedTicks,
    timerSamples: entry.timerSamples, timerAnomalies: entry.timerAnomalies,
    warning: entry.status === 'SUSPECT_STALLED', authority: 'SHADOW'
  };
}
function observe(game, memory, logger) {
  if (!game || !integer(game.time, 1, Number.MAX_SAFE_INTEGER) ||
      !memory || !memory.bot || !game.spawns ||
      typeof game.spawns !== 'object') {
    return { status: 'HOLD', reason: 'INVALID_GAME_CONTEXT', authority: 'SHADOW', events: [] };
  }
  const names = Object.keys(game.spawns).sort();
  if (names.length > MAX_SPAWNS) {
    return { status: 'HOLD', reason: 'SPAWN_BUDGET_EXCEEDED', authority: 'SHADOW', events: [] };
  }
  const prior = memory.bot.spawnJobStallWatch &&
    memory.bot.spawnJobStallWatch.modelVersion === MODEL_VERSION
      ? memory.bot.spawnJobStallWatch : emptyWatch();
  const bySpawn = {};
  const events = [];
  for (const name of names) {
    const spawn = game.spawns[name];
    if (!spawn || !spawn.my || !spawn.room || typeof spawn.room.name !== 'string' ||
        !spawn.room.controller || !spawn.room.controller.my ||
        typeof spawn.id !== 'string' || !spawn.id ||
        typeof name !== 'string' || name.length > MAX_NAME_LENGTH) continue;
    const room = spawn.room.name;
    const job = spawn.spawning;
    const current = prior.bySpawn && Object.prototype.hasOwnProperty.call(prior.bySpawn, name)
      ? prior.bySpawn[name] : null;
    if (!job) {
      bySpawn[name] = { spawnId: spawn.id, room, status: 'IDLE',
        lastTick: game.time, observedTicks: 0, timerSamples: 0,
        timerAnomalies: 0 };
      continue;
    }
    // A claim of stall requires BOTH an unchanged authenticated in-game
    // Spawn.spawning.name and valid in-game remainingTime/needTime.
    // Unavailable or nonsensical timer evidence is UNKNOWN, not a PASS.
    const valid = typeof job.name === 'string' &&
      job.name.length > 0 && job.name.length <= MAX_NAME_LENGTH &&
      integer(job.needTime, 1, MAX_SPAWN_TICKS) &&
      integer(job.remainingTime, 0, job.needTime);
    if (!valid) {
      bySpawn[name] = { spawnId: spawn.id, room, status: 'TIMER_UNKNOWN',
        lastTick: game.time, observedTicks: 0, timerSamples: 0,
        timerAnomalies: 0 };
      continue;
    }
    const contiguous = current && current.spawnId === spawn.id &&
      current.jobName === job.name &&
      current.status !== 'IDLE' && current.status !== 'TIMER_UNKNOWN' &&
      current.lastTick === game.time - 1 &&
      integer(current.observedTicks, 1, MAX_SPAWN_TICKS + 1) &&
      integer(current.timerSamples, 1, MAX_SPAWN_TICKS + 1) &&
      integer(current.remainingTime, 0, MAX_SPAWN_TICKS);
    const observations = contiguous
      ? Math.min(MAX_SPAWN_TICKS + 1, current.observedTicks + 1) : 1;
    const anomalies = contiguous
      ? Math.min(MAX_SPAWN_TICKS + 1,
        (current.timerAnomalies || 0) +
          (current.remainingTime - 1 === job.remainingTime ? 0 : 1)) : 0;
    const suspect = observations > MAX_SPAWN_TICKS;
    const status = suspect ? 'SUSPECT_STALLED' : 'OBSERVING';
    // The job name is used only inside private Screeps Memory to correlate
    // consecutive actual game ticks. It is never logged or summarized.
    bySpawn[name] = { spawnId: spawn.id, room, jobName: job.name,
      needTime: job.needTime, remainingTime: job.remainingTime,
      lastTick: game.time, observedTicks: observations,
      timerSamples: observations, timerAnomalies: anomalies, status };
    if (suspect && (!current || current.status !== 'SUSPECT_STALLED')) {
      const event = {
        room, observedTicks: observations, timerSamples: observations,
        timerAnomalies: anomalies,
        evidence: 'CONTIGUOUS_IN_GAME_TICKS',
        resolution: 'MANUAL_REVIEW_ONLY',
        actionAuthority: 'NONE'
      };
      events.push(event);
      if (logger && typeof logger.warn === 'function') {
        logger.warn('SPAWN_JOB_STALL_SUSPECT',
          'Same in-game spawning job observed beyond maximum legal duration',
          event, { force: true, persist: true, dedupeTicks: 0 });
      }
    }
  }
  // Atomic bounded replacement of only the O65-owned memory namespace.
  // Room loss, spawn destruction, gaps and restarts never preserve a false
  // uninterrupted observation chain.
  memory.bot.spawnJobStallWatch = {
    modelVersion: MODEL_VERSION, observedAtTick: game.time, bySpawn
  };
  return { status: 'OBSERVED', authority: 'SHADOW', events };
}
function summary(roomName, memory) {
  const watch = memory && memory.bot && memory.bot.spawnJobStallWatch;
  if (!watch || watch.modelVersion !== MODEL_VERSION ||
      typeof roomName !== 'string') return safeSnapshot(null);
  let chosen = null;
  // Don't output job/spawn names, IDs or the private memory ledger.
  for (const key of Object.keys(watch.bySpawn || {}).sort()) {
    const entry = watch.bySpawn[key];
    if (entry && entry.room === roomName &&
        (!chosen || entry.observedTicks > chosen.observedTicks))
      chosen = entry;
  }
  return safeSnapshot(chosen);
}
module.exports = { observe, summary, MODEL_VERSION, MAX_SPAWNS, MAX_SPAWN_TICKS };
