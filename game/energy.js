'use strict';

const config = require('config');
const consumerSupplyObserver = require('consumer.supply.observer');

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

// Only override a distant dropped-energy trip when a source container
// nearby can supply at least half a normal load (minimum 100 energy).
// Compare cheap tile ranges, not an additional expensive path search.
// This is a bounded optimization: if the preferred container is stale or
// unreachable, regular drop/alternate-source failover still applies.
function nearbyFundedSourceContainer(creep, dropped) {
  if (!dropped || !creep || !creep.pos ||
      typeof creep.pos.getRangeTo !== 'function') return null;
  const dropRange = creep.pos.getRangeTo(dropped);
  if (!Number.isSafeInteger(dropRange) || dropRange <= 10) return null;
  const store = creep.store;
  const capacity = store && typeof store.getCapacity === 'function'
    ? Number(store.getCapacity(RESOURCE_ENERGY)) : 0;
  const minimum = Math.max(100,
    Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity * 0.5) : 0);
  const containers = creep.room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_CONTAINER &&
      energyAmount(s) >= minimum && isSourceContainer(creep.room,s)
  });
  let chosen = null;
  let nearest = 6;
  for (const candidate of containers) {
    const range = creep.pos.getRangeTo(candidate);
    if (Number.isSafeInteger(range) && range < nearest) {
      chosen = candidate;
      nearest = range;
    }
  }
  consumerSupplyObserver.recordLongDropChoice(creep, !!chosen);
  return chosen;
}

