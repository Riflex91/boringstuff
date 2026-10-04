'use strict';

const config = require('config');

const CONSUMER_ROLES = {
  builder: true,
  worker: true,
  repairer: true,
  upgrader: true
};

function energyAmount(target) {
  if (!target) return 0;
  if (target.store) return target.store[RESOURCE_ENERGY] || 0;
  if (target.energy !== undefined) return target.energy;
  return 0;
}

function freeEnergyCapacity(target) {
  if (!target) return 0;
  if (target.store && target.store.getFreeCapacity) return target.store.getFreeCapacity(RESOURCE_ENERGY);
  if (target.energyCapacity !== undefined && target.energy !== undefined) return target.energyCapacity - target.energy;
  return 0;
}

function isSourceContainer(room, structure) {
  if (!structure || structure.structureType !== STRUCTURE_CONTAINER) return false;
  return room.find(FIND_SOURCES).some(source => source.pos.getRangeTo(structure) <= 1);
}

function findWithdrawTarget(creep) {
  const room = creep.room;
  const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
    filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= Math.min(100, creep.store.getFreeCapacity())
  });
  if (dropped) return { type: 'pickup', target: dropped };

  const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, { filter: t => (t.store[RESOURCE_ENERGY] || 0) > 0 });
  if (tomb) return { type: 'withdraw', target: tomb };

  const ruin = creep.pos.findClosestByPath(FIND_RUINS, { filter: r => (r.store[RESOURCE_ENERGY] || 0) > 0 });
  if (ruin) return { type: 'withdraw', target: ruin };

  const stores = room.find(FIND_STRUCTURES, {
    filter: s => (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) && energyAmount(s) > 50
  });
  if (stores.length) {
    const target = creep.pos.findClosestByPath(stores);
    if (target) return { type: 'withdraw', target };
  }
  return null;
}

function acquire(creep, allowHarvest) {
  const source = findWithdrawTarget(creep);
  if (source) {
    const rc = source.type === 'pickup' ? creep.pickup(source.target) : creep.withdraw(source.target, RESOURCE_ENERGY);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(source.target, { reusePath: 10, visualizePathStyle: { stroke: '#ffaa00' } });
    return true;
  }

  if (allowHarvest !== false && creep.getActiveBodyparts(WORK) > 0) {
    const target = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE) || creep.pos.findClosestByPath(FIND_SOURCES);
    if (target) {
      const rc = creep.harvest(target);
      if (rc === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 10, visualizePathStyle: { stroke: '#ffaa00' } });
      return true;
    }
  }
  return false;
}

function acquireForHauler(creep) {
  const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
    filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 0
  });
  if (dropped) {
    const rc = creep.pickup(dropped);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(dropped, { reusePath: 8, visualizePathStyle: { stroke: '#ffaa00' } });
    return true;
  }

  const containers = creep.room.find(FIND_STRUCTURES, {
    filter: s => isSourceContainer(creep.room, s) && energyAmount(s) > 0
  });
  const container = creep.pos.findClosestByPath(containers);
  if (container) {
    const rc = creep.withdraw(container, RESOURCE_ENERGY);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(container, { reusePath: 8, visualizePathStyle: { stroke: '#ffaa00' } });
    return true;
  }

  const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, { filter: t => (t.store[RESOURCE_ENERGY] || 0) > 0 });
  if (tomb) {
    const rc = creep.withdraw(tomb, RESOURCE_ENERGY);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(tomb, { reusePath: 8 });
    return true;
  }
  return false;
}

function acquireForConsumer(creep) {
  // Consumers should not walk back to source containers while an active hauler
  // exists. They may use nearby drops, storage, or a controller-side container.
  const localDrop = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
    filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 0
  })[0];
  if (localDrop) {
    const rc = creep.pickup(localDrop);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(localDrop, { reusePath: 5 });
    return true;
  }

  if (creep.room.storage && energyAmount(creep.room.storage) > 0) {
    const rc = creep.withdraw(creep.room.storage, RESOURCE_ENERGY);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(creep.room.storage, { reusePath: 8 });
    return true;
  }

  if (creep.memory.role === 'upgrader' && creep.room.controller) {
    const controllerContainers = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER && energyAmount(s) > 0
    });
    const target = creep.pos.findClosestByPath(controllerContainers);
    if (target) {
      const rc = creep.withdraw(target, RESOURCE_ENERGY);
      if (rc === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 8 });
      return true;
    }
  }
  return false;
}

