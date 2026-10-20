'use strict';

// O67: bounded, read-only same-room fleet telemetry. This does not decide
// spawn roles or write game memory. It never discloses job/spawn identities.
// A stall assertion requires fresh O65 in-game continuity at THIS game tick.
const MAX_SPAWNS = 64;
const MAX_SPAWN_TICKS = 150;
const MAX_NAME_LENGTH = 128;

function validTick(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function hold(reason) {
  return { authority: 'SHADOW', actionAuthority: 'NONE',
    status: 'HOLD', reason, fleetSize: null, busy: null,
    idleAvailable: null, inactive: null, unknown: null,
    allBusy: null, hasIdleCapacity: null, suspectStalled: null,
    timerUnknown: null, maxContinuousJobTicks: null,
    evidenceFresh: false };
}
function summary(state, memory, game) {
  if (!state || !state.room || typeof state.room.name !== 'string' ||
      !Array.isArray(state.spawns) || !validTick(game && game.time))
    return hold('INVALID_FLEET_INPUT');
  if (state.spawns.length > MAX_SPAWNS)
    return hold('FLEET_BUDGET_EXCEEDED');

  const roomName = state.room.name;
  const prior = memory && memory.bot && memory.bot.spawnJobStallWatch;
  const evidenceFresh = !!(prior && prior.modelVersion === 1 &&
    prior.observedAtTick === game.time && prior.bySpawn &&
    typeof prior.bySpawn === 'object');
  const seen = {};
  let busy = 0, idleAvailable = 0, inactive = 0, unknown = 0;
  let timerUnknown = 0, suspectStalled = 0, maxContinuousJobTicks = 0;
  let matchedBusy = 0;
  for (const spawn of state.spawns) {
    // Never trust duplicate/missing identities for availability or
    // monitoring. No fallback to an unrelated room's spawn is allowed.
    if (!spawn || typeof spawn.id !== 'string' || !spawn.id ||
        typeof spawn.name !== 'string' || !spawn.name ||
        spawn.name.length > MAX_NAME_LENGTH ||
        seen[spawn.name] || spawn.my === false ||
        !spawn.room || spawn.room.name !== roomName) {
      unknown++;
      continue;
    }
    seen[spawn.name] = true;
    let active;
    try {
      active = typeof spawn.isActive === 'function'
        ? spawn.isActive() === true : true;
    } catch (_) {
      unknown++;
      continue;
    }
    if (!active) { inactive++; continue; }
    if (spawn.spawning) {
      busy++;
      const liveJob = spawn.spawning;
      if (!evidenceFresh) continue;
      const entry = Object.prototype.hasOwnProperty.call(prior.bySpawn,spawn.name)
        ? prior.bySpawn[spawn.name] : null;
      if (!entry || entry.spawnId !== spawn.id ||
          entry.room !== roomName || entry.lastTick !== game.time ||
          (entry.status !== 'TIMER_UNKNOWN' &&
            entry.jobName !== liveJob.name)) continue;
      matchedBusy++;
      if (entry.status === 'TIMER_UNKNOWN') {
        timerUnknown++;
      } else if (entry.status === 'OBSERVING' ||
                 entry.status === 'SUSPECT_STALLED') {
        if (Number.isSafeInteger(entry.observedTicks) &&
            entry.observedTicks >= 1 &&
            entry.observedTicks <= MAX_SPAWN_TICKS + 1) {
          maxContinuousJobTicks = Math.max(maxContinuousJobTicks,
            entry.observedTicks);
          if (entry.status === 'SUSPECT_STALLED' &&
              entry.observedTicks > MAX_SPAWN_TICKS)
            suspectStalled++;
        }
      }
    } else if (typeof spawn.spawnCreep === 'function') {
      idleAvailable++;
    } else unknown++;
  }
  const fleetSize = state.spawns.length;
  const usable = busy + idleAvailable + inactive;
  return {
    authority: 'SHADOW', actionAuthority: 'NONE',
    status: fleetSize ? 'OBSERVED' : 'NO_SPAWNS',
    fleetSize, busy, idleAvailable, inactive, unknown,
    allBusy: usable > 0 && busy === usable && inactive === 0 && unknown === 0,
    hasIdleCapacity: idleAvailable > 0,
    suspectStalled: evidenceFresh ? suspectStalled : null,
    timerUnknown: evidenceFresh ? timerUnknown : null,
    maxContinuousJobTicks: evidenceFresh ? maxContinuousJobTicks : null,
    evidenceFresh,
    // If O65's observer was missing or the snapshot raced a new job, do
    // not claim that an untracked job was safe or inspected.
    trackedBusyJobs: evidenceFresh ? matchedBusy : null,
    untrackedBusyJobs: evidenceFresh ? busy - matchedBusy : null
  };
}
module.exports = { summary, MAX_SPAWNS };
