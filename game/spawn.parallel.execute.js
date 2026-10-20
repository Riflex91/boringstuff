'use strict';

// O69: separately gated ACTIVE executor for O68's read-only plan.
// Config defaults OFF. Do not activate without an approved runtime release.
const MAX_SPAWNS = 3;
const planner = require('spawn.parallel.plan');
// Room-object identity is stable inside one Screeps tick. Keep the guard in
// module memory, not persistent Memory; ambiguous writes must not be retried.
const tickAttemptedByRoom = new WeakMap();
const ROLES = new Set([
  'defender','harvester','worker','hauler',
  'repairer','builder','upgrader','scout'
]);

function report(status, reason, accepted, attempted, totalCost) {
  return {
    status, reason: reason || null,
    authority: 'RELEASE_GATED_EXECUTOR',
    acceptedCount: accepted,
    attemptedCount: attempted,
    spentEnergy: totalCost
  };
}
function reject(reason) { return report('HOLD', reason, 0, 0, 0); }
function dryMemory(intent, room, tick) {
  return {role:intent.role,home:room,born:tick};
}
function costOf(body) {
  if (!Array.isArray(body) || !body.length || body.length > 50 ||
      !BODYPART_COST || typeof BODYPART_COST !== 'object') return null;
  let total = 0;
  for (const part of body) {
    const n = BODYPART_COST[part];
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    total += n;
  }
  return Number.isSafeInteger(total) ? total : null;
}

function inspect(state, proposal, game, memory) {
  if (!state || !state.room || !state.room.controller ||
      state.room.controller.my !== true ||
      !state.room.name || !game || !Number.isSafeInteger(game.time) ||
      !game.spawns || !game.creeps || !memory || !memory.creeps ||
      !proposal || proposal.authority !== 'SHADOW' ||
      proposal.actionAuthority !== 'NONE' ||
      !['PLANNED','PARTIAL'].includes(proposal.status) ||
      !Array.isArray(proposal.intents) ||
      !proposal.intents.length || proposal.intents.length > MAX_SPAWNS ||
      !proposal.summary || proposal.summary.actionAuthority !== 'NONE' ||
      !Number.isSafeInteger(state.energyAvailable) ||
      !Number.isSafeInteger(state.room.energyAvailable) ||
      !Number.isSafeInteger(state.energyCapacityAvailable) ||
      state.energyAvailable < 0 ||
      state.energyAvailable > state.energyCapacityAvailable ||
      state.room.energyAvailable < 0 ||
      state.room.energyAvailable > state.energyCapacityAvailable ||
      state.room.energyAvailable !== state.energyAvailable ||
      !Array.isArray(state.spawns) || state.spawns.length > MAX_SPAWNS)
    return {error:'INVALID_RELEASE_SNAPSHOT'};

  const byName = new Map();
  for (const spawn of state.spawns) {
    if (!spawn || !spawn.name || !spawn.id || !spawn.room ||
        spawn.room.name !== state.room.name || spawn.my !== true ||
        byName.has(spawn.name)) return {error:'INVALID_FLEET'};
    byName.set(spawn.name, spawn);
  }
  const used = new Set();
  const intents = [];
  let reserved = 0;
  for (let index=0; index<proposal.intents.length; index++) {
    const i = proposal.intents[index];
    if (!i || i.tick !== game.time || i.slot !== index ||
        !ROLES.has(i.role) || !i.spawnName ||
        used.has(i.spawnName)) return {error:'STALE_OR_DUPLICATE_INTENT'};
    used.add(i.spawnName);
    const spawn = byName.get(i.spawnName);
    if (!spawn || game.spawns[i.spawnName] !== spawn ||
        spawn.spawning || typeof spawn.spawnCreep !== 'function')
      return {error:'STALE_SPAWN'};
    if (typeof spawn.isActive === 'function') {
      let active=false;
      try { active=spawn.isActive()===true; } catch (_) {}
      if (!active) return {error:'INACTIVE_SPAWN'};
    }
    const cost = costOf(i.body);
    if (cost === null || cost !== i.cost) return {error:'BODY_COST_MISMATCH'};
    reserved += cost;
    if (!Number.isSafeInteger(reserved)) return {error:'ENERGY_OVERFLOW'};
    const name=i.role.slice(0,3)+'-'+state.room.name+'-'+game.time+'-'+index;
    if (game.creeps[name] || memory.creeps[name])
      return {error:'CREEP_NAME_CONFLICT'};
    intents.push({spawn,name,body:i.body.slice(),role:i.role,cost});
  }
  const available = Math.min(state.energyAvailable,state.room.energyAvailable);
  if (reserved > available ||
      reserved !== proposal.summary.reservedEnergy)
    return {error:'STALE_ENERGY_RESERVATION'};

  // The caller-owned SHADOW proposal is not authority. Recreate it against
  // CURRENT jobs, roles, ownership and energy to detect stale/forged priority.
  let fresh;
  try { fresh = planner.plan(state, game, memory); }
  catch (_) { return {error:'FRESH_PLAN_UNAVAILABLE'}; }
  if (!fresh || fresh.status !== proposal.status ||
      !fresh.summary || fresh.summary.reservedEnergy !== reserved ||
      proposal.summary.plannedCount !== intents.length ||
      !Array.isArray(fresh.intents) ||
      fresh.intents.length !== proposal.intents.length)
    return {error:'PLAN_DRIFT'};
  for (let n = 0; n < intents.length; n++) {
    const a = proposal.intents[n], b = fresh.intents[n];
    if (a.spawnName !== b.spawnName || a.role !== b.role ||
        a.slot !== b.slot || a.tick !== b.tick || a.cost !== b.cost ||
        !Array.isArray(b.body) || a.body.length !== b.body.length ||
        a.body.some((part, k) => part !== b.body[k]))
      return {error:'PLAN_DRIFT'};
  }
  return {intents,available};
}