function deliveryTargets(creep) {
  const targets = creep.room.find(FIND_MY_STRUCTURES, {
    filter: s => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION || s.structureType === STRUCTURE_TOWER) && freeEnergyCapacity(s) > 0
  });
  targets.sort((a, b) => {
    const pa = a.structureType === STRUCTURE_SPAWN ? 0 : a.structureType === STRUCTURE_EXTENSION ? 1 : 2;
    const pb = b.structureType === STRUCTURE_SPAWN ? 0 : b.structureType === STRUCTURE_EXTENSION ? 1 : 2;
    return pa - pb || creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
  });
  return targets;
}

function deliver(creep) {
  const targets = deliveryTargets(creep);
  const target = targets[0];
  if (!target) return false;
  const rc = creep.transfer(target, RESOURCE_ENERGY);
  if (rc === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 10, visualizePathStyle: { stroke: '#ffffff' } });
  return true;
}

function consumerPriority(creep) {
  const role = creep.memory.role;
  if (role === 'builder') return 0;
  if (role === 'worker') return 1;
  if (role === 'repairer') return 2;
  if (role === 'upgrader') return 3;
  return 10;
}

function isConsumer(creep) {
  return !!(creep && creep.memory && CONSUMER_ROLES[creep.memory.role] && creep.store && creep.store.getFreeCapacity);
}

function consumerEnergyUsePerTick(creep) {
  if (!creep || !creep.memory || !creep.getActiveBodyparts || typeof WORK === 'undefined') return 0;
  const workParts = creep.getActiveBodyparts(WORK) || 0;
  if (workParts <= 0) return 0;

  const upgradePower = typeof UPGRADE_CONTROLLER_POWER !== 'undefined' ? UPGRADE_CONTROLLER_POWER : 1;
  if (creep.memory.role === 'upgrader') return workParts * upgradePower;

  // Builders/workers can consume BUILD_POWER energy per WORK part while
  // construction is active. Outside a construction phase their repair/upgrade
  // burn is lower, so use the controller rate as the conservative refill need.
  const buildPower = typeof BUILD_POWER !== 'undefined' ? BUILD_POWER : 5;
  const hasConstruction = !!(
    creep.room &&
    creep.room.find &&
    typeof FIND_MY_CONSTRUCTION_SITES !== 'undefined' &&
    creep.room.find(FIND_MY_CONSTRUCTION_SITES).length
  );
  return workParts * (hasConstruction ? buildPower : upgradePower);
}

function consumerRefillTargetEnergy(creep) {
  if (!isConsumer(creep)) return 0;
  const capacity = energyAmount(creep) + freeEnergyCapacity(creep);
  if (capacity <= 0) return 0;

  const carryUnit = typeof CARRY_CAPACITY !== 'undefined' ? CARRY_CAPACITY : 50;
  const burnPerTick = consumerEnergyUsePerTick(creep);
  const horizon = Math.max(1, Number(config.CONSUMER_HAULER_WAIT_TICKS) || 1);

  // Aim for enough energy to survive one complete logistics wait horizon.
  // Clamp to carry capacity so current early-RCL consumers naturally top out
  // at their physical store instead of introducing a fixed refill percentage.
  if (burnPerTick <= 0) return Math.min(capacity, carryUnit);
  return Math.min(capacity, Math.max(carryUnit, Math.ceil(burnPerTick * horizon)));
}

function consumerRefillRequestThresholdEnergy(creep) {
  const target = consumerRefillTargetEnergy(creep);
  const carryUnit = typeof CARRY_CAPACITY !== 'undefined' ? CARRY_CAPACITY : 50;
  return Math.max(0, target - Math.min(target, carryUnit));
}

function consumerRefillEnergyNeeded(creep) {
  return Math.max(0, consumerRefillTargetEnergy(creep) - energyAmount(creep));
}

function consumerResumeTargetEnergy(creep) {
  const refillTarget = consumerRefillTargetEnergy(creep);
  const carryUnit = typeof CARRY_CAPACITY !== 'undefined' ? CARRY_CAPACITY : 50;
  return Math.min(refillTarget, carryUnit);
}

