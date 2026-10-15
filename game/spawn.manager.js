'use strict';

const body = require('body.builder');
const logger = require('logger');
const config = require('config');
const workPriority = require('work.priority');

function defenderDemand(hostiles) {
  if (!Array.isArray(hostiles) || !hostiles.length) return 0;
  let combatParts = 0;
  let healParts = 0;
  let unknown = 0;
  for (const hostile of hostiles) {
    if (!hostile || !Array.isArray(hostile.body)) { unknown += 1; continue; }
    for (const part of hostile.body) {
      if (!part || !(part.hits > 0)) continue;
      if (part.type === 'attack' || part.type === 'ranged_attack' ||
          part.type === 'work') combatParts += 1;
      if (part.type === 'heal') healParts += 1;
    }
  }
  // Do not spend scarce bootstrap energy on known harmless scouts.
  // Scale bounded defender demand with active hostile combat capacity.
  const pressure = combatParts + 2 * healParts + unknown * 2;
  return pressure > 0 ? Math.min(3, Math.max(1, Math.ceil(pressure / 4))) : 0;
}

function desired(state) {
  const constructionHeavy = state.sites.length > 5;
  const damaged = state.structures.some(s => s.hits !== undefined && s.hits < s.hitsMax * 0.6 && s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART);
  const defendersNeeded = defenderDemand(state.hostileCreeps);
  const baseHarvesters = Math.max(1, state.sources.length);
  let desiredHarvesters = baseHarvesters;

  if (state.rcl >= 2 && state.economyModel) {
    desiredHarvesters = Math.min(
      config.MAX_BOOTSTRAP_HARVESTERS,
      Math.max(baseHarvesters, state.economyModel.recommendedHarvesterCount || baseHarvesters)
    );
  }
  const baseWorkers = state.rcl <= 2 ? 2 : 1;

  let desiredUpgraders = baseUpgraderTarget(state);

  if (state.rcl === 1 && state.economyMetrics &&
      state.economyMetrics.energyCappedStreak >= config.RCL1_SURPLUS_STREAK_TICKS &&
      (state.byRole.harvester || 0) >= baseHarvesters &&
      (state.byRole.worker || 0) >= baseWorkers) {
    desiredUpgraders = Math.max(desiredUpgraders, config.RCL1_SURPLUS_UPGRADERS);
  }

  if (state.rcl >= 2 && state.rcl < 8 &&
      state.sites.length === 0 &&
      state.economyMetrics &&
      state.economyMetrics.energyCappedStreak >= config.RCL2_PLUS_SURPLUS_STREAK_TICKS &&
      state.economyMetrics.spawnIdleStreak >= config.RCL2_PLUS_SURPLUS_STREAK_TICKS &&
      state.energyStored > config.RCL2_PLUS_SURPLUS_MIN_STORED &&
      state.economyModel &&
      (state.economyModel.harvesterWorkDeficit || 0) <= 0 &&
      (state.economyModel.haulerCarryDeficit || 0) <= 0 &&
      (state.economyModel.consumerCriticalCount || 0) <= 0 &&
      (state.economyModel.consumerFallbackCount || 0) <= 0 &&
      (state.economyModel.sourceContainersReady || 0) === state.sources.length) {
    desiredUpgraders = Math.max(
      desiredUpgraders,
      Math.min(config.MAX_UPGRADERS, config.RCL2_PLUS_SURPLUS_UPGRADERS)
    );
  }

  // Phase 2A: activate only one narrow model-driven control loop. When RCL2+
  // has productive work and dedicated mining produces energy that must travel,
  // provision the number of haulers calculated from current mining throughput
  // and route length. Mining counts themselves stay conservative for now.
  let desiredHaulers = 0;
  if (state.rcl >= 2 && state.economyModel) {
    // Container/source logistics remains necessary even when there are no
    // construction sites. Spawn/extensions and productive consumers still
    // depend on modeled source-route transport capacity.
    desiredHaulers = Math.min(config.MAX_BOOTSTRAP_HAULERS, state.economyModel.recommendedHaulerCount || 0);
  }

  const d = {
    harvester: desiredHarvesters,
    hauler: desiredHaulers,
    worker: baseWorkers,
    builder: state.sites.length ? Math.min(config.MAX_BUILDERS, constructionHeavy ? 2 : 1) : 0,
    repairer: damaged && state.rcl >= 2 ? 1 : 0,
    upgrader: desiredUpgraders,
    defender: defendersNeeded,
    scout: state.rcl >= config.SCOUTS_AFTER_RCL ? 1 : 0
  };

  if (state.emergency) {
    d.harvester = 1;
    d.worker = 1;
    d.hauler = 0;
    d.builder = 0;
    d.repairer = 0;
    d.upgrader = 0;
    d.scout = 0;
  }
  return d;
}

