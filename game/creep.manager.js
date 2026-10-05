'use strict';

const logger = require('logger');
const harvester = require('role.harvester');
const hauler = require('role.hauler');
const worker = require('role.worker');
const defender = require('role.defender');
const scout = require('role.scout');
const profiler = require('profiler');

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
  const cpuByRole = {};
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    const role = creep && creep.memory && creep.memory.role ? creep.memory.role : 'worker';
    const start = Game.cpu.getUsed();
    runCreep(creep);
    const used = Math.max(0, Game.cpu.getUsed() - start);
    cpuByRole[role] = (cpuByRole[role] || 0) + used;
  }
  for (const role in cpuByRole) profiler.detailValue('creep.' + role, cpuByRole[role]);
  return cpuByRole;
}

module.exports = { runAll, _test: { runCreep } };