function acquireForHauler(creep) {
  const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
    maxOps: config.PATH_MAX_OPS,
    filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 0
  });
  const preferredContainer = nearbyFundedSourceContainer(creep, dropped);
  let preferredContainerFailed = false;
  if (preferredContainer) {
    const rc = creep.withdraw(preferredContainer, RESOURCE_ENERGY);
    consumerSupplyObserver.recordHaulerAcquisition(creep, 'container', rc);
    if (rc === ERR_NOT_IN_RANGE) {
      const moveRc = creep.moveTo(preferredContainer, {
        reusePath: 8, maxOps: config.PATH_MAX_OPS,
        visualizePathStyle: { stroke: '#ffaa00' }
      });
      consumerSupplyObserver.recordAcquisitionTravel(
        creep, preferredContainer, moveRc, 'container');
      if (moveRc !== ERR_NO_PATH && moveRc !== ERR_INVALID_TARGET)
        return true;
    } else if (rc !== ERR_NOT_ENOUGH_RESOURCES &&
               rc !== ERR_INVALID_TARGET) {
      return true;
    }
    preferredContainerFailed = true;
  }
  if (dropped) {
    const rc = creep.pickup(dropped);
    consumerSupplyObserver.recordHaulerAcquisition(creep, 'drop', rc);
    if (rc === ERR_NOT_IN_RANGE) {
      const moveRc = creep.moveTo(dropped, {
        reusePath: 8, maxOps: config.PATH_MAX_OPS,
        visualizePathStyle: { stroke: '#ffaa00' }
      });
      consumerSupplyObserver.recordAcquisitionTravel(creep, dropped, moveRc, 'drop');
      if (moveRc !== ERR_NO_PATH && moveRc !== ERR_INVALID_TARGET)
        return true;
    } else if (rc !== ERR_NOT_ENOUGH_RESOURCES &&
               rc !== ERR_INVALID_TARGET) {
      return true;
    }
    // A permanently unreachable or stale drop cannot hold a hauler idle.
    // Fall through to an alternative source container or tombstone, never
    // after an accepted pickup or a viable in-flight movement intent.
  }

  const containers = creep.room.find(FIND_STRUCTURES, {
    filter: s => (!preferredContainerFailed || s !== preferredContainer) &&
      isSourceContainer(creep.room, s) && energyAmount(s) > 0
  });
  const container = creep.pos.findClosestByPath(containers, { maxOps: config.PATH_MAX_OPS });
  if (container) {
    const rc = creep.withdraw(container, RESOURCE_ENERGY);
    consumerSupplyObserver.recordHaulerAcquisition(creep, 'container', rc);
    if (rc === ERR_NOT_IN_RANGE) {
      const moveRc = creep.moveTo(container, {
        reusePath: 8, maxOps: config.PATH_MAX_OPS,
        visualizePathStyle: { stroke: '#ffaa00' }
      });
      consumerSupplyObserver.recordAcquisitionTravel(creep, container, moveRc, 'container');
      if (moveRc !== ERR_NO_PATH && moveRc !== ERR_INVALID_TARGET)
        return true;
    } else if (rc !== ERR_NOT_ENOUGH_RESOURCES &&
               rc !== ERR_INVALID_TARGET) {
      return true;
    }
    // Concurrent pickups can empty a filtered source container before this
    // hauler's withdrawal intent. A permanent path failure has the same
    // effect. Only these terminal outcomes may fall through to a tombstone;
    // accepted withdrawals and viable/in-flight movement never do so.
  }

  const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, { maxOps: config.PATH_MAX_OPS, filter: t => (t.store[RESOURCE_ENERGY] || 0) > 0 });
  if (tomb) {
    const rc = creep.withdraw(tomb, RESOURCE_ENERGY);
    consumerSupplyObserver.recordHaulerAcquisition(creep, 'tomb', rc);
    if (rc === ERR_NOT_IN_RANGE) {
      const moveRc = creep.moveTo(tomb, { reusePath: 8, maxOps: config.PATH_MAX_OPS });
      consumerSupplyObserver.recordAcquisitionTravel(creep, tomb, moveRc, 'tomb');
      return moveRc !== ERR_NO_PATH && moveRc !== ERR_INVALID_TARGET;
    }
    return rc !== ERR_NOT_ENOUGH_RESOURCES && rc !== ERR_INVALID_TARGET;
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
    if (rc === OK) return true;
    if (rc === ERR_NOT_IN_RANGE) return creep.moveTo(localDrop, { reusePath: 5, maxOps: config.PATH_MAX_OPS }) === OK;
    return false;
  }

  // An upgrader works at controller range. If its controller-side buffer
  // is funded, use it BEFORE storage: the old storage-first branch could send
  // a productive upgrader across the room while a nearby buffer was ready.
  // This helper is called only during the hauler-assisted acquisition phase;
  // no hauler mission or storage reservation is created here.
  if (creep.memory.role === 'upgrader' && creep.room.controller) {
    const controllerContainers = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 1, {
      filter: s => s.structureType === STRUCTURE_CONTAINER && energyAmount(s) > 0
    });
    const target = creep.pos.findClosestByPath(controllerContainers, { maxOps: config.PATH_MAX_OPS });
    if (target) {
      const rc = creep.withdraw(target, RESOURCE_ENERGY);
      if (rc === OK) return true;
      if (rc === ERR_NOT_IN_RANGE) return creep.moveTo(target, { reusePath: 8, maxOps: config.PATH_MAX_OPS }) === OK;
      // A transiently emptied buffer does not prevent the next safe local
      // option; no accepted movement or withdrawal occurred on this path.
    }
  }

  const storage=creep.room.storage;
  // Read range exactly once; invalid or negative readings cannot authorize
  // even a short optional detour away from the controller.
  const storageRange=storage && typeof creep.pos.getRangeTo === 'function'
    ? creep.pos.getRangeTo(storage) : null;
  const localUpgraderStorage=creep.memory.role !== 'upgrader' ||
    (Number.isSafeInteger(storageRange) && storageRange >= 0 && storageRange <= 4);
  // Do not send an empty upgrader on a long trek back to central storage
  // while live haulers are already serving controller-side consumers.
  // Keep the legacy ordinary-worker path. A genuinely starved upgrader
  // still retains the existing bounded self-supply fallback after 12 ticks.
  if (storage && localUpgraderStorage && energyAmount(storage) > 0) {
    const rc = creep.withdraw(storage, RESOURCE_ENERGY);
    if (rc === OK) return true;
    if (rc === ERR_NOT_IN_RANGE) return creep.moveTo(storage, { reusePath: 8, maxOps: config.PATH_MAX_OPS }) === OK;
    return false;
  }
  return false;
}