function baseUpgraderTarget(state) {
  return state.rcl < 8 ? Math.min(config.MAX_UPGRADERS, state.energyStored > 5000 ? 2 : 1) : 0;
}

function countRole(room, role) {
  if (role === 'scout') {
    const counted = {};
    let total = 0;
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (!creep || !creep.memory || creep.memory.role !== 'scout') continue;
      const home = creep.memory.home || (creep.room && creep.room.name);
      if (home !== room.name) continue;
      counted[name] = true;
      total += 1;
    }

    // Guard against runtimes where a spawning creep is not yet exposed through
    // Game.creeps. Do not double-count when it already is.
    const spawning = room.find(FIND_MY_SPAWNS, {
      filter: s => s.spawning &&
        !counted[s.spawning.name] &&
        Memory.creeps[s.spawning.name] &&
        Memory.creeps[s.spawning.name].role === 'scout'
    });
    return total + spawning.length;
  }

  return room.find(FIND_MY_CREEPS, { filter: c => c.memory.role === role }).length +
    room.find(FIND_MY_SPAWNS, { filter: s => s.spawning && Memory.creeps[s.spawning.name] && Memory.creeps[s.spawning.name].role === role }).length;
}

function bodyFor(role, energy, state) {
  switch (role) {
    case 'harvester': return body.harvester(energy, state.economyModel && state.economyModel.sourceContainersReady === state.sources.length);
    case 'hauler': return body.hauler(energy);
    case 'upgrader': return body.upgrader(energy);
    case 'defender': return body.defender(energy, state.hostileCreeps);
    case 'scout': return body.scout();
    default: return body.worker(energy, state.emergency);
  }
}

function productivePrespawnHorizon(role, state) {
  // Preserve the modeled 2+ hauler service floor before an expiring carrier
  // disappears. Do not anticipate bootstrap/mobile hauling, an optional
  // one-hauler fleet, or emergency recovery. This changes timing only, not
  // the number of haulers requested by the economy model.
  if (role === 'hauler') {
    if (state.rcl < 2 || state.emergency || !state.economyModel ||
        !Array.isArray(state.sources) || state.sources.length === 0 ||
        state.economyModel.sourceContainersReady !== state.sources.length ||
        (state.economyModel.recommendedHaulerCount || 0) < 2) return 0;
  } else {
    if (role === 'harvester') {
      // RCL1 retains its conservative mobile-mining overlap. At RCL2+,
      // never let a fully established source-container miner expire before
      // a replacement can finish spawning. Do not enable speculative
      // overlap during bootstrap, emergency or active defense.
      if (state.rcl !== 1 && (
          state.rcl < 2 || state.emergency ||
          !Array.isArray(state.sources) || state.sources.length === 0 ||
          !state.economyModel ||
          state.economyModel.sourceContainersReady !== state.sources.length ||
          !Number.isSafeInteger(state.economyModel.recommendedHarvesterCount) ||
          state.economyModel.recommendedHarvesterCount < state.sources.length ||
          !Array.isArray(state.hostileCreeps) ||
          state.hostileCreeps.length > 0)) return 0;
    } else if (role !== 'worker' && role !== 'builder' &&
               role !== 'upgrader') return 0;
  }
  const budget = Math.max(0, Number(state.energyCapacityAvailable) || Number(state.energyAvailable) || 0);
  const replacementBody = bodyFor(role, budget, state);
  const spawnTimePerPart = typeof CREEP_SPAWN_TIME !== 'undefined' && Number.isFinite(CREEP_SPAWN_TIME)
    ? CREEP_SPAWN_TIME
    : 3;
  const spawnTicks = replacementBody.length * spawnTimePerPart;
  return spawnTicks + 3;
}

function countRoleAvailable(state, role) {
  const horizon = productivePrespawnHorizon(role, state);
  if (horizon <= 0) return countRole(state.room, role);

  const active = state.room.find(FIND_MY_CREEPS, {
    filter: c =>
      c.memory.role === role &&
      (!Number.isFinite(c.ticksToLive) || c.ticksToLive > horizon)
  }).length;

  const spawning = state.room.find(FIND_MY_SPAWNS, {
    filter: s =>
      s.spawning &&
      Memory.creeps[s.spawning.name] &&
      Memory.creeps[s.spawning.name].role === role
  }).length;

  return active + spawning;
}

