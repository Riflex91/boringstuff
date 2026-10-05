'use strict';

const config = require('config');
const worldIntel = require('world.intel');
const profiler = require('profiler');

function adjacentRooms(roomName) {
  const exits = Game.map.describeExits(roomName) || {};
  return Object.keys(exits).map(k => exits[k]);
}

function worldIntelNeedsRefresh(roomName) {
  return !worldIntel.freshness(roomName, Game.time, config.INTEL_INTERVAL).fresh;
}

function scoutHome(creep) {
  return creep && creep.memory && creep.memory.home
    ? creep.memory.home
    : (creep && creep.room ? creep.room.name : null);
}

function activeScoutName(homeRoom) {
  let best = null;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (!creep || !creep.memory || creep.memory.role !== 'scout') continue;
    if (scoutHome(creep) !== homeRoom) continue;
    const born = Number.isFinite(creep.memory.born) ? creep.memory.born : Number.MAX_SAFE_INTEGER;
    const candidate = { name, born };
    if (!best || candidate.born < best.born ||
      (candidate.born === best.born && candidate.name < best.name)) {
      best = candidate;
    }
  }
  return best ? best.name : null;
}

function isActiveScout(creep) {
  const home = scoutHome(creep);
  return !!home && activeScoutName(home) === creep.name;
}

function run(creep) {
  if (!isActiveScout(creep)) return;
  if (!Memory.intel) Memory.intel = {};
  const room = creep.room;

  profiler.detailSection('scout.legacy-intel', function() {
    Memory.intel[room.name] = {
      tick: Game.time,
      owner: room.controller && room.controller.owner ? room.controller.owner.username : null,
      reservation: room.controller && room.controller.reservation ? room.controller.reservation.username : null,
      sources: room.find(FIND_SOURCES).length,
      hostileCreeps: room.find(FIND_HOSTILE_CREEPS).length
    };
  });

  // The global world-intel process refreshes visible rooms on INTEL_INTERVAL.
  // Only force a scout-side full snapshot when that shared record is stale.
  if (worldIntelNeedsRefresh(room.name)) {
    profiler.detailSection('scout.world-intel', function() {
      worldIntel.observeRoom(room, undefined, Game, 'scout');
    });
  }

  profiler.detailSection('scout.target', function() {
    if (!creep.memory.targetRoom || creep.room.name === creep.memory.targetRoom) {
      const adjacent = adjacentRooms(room.name);
      const candidates = adjacent.filter(r => !Memory.intel[r] || Game.time - Memory.intel[r].tick > 1500);
      creep.memory.targetRoom = candidates[0] || adjacent[Game.time % Math.max(1, adjacent.length)];
    }
  });

  profiler.detailSection('scout.move', function() {
    if (creep.memory.targetRoom) {
      const exitDir = Game.map.findExit(room.name, creep.memory.targetRoom);
      if (exitDir >= 0) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit) creep.moveTo(exit, { reusePath: 20 });
      }
    }
  });
}

module.exports = { run, _test: { adjacentRooms, worldIntelNeedsRefresh, scoutHome, activeScoutName, isActiveScout } };