// During an armed room assault, refill an under-half-charged tower before
// ordinary extensions. The spawn remains strictly first so defenders,
// harvesters and recovery bodies can still be spawned. Harmless scouts cannot
// change infrastructure priority, and this never bypasses infrastructure to
// serve optional consumer work.
function armedHostilePresent(room) {
  if (!room || typeof room.find !== 'function' ||
      typeof FIND_HOSTILE_CREEPS === 'undefined') return false;
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  return Array.isArray(hostiles) && hostiles.some(h =>
    h && Array.isArray(h.body) &&
    h.body.some(p => p && p.hits > 0 &&
      (p.type === 'attack' || p.type === 'ranged_attack' ||
       p.type === 'work' || p.type === 'heal')));
}

function needsCombatTowerRefill(structure) {
  if (!structure || structure.structureType !== STRUCTURE_TOWER ||
      !structure.store || typeof structure.store.getCapacity !== 'function')
    return false;
  const cap = Number(structure.store.getCapacity(RESOURCE_ENERGY));
  const energy = Number(structure.store[RESOURCE_ENERGY]);
  return Number.isFinite(cap) && cap > 0 &&
    Number.isFinite(energy) && energy >= 0 && energy < cap * 0.5;
}

// D7: keep a larger *loaded Tower ammunition reserve* in an actual
// observed armed siege, without spending the energy necessary to spawn
// defender/harvester replacements. Below 50% remains the D1 emergency.
function towerBelowSiegeReserve(structure) {
  if(!structure || structure.structureType!==STRUCTURE_TOWER ||
     !structure.store || typeof structure.store.getCapacity!=='function')
    return false;
  const cap=Number(structure.store.getCapacity(RESOURCE_ENERGY));
  const amount=Number(structure.store[RESOURCE_ENERGY]);
  return Number.isFinite(cap) && cap>0 &&
    Number.isFinite(amount) && amount>=0 && amount < cap*0.8;
}
function safeProactiveTowerRefill(room) {
  if(!room || !Number.isFinite(room.energyAvailable) ||
     !Number.isFinite(room.energyCapacityAvailable) ||
     room.energyCapacityAvailable<=0)return false;
  return room.energyAvailable>=Math.max(300,
    room.energyCapacityAvailable*0.8);
}
// D17: During an authenticated ACTIVE assault on an actual owned
// Spawn/Tower/Storage, an explicitly exhausted Safe Mode stock warrants a
// slightly earlier Tower ammunition refill. Require >=50% *actual available*
// room energy (and >=300), protecting defender/harvester spawn viability.
// This does NOT authorize proactive refill on distant scouts, heal-only
// strangers, phantom core targets, unknown safe-mode stock or stale intel.
// Strict small scan bounds prevent CPU spirals under mass-hostile pressure.
function noSafeModeCoreTowerRefill(room) {
  const controller=room?.controller;
  if(!controller?.my || controller.safeModeAvailable!==0 ||
     controller.safeMode || !Number.isFinite(room.energyAvailable) ||
     !Number.isFinite(room.energyCapacityAvailable) ||
     room.energyCapacityAvailable<=0 ||
     room.energyAvailable<Math.max(300,
       room.energyCapacityAvailable*0.5) ||
     typeof room.find!=='function' ||
     typeof FIND_MY_STRUCTURES==='undefined' ||
     typeof FIND_HOSTILE_CREEPS==='undefined')return false;
  let structures,hostiles;
  try{
    structures=room.find(FIND_MY_STRUCTURES);
    hostiles=room.find(FIND_HOSTILE_CREEPS);
  }catch(_){return false;}
  if(!Array.isArray(structures)||structures.length>400 ||
     !Array.isArray(hostiles)||!hostiles.length||hostiles.length>40)
    return false;
  const critical=structures.filter(s=>s?.my===true && s.pos &&
    (s.structureType===STRUCTURE_SPAWN ||
     s.structureType===STRUCTURE_TOWER ||
     s.structureType===STRUCTURE_STORAGE));
  if(!critical.length||critical.length>16)return false;
  for(const h of hostiles) {
    if(!h?.pos||typeof h.pos.getRangeTo!=='function' ||
       !Array.isArray(h.body)||h.body.length>50)continue;
    for(const target of critical){
      let range;
      try{range=h.pos.getRangeTo(target);}catch(_){continue;}
      if(!Number.isSafeInteger(range)||range<0||range>3)continue;
      for(const part of h.body){
        if(!part||!(part.hits>0))continue;
        if((range<=1&&(part.type==='attack'||part.type==='work'))||
           (range<=3&&part.type==='ranged_attack'))return true;
      }
    }
  }
  return false;
}

