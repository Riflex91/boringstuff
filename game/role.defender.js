'use strict';

const config = require('config');

function run(creep) {
  const hostile = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS, { maxOps: config.PATH_MAX_OPS });
  if (hostile) {
    const rc = creep.attack(hostile);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(hostile, { reusePath: 3, maxRooms: 1, maxOps: config.PATH_MAX_OPS });
    return;
  }
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && creep.pos.getRangeTo(spawn) > 3) creep.moveTo(spawn, { reusePath: 10, maxOps: config.PATH_MAX_OPS });
}

module.exports = { run };
