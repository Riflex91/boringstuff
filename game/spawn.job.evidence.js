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
  const role = mem && Object.prototype.hasOwnProperty.call(ROLES, mem.role)
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

module.exports = { snapshot, MAX_SPAWN_TICKS };