function siegeTowerReserveDeficit(room) {
  if(!armedHostilePresent(room))return false;
  if(typeof FIND_MY_STRUCTURES==='undefined')return true;
  let structures;
  try {structures=room.find(FIND_MY_STRUCTURES);}
  catch (_) {return true;}
  if(!Array.isArray(structures) || structures.length>400)return true;
  return structures.some(s=>s?.structureType===STRUCTURE_TOWER &&
    (!s.store || typeof s.store.getCapacity!=='function' ||
     !Number.isFinite(Number(s.store.getCapacity(RESOURCE_ENERGY))) ||
     towerBelowSiegeReserve(s)));
}

function deliveryTargets(creep) {
  const targets = creep.room.find(FIND_MY_STRUCTURES, {
    filter: s => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION || s.structureType === STRUCTURE_TOWER) && freeEnergyCapacity(s) > 0
  });
  const combatPressure = armedHostilePresent(creep.room);
  // Read the expensive bounded D17 core threat ONCE per hauler decision,
  // never once per target; ordinary D7 stays unchanged with Safe Mode or
  // uncertain room data. Spawn remains strictly above every Tower.
  const proactiveCombatRefill=combatPressure &&
    (safeProactiveTowerRefill(creep.room) ||
      noSafeModeCoreTowerRefill(creep.room));
  const priority = s => s.structureType === STRUCTURE_SPAWN ? 0 :
    combatPressure && needsCombatTowerRefill(s) ? 1 :
    proactiveCombatRefill && towerBelowSiegeReserve(s) ? 1 :
    s.structureType === STRUCTURE_EXTENSION ? 2 : 3;
  targets.sort((a, b) =>
    priority(a) - priority(b) ||
    creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b));
  return targets;
}