function countRoleForDesired(state, role, wantCount) {
  if (role !== 'upgrader' || state.rcl < 2) return countRoleAvailable(state, role);

  const raw = countRole(state.room, role);
  const available = countRoleAvailable(state, role);
  const baseTarget = baseUpgraderTarget(state);
  const want = Math.max(0, Number(wantCount) || 0);

  // The mature-surplus third upgrader is optional throughput, not an essential
  // colony role. Do not pre-spawn-replace it while the two base upgraders are
  // still safely available; let it age out naturally and recreate it only if
  // surplus conditions are still true afterwards.
  if (want > baseTarget && raw >= want && available >= baseTarget) return raw;
  return available;
}

function productivePrespawnShortfall(state, role, wantCount) {
  if (role !== 'worker' && role !== 'builder' && role !== 'upgrader') return false;
  let want = Math.max(0, Number(wantCount) || 0);
  if (role === 'upgrader' && state.rcl >= 2) {
    // Only the base upgrader target is lifecycle-critical. The optional surplus
    // upgrader may expire without triggering a prespawn or low-energy bypass.
    want = Math.min(want, baseUpgraderTarget(state));
  }
  if (want <= 0) return false;
  const total = countRole(state.room, role);
  const available = countRoleAvailable(state, role);
  return total >= want && available < want;
}