function execute(state, proposal, game, memory) {
  // The second gate deliberately rechecks the release flag at call time.
  const config = require('config');
  if (config.ENABLE_PARALLEL_SPAWN_EXECUTION !== true)
    return reject('PARALLEL_EXECUTION_DISABLED');
  if (state && state.room && game && Number.isSafeInteger(game.time) &&
      tickAttemptedByRoom.get(state.room) === game.time)
    return reject('DUPLICATE_EXECUTION_TICK');
  const checked = inspect(state, proposal, game, memory);
  if (checked.error) return reject(checked.error);
  const room=state.room.name;
  // Every requested slot is first validated with official non-mutating dryRun.
  // No other game writer may be invoked between this pass and actual attempts.
  for (const i of checked.intents) {
    let rc;
    try {
      rc=i.spawn.spawnCreep(i.body,i.name,{
        memory:dryMemory(i,room,game.time),dryRun:true
      });
    } catch (_) {
      return reject('DRY_RUN_EXCEPTION');
    }
    if (rc !== OK) return reject('DRY_RUN_REJECTED');
  }

  // Official dryRun should be side-effect free, but verify the invariant
  // immediately before submitting ANY productive intent.
  const refreshed = inspect(state, proposal, game, memory);
  if (refreshed.error) return reject(refreshed.error);
  if (tickAttemptedByRoom.get(state.room) === game.time)
    return reject('DUPLICATE_EXECUTION_TICK');
  tickAttemptedByRoom.set(state.room, game.time);

  let remaining=refreshed.available;
  let accepted=0, attempted=0, spent=0;
  for (const i of checked.intents) {
    // Compare with the virtual shared ledger even if the host API exposes
    // the original room.energyAvailable until tick intents are committed.
    if (i.cost > remaining || i.spawn.spawning ||
        game.spawns[i.spawn.name] !== i.spawn) {
      return report('PARTIAL_HOLD','PRE_INTENT_STATE_CHANGED',
        accepted,attempted,spent);
    }
    attempted++;
    let rc;
    try {
      rc=i.spawn.spawnCreep(i.body,i.name,{
        memory:dryMemory(i,room,game.time)
      });
    } catch (_) {
      return report('PARTIAL_HOLD','SPAWN_INTENT_EXCEPTION',
        accepted,attempted,spent);
    }
    // An ambiguous return is NEVER retried in this tick.
    if (rc !== OK) return report('PARTIAL_HOLD',
      rc === ERR_NOT_ENOUGH_ENERGY ? 'LIVE_ENERGY_CONFLICT' :
      rc === ERR_BUSY ? 'LIVE_SPAWN_BUSY' : 'LIVE_SPAWN_REJECTED',
      accepted,attempted,spent);
    remaining -= i.cost;
    accepted++;
    spent += i.cost;
  }
  return report('EXECUTED',null,accepted,attempted,spent);
}

module.exports = {execute, inspect, _test:{costOf}};
