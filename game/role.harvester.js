'use strict';

const logger = require('logger');
const energy = require('energy');
const config = require('config');

function replacementHorizon(creep) {
  // Match the replacement's *actual* observed body spawn duration without
  // creating an extra body plan or invoking expensive room pathfinding.
  // Missing, malformed or implausible body evidence disables this preference.
  const parts=Array.isArray(creep?.body)?creep.body.length:null;
  if (!Number.isSafeInteger(parts) || parts < 1 || parts > 50) return 0;
  const spawnPerPart=typeof CREEP_SPAWN_TIME !== 'undefined' &&
    Number.isSafeInteger(CREEP_SPAWN_TIME) && CREEP_SPAWN_TIME > 0 &&
    CREEP_SPAWN_TIME <= 10 ? CREEP_SPAWN_TIME : 3;
  return parts*spawnPerPart+3;
}

function chooseSource(creep) {
  if (creep.memory.sourceId) {
    const existing = Game.getObjectById(creep.memory.sourceId);
    if (existing) return existing;
  }
  const sources = creep.room.find(FIND_SOURCES);
  if (!sources.length) return null;
  const counts = {},futureCounts = {};
  const horizon=replacementHorizon(creep);
  creep.room.find(FIND_MY_CREEPS).forEach(c => {
    if (c.memory.role !== 'harvester' || !c.memory.sourceId) return;
    const id=c.memory.sourceId;
    counts[id]=(counts[id]||0)+1;
    // A miner about to expire is still working now, but will not cover the
    // next miner's source once the new body arrives. Prefer that source when
    // assigning one incoming harvester. Existing assignments never change.
    const retiring=horizon>0 && Number.isFinite(c.ticksToLive) &&
      c.ticksToLive>=0 && c.ticksToLive<=horizon;
    if (!retiring) futureCounts[id]=(futureCounts[id]||0)+1;
  });
  // Most urgent gap in future source coverage first; if equal, preserve the
  // original least-currently-assigned policy. Never move existing miners.
  sources.sort((a,b)=>(futureCounts[a.id]||0)-(futureCounts[b.id]||0) ||
    (counts[a.id]||0)-(counts[b.id]||0));
  creep.memory.sourceId=sources[0].id;
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

module.exports = { run, _test: { chooseSource, replacementHorizon } };
