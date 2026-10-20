'use strict';

function get(room) {
  const creeps = room.find(FIND_MY_CREEPS);
  const hostileCreeps = room.find(FIND_HOSTILE_CREEPS);
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
  const structures = room.find(FIND_STRUCTURES);
  const sources = room.find(FIND_SOURCES);
  // Keep all owned spawns available to the legacy spawn manager. The
  // original primary spawn remains unchanged for recovery/health callers.
  const ownedSpawns = room.find(FIND_MY_SPAWNS);
  const energyStored = structures.reduce((sum, s) => {
    if (!s.store) return sum;
    return sum + (s.store[RESOURCE_ENERGY] || 0);
  }, 0);

  const byRole = {};
  creeps.forEach(c => { byRole[c.memory.role || 'unknown'] = (byRole[c.memory.role || 'unknown'] || 0) + 1; });

  return {
    room,
    rcl: room.controller ? room.controller.level : 0,
    creeps,
    byRole,
    hostileCreeps,
    sites,
    structures,
    sources,
    energyStored,
    energyAvailable: room.energyAvailable,
    energyCapacityAvailable: room.energyCapacityAvailable,
    emergency: creeps.filter(c => c.getActiveBodyparts(WORK) > 0 && c.getActiveBodyparts(CARRY) > 0).length === 0,
    spawn: ownedSpawns[0],
    spawns: ownedSpawns,
    towers: room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER })
  };
}

module.exports = { get };