function deliver(creep) {
  const targets = deliveryTargets(creep);
  if (!targets.length) return false;

  // A permanently unreachable spawn/extension can otherwise monopolize the
  // infrastructure hauler forever. Retry at most ONE alternative structure
  // after an explicit terminal target/path failure; preserve the hard
  // infrastructure reserve and the bounded legacy PathFinder budget.
  for (let i = 0; i < Math.min(2, targets.length); i++) {
    const target = targets[i];
    const rc = creep.transfer(target, RESOURCE_ENERGY);
    consumerSupplyObserver.recordResult(creep, 'infrastructure', rc);
    if (rc === OK) return true;
    if (rc === ERR_NOT_IN_RANGE) {
      const moveRc = creep.moveTo(target, {
        reusePath: 10, maxOps: config.PATH_MAX_OPS,
        visualizePathStyle: { stroke: '#ffffff' }
      });
      if ((typeof ERR_NO_PATH !== 'undefined' && moveRc === ERR_NO_PATH) ||
          (typeof ERR_INVALID_TARGET !== 'undefined' &&
           moveRc === ERR_INVALID_TARGET)) continue;
      return true;
    }
    if ((typeof ERR_INVALID_TARGET !== 'undefined' && rc === ERR_INVALID_TARGET) ||
        (typeof ERR_FULL !== 'undefined' && rc === ERR_FULL)) continue;
    // All other return codes are not authoritative proof that an alternative
    // target would be safe. Do not divert the protected hauler to consumers.
    return true;
  }
  // Two terminal attempts still leave hard infrastructure as the priority.
  // Never misinterpret a failed move as an accepted delivery.
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
      other.memory.consumerTargetId === c.id &&
      haulerReadyToDeliver(other)))
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
  // When Towers are under the 80% reserve during an actual armed siege,
  // all ready carriers serve Spawn/extension/Tower logistics. No optional
  // consumer guards may siphon loaded carriers from defense ammunition.
  // Once reserve recovers, historical critical-consumer rescue resumes.
  if (siegeTowerReserveDeficit(room)) return [];
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

  // Protect a delivery-READY infrastructure carrier, not merely a living
  // hauler. Previously a nonready/empty hauler counted as the reserve and
  // the sole loaded carrier could be diverted while spawn/extensions starved.
  // A partial-load rescuer above remains the only one-ready exception, and
  // is already gated on FULL spawn/extensions and healthy tower reserves.
  if (ready.length <= 1) return [];
  const maxGuards = Math.min(
    critical.length,
    ready.length - 1,
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
  // A ready hauler should be compared against critical consumers not already
  // covered by a selected sticky guard. This avoids spending the last guard
  // slot near a request that already has a delivery-ready reservation.
  const uncovered = critical.filter(c => !coveredReservedTargets.has(c.id));
  const distanceTargets = uncovered.length ? uncovered : critical;
  remaining.sort((a, b) => {
    const rangeA = Math.min.apply(null, distanceTargets.map(c => a.pos && a.pos.getRangeTo ? a.pos.getRangeTo(c) : 999));
    const rangeB = Math.min.apply(null, distanceTargets.map(c => b.pos && b.pos.getRangeTo ? b.pos.getRangeTo(c) : 999));
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
  const selected = guards.some(guard => guard.id === creep.id);
  consumerSupplyObserver.recordGuard(creep, selected);
  return selected;
}

function shouldRescueConsumer(creep) {
  if (!creep || !creep.memory || creep.memory.role !== 'hauler' ||
      creep.memory.delivering || !creep.room) return false;
  const selected = selectConsumerGuardHaulers(creep.room)
    .some(guard => guard.id === creep.id);
  // Read-only diagnostic: a selected partial-load rescuer is intentionally
  // NOT delivery-ready under the regular >=50% guard. Report the selection
  // separately so post-intent gaps cannot be assumed to mean no rescue was
  // attempted. This never changes selection or creep intents.
  consumerSupplyObserver.recordRescue(creep, selected);
  return selected;
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
  let authorizedPartialRescuers = null;
  for (const hauler of haulers) {
    // Zero CARRY cannot honor a reservation, regardless of execution order.
    // A positive but underfilled collecting carrier also cannot honor one
    // UNLESS it is currently the selected partial-load rescue guard. Its
    // rescue eligibility may have disappeared since the previous tick when
    // spawn/extensions or tower reserves fell. Reclaim that obsolete claim
    // before an actually ready hauler chooses an urgent consumer.
    if (energyAmount(hauler) <= 0) {
      delete hauler.memory.consumerTargetId;
      continue;
    }
    if (!haulerReadyToDeliver(hauler)) {
      if (authorizedPartialRescuers === null) {
        authorizedPartialRescuers = new Set(
          selectConsumerGuardHaulers(creep.room)
            .filter(guard => !haulerReadyToDeliver(guard))
            .map(guard => guard.id)
        );
      }
      if (!authorizedPartialRescuers.has(hauler.id)) {
        delete hauler.memory.consumerTargetId;
        continue;
      }
    }
    reserved[hauler.memory.consumerTargetId] = true;
  }
  return reserved;
}

function selectConsumerTarget(creep, criticalOnly = false) {
  // v0.2.14 could have enough aggregate CARRY while consumers still entered
  // self-supply fallback. Two causes were visible in the implementation:
  // haulers topped off any partially used consumer, and several haulers could
  // chase the same high-priority builder. Only consumers that are actually
  // empty/waiting/fallbacking become delivery requests, and another live
  // hauler's reservation excludes that target from this selection.
  const reserved = consumerReservations(creep);
  const consumers = creep.room.find(FIND_MY_CREEPS, {
    filter: c => c.id !== creep.id &&
      (criticalOnly ? isCriticalConsumerRequest(c) : consumerNeedsDelivery(c)) &&
      !reserved[c.id]
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

    // Emergency guards reduce travel time for equally urgent consumers.
    // Preserve fallback, waiting age, emptiness and energy-ratio ordering;
    // only use locality before static role priority for critical requests.
    if (criticalOnly) {
      const distanceDelta = creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
      if (distanceDelta !== 0) return distanceDelta;
    }
    return consumerPriority(a) - consumerPriority(b) || creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
  });
  return consumers[0] || null;
}

function currentConsumerTarget(creep, criticalOnly = false) {
  const id = creep.memory.consumerTargetId;
  if (!id || typeof Game === 'undefined' || !Game.getObjectById) return null;
  const target = Game.getObjectById(id);
  if (!target || target.room !== creep.room || !consumerNeedsDelivery(target) ||
      (criticalOnly && !isCriticalConsumerRequest(target))) {
    delete creep.memory.consumerTargetId;
    return null;
  }
  return target;
}

function clearConsumerTarget(creep) {
  if (creep && creep.memory) delete creep.memory.consumerTargetId;
}

function deliverToConsumer(creep, criticalOnly = false) {
  // Emergency guards are authorized to bypass infrastructure only to serve
  // an actually waiting/fallbacking consumer. Revalidate the prior sticky
  // target because it can remain merely empty after its critical state clears.
  let target = currentConsumerTarget(creep, criticalOnly);
  if (!target) {
    target = selectConsumerTarget(creep, criticalOnly);
    if (!target) {
      clearConsumerTarget(creep);
      return false;
    }
    creep.memory.consumerTargetId = target.id;
  }

  const rc = creep.transfer(target, RESOURCE_ENERGY);
  consumerSupplyObserver.recordResult(creep, 'consumer', rc);
  if (rc === ERR_NOT_IN_RANGE) {
    const moveRc = creep.moveTo(target, {
      reusePath: 5, maxOps: config.PATH_MAX_OPS,
      visualizePathStyle: { stroke: '#ffffff' }
    });
    consumerSupplyObserver.recordConsumerTravel(creep, target, moveRc);
    // An impossible path cannot service the reserved consumer. Relinquish
    // this claim immediately so a different loaded hauler is not excluded
    // by an undeliverable sticky assignment. Do not treat transient fatigue,
    // busy movement, or a bounded route attempt as terminal failures.
    if ((typeof ERR_NO_PATH !== 'undefined' && moveRc === ERR_NO_PATH) ||
        (typeof ERR_INVALID_TARGET !== 'undefined' &&
         moveRc === ERR_INVALID_TARGET)) {
      clearConsumerTarget(creep);
      return false;
    }
    return true;
  }
  if (rc === OK) {
    // OK only accepts an intent, not a settled energy delivery. Preserve the
    // real waiting/fallback request and sticky reservation until the consumer
    // itself observes usable energy. This hint is NOT receipt evidence.
    if (target.memory && typeof Game !== 'undefined' &&
        Number.isSafeInteger(Game.time)) {
      const carriedNow = energyAmount(target);
      const priorTick = target.memory.lastHaulerIntentTick;
      const priorEnergy = target.memory.lastHaulerIntentEnergy;
      // When haulers run before consumers on consecutive ticks, do not
      // overwrite a still-unconsumed witness of the PREVIOUS tick's real
      // energy increase. Otherwise the new current-tick intent can hide the
      // actual earlier gain and prevent productive partial-load recovery.
      const previousGain = Number.isSafeInteger(priorTick) &&
        priorTick === Game.time - 1 &&
        Number.isSafeInteger(priorEnergy) && priorEnergy >= 0 &&
        carriedNow > priorEnergy;
      if (!previousGain) {
        target.memory.lastHaulerIntentTick = Game.time;
        // Record pre-settlement CARRY; positive CARRY by itself is not proof
        // that this particular transfer intent executed.
        target.memory.lastHaulerIntentEnergy = carriedNow;
      }
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
    selectConsumerRescueHauler,
    noSafeModeCoreTowerRefill
  }
};
