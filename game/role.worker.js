'use strict';

const energy = require('energy');
const config = require('config');
const workPriority = require('work.priority');

function needsEnergy(creep) {
  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    creep.memory.working = false;
  }
  if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
    creep.memory.working = true;
    creep.memory.logisticsFallback = false;
    creep.memory.waitingEnergyTicks = 0;
    delete creep.memory.lastHaulerIntentTick;
    delete creep.memory.lastHaulerIntentEnergy;
  }

  // An accepted transfer intent cannot settle until the NEXT game tick.
  // The consumer may already carry partial self-harvest energy, or may act
  // later in the same tick after the hauler. Neither is a delivery receipt.
  // Resume partial-load work only after a full tick boundary and a measured
  // net increase over the store at intent time. This is a productivity hint,
  // not source attribution: E5 Room.getEventLog() is the settlement witness.
  if (!creep.memory.working && (creep.store[RESOURCE_ENERGY] || 0) > 0) {
    const intentTick = creep.memory.lastHaulerIntentTick;
    const energyBefore = creep.memory.lastHaulerIntentEnergy;
    const now = typeof Game !== 'undefined' && Number.isSafeInteger(Game.time)
      ? Game.time : null;
    if (now !== null && Number.isSafeInteger(intentTick) &&
        now - intentTick === 1 &&
        Number.isSafeInteger(energyBefore) && energyBefore >= 0 &&
        (creep.store[RESOURCE_ENERGY] || 0) > energyBefore) {
      creep.memory.working = true;
      creep.memory.waitingEnergyTicks = 0;
      creep.memory.logisticsFallback = false;
      delete creep.memory.lastHaulerIntentTick;
      delete creep.memory.lastHaulerIntentEnergy;
    }
  }
  return !creep.memory.working;
}

function hasLiveHauler(room) {
  return room.find(FIND_MY_CREEPS, {
    filter: c => !c.spawning && c.memory.role === 'hauler'
  }).length > 0;
}

function constructionPriority(site) {
  switch (site.structureType) {
    case STRUCTURE_SPAWN: return 0;
    case STRUCTURE_EXTENSION: return 1;
    case STRUCTURE_CONTAINER: return 2;
    case STRUCTURE_TOWER: return 3;
    case STRUCTURE_STORAGE: return 4;
    case STRUCTURE_LINK: return 5;
    case STRUCTURE_TERMINAL: return 6;
    case STRUCTURE_ROAD: return 20;
    case STRUCTURE_RAMPART: return 30;
    case STRUCTURE_WALL: return 31;
    default: return 10;
  }
}

// A road on natural wall terrain costs 45,000 build energy rather than
// 300 on plain or 1,500 on swamp. Pending a real route-ROI decision, defer
// expensive tunnel work at ALL RCLs. Keep existing partial progress/sites
// intact (no remove()): builders return to useful repair/controller work.
const MAX_UNVERIFIED_ROAD_SITE_COST = 1500;
function economicConstructionSite(site) {
  if (!site) return false;
  if (site.structureType !== STRUCTURE_ROAD) return true;
  // progressTotal is part of the real Screeps ConstructionSite API; missing
  // or malformed evidence fails closed rather than assuming a cheap road.
  return Number.isSafeInteger(site.progressTotal) &&
    site.progressTotal > 0 && site.progressTotal <= MAX_UNVERIFIED_ROAD_SITE_COST;
}

function preferredConstructionSite(creep) {
  const sites = creep.room.find(FIND_MY_CONSTRUCTION_SITES)
    .filter(economicConstructionSite);
  if (!sites.length) return null;
  let bestPriority = Infinity;
  for (const site of sites) bestPriority = Math.min(bestPriority, constructionPriority(site));
  const important = sites.filter(site => constructionPriority(site) === bestPriority);
  return creep.pos.findClosestByPath(important, { maxOps: config.PATH_MAX_OPS }) || important[0] || null;
}

function waitNearWork(creep) {
  if (creep.memory.role === 'upgrader' && creep.room.controller) {
    creep.moveTo(creep.room.controller, { reusePath: 10, range: 3, maxOps: config.PATH_MAX_OPS });
    return;
  }
  const site = preferredConstructionSite(creep);
  if (site) {
    creep.moveTo(site, { reusePath: 10, range: 3, maxOps: config.PATH_MAX_OPS });
    return;
  }
  if (creep.room.controller) creep.moveTo(creep.room.controller, { reusePath: 10, range: 3, maxOps: config.PATH_MAX_OPS });
}

