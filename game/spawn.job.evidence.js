'use strict';

// O20 in-engine, SAME-GAME-TICK spawn state evidence, *never* an action.
// No creep/spawn IDs, names, body, coordinates or raw Memory are emitted.
// The legacy spawn policy, cleanup, attack and expansion rules are untouched.

const MAX_SPAWN_TICKS = 150; // 50 body parts * CREEP_SPAWN_TIME(3)
const ROLES = {
  defender: true, harvester: true, hauler: true, worker: true,
  builder: true, repairer: true, upgrader: true, scout: true
};
function tick(n) {
  return Number.isSafeInteger(n) && n >= 0 && n <= 2000000000;
}
function duration(n) {
  return Number.isSafeInteger(n) && n >= 0 && n <= MAX_SPAWN_TICKS
    ? n : null;
}

function snapshot(state, game, memory) {
  const currentTick = game && game.time;
  if (!tick(currentTick)) return {
    status: 'UNVERIFIED', reason: 'GAME_TICK_INVALID',
    authority: 'IN_GAME_DIAGNOSTIC_ONLY', actionsTaken: 0
  };
  const base = {
    authority: 'IN_GAME_DIAGNOSTIC_ONLY',
    currentGameTickVerified: true,
    tick: currentTick,
    actionsTaken: 0,
    canAuthorizeCancel: false,
    canAuthorizeClaim: false
  };
  const spawn = state && state.spawn;
  if (!spawn) return Object.assign({}, base, {
    status: 'NO_OWN_SPAWN', spawning: false
  });
  if (!Object.prototype.hasOwnProperty.call(spawn, 'spawning') &&
      !('spawning' in Object(spawn))) return Object.assign({}, base, {
    status: 'UNVERIFIED', reason: 'SPAWNING_FIELD_NOT_OBSERVABLE'
  });
  const job = spawn.spawning;
  if (job == null) return Object.assign({}, base, {
    status: 'IDLE', spawning: false
  });
  if (typeof job !== 'object' || Array.isArray(job))
    return Object.assign({}, base, {
      status: 'UNVERIFIED', reason: 'SPAWNING_OBJECT_INVALID',
      spawning: true
    });
  const name = typeof job.name === 'string' &&
    job.name.length > 0 && job.name.length <= 100 ? job.name : null;
  const row = name && memory && memory.creeps &&
    typeof memory.creeps === 'object'
    ? memory.creeps[name] : null;
  const creep = name && game.creeps && game.creeps[name];
  const mem = row && typeof row === 'object' && !Array.isArray(row)
    ? row : creep && creep.memory && typeof creep.memory === 'object'
      ? creep.memory : null;
  const role = mem && typeof mem.role === 'string' &&
    Object.prototype.hasOwnProperty.call(ROLES, mem.role)
    ? mem.role : null;
  const born = mem && tick(mem.born) && mem.born <= currentTick
    ? mem.born : null;
  const elapsed = born === null ? null : currentTick - born;
  const needTime = duration(job.needTime);
  const remainingTime = duration(job.remainingTime);
  const timesConsistent = needTime === null || remainingTime === null
    ? null : remainingTime <= needTime && needTime > 0;
  const ageOverMax = elapsed === null ? null : elapsed > MAX_SPAWN_TICKS;
  const ageNeedTimeMismatch = elapsed === null || timesConsistent !== true
    ? null : elapsed + remainingTime > needTime + 3;
  const gameCreepSpawning = creep && typeof creep.spawning === 'boolean'
    ? creep.spawning : null;
  return Object.assign({}, base, {
    status: name && timesConsistent === true
      ? 'ACTIVE_JOB_TIMING_OBSERVED' : 'ACTIVE_JOB_PARTIAL',
    spawning: true,
    jobNameVerified: !!name,
    memoryRole: role,
    gameCreepPresent: !!creep,
    gameCreepSpawning,
    jobBornTick: born,
    elapsedSinceSpawnIntentTicks: elapsed,
    needTime,
    remainingTime,
    timingFieldsConsistent: timesConsistent,
    ageExceeds150Ticks: ageOverMax,
    ageVsRemainingMismatch: ageNeedTimeMismatch,
    // Comparing snapshots is only authoritative when both come from the
    // in-game status journal, never from room-object API time.
    sameJobAcrossSnapshotsVerified: false
  });
}

// Called ONLY from the existing 100-tick STATUS_SNAPSHOT. Store a single
// private, bounded first/last observation per owned room in bot Memory so
// the identical opaque Spawn + Spawning.name can be verified at *two actual*
// Game.time samples. No raw identity is ever logged; no spawn/game intent is
// issued. This does not imply the spawn stayed busy between sample ticks.
function sample(state, game, memory) {
  const observation = snapshot(state, game, memory);
  const result = Object.assign({}, observation, {
    sameJobAcrossSnapshotsVerified: false,
    sameJobObservedGameTickSpan: null,
    sameJobExceeds150ObservedTicks: null,
    continuousBusyBetweenSnapshotsVerified: false,
    observationMemoryWrites: 0
  });
  const bot = memory && memory.bot;
  const room = state && state.room && state.room.name;
  const validRoom = typeof room === 'string' &&
    /^(E|W)\d+(N|S)\d+$/.test(room);
  if (!bot || typeof bot !== 'object' || Array.isArray(bot) ||
      !validRoom || !tick(game && game.time)) return result;
  // One bounded entry per room; don't overwrite untrusted or oversized state.
  let watches = bot.spawnJobWitness;
  if (!watches) {
    watches = Object.create(null);
    bot.spawnJobWitness = watches;
  }
  if (!watches || typeof watches !== 'object' || Array.isArray(watches) ||
      Object.keys(watches).length > 8 ||
      (Object.keys(watches).length >= 8 &&
       !Object.prototype.hasOwnProperty.call(watches, room))) return result;
  const spawn = state.spawn;
  const spawnId = spawn && typeof spawn.id === 'string' &&
    spawn.id.length >= 1 && spawn.id.length <= 100 ? spawn.id : null;
  const job = spawn && spawn.spawning;
  const jobName = job && typeof job.name === 'string' &&
    job.name.length >= 1 && job.name.length <= 100 ? job.name : null;
  if (!spawnId || !jobName || observation.spawning !== true) {
    if (Object.prototype.hasOwnProperty.call(watches, room)) {
      delete watches[room];
      result.observationMemoryWrites = 1;
    }
    return result;
  }
  const deploymentId = typeof bot.deploymentId === 'string' &&
    bot.deploymentId.length <= 140 ? bot.deploymentId : null;
  const prev = watches[room];
  const validPrev = prev && typeof prev === 'object' &&
    prev.spawnId === spawnId && prev.jobName === jobName &&
    prev.deploymentId === deploymentId &&
    tick(prev.firstTick) && tick(prev.lastTick) &&
    prev.firstTick <= prev.lastTick && prev.lastTick < game.time;
  const firstTick = validPrev ? prev.firstTick : game.time;
  watches[room] = { spawnId, jobName, deploymentId,
    firstTick, lastTick: game.time };
  result.observationMemoryWrites = 1;
  if (validPrev) {
    const span = game.time - firstTick;
    result.sameJobAcrossSnapshotsVerified = true;
    result.sameJobObservedGameTickSpan = span;
    result.sameJobExceeds150ObservedTicks = span > MAX_SPAWN_TICKS;
  }
  return result;
}

module.exports = { snapshot, sample, MAX_SPAWN_TICKS };
