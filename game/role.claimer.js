'use strict';

const config = require('config');
const ROOM = /^[WE]\d+[NS]\d+$/;

// The I4 claimer is an executor for a *separately authorized* autonomous
// expansion mission. It cannot choose a target or grant claim authority.
function verifiedMission(creep, memory) {
  const m = memory && memory.bot && memory.bot.expansionClaim;
  if (!creep || !creep.memory || !m || m.schemaVersion !== 1 ||
      m.phase !== 'CLAIMING' || m.id !== creep.memory.claimMissionId ||
      creep.memory.role !== 'claimer' ||
      !ROOM.test(m.parent || '') || !ROOM.test(m.target || '') ||
      m.parent === m.target ||
      !Array.isArray(m.route) || m.route.length < 2 || m.route.length > 4 ||
      m.route[0] !== m.parent || m.route[m.route.length - 1] !== m.target ||
      new Set(m.route).size !== m.route.length ||
      m.route.some(x => !ROOM.test(x)) ||
      !Number.isSafeInteger(m.createdTick) || m.createdTick < 0 ||
      !Number.isSafeInteger(Game.time) ||
      Game.time < m.createdTick || Game.time - m.createdTick > 900)
    return null;
  return m;
}

function abort(m, reason) {
  m.phase = 'ABORTED';
  m.reason = reason;
  m.abortTick = Game.time;
}

function retreat(creep, parent) {
  // Never approach enemy ownership to salvage a failed claim mission.
  if (creep.room.name === parent) return;
  const dir = Game.map && Game.map.findExit
    ? Game.map.findExit(creep.room.name, parent) : -1;
  if (!Number.isInteger(dir) || dir < 0) return;
  const exit = creep.pos.findClosestByRange(dir);
  if (exit) creep.moveTo(exit,{
    maxRooms:1,reusePath:5,maxOps:config.PATH_MAX_OPS
  });
}

function roomUnsafe(room) {
  if (!room || typeof room.find !== 'function') return true;
  const enemies = room.find(FIND_HOSTILE_CREEPS);
  if (!Array.isArray(enemies) || enemies.length) return true;
  if (typeof FIND_HOSTILE_STRUCTURES !== 'undefined') {
    const structures = room.find(FIND_HOSTILE_STRUCTURES);
    if (!Array.isArray(structures) || structures.length) return true;
  }
  return false;
}

function run(creep) {
  const m = verifiedMission(creep,Memory);
  if (!m) return;
  const home = Game.rooms && Game.rooms[m.parent];
  if (!home || !home.controller || home.controller.my !== true ||
      (Number(home.controller.safeMode) || 0) > 0 ||
      (Number(home.controller.safeModeCooldown) || 0) > 0 ||
      roomUnsafe(home)) {
    abort(m,'PARENT_DEFENSE_OR_VISION_UNSAFE');
    retreat(creep,m.parent);
    return;
  }
  const index = m.route.indexOf(creep.room.name);
  if (index < 0 || roomUnsafe(creep.room)) {
    abort(m,'UNVERIFIED_ROUTE_OR_HOSTILE');
    retreat(creep,m.parent);
    return;
  }
  if (index < m.route.length - 1) {
    const next = m.route[index+1];
    const dir = Game.map && typeof Game.map.findExit === 'function'
      ? Game.map.findExit(creep.room.name,next) : -1;
    if (!Number.isInteger(dir) || dir < 0) {
      abort(m,'ROUTE_EXIT_UNAVAILABLE');
      return;
    }
    const exit = creep.pos.findClosestByRange(dir);
    if (!exit) {
      abort(m,'ROUTE_EXIT_UNREACHABLE');
      return;
    }
    creep.moveTo(exit,{
      reusePath:10,maxRooms:1,maxOps:config.PATH_MAX_OPS
    });
    return;
  }
  const controller = creep.room.controller;
  if (!controller || controller.owner || controller.reservation) {
    if (controller && controller.my === true) {
      m.phase='CLAIMED';
      m.confirmedTick=Game.time;
      return;
    }
    abort(m,'TARGET_NO_LONGER_NEUTRAL');
    retreat(creep,m.parent);
    return;
  }
  if (controller.my === true) {
    m.phase='CLAIMED';
    m.confirmedTick=Game.time;
    return;
  }
  if (controller.level !== 0 || !controller.pos ||
      typeof creep.claimController !== 'function') {
    abort(m,'TARGET_CONTROLLER_INVALID');
    return;
  }
  const owned = Object.values(Game.rooms||{}).filter(room =>
    room && room.controller && room.controller.my === true).length;
  if (!Game.gcl || !Number.isSafeInteger(Game.gcl.level) ||
      Game.gcl.level <= owned || owned >= 3) {
    abort(m,'OWNERSHIP_CAPACITY_EXHAUSTED');
    retreat(creep,m.parent);
    return;
  }
  const rc = creep.claimController(controller);
  if (rc === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller,{
      reusePath:8,maxRooms:1,maxOps:config.PATH_MAX_OPS
    });
  } else if (rc !== OK && rc !== ERR_BUSY) {
    abort(m,'CLAIM_INTENT_REJECTED');
  }
  // OK is only an accepted intent. Ownership is checked next tick, never
  // inferred from a return code.
}

module.exports={run,_test:{verifiedMission,roomUnsafe,retreat}};
