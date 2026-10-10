'use strict';

const energy = require('energy');
const config = require('config');

function run(creep) {
  if (creep.memory.delivering && creep.store[RESOURCE_ENERGY] === 0) {
    creep.memory.delivering = false;
    energy.clearConsumerTarget(creep);
  }
  if (!creep.memory.delivering && creep.store.getFreeCapacity() === 0) creep.memory.delivering = true;

  if (!creep.memory.delivering) {
    const capacity = creep.store.getCapacity(RESOURCE_ENERGY) || 0;
    const carried = creep.store[RESOURCE_ENERGY] || 0;
    if (carried >= Math.max(50, Math.floor(capacity * 0.5))) creep.memory.delivering = true;
  }

  if (!creep.memory.delivering) {
    // New active behavior: when hard infrastructure is healthy and another
    // ready hauler is reserved for it, deliver partial loads to genuinely
    // starved consumers rather than waiting to fill CARRY to 50%.
    // Do not flip delivering: the guard is reevaluated each tick and will
    // immediately relinquish the reservation if infrastructure deteriorates.
    if (energy.shouldRescueConsumer(creep) && energy.deliverToConsumer(creep)) return;
    energy.clearConsumerTarget(creep);
    if (!energy.acquireForHauler(creep)) {
      const sourceContainers = creep.room.find(FIND_STRUCTURES, {
        filter: s => energy.isSourceContainer(creep.room, s)
      });
      const sourceContainer = creep.pos.findClosestByPath(sourceContainers, { maxOps: config.PATH_MAX_OPS });
      if (sourceContainer) {
        creep.moveTo(sourceContainer, { reusePath: 10, maxOps: config.PATH_MAX_OPS });
        return;
      }
      const harvester = creep.pos.findClosestByPath(FIND_MY_CREEPS, { maxOps: config.PATH_MAX_OPS, filter: c => c.memory.role === 'harvester' });
      if (harvester) creep.moveTo(harvester, { reusePath: 10, maxOps: config.PATH_MAX_OPS });
    }
    return;
  }

  // Hard infrastructure remains the default first priority. With redundant
  // hauling, selected starvation guards may serve waiting/fallbacking consumers
  // before spawn/extensions. Guard selection always leaves at least one live
  // hauler outside the guard set for hard infrastructure, preserving recovery
  // safety while a third hauler can service a second critical consumer.
  const consumerGuard = energy.shouldPrioritizeConsumer(creep);
  if (consumerGuard && energy.deliverToConsumer(creep)) return;

  if (energy.deliver(creep)) {
    energy.clearConsumerTarget(creep);
    return;
  }
  if (!consumerGuard && energy.deliverToConsumer(creep)) return;
  energy.clearConsumerTarget(creep);
  if (energy.deliverToControllerBuffer(creep)) return;

  const storage = creep.room.storage;
  if (storage) {
    const rc = creep.transfer(storage, RESOURCE_ENERGY);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(storage, { reusePath: 10, maxOps: config.PATH_MAX_OPS });
    return;
  }

  if (creep.room.controller) creep.moveTo(creep.room.controller, { reusePath: 10, range: 3, maxOps: config.PATH_MAX_OPS });
}

module.exports = { run };
