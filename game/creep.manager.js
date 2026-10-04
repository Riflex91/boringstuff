'use strict';

const logger = require('logger');
const harvester = require('role.harvester');
const hauler = require('role.hauler');
const worker = require('role.worker');
const defender = require('role.defender');
const scout = require('role.scout');

const handlers = {
  harvester,
  hauler,
  worker,
  builder: worker,
  repairer: worker,
  upgrader: worker,
  defender,
  scout
};

function runCreep(creep) {
  if (creep.spawning) return;
  const role = creep.memory.role || 'worker';
  const handler = handlers[role];
  if (!handler) {
    logger.warn('UNKNOWN_ROLE', 'Unknown creep role; falling back to worker', { creep: creep.name, role, room: creep.room.name }, { dedupeTicks: 100 });
    worker.run(creep);
    return;
  }
  try {
    handler.run(creep);
  } catch (err) {
    logger.error('CREEP_EXCEPTION', 'Creep role threw an exception', err, { creep: creep.name, role, room: creep.room.name });
  }
}

function runAll() {
  for (const name in Game.creeps) runCreep(Game.creeps[name]);
}

module.exports = { runAll };