function consumerCanResumeWork(creep) {
  if (!isConsumer(creep)) return false;
  const resumeTarget = consumerResumeTargetEnergy(creep);
  return resumeTarget > 0 && energyAmount(creep) >= resumeTarget;
}

function consumerUsefulDeliveryEnergyNeeded(creep) {
  const refillNeeded = consumerRefillEnergyNeeded(creep);
  if (refillNeeded <= 0) return 0;

  const waiting = creep.memory.waitingEnergyTicks || 0;
  const stalled = !creep.memory.working ||
    energyAmount(creep) === 0 ||
    waiting > 0 ||
    !!creep.memory.logisticsFallback;

  if (!stalled) return refillNeeded;
  return Math.max(0, consumerResumeTargetEnergy(creep) - energyAmount(creep));
}

function consumerHasLowRunway(creep) {
  if (!isConsumer(creep) || !creep.memory.working || freeEnergyCapacity(creep) <= 0) return false;
  const carried = energyAmount(creep);
  if (carried <= 0) return false;
  const target = consumerRefillTargetEnergy(creep);
  return carried < target && carried <= consumerRefillRequestThresholdEnergy(creep);
}

function consumerNeedsDelivery(creep) {
  if (!isConsumer(creep) || freeEnergyCapacity(creep) <= 0) return false;
  const waiting = creep.memory.waitingEnergyTicks || 0;
  return energyAmount(creep) === 0 || waiting > 0 || !!creep.memory.logisticsFallback || consumerHasLowRunway(creep);
}

function isCriticalConsumerRequest(creep) {
  if (!consumerNeedsDelivery(creep)) return false;
  return !!creep.memory.logisticsFallback ||
    (creep.memory.waitingEnergyTicks || 0) > 0 ||
    consumerHasLowRunway(creep);
}

function haulerReadyToDeliver(creep) {
  if (!creep || !creep.store || !creep.store.getCapacity || !creep.memory) return false;
  const carried = energyAmount(creep);
  if (carried <= 0) return false;
  const capacity = creep.store.getCapacity(RESOURCE_ENERGY) || 0;
  return !!creep.memory.delivering || carried >= Math.max(50, Math.floor(capacity * 0.5));
}

function stableCreepKey(creep) {
  return creep.name || creep.id || '';
}

function selectConsumerGuardHauler(room) {
  // A spawn/extension refill burst can otherwise monopolize every hauler long
  // enough for productive creeps to cross the self-supply threshold. Keep the
  // survival rule when only one hauler exists, but with redundant logistics
  // reserve exactly one delivery-ready hauler for a consumer that is already
  // waiting or has entered fallback. The other haulers keep hard
  // infrastructure at highest priority.
  if (!room || !room.find) return null;
  const haulers = room.find(FIND_MY_CREEPS, {
    filter: c => !c.spawning && c.memory && c.memory.role === 'hauler'
  });
  if (haulers.length < 2) return null;

  const critical = room.find(FIND_MY_CREEPS, {
    filter: c => isCriticalConsumerRequest(c)
  });
  if (!critical.length) return null;

  const ready = haulers.filter(haulerReadyToDeliver);
  if (!ready.length) return null;

  const criticalIds = {};
  for (const consumer of critical) criticalIds[consumer.id] = true;

  // Preserve an existing useful reservation so the guard assignment does not
  // oscillate while a hauler is already travelling to a starved consumer.
  const reserved = ready.filter(h => h.memory.consumerTargetId && criticalIds[h.memory.consumerTargetId]);
  if (reserved.length) {
    reserved.sort((a, b) => stableCreepKey(a).localeCompare(stableCreepKey(b)));
    return reserved[0];
  }

  ready.sort((a, b) => {
    const rangeA = Math.min.apply(null, critical.map(c => a.pos && a.pos.getRangeTo ? a.pos.getRangeTo(c) : 999));
    const rangeB = Math.min.apply(null, critical.map(c => b.pos && b.pos.getRangeTo ? b.pos.getRangeTo(c) : 999));
    if (rangeA !== rangeB) return rangeA - rangeB;

    const energyDelta = energyAmount(b) - energyAmount(a);
    if (energyDelta !== 0) return energyDelta;
    return stableCreepKey(a).localeCompare(stableCreepKey(b));
  });
  return ready[0] || null;
}

function shouldPrioritizeConsumer(creep) {
  if (!creep || !creep.room) return false;
  const guard = selectConsumerGuardHauler(creep.room);
  return !!guard && guard.id === creep.id;
}


