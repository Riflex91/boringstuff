'use strict';

// O68: deterministic, bounded, READ-ONLY multi-spawn scheduling preview.
// The existing spawn.manager.spawnOne is the only gameplay executor.
const legacy = require('spawn.manager');
const body = require('body.builder');
const workPriority = require('work.priority');

const MAX_SPAWNS = 3;
const MAX_ROOM_CREEPS = 256;
const MAX_WORLD_CREEPS = 1024;
const ROLES = Object.freeze([
  'defender', 'harvester', 'worker', 'hauler',
  'repairer', 'builder', 'upgrader', 'scout'
]);

function hold(reason) {
  return {
    status: 'HOLD', reason, authority: 'SHADOW', actionAuthority: 'NONE',
    intents: [], summary: {
      status: 'HOLD', reason, authority: 'SHADOW', actionAuthority: 'NONE',
      plannedCount: 0, reservedEnergy: 0, remainingEnergy: null,
      idleSlots: null, roles: {}
    }
  };
}

function bodyFor(role, energy, state) {
  switch (role) {
    case 'harvester': return body.harvester(energy,
      !!(state.economyModel &&
        state.economyModel.sourceContainersReady === state.sources.length));
    case 'hauler': return body.hauler(energy);
    case 'upgrader': return body.upgrader(energy);
    case 'defender': return body.defender(energy, state.hostileCreeps);
    case 'scout': return body.scout();
    default: return body.worker(energy, state.emergency);
  }
}

function validCost(parts) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 50 ||
      typeof BODYPART_COST !== 'object' || !BODYPART_COST) return null;
  let cost = 0;
  for (const part of parts) {
    const partCost = BODYPART_COST[part];
    if (!Number.isSafeInteger(partCost) || partCost <= 0) return null;
    cost += partCost;
  }
  return Number.isSafeInteger(cost) && cost > 0 ? cost : null;
}

function validInput(state, game) {
  if (!state || !state.room || typeof state.room.name !== 'string' ||
      !state.room.name || !state.room.controller ||
      state.room.controller.my !== true ||
      !Array.isArray(state.creeps) || state.creeps.length > MAX_ROOM_CREEPS ||
      !Array.isArray(state.sources) || !Array.isArray(state.sites) ||
      !Array.isArray(state.structures) || !Array.isArray(state.hostileCreeps) ||
      !Number.isSafeInteger(state.energyAvailable) ||
      !Number.isSafeInteger(state.energyCapacityAvailable) ||
      state.energyAvailable < 0 || state.energyCapacityAvailable < 0 ||
      state.energyAvailable > state.energyCapacityAvailable ||
      !game || !Number.isSafeInteger(game.time) || game.time < 0 ||
      !game.creeps || typeof game.creeps !== 'object') return false;
  return true;
}

function fleet(state, memory) {
  const spawns = Array.isArray(state.spawns)
    ? state.spawns : (state.spawn ? [state.spawn] : []);
  if (spawns.length > MAX_SPAWNS) return { error: 'SPAWN_LIMIT' };
  const seenNames = new Set();
  const seenIds = new Set();
  const idle = [];
  const jobs = [];
  for (const spawn of spawns) {
    if (!spawn || spawn.my !== true ||
        !spawn.room || spawn.room.name !== state.room.name ||
        typeof spawn.name !== 'string' || !spawn.name ||
        typeof spawn.id !== 'string' || !spawn.id ||
        seenNames.has(spawn.name) || seenIds.has(spawn.id)) {
      return { error: 'INVALID_SPAWN_FLEET' };
    }
    seenNames.add(spawn.name);
    seenIds.add(spawn.id);
    if (spawn.spawning) {
      if (typeof spawn.spawning.name !== 'string' ||
          !spawn.spawning.name || !memory || !memory.creeps ||
          !memory.creeps[spawn.spawning.name] ||
          !ROLES.includes(memory.creeps[spawn.spawning.name].role) ||
          (memory.creeps[spawn.spawning.name].home &&
           memory.creeps[spawn.spawning.name].home !== state.room.name)) {
        return { error: 'UNKNOWN_RUNNING_JOB' };
      }
      jobs.push({ name: spawn.spawning.name,
        role: memory.creeps[spawn.spawning.name].role });
      continue;
    }
    if (typeof spawn.spawnCreep !== 'function') continue;
    if (typeof spawn.isActive === 'function') {
      let active = false;
      try { active = spawn.isActive() === true; } catch (_) {}
      if (!active) continue;
    }
    idle.push(spawn);
  }
  // Stable assignment order across source arrays and Object enumeration.
  idle.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { idle, jobs };
}

