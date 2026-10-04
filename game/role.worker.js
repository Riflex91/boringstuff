'use strict';

const energy = require('energy');
const config = require('config');

function needsEnergy(creep) {
  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    creep.memory.working = false;
  }

  // With live logistics, a consumer no longer has to remain in self-supply
  // fallback until its carry is completely full. Resume after one meaningful
  // work burst; energy.consumerNeedsDelivery() keeps the low-runway request
  // active until haulers finish the derived refill target. Without a live
  // hauler, preserve the historical full-carry self-supply behavior.
  if (
    !creep.memory.working &&
    hasLiveHauler(creep.room) &&
    energy.consumerCanResumeWork(creep)
  ) {
    creep.memory.working = true;
    creep.memory.logisticsFallback = false;
    creep.memory.waitingEnergyTicks = 0;
  }

  if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
    creep.memory.working = true;
    creep.memory.logisticsFallback = false;
    creep.memory.waitingEnergyTicks = 0;
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

function preferredConstructionSite(creep) {
  const sites = creep.room.find(FIND_MY_CONSTRUCTION_SITES);
  if (!sites.length) return null;
  let bestPriority = Infinity;
  for (const site of sites) bestPriority = Math.min(bestPriority, constructionPriority(site));
  const important = sites.filter(site => constructionPriority(site) === bestPriority);
  return creep.pos.findClosestByPath(important) || important[0] || null;
}

function waitNearWork(creep) {
  if (creep.memory.role === 'upgrader' && creep.room.controller) {
    creep.moveTo(creep.room.controller, { reusePath: 10, range: 3 });
    return;
  }
  const site = preferredConstructionSite(creep);
  if (site) {
    creep.moveTo(site, { reusePath: 10, range: 3 });
    return;
  }
  if (creep.room.controller) creep.moveTo(creep.room.controller, { reusePath: 10, range: 3 });
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

  if (energy.acquireForConsumer(creep)) {
    creep.memory.waitingEnergyTicks = 0;
    return true;
  }

  creep.memory.waitingEnergyTicks = (creep.memory.waitingEnergyTicks || 0) + 1;
  if (creep.memory.waitingEnergyTicks <= config.CONSUMER_HAULER_WAIT_TICKS) {
    waitNearWork(creep);
    return true;
  }

  creep.memory.waitingEnergyTicks = 0;
  creep.memory.logisticsFallback = true;
  return energy.acquire(creep, true);
}

function build(creep) {
  const site = preferredConstructionSite(creep);
  if (!site) return false;
  const rc = creep.build(site);
  if (rc === ERR_NOT_IN_RANGE) creep.moveTo(site, { reusePath: 10, visualizePathStyle: { stroke: '#00ffff' } });
  return rc === OK || rc === ERR_NOT_IN_RANGE;
}

function repair(creep) {
  const rcl = creep.room.controller ? creep.room.controller.level : 1;
  const wallCap = Math.max(10000, rcl * config.REPAIR_WALL_TARGET_RCL_MULTIPLIER);
  const target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: s => {
      if (s.hits >= s.hitsMax) return false;
      if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) return s.hits < wallCap;
      return s.hits < s.hitsMax * 0.65;
    }
  });
  if (!target) return false;
  const rc = creep.repair(target);
  if (rc === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 10, visualizePathStyle: { stroke: '#00ff66' } });
  return rc === OK || rc === ERR_NOT_IN_RANGE;
}

function upgrade(creep) {
  const controller = creep.room.controller;
  if (!controller) return false;
  const rc = creep.upgradeController(controller);
  if (rc === ERR_NOT_IN_RANGE) creep.moveTo(controller, { reusePath: 10, visualizePathStyle: { stroke: '#aa66ff' } });
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

  if (shouldAssistInfrastructure(creep) && refill(creep)) return;

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

module.exports = { run, _test: { acquireWorkEnergy, needsEnergy, liveHaulerCount, shouldAssistInfrastructure } };
