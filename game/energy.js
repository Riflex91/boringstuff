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
    maxOps: config.PATH_MAX_OPS,
    filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= Math.min(100, creep.store.getFreeCapacity())
  });
  if (dropped) return { type: 'pickup', target: dropped };

  const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, { maxOps: config.PATH_MAX_OPS, filter: t => (t.store[RESOURCE_ENERGY] || 0) > 0 });
  if (tomb) return { type: 'withdraw', target: tomb };

  const ruin = creep.pos.findClosestByPath(FIND_RUINS, { maxOps: config.PATH_MAX_OPS, filter: r => (r.store[RESOURCE_ENERGY] || 0) > 0 });
  if (ruin) return { type: 'withdraw', target: ruin };

  const stores = room.find(FIND_STRUCTURES, {
    filter: s => (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) && energyAmount(s) > 50
  });
  if (stores.length) {
    const target = creep.pos.findClosestByPath(stores, { maxOps: config.PATH_MAX_OPS });
    if (target) return { type: 'withdraw', target };
  }
  return null;
}

function acquire(creep, allowHarvest) {
  const source = findWithdrawTarget(creep);
  if (source) {
    const rc = source.type === 'pickup' ? creep.pickup(source.target) : creep.withdraw(source.target, RESOURCE_ENERGY);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(source.target, { reusePath: 10, maxOps: config.PATH_MAX_OPS, visualizePathStyle: { stroke: '#ffaa00' } });
    return true;
  }

  if (allowHarvest !== false && creep.getActiveBodyparts(WORK) > 0) {
    const target = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE, { maxOps: config.PATH_MAX_OPS }) ||
      creep.pos.findClosestByPath(FIND_SOURCES, { maxOps: config.PATH_MAX_OPS });
    if (target) {
      const rc = creep.harvest(target);
      if (rc === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 10, maxOps: config.PATH_MAX_OPS, visualizePathStyle: { stroke: '#ffaa00' } });
      return true;
    }
  }
  return false;
}

function acquireForHauler(creep) {
  const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
    maxOps: config.PATH_MAX_OPS,
    filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 0
  });
  if (dropped) {
    const rc = creep.pickup(dropped);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(dropped, { reusePath: 8, maxOps: config.PATH_MAX_OPS, visualizePathStyle: { stroke: '#ffaa00' } });
    return true;
  }

  const containers = creep.room.find(FIND_STRUCTURES, {
    filter: s => isSourceContainer(creep.room, s) && energyAmount(s) > 0
  });
  const container = creep.pos.findClosestByPath(containers, { maxOps: config.PATH_MAX_OPS });
  if (container) {
    const rc = creep.withdraw(container, RESOURCE_ENERGY);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(container, { reusePath: 8, maxOps: config.PATH_MAX_OPS, visualizePathStyle: { stroke: '#ffaa00' } });
    return true;
  }

  const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, { maxOps: config.PATH_MAX_OPS, filter: t => (t.store[RESOURCE_ENERGY] || 0) > 0 });
  if (tomb) {
    const rc = creep.withdraw(tomb, RESOURCE_ENERGY);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(tomb, { reusePath: 8, maxOps: config.PATH_MAX_OPS });
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
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(localDrop, { reusePath: 5, maxOps: config.PATH_MAX_OPS });
    return true;
  }

  if (creep.room.storage && energyAmount(creep.room.storage) > 0) {
    const rc = creep.withdraw(creep.room.storage, RESOURCE_ENERGY);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(creep.room.storage, { reusePath: 8, maxOps: config.PATH_MAX_OPS });
    return true;
  }

  if (creep.memory.role === 'upgrader' && creep.room.controller) {
    const controllerContainers = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER && energyAmount(s) > 0
    });
    const target = creep.pos.findClosestByPath(controllerContainers, { maxOps: config.PATH_MAX_OPS });
    if (target) {
      const rc = creep.withdraw(target, RESOURCE_ENERGY);
      if (rc === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 8, maxOps: config.PATH_MAX_OPS });
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
  if (rc === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 10, maxOps: config.PATH_MAX_OPS, visualizePathStyle: { stroke: '#ffffff' } });
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

function consumerNeedsDelivery(creep) {
  if (!isConsumer(creep) || freeEnergyCapacity(creep) <= 0) return false;
  const waiting = creep.memory.waitingEnergyTicks || 0;
  return energyAmount(creep) === 0 || waiting > 0 || !!creep.memory.logisticsFallback;
}