function acquireWorkEnergy(creep) {
  const logistics = hasLiveHauler(creep.room);
  if (!logistics) {
    creep.memory.waitingEnergyTicks = 0;
    creep.memory.logisticsFallback = false;
    return energy.acquire(creep, true);
  }

  // v0.2.9 fallback bug: after the wait threshold a consumer performed only
  // one self-harvest movement/action, then returned to another full wait
  // period. Once fallback starts, stay in it until the creep actually fills.
  if (creep.memory.logisticsFallback) {
    return energy.acquire(creep, true);
  }

  // The local drop/storage/controller-container helper returns true on an
  // accepted pickup/withdraw intent OR an accepted moveTo. Neither proves
  // that CARRY changed. Do not indefinitely restart the hauler wait clock
  // while walking toward a distant or emptying local source.
  const acquiring = energy.acquireForConsumer(creep);
  creep.memory.waitingEnergyTicks = (creep.memory.waitingEnergyTicks || 0) + 1;
  if (creep.memory.waitingEnergyTicks <= config.CONSUMER_HAULER_WAIT_TICKS) {
    // Never overwrite an already issued pickup/withdraw or local approach
    // movement with a second moveTo near the work site in this same tick.
    if (!acquiring) waitNearWork(creep);
    return true;
  }

  creep.memory.waitingEnergyTicks = 0;
  creep.memory.logisticsFallback = true;
  // Finish the in-flight local action/move this tick. Starting NEXT tick,
  // persistent fallback collects independent of the stalled hauler path.
  // This also avoids issuing competing movement intents in one tick.
  if (acquiring) return true;
  return energy.acquire(creep, true);
}

function build(creep) {
  const site = preferredConstructionSite(creep);
  if (!site) return false;
  const rc = creep.build(site);
  if (rc === ERR_NOT_IN_RANGE) creep.moveTo(site, { reusePath: 10, maxOps: config.PATH_MAX_OPS, visualizePathStyle: { stroke: '#00ffff' } });
  return rc === OK || rc === ERR_NOT_IN_RANGE;
}

function emergencyRepair(creep) {
  const targets = workPriority.emergencyRepairTargets(creep.room.find(FIND_STRUCTURES));
  if (!targets.length) return false;

  // Never skip a threatened spawn just because a road is closer. Within
  // the highest-priority category, try the most damaged reachable object.
  const target = creep.pos.findClosestByPath(targets, {
    maxOps: config.PATH_MAX_OPS
  });
  if (!target) return false;
  const rc = creep.repair(target);
  if (rc === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, {
      reusePath: 10,
      maxOps: config.PATH_MAX_OPS,
      visualizePathStyle: { stroke: '#ff5533' }
    });
  }
  return rc === OK || rc === ERR_NOT_IN_RANGE;
}

// D6: only verified enemy damage to an owned Spawn/Tower/Storage shield
// displaces discretionary construction. Evacuation still executes before
// this role and prevents a worker from being ordered into immediate danger.
function repairCoreShield(creep,options) {
  if(!creep?.room?.controller?.my || creep.room.controller.safeMode ||
     !creep.pos || !creep.store ||
     (creep.store[RESOURCE_ENERGY]||0)<=0 ||
     typeof creep.room.find!=='function' ||
     typeof FIND_HOSTILE_CREEPS==='undefined')return false;
  let structures,hostiles;
  try {
    hostiles=creep.room.find(FIND_HOSTILE_CREEPS);
    if(!Array.isArray(hostiles) || !hostiles.length)return false;
    structures=creep.room.find(FIND_STRUCTURES);
  }catch(_){return false;}
  const targets=workPriority.criticalCoreShieldTargets(structures,hostiles,
    options?.imminentOnly===true?{imminentOnly:true}:undefined);
  if(!targets.length ||
     typeof creep.pos.findClosestByPath!=='function')return false;
  const target=creep.pos.findClosestByPath(targets,{
    maxOps:config.PATH_MAX_OPS
  });
  if(!target)return false;
  let rc;
  try{rc=creep.repair(target);}catch(_){return false;}
  if(rc===ERR_NOT_IN_RANGE) {
    // Stand at working range, not directly on the tile exposed to attackers.
    creep.moveTo(target,{range:3,reusePath:3,maxRooms:1,
      maxOps:config.PATH_MAX_OPS});
  }
  return rc===OK || rc===ERR_NOT_IN_RANGE;
}

