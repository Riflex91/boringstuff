'use strict';

const body = require('body.builder');
const logger = require('logger');
const config = require('config');

function desired(state) {
  const constructionHeavy = state.sites.length > 5;
  const damaged = state.structures.some(s => s.hits !== undefined && s.hits < s.hitsMax * 0.6 && s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART);
  const hostiles = state.hostileCreeps.length;
  const baseHarvesters = Math.max(1, state.sources.length);
  let desiredHarvesters = baseHarvesters;

  if (state.rcl >= 2 && state.economyModel) {
    desiredHarvesters = Math.min(
      config.MAX_BOOTSTRAP_HARVESTERS,
      Math.max(baseHarvesters, state.economyModel.recommendedHarvesterCount || baseHarvesters)
    );
  }
  const baseWorkers = state.rcl <= 2 ? 2 : 1;

  let desiredUpgraders = state.rcl < 8 ? Math.min(config.MAX_UPGRADERS, state.energyStored > 5000 ? 2 : 1) : 0;

  if (state.rcl === 1 && state.economyMetrics &&
      state.economyMetrics.energyCappedStreak >= config.RCL1_SURPLUS_STREAK_TICKS &&
      (state.byRole.harvester || 0) >= baseHarvesters &&
      (state.byRole.worker || 0) >= baseWorkers) {
    desiredUpgraders = Math.max(desiredUpgraders, config.RCL1_SURPLUS_UPGRADERS);
  }

  // Phase 2A: activate only one narrow model-driven control loop. When RCL2+
  // has productive work and dedicated mining produces energy that must travel,
  // provision the number of haulers calculated from current mining throughput
  // and route length. Mining counts themselves stay conservative for now.
  let desiredHaulers = 0;
  if (state.rcl >= 2 && state.economyModel && state.sites.length > 0) {
    desiredHaulers = Math.min(config.MAX_BOOTSTRAP_HAULERS, state.economyModel.recommendedHaulerCount || 0);
  }

  const d = {
    harvester: desiredHarvesters,
    hauler: desiredHaulers,
    worker: baseWorkers,
    builder: state.sites.length ? Math.min(config.MAX_BUILDERS, constructionHeavy ? 2 : 1) : 0,
    repairer: damaged && state.rcl >= 2 ? 1 : 0,
    upgrader: desiredUpgraders,
    defender: hostiles ? Math.min(3, Math.max(1, hostiles)) : 0,
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

function countRole(room, role) {
  return room.find(FIND_MY_CREEPS, { filter: c => c.memory.role === role }).length +
    room.find(FIND_MY_SPAWNS, { filter: s => s.spawning && Memory.creeps[s.spawning.name] && Memory.creeps[s.spawning.name].role === role }).length;
}

function creepPartCount(creep, part) {
  if (!creep) return 0;
  if (creep.getActiveBodyparts) return creep.getActiveBodyparts(part) || 0;
  return (creep.body || []).filter(p => {
    const type = p && typeof p === 'object' ? p.type : p;
    const hits = p && typeof p === 'object' && p.hits !== undefined ? p.hits : 100;
    return type === part && hits > 0;
  }).length;
}

function haulerReplacementLeadTicks(state) {
  const model = state.economyModel || {};
  const plannedBody = body.hauler(state.energyCapacityAvailable || state.energyAvailable || 300);
  const spawnTimePerPart = typeof CREEP_SPAWN_TIME !== 'undefined' ? CREEP_SPAWN_TIME : 3;
  const spawnTicks = plannedBody.length * spawnTimePerPart;
  const longestRoute = Math.max(0, ...(model.sourceRoutes || []).map(r => Number(r.spawnDistance) || 0));
  const roundTripTicks = longestRoute * 2;
  const bodyCost = plannedBody.reduce((sum, part) => {
    return sum + ((typeof BODYPART_COST !== 'undefined' && BODYPART_COST[part]) || 0);
  }, 0);
  const income = Math.max(1, Number(model.dedicatedHarvestCapacityPerTick) || 1);
  const energyBuildTicks = Math.ceil(bodyCost / income);
  const observationMargin = Math.max(1, Number(config.LOG_HEARTBEAT_INTERVAL) || 1);
  return spawnTicks + roundTripTicks + energyBuildTicks + observationMargin;
}

function projectedHaulerCarryParts(state, leadTicks) {
  const haulers = (state.creeps || []).filter(c => c.memory && c.memory.role === 'hauler');
  return haulers.reduce((sum, creep) => {
    const ttl = Number(creep.ticksToLive);
    const survivesLead = creep.spawning || !Number.isFinite(ttl) || ttl > leadTicks;
    return survivesLead ? sum + creepPartCount(creep, CARRY) : sum;
  }, 0);
}

function shouldPrespawnHauler(state) {
  if (!state || state.rcl < 2 || !state.sites || !state.sites.length || !state.economyModel) return false;
  const model = state.economyModel;
  const requiredCarry = Number(model.recommendedHaulerCarryParts) || 0;
  if (requiredCarry <= 0) return false;

  // Do not steal spawn time from an active mining recovery deficit. This path
  // exists only to overlap a predictable hauler retirement with its
  // replacement while the mining side is already healthy.
  if ((Number(model.harvesterWorkDeficit) || 0) > 0) return false;

  const leadTicks = haulerReplacementLeadTicks(state);
  const projectedCarry = projectedHaulerCarryParts(state, leadTicks);
  return projectedCarry < requiredCarry;
}

function bodyFor(role, energy, state) {
  switch (role) {
    case 'harvester': return body.harvester(energy, state.economyModel && state.economyModel.sourceContainersReady === state.sources.length);
    case 'hauler': return body.hauler(energy);
    case 'upgrader': return body.upgrader(energy);
    case 'defender': return body.defender(energy);
    case 'scout': return body.scout();
    default: return body.worker(energy, state.emergency);
  }
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
    const workers = countRole(state.room, 'worker');
    if (harvesters < 1 && harvesters < want.harvester) role = 'harvester';
    else if (workers < 1 && workers < want.worker) role = 'worker';
    else if (harvesters < want.harvester) role = 'harvester';
    else if (workers < want.worker) role = 'worker';
  }

  if (!role && state.rcl >= 2) {
    const baseHarvesters = Math.max(1, state.sources.length);
    const harvesters = countRole(state.room, 'harvester');
    const workers = countRole(state.room, 'worker');
    const builders = countRole(state.room, 'builder');
    const upgraders = countRole(state.room, 'upgrader');
    const haulers = countRole(state.room, 'hauler');

    // Preserve essential colony functions before scaling throughput.
    if (harvesters < baseHarvesters) role = 'harvester';
    else if (workers < want.worker) role = 'worker';
    else if (upgraders < want.upgrader) role = 'upgrader';
    else if (builders < want.builder) role = 'builder';
    else if (haulers < Math.min(1, want.hauler)) role = 'hauler';
    else if (shouldPrespawnHauler(state)) role = 'hauler';

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

  if (!role) {
    for (const r of priority) {
      if (countRole(state.room, r) < want[r]) { role = r; break; }
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
  let creepBody = bodyFor(role, available, state);
  let cost = creepBody.reduce((sum, p) => sum + BODYPART_COST[p], 0);
  if (cost > state.energyAvailable) {
    if (!state.emergency && state.energyAvailable < Math.min(300, state.energyCapacityAvailable)) return false;
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

module.exports = {
  desired,
  spawnOne,
  _test: {
    creepPartCount,
    haulerReplacementLeadTicks,
    projectedHaulerCarryParts,
    shouldPrespawnHauler
  }
};