function isCriticalConsumerRequest(creep) {
  if (!consumerNeedsDelivery(creep)) return false;
  return !!creep.memory.logisticsFallback || (creep.memory.waitingEnergyTicks || 0) > 0;
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


const MIN_RESCUE_ENERGY = 25;
const MIN_RESCUE_WAIT = 3;

// A partially loaded hauler may interrupt collection only when the room has
// full spawn/extension energy and towers are at least half charged.
function rescueInfrastructureSafe(room) {
  if (!room || !room.find || !Number.isFinite(room.energyAvailable) ||
      !Number.isFinite(room.energyCapacityAvailable) ||
      room.energyCapacityAvailable <= 0 ||
      room.energyAvailable < room.energyCapacityAvailable) return false;
  const structures = room.find(FIND_MY_STRUCTURES);
  if (!Array.isArray(structures)) return false;
  return !structures.some(s => {
    if (s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_EXTENSION) return freeEnergyCapacity(s) > 0;
    if (s.structureType !== STRUCTURE_TOWER) return false;
    const capacity = s.store && s.store.getCapacity
      ? Number(s.store.getCapacity(RESOURCE_ENERGY)) : Number(s.energyCapacity);
    return !Number.isFinite(capacity) || capacity <= 0 ||
      energyAmount(s) < capacity * 0.5;
  });
}

function selectConsumerRescueHauler(room, haulers, ready, critical) {
  // Keep the sole normally ready hauler for infrastructure. No rescue with
  // one hauler, no ready infrastructure hauler, or uncertain room supply.
  if (haulers.length < 2 || ready.length !== 1 ||
      !rescueInfrastructureSafe(room)) return null;
  const urgent = critical.filter(c => c.memory &&
    (c.memory.logisticsFallback ||
      (Number(c.memory.waitingEnergyTicks) || 0) >= MIN_RESCUE_WAIT));
  if (!urgent.length) return null;
  const candidates = haulers.filter(h => {
    if (!h.memory || h.memory.delivering || h.spawning ||
        !h.store || typeof h.store.getCapacity !== 'function') return false;
    const cap = Number(h.store.getCapacity(RESOURCE_ENERGY));
    const carried = energyAmount(h);
    return Number.isFinite(cap) && cap > 0 &&
      carried >= MIN_RESCUE_ENERGY &&
      carried < Math.max(50, Math.floor(cap * 0.5));
  });
  const viable = candidates.map(h => ({
    h,
    requests: urgent.filter(c => !haulers.some(other =>
      other.id !== h.id && other.memory &&
      other.memory.consumerTargetId === c.id))
  })).filter(x => x.requests.length);
  viable.sort((a, b) => {
    const sticky = x => x.requests.some(c => c.id === x.h.memory.consumerTargetId) ? 1 : 0;
    if (sticky(a) !== sticky(b)) return sticky(b) - sticky(a);
    const distance = x => Math.min(...x.requests.map(c =>
      x.h.pos && x.h.pos.getRangeTo ? x.h.pos.getRangeTo(c) : 999));
    return distance(a) - distance(b) ||
      stableCreepKey(a.h).localeCompare(stableCreepKey(b.h));
  });
  return viable.length ? viable[0].h : null;
}

function selectConsumerGuardHaulers(room) {
  // Preserve at least one live hauler for hard infrastructure. With two
  // haulers this remains the historical single starvation guard. A third
  // hauler may unlock a second guard only when multiple critical consumers
  // exist, so severe consumer pressure can be served concurrently without
  // abandoning spawn/extensions/tower refill.
  if (!room || !room.find) return [];
  const haulers = room.find(FIND_MY_CREEPS, {
    filter: c => !c.spawning && c.memory && c.memory.role === 'hauler'
  });
  if (haulers.length < 2) return [];

  const critical = room.find(FIND_MY_CREEPS, {
    filter: c => isCriticalConsumerRequest(c)
  });
  if (!critical.length) return [];

  const ready = haulers.filter(haulerReadyToDeliver);
  if (!ready.length) return [];
  // Unlike the normal guard, rescue assigns the underfilled hauler to the
  // consumer and leaves the one ready hauler outside consumer service.
  const rescuer = selectConsumerRescueHauler(room, haulers, ready, critical);
  if (rescuer) return [rescuer];

  const maxGuards = Math.min(
    critical.length,
    ready.length,
    Math.max(1, haulers.length - 1)
  );
  const criticalIds = {};
  for (const consumer of critical) criticalIds[consumer.id] = true;

  const selected = [];
  const selectedIds = {};
  const coveredReservedTargets = new Set();
  const reserved = ready.filter(h => h.memory.consumerTargetId && criticalIds[h.memory.consumerTargetId]);
  reserved.sort((a, b) => stableCreepKey(a).localeCompare(stableCreepKey(b)));
  for (const hauler of reserved) {
    if (selected.length >= maxGuards) break;
    // Multiple persistent reservations for one critical consumer can survive
    // from earlier assignments. Never spend two critical guard slots on the
    // same target: deliverToConsumer honors its existing sticky target.
    const targetId = hauler.memory.consumerTargetId;
    if (coveredReservedTargets.has(targetId)) continue;
    coveredReservedTargets.add(targetId);
    selected.push(hauler);
    selectedIds[hauler.id] = true;
  }

  // Duplicated sticky reservations are deliberately kept outside the guard
  // rather than forced into a second emergency consumer slot. Their normal
  // infrastructure-first delivery path clears stale reservations.
  const remaining = ready.filter(h => !selectedIds[h.id] &&
    !(h.memory.consumerTargetId && coveredReservedTargets.has(h.memory.consumerTargetId)));
  remaining.sort((a, b) => {
    const rangeA = Math.min.apply(null, critical.map(c => a.pos && a.pos.getRangeTo ? a.pos.getRangeTo(c) : 999));
    const rangeB = Math.min.apply(null, critical.map(c => b.pos && b.pos.getRangeTo ? b.pos.getRangeTo(c) : 999));
    if (rangeA !== rangeB) return rangeA - rangeB;

    const energyDelta = energyAmount(b) - energyAmount(a);
    if (energyDelta !== 0) return energyDelta;
    return stableCreepKey(a).localeCompare(stableCreepKey(b));
  });
  for (const hauler of remaining) {
    if (selected.length >= maxGuards) break;
    selected.push(hauler);
  }
  return selected;
}

function selectConsumerGuardHauler(room) {
  return selectConsumerGuardHaulers(room)[0] || null;
}
function shouldPrioritizeConsumer(creep) {
  if (!creep || !creep.room) return false;
  const guards = selectConsumerGuardHaulers(creep.room);
  return guards.some(guard => guard.id === creep.id);
}

function shouldRescueConsumer(creep) {
  if (!creep || !creep.memory || creep.memory.role !== 'hauler' ||
      creep.memory.delivering || !creep.room) return false;
  return selectConsumerGuardHaulers(creep.room)
    .some(guard => guard.id === creep.id);
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
    creep.moveTo(target, { reusePath: 5, maxOps: config.PATH_MAX_OPS, visualizePathStyle: { stroke: '#ffffff' } });
    return true;
  }
  if (rc === OK) {
    if (target.memory) {
      // Any confirmed hauler delivery means logistics has recovered for this
      // consumer. Clear the self-supply fallback immediately, even when the
      // transfer is partial, or the consumer remains falsely critical and
      // re-enters self-harvest on its next empty cycle.
      target.memory.waitingEnergyTicks = 0;
      target.memory.logisticsFallback = false;
    }

    if (freeEnergyCapacity(target) <= 0) {
      if (target.memory) delete target.memory.lastHaulerDeliveryTick;
      clearConsumerTarget(creep);
    } else if (target.memory && typeof Game !== 'undefined' && Number.isFinite(Game.time)) {
      // Partial delivery is still useful productive energy. Mark it explicitly
      // so role.worker can resume work on the next consumer turn without
      // mistaking self-harvest/fallback energy for a logistics delivery.
      target.memory.lastHaulerDeliveryTick = Game.time;
    }
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
  if (rc === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 8, maxOps: config.PATH_MAX_OPS, visualizePathStyle: { stroke: '#ffffff' } });
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
  shouldPrioritizeConsumer,
  shouldRescueConsumer,
  clearConsumerTarget,
  _test: {
    consumerPriority,
    consumerEnergyRatio,
    selectConsumerTarget,
    currentConsumerTarget,
    haulerReadyToDeliver,
    selectConsumerGuardHauler,
    selectConsumerGuardHaulers,
    rescueInfrastructureSafe,
    selectConsumerRescueHauler
  }
};
