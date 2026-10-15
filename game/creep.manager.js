'use strict';

const logger = require('logger');
const harvester = require('role.harvester');
const hauler = require('role.hauler');
const worker = require('role.worker');
const defender = require('role.defender');
const civilianEvacuation = require('defense.civilian.evacuate');
const spawnlessWorkerRescue = require('recovery.spawnless.worker');
const scout = require('role.scout');
const claimer = require('role.claimer');
const raider = require('role.raider');
const pioneer = require('role.pioneer');
const profiler = require('profiler');

const handlers = {
  harvester,
  hauler,
  worker,
  builder: worker,
  repairer: worker,
  upgrader: worker,
  defender,
  claimer,
  raider,
  pioneer,
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
    // Short-circuit productive jobs only when an observed nearby armed enemy
    // caused a successful real flee intent in our owned room.
    if(civilianEvacuation.run(creep,Game))return;
    // R2 movement precedes ordinary worker intents; onsite rescue labor
    // then uses existing work/energy handlers with no new special AI.
    if(spawnlessWorkerRescue.run(creep,Game,Memory))return;
    handler.run(creep);
  } catch (err) {
    logger.error('CREEP_EXCEPTION', 'Creep role threw an exception', err, { creep: creep.name, role, room: creep.room.name });
  }
}

function runAll(onHaulerRoleCpu) {
  const cpuByRole = {};
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    const role = creep && creep.memory && creep.memory.role ? creep.memory.role : 'worker';
    const start = Game.cpu.getUsed();
    runCreep(creep);
    const used = Math.max(0, Game.cpu.getUsed() - start);
    cpuByRole[role] = (cpuByRole[role] || 0) + used;
    // Reuse the original two CPU readings. Optional observer is side-effect
    // isolated and must never interrupt gameplay if diagnostics fail.
    if (role === 'hauler' && !creep.spawning &&
        typeof onHaulerRoleCpu === 'function' &&
        creep.room && typeof creep.room.name === 'string') {
      try { onHaulerRoleCpu(creep.room.name, used); } catch (_) { /* optional */ }
    }
  }
  for (const role in cpuByRole) profiler.detailValue('creep.' + role, cpuByRole[role]);
  return cpuByRole;
}

module.exports = { runAll, _test: { runCreep } };
