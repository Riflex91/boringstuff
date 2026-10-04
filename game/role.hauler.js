'use strict';

const energy = require('energy');

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
    energy.clearConsumerTarget(creep);
    if (!energy.acquireForHauler(creep)) {
      const sourceContainers = creep.room.find(FIND_STRUCTURES, {
        filter: s => energy.isSourceContainer(creep.room, s)
      });
      const sourceContainer = creep.pos.findClosestByPath(sourceContainers);
      if (sourceContainer) {
        creep.moveTo(sourceContainer, { reusePath: 10 });
        return;
      }
      const harvester = creep.pos.findClosestByPath(FIND_MY_CREEPS, { filter: c => c.memory.role === 'harvester' });
      if (harvester) creep.moveTo(harvester, { reusePath: 10 });
    }
    return;
  }

  // Hard infrastructure remains the default first priority. v0.2.16 adds a
  // starvation guard: when at least two haulers exist and a productive creep
  // is already waiting/fallbacking, exactly one delivery-ready hauler serves
  // consumers before spawn/extensions. The rest of the fleet continues the
  // infrastructure refill, preserving recovery safety.
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
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(storage, { reusePath: 10 });
    return;
  }

  if (creep.room.controller) creep.moveTo(creep.room.controller, { reusePath: 10, range: 3 });
}

module.exports = { run };