function selectConsumerEarlyDispatchHauler(room) {
  // v0.2.20: aggregate CARRY can be sufficient while every hauler is still on
  // the pickup leg. A critical consumer can then wait all the way to fallback
  // even though one hauler already carries usable energy. With redundant
  // logistics, let exactly one partial hauler break pickup early — but only
  // when no normal delivery-ready guard already exists.
  if (!room || !room.find) return null;
  const readyGuard = selectConsumerGuardHauler(room);
  if (readyGuard) return null;

  const haulers = room.find(FIND_MY_CREEPS, {
    filter: c => !c.spawning && c.memory && c.memory.role === 'hauler'
  });
  if (haulers.length < 2) return null;

  const critical = room.find(FIND_MY_CREEPS, {
    filter: c => isCriticalConsumerRequest(c)
  });
  if (!critical.length) return null;

  // A stalled consumer only needs enough energy to resume a meaningful work
  // burst. Low-runway hysteresis keeps the refill request active afterwards
  // until the full derived refill target is reached, so resuming at one CARRY
  // unit no longer recreates the old "deliver 50, disappear from the queue"
  // oscillation. For already-working low-runway consumers, the useful amount
  // remains the full outstanding refill need.
  const usefulNeeds = critical
    .map(consumerUsefulDeliveryEnergyNeeded)
    .filter(need => need > 0);
  if (!usefulNeeds.length) return null;
  const requiredUsefulDelivery = Math.min.apply(null, usefulNeeds);
  const partial = haulers.filter(h =>
    !haulerReadyToDeliver(h) &&
    energyAmount(h) > 0 &&
    energyAmount(h) >= requiredUsefulDelivery
  );
  if (!partial.length) return null;

  const criticalIds = {};
  for (const consumer of critical) criticalIds[consumer.id] = true;

  const reserved = partial.filter(h => h.memory.consumerTargetId && criticalIds[h.memory.consumerTargetId]);
  if (reserved.length) {
    reserved.sort((a, b) => stableCreepKey(a).localeCompare(stableCreepKey(b)));
    return reserved[0];
  }

  partial.sort((a, b) => {
    const rangeA = Math.min.apply(null, critical.map(c => a.pos && a.pos.getRangeTo ? a.pos.getRangeTo(c) : 999));
    const rangeB = Math.min.apply(null, critical.map(c => b.pos && b.pos.getRangeTo ? b.pos.getRangeTo(c) : 999));
    if (rangeA !== rangeB) return rangeA - rangeB;

    const energyDelta = energyAmount(b) - energyAmount(a);
    if (energyDelta !== 0) return energyDelta;
    return stableCreepKey(a).localeCompare(stableCreepKey(b));
  });
  return partial[0] || null;
}

function shouldInterruptPickupForConsumer(creep) {
  if (!creep || !creep.room || !creep.memory || creep.memory.delivering || energyAmount(creep) <= 0) return false;
  const guard = selectConsumerEarlyDispatchHauler(creep.room);
  return !!guard && guard.id === creep.id;
}

function consumerEnergyRatio(creep) {
  const carried = energyAmount(creep);
  const free = freeEnergyCapacity(creep);
  const total = carried + free;
  return total > 0 ? carried / total : 1;
}

function consumerReservations(creep) {
  const reserved = {};
  const haulers = creep.room.find(FIND_MY_CREEPS, {
    filter: c => c.id !== creep.id && !c.spawning && c.memory && c.memory.role === 'hauler' && c.memory.consumerTargetId
  });
  for (const hauler of haulers) reserved[hauler.memory.consumerTargetId] = true;
  return reserved;
}