// D11: the *dedicated* siege repairer must not donate its last carried
// energy to infrastructure while a REAL protected Spawn/Tower/Storage
// shield is at most three observed hostile-damage ticks from collapse.
// A live Hauler must still be available to keep Spawn/Tower logistics
// running. Never divert the sole productive worker/builder/upgrader.
// Directly damaged owned core remains above shields in the D6 hierarchy.
function preemptForImminentShield(creep) {
  if(creep?.memory?.role!=='repairer'||
     !creep.room?.controller?.my || creep.room.controller.safeMode)
    return false;
  try {
    if(liveHaulerCount(creep.room)<1)return false;
    if(workPriority.hasEmergencyRepair(creep.room.find(FIND_STRUCTURES)))
      return false;
  }catch(_){return false;}
  return repairCoreShield(creep,{imminentOnly:true});
}

function repair(creep) {
  const rcl = creep.room.controller ? creep.room.controller.level : 1;
  const wallCap = Math.max(10000, rcl * config.REPAIR_WALL_TARGET_RCL_MULTIPLIER);
  const target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    maxOps: config.PATH_MAX_OPS,
    filter: s => {
      if (s.hits >= s.hitsMax) return false;
      if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) return s.hits < wallCap;
      return s.hits < s.hitsMax * 0.65;
    }
  });
  if (!target) return false;
  const rc = creep.repair(target);
  if (rc === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 10, maxOps: config.PATH_MAX_OPS, visualizePathStyle: { stroke: '#00ff66' } });
  return rc === OK || rc === ERR_NOT_IN_RANGE;
}

function upgrade(creep) {
  const controller = creep.room.controller;
  if (!controller) return false;
  const rc = creep.upgradeController(controller);
  if (rc === ERR_NOT_IN_RANGE) creep.moveTo(controller, { reusePath: 10, maxOps: config.PATH_MAX_OPS, visualizePathStyle: { stroke: '#aa66ff' } });
  return rc === OK || rc === ERR_NOT_IN_RANGE;
}

function liveHaulerCount(room) {
  return room.find(FIND_MY_CREEPS, {
    filter: c => !c.spawning && c.memory && c.memory.role === 'hauler'
  }).length;
}

function shouldAssistInfrastructure(creep) {
  // Productive consumers are the recovery logistics reserve, not part of the
  // normal haul loop. Once two live haulers exist, keep consumer energy on
  // productive work instead of donating it back to spawn/extensions and then
  // waiting for another delivery. If logistics loses redundancy, immediately
  // restore the historical infrastructure-first behavior.
  return liveHaulerCount(creep.room) < 2;
}

function refill(creep) { return energy.deliver(creep); }

function run(creep) {
  if (needsEnergy(creep)) {
    acquireWorkEnergy(creep);
    return;
  }

  creep.memory.waitingEnergyTicks = 0;
  const role = creep.memory.role;

  if (role === 'upgrader') {
    upgrade(creep);
    return;
  }

  // A measured imminent breach takes precedence over optional repairer
  // energy delivery ONLY while a dedicated live hauler survives.
  if (preemptForImminentShield(creep)) return;

  if (shouldAssistInfrastructure(creep) && refill(creep)) return;

  // Preserve infrastructure refill for recovery rooms, then immediately
  // repair critically damaged owned spawns/towers/storage before construction
  // or routine maintenance. Upgraders retain their controller assignment.
  if (emergencyRepair(creep)) return;
  if (repairCoreShield(creep)) return;

  if (role === 'builder') {
    if (build(creep)) return;
    if (repair(creep)) return;
    upgrade(creep);
    return;
  }
  if (role === 'repairer') {
    if (repair(creep)) return;
    if (build(creep)) return;
    upgrade(creep);
    return;
  }

  if (build(creep)) return;
  if (repair(creep)) return;
  upgrade(creep);
}

module.exports = { run, _test: { acquireWorkEnergy, needsEnergy, liveHaulerCount, shouldAssistInfrastructure, emergencyRepair, repairCoreShield, preemptForImminentShield, economicConstructionSite, preferredConstructionSite } };
