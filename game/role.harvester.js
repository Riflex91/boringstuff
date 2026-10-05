'use strict';

const logger = require('logger');
const energy = require('energy');
const config = require('config');

function chooseSource(creep) {
  if (creep.memory.sourceId) {
    const existing = Game.getObjectById(creep.memory.sourceId);
    if (existing) return existing;
  }
  const sources = creep.room.find(FIND_SOURCES);
  if (!sources.length) return null;
  const counts = {};
  creep.room.find(FIND_MY_CREEPS).forEach(c => {
    if (c.memory.role === 'harvester' && c.memory.sourceId) counts[c.memory.sourceId] = (counts[c.memory.sourceId] || 0) + 1;
  });
  sources.sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0));
  creep.memory.sourceId = sources[0].id;
  return sources[0];
}

function hasLiveHauler(room) {
  return room.find(FIND_MY_CREEPS, {
    filter: c => !c.spawning && c.memory.role === 'hauler'
  }).length > 0;
}

function run(creep) {
  const source = chooseSource(creep);
  if (!source) return;

  if (creep.store.getFreeCapacity() > 0) {
    const rc = creep.harvest(source);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(source, { reusePath: 20, maxOps: config.PATH_MAX_OPS, visualizePathStyle: { stroke: '#ffaa00' } });
    else if (rc !== OK && rc !== ERR_NOT_ENOUGH_RESOURCES) logger.warn('HARVEST_RC', 'Harvester action returned error', { creep: creep.name, room: creep.room.name, rc });
    return;
  }

  const nearbyContainer = source.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: s => s.structureType === STRUCTURE_CONTAINER && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  })[0];
  if (nearbyContainer) {
    const rc = creep.transfer(nearbyContainer, RESOURCE_ENERGY);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(nearbyContainer, { reusePath: 10, maxOps: config.PATH_MAX_OPS });
    return;
  }

  // Phase 2A transition: once a hauler is alive, harvesters stop long trips to
  // the spawn. They leave energy at the source for logistics pickup. Without a
  // hauler they keep the v0.2.8 mobile-bootstrap fallback so the colony cannot
  // deadlock during spawn/replacement gaps.
  if (hasLiveHauler(creep.room)) {
    const dropped = creep.drop(RESOURCE_ENERGY);
    if (dropped !== OK) logger.warn('HARVEST_DROP_RC', 'Harvester could not stage energy for hauler', { creep: creep.name, room: creep.room.name, rc: dropped });
    return;
  }

  if (energy.deliver(creep)) return;

  const dropped = creep.drop(RESOURCE_ENERGY);
  if (dropped !== OK) logger.warn('HARVEST_DROP_RC', 'Harvester could not drop energy', { creep: creep.name, room: creep.room.name, rc: dropped });
}

module.exports = { run };
