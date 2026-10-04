'use strict';

function run(creep) {
  const hostile = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
  if (hostile) {
    const rc = creep.attack(hostile);
    if (rc === ERR_NOT_IN_RANGE) creep.moveTo(hostile, { reusePath: 3, maxRooms: 1 });
    return;
  }
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && creep.pos.getRangeTo(spawn) > 3) creep.moveTo(spawn, { reusePath: 10 });
}

module.exports = { run };