function spawnOne(state) {
  const spawn = state.spawn;
  if (!spawn || spawn.spawning) return false;
  const want = desired(state);
  const priority = ['defender', 'harvester', 'hauler', 'worker', 'builder', 'repairer', 'upgrader', 'scout'];
  let role = null;

  if (countRole(state.room, 'defender') < want.defender) role = 'defender';

  if (!role && state.rcl <= 1) {
    const harvesters = countRole(state.room, 'harvester');
    const workers = countRoleAvailable(state, 'worker');
    if (harvesters < 1 && harvesters < want.harvester) role = 'harvester';
    else if (workers < 1 && workers < want.worker) role = 'worker';
    else if (harvesters < want.harvester) role = 'harvester';
    else if (workers < want.worker) role = 'worker';
    else if (harvesters >= want.harvester &&
             countRoleAvailable(state, 'harvester') < want.harvester &&
             countRoleAvailable(state, 'upgrader') >= baseUpgraderTarget(state) &&
             !state.emergency &&
             Number.isFinite(state.energyCapacityAvailable) &&
             state.energyCapacityAvailable >= 300 &&
             state.energyAvailable >= state.energyCapacityAvailable) {
      // Optional replacement after the core roles INCLUDING a live base
      // upgrader are supplied. Do not deprive controller progression of its
      // minimum essential productive creep just to pre-spawn a miner.
      // Never deplete a partly refilled 300-energy room.
      // The existing low-energy bypass is intentionally restricted to
      // productive worker/builder/upgrader replacements.
      role = 'harvester';
    }
  }

  if (!role && state.rcl >= 2) {
    const baseHarvesters = Math.max(1, state.sources.length);
    const harvesters = countRole(state.room, 'harvester');
    const workers = countRoleAvailable(state, 'worker');
    const builders = countRoleAvailable(state, 'builder');
    const upgraders = countRoleForDesired(state, 'upgrader', want.upgrader);
    const haulers = countRoleAvailable(state, 'hauler');
    const emergencyRepairNeeded = !state.emergency &&
      workPriority.hasEmergencyRepair(state.structures) &&
      countRole(state.room, 'repairer') < want.repairer;

    // Preserve essential colony functions before scaling throughput. If a
    // spawn/tower/storage is critically damaged, protect the transport floor
    // and then mobilize one repairer before optional work or controller gains.
    // This never interrupts bootstrap emergency recovery or defender priority.
    if (emergencyRepairNeeded &&
        harvesters >= baseHarvesters &&
        workers >= want.worker &&
        haulers >= Math.min(1, want.hauler)) role = 'repairer';

    // Preserve essential colony functions before scaling throughput.
    if (!role && harvesters < baseHarvesters) role = 'harvester';
    else if (!role && workers < want.worker) role = 'worker';
    else if (!role && haulers < Math.min(1, want.hauler) &&
             emergencyRepairNeeded) role = 'hauler';
    else if (!role && upgraders < want.upgrader) role = 'upgrader';
    else if (!role && builders < want.builder) role = 'builder';
    else if (!role && haulers < Math.min(1, want.hauler)) role = 'hauler';

    if (!role && state.economyModel) {
      const workNow = state.economyModel.harvesterWorkParts || 0;
      const workTarget = state.economyModel.recommendedHarvesterWorkParts || 0;
      const floor = Math.ceil(workTarget * config.BOOTSTRAP_MINING_FLOOR_RATIO);

      // Lift mining to a safe fraction of demand, add transport, then finish
      // the remaining mining deficit. This avoids spawning every miner before
      // hauling capacity has a chance to scale.
      if (harvesters < want.harvester && workNow < floor) role = 'harvester';
      else if (haulers < want.hauler) role = 'hauler';
      else if (harvesters < want.harvester) role = 'harvester';
    }
  }

  // RCL2+: fill missing workers, haulers, controller capacity and urgent
  // repairs first. Once the actual workforce is healthy, overlap a source
  // miner ONLY inside its replacement-body spawn-time window.
  if (!role && state.rcl >= 2 &&
      countRole(state.room, 'harvester') >= want.harvester &&
      countRoleAvailable(state, 'harvester') < want.harvester &&
      countRoleAvailable(state, 'worker') >= want.worker &&
      countRoleAvailable(state, 'upgrader') >= Math.min(1, want.upgrader) &&
      countRoleAvailable(state, 'hauler') >= Math.min(1, want.hauler) &&
      !workPriority.hasEmergencyRepair(state.structures)) {
    role = 'harvester';
  }

  if (!role) {
    for (const r of priority) {
      const count = (r === 'worker' || r === 'builder' ||
        r === 'upgrader' || r === 'hauler')
        ? countRoleForDesired(state, r, want[r])
        : countRole(state.room, r);
      if (count < want[r]) { role = r; break; }
    }
  }

  if (!role) {
    if (state.economyMetrics && state.economyMetrics.energyCappedStreak >= 25 && state.economyMetrics.spawnIdleStreak >= 25) {
      logger.info('SPAWN_IDLE_SURPLUS', 'Spawn idle while room energy remains capped', {
        room: state.room.name,
        rcl: state.rcl,
        energy: state.energyAvailable,
        capacity: state.energyCapacityAvailable,
        energyCappedStreak: state.economyMetrics.energyCappedStreak,
        spawnIdleStreak: state.economyMetrics.spawnIdleStreak,
        desired: want,
        actual: state.byRole,
        economyModel: state.economyModel || null
      }, { dedupeTicks: 50 });
    }
    return false;
  }

  const available = state.emergency ? state.energyAvailable : state.energyCapacityAvailable;
  const prespawnShortfall = productivePrespawnShortfall(state, role, want[role]);
  // Early hauler replacement is optional until the old carrier expires.
  // Never drain a partially refilled room for a reduced-capacity hauler
  // solely because its predecessor entered the overlap horizon.
  const earlyHaulerReplacement = role === 'hauler' &&
    countRole(state.room, role) >= want[role] &&
    countRoleAvailable(state, role) < want[role];
  let creepBody = bodyFor(role, available, state);
  let cost = creepBody.reduce((sum, p) => sum + BODYPART_COST[p], 0);
  if (earlyHaulerReplacement && cost > state.energyAvailable) return false;
  const earlyHarvesterReplacement = role === 'harvester' &&
    countRole(state.room, role) >= want[role] &&
    countRoleAvailable(state, role) < want[role];
  // Early miner overlap is optional. Do not launch a reduced-body miner
  // that consumes scarce energy and has too little WORK to replace its peer.
  if (earlyHarvesterReplacement && cost > state.energyAvailable) return false;
  if (cost > state.energyAvailable) {
    const lowEnergyFloor = Math.min(300, state.energyCapacityAvailable);
    if (!state.emergency && state.energyAvailable < lowEnergyFloor && !prespawnShortfall) return false;

    // A productive prespawn is time-sensitive: waiting for the room to refill
    // to 300+ energy can consume the remaining TTL and recreate the exact
    // capacity gap prespawn is meant to prevent. Only a confirmed prespawn
    // shortfall may use the smaller immediately-affordable replacement body.
    creepBody = bodyFor(role, state.energyAvailable, Object.assign({}, state, { emergency: true }));
    cost = creepBody.reduce((sum, p) => sum + BODYPART_COST[p], 0);
  }
  if (!creepBody.length || cost > state.energyAvailable) return false;

  const name = role.slice(0, 3) + '-' + state.room.name + '-' + Game.time;
  const rc = spawn.spawnCreep(creepBody, name, { memory: { role, home: state.room.name, born: Game.time } });
  if (rc === OK) {
    logger.info('SPAWN_OK', 'Spawned creep', { room: state.room.name, creep: name, role, cost, body: creepBody }, { force: true, persist: true, dedupeTicks: 0 });
    return true;
  }
  if (rc !== ERR_NOT_ENOUGH_ENERGY && rc !== ERR_BUSY) {
    logger.warn('SPAWN_RC', 'spawnCreep returned unexpected code', { room: state.room.name, role, rc, energy: state.energyAvailable, cost }, { dedupeTicks: 5 });
  }
  return false;
}

module.exports = { desired, spawnOne, _test: { countRole, baseUpgraderTarget, productivePrespawnHorizon, countRoleAvailable, countRoleForDesired, productivePrespawnShortfall, defenderDemand } };