function selectConsumerTarget(creep) {
  // v0.2.14 could have enough aggregate CARRY while consumers still entered
  // self-supply fallback. Two causes were visible in the implementation:
  // haulers topped off any partially used consumer, and several haulers could
  // chase the same high-priority builder. Only consumers that are actually
  // empty/waiting/fallbacking become delivery requests, and another live
  // hauler's reservation excludes that target from this selection.
  const reserved = consumerReservations(creep);
  const consumers = creep.room.find(FIND_MY_CREEPS, {
    filter: c => c.id !== creep.id && consumerNeedsDelivery(c) && !reserved[c.id]
  });
  consumers.sort((a, b) => {
    const fallbackA = a.memory.logisticsFallback ? 1 : 0;
    const fallbackB = b.memory.logisticsFallback ? 1 : 0;
    if (fallbackA !== fallbackB) return fallbackB - fallbackA;

    const waitA = a.memory.waitingEnergyTicks || 0;
    const waitB = b.memory.waitingEnergyTicks || 0;
    if (waitA !== waitB) return waitB - waitA;

    const emptyA = energyAmount(a) === 0 ? 1 : 0;
    const emptyB = energyAmount(b) === 0 ? 1 : 0;
    if (emptyA !== emptyB) return emptyB - emptyA;

    const ratioDelta = consumerEnergyRatio(a) - consumerEnergyRatio(b);
    if (ratioDelta !== 0) return ratioDelta;

    return consumerPriority(a) - consumerPriority(b) || creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
  });
  return consumers[0] || null;
}

function currentConsumerTarget(creep) {
  const id = creep.memory.consumerTargetId;
  if (!id || typeof Game === 'undefined' || !Game.getObjectById) return null;
  const target = Game.getObjectById(id);
  if (!target || target.room !== creep.room || !consumerNeedsDelivery(target)) {
    delete creep.memory.consumerTargetId;
    return null;
  }
  return target;
}

function clearConsumerTarget(creep) {
  if (creep && creep.memory) delete creep.memory.consumerTargetId;
}

function deliverToConsumer(creep) {
  let target = currentConsumerTarget(creep);
  if (!target) {
    target = selectConsumerTarget(creep);
    if (!target) {
      clearConsumerTarget(creep);
      return false;
    }
    creep.memory.consumerTargetId = target.id;
  }

  const rc = creep.transfer(target, RESOURCE_ENERGY);
  if (rc === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 5, visualizePathStyle: { stroke: '#ffffff' } });
    return true;
  }
  if (rc === OK) {
    // Resume after one meaningful logistics quantum, not only after a full
    // refill. Unlike the rejected "any positive transfer" iteration, the
    // low-runway request remains active below the derived refill target, so a
    // resumed consumer stays eligible for top-up instead of disappearing from
    // the delivery queue until it becomes empty again.
    if (consumerCanResumeWork(target)) {
      target.memory.working = true;
      target.memory.waitingEnergyTicks = 0;
      target.memory.logisticsFallback = false;
    }

    // Travel is complete after a successful transfer. Release the reservation
    // even when the consumer still needs top-up so another hauler may finish
    // the refill without being blocked by a stale assignment.
    clearConsumerTarget(creep);
    return true;
  }

  // A stale/full target must not hold a reservation indefinitely. Retarget on
  // the next tick; the hauler may still use a controller buffer this tick.
  clearConsumerTarget(creep);
  return false;
}

function deliverToControllerBuffer(creep) {
  const controller = creep.room.controller;
  if (!controller) return false;
  const target = controller.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: s => s.structureType === STRUCTURE_CONTAINER && freeEnergyCapacity(s) > 0
  })[0];
  if (!target) return false;
  const rc = creep.transfer(target, RESOURCE_ENERGY);
  if (rc === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 8, visualizePathStyle: { stroke: '#ffffff' } });
  return rc === OK || rc === ERR_NOT_IN_RANGE;
}

module.exports = {
  acquire,
  acquireForHauler,
  acquireForConsumer,
  deliver,
  deliverToConsumer,
  deliverToControllerBuffer,
  deliveryTargets,
  energyAmount,
  freeEnergyCapacity,
  isSourceContainer,
  consumerNeedsDelivery,
  isCriticalConsumerRequest,
  consumerCanResumeWork,
  shouldPrioritizeConsumer,
  shouldInterruptPickupForConsumer,
  clearConsumerTarget,
  _test: {
    consumerPriority,
    consumerEnergyRatio,
    consumerEnergyUsePerTick,
    consumerRefillTargetEnergy,
    consumerRefillRequestThresholdEnergy,
    consumerRefillEnergyNeeded,
    consumerResumeTargetEnergy,
    consumerUsefulDeliveryEnergyNeeded,
    consumerHasLowRunway,
    selectConsumerTarget,
    currentConsumerTarget,
    haulerReadyToDeliver,
    selectConsumerGuardHauler,
    selectConsumerEarlyDispatchHauler
  }
};