function countsFor(state, game, jobs) {
  const gameNames = Object.keys(game.creeps);
  if (gameNames.length > MAX_WORLD_CREEPS) return null;
  const counts = {};
  for (const role of ROLES) counts[role] = { raw: 0, available: 0 };
  const observed = new Set();
  function add(creep, name) {
    if (!creep || !creep.memory || !ROLES.includes(creep.memory.role)) return;
    if (name && observed.has(name)) return;
    if (name) observed.add(name);
    const role = creep.memory.role;
    counts[role].raw++;
    const horizon = legacy._test.productivePrespawnHorizon(role, state);
    if (!Number.isFinite(creep.ticksToLive) ||
        creep.ticksToLive > horizon) counts[role].available++;
  }
  for (const creep of state.creeps) add(creep, creep && creep.name);
  // Legacy scout demand includes scouts outside this room with the same home.
  for (const name of gameNames) {
    const creep = game.creeps[name];
    if (creep && creep.memory && creep.memory.role === 'scout' &&
        (creep.memory.home || (creep.room && creep.room.name)) === state.room.name) {
      add(creep, name);
    }
  }
  for (const job of jobs) {
    if (observed.has(job.name)) continue;
    if (counts[job.role]) {
      counts[job.role].raw++;
      counts[job.role].available++;
    }
    observed.add(job.name);
  }
  return counts;
}

function effectiveCount(role, counts, state, want) {
  const c = counts[role];
  if (role === 'upgrader' && state.rcl >= 2) {
    const base = legacy._test.baseUpgraderTarget(state);
    if (want.upgrader > base && c.raw >= want.upgrader &&
        c.available >= base) return c.raw;
  }
  return c.available;
}

function nextRole(state, counts, want) {
  const needs = role => effectiveCount(role, counts, state, want) < want[role];
  // Mandatory immediate defense and bootstrap survival always precede
  // optional builders, full logistics throughput and controller surplus.
  if (needs('defender')) return 'defender';
  const sourceFloor = Math.max(1, state.sources.length);
  if (counts.harvester.raw < Math.min(sourceFloor, want.harvester))
    return 'harvester';
  if (needs('worker')) return 'worker';
  if (want.hauler > 0 && counts.hauler.available < 1) return 'hauler';
  const emergencyRepair = !state.emergency &&
    workPriority.hasEmergencyRepair(state.structures);
  if (emergencyRepair && needs('repairer')) return 'repairer';
  for (const role of ['harvester', 'hauler', 'builder',
                      'repairer', 'upgrader', 'scout']) {
    if (needs(role)) return role;
  }
  return null;
}

function plan(state, game, memory) {
  if (!validInput(state, game)) return hold('INVALID_ROOM_SNAPSHOT');
  const scanned = fleet(state, memory);
  if (scanned.error) return hold(scanned.error);
  const counts = countsFor(state, game, scanned.jobs);
  if (!counts) return hold('CREEP_SCAN_LIMIT');
  let want;
  try { want = legacy.desired(state); }
  catch (_) { return hold('DESIRED_UNAVAILABLE'); }
  for (const role of ROLES) {
    if (!Number.isSafeInteger(want[role]) || want[role] < 0 ||
        want[role] > MAX_ROOM_CREEPS) return hold('INVALID_ROLE_DEMAND');
  }

  const intents = [];
  let remaining = state.energyAvailable;
  let reason = null;
  for (const spawn of scanned.idle) {
    const role = nextRole(state, counts, want);
    if (!role) break;
    const outstanding = ROLES.reduce((n, r) =>
      n + Math.max(0, want[r] - effectiveCount(r, counts, state, want)), 0);
    // When several essential roles need production, split room energy
    // deterministically rather than letting the first large body consume all.
    const slotsLeft = scanned.idle.length - intents.length;
    const divisor = Math.max(1, Math.min(slotsLeft, outstanding));
    const budget = state.emergency
      ? remaining
      : Math.min(state.energyCapacityAvailable,
          Math.max(300, Math.floor(remaining / divisor)));
    let parts;
    try { parts = bodyFor(role, budget, state); }
    catch (_) { return hold('BODY_BUILD_EXCEPTION'); }
    const cost = validCost(parts);
    if (cost === null) return hold('INVALID_BODY');
    // A strictly needed role cannot be skipped to spend its energy on an
    // optional upgrader. Do not imitate the legacy low-energy bypass here.
    if (cost > remaining ||
        (!state.emergency && remaining < Math.min(300, state.energyCapacityAvailable))) {
      reason = 'CRITICAL_ROLE_ENERGY_SHORTFALL';
      break;
    }
    const previous = counts[role];
    // No side effects: the simulated reservation is local to this invocation.
    previous.raw++;
    previous.available++;
    intents.push({
      spawnName: spawn.name, role, body: parts.slice(), cost,
      slot: intents.length, tick: game.time
    });
    remaining -= cost;
  }

  const roles = {};
  for (const intent of intents) roles[intent.role] = (roles[intent.role] || 0) + 1;
  const summary = {
    status: reason ? 'PARTIAL' : scanned.idle.length ? 'PLANNED' : 'NO_IDLE',
    reason, authority: 'SHADOW', actionAuthority: 'NONE',
    plannedCount: intents.length, reservedEnergy: state.energyAvailable - remaining,
    remainingEnergy: remaining, idleSlots: scanned.idle.length, roles
  };
  return {
    status: summary.status, reason, authority: 'SHADOW',
    actionAuthority: 'NONE', intents, summary
  };
}

function deferred(reason) {
  const result = hold(reason || 'CPU_DEFERRED');
  result.status = 'DEFERRED';
  result.summary.status = 'DEFERRED';
  return result;
}

module.exports = { plan, deferred, MAX_SPAWNS, _test: {
  bodyFor, validCost, fleet, countsFor, effectiveCount, nextRole
} };
