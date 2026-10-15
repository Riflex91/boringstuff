'use strict';

const config = require('config');
const worldIntel = require('world.intel');
const profiler = require('profiler');

// The I4 expansion operation accepts source/route intel for at most 150 ticks.
// Legacy scout Memory.intel may stay "fresh" for 1500 ticks: choosing the
// next scout target from that legacy TTL can starve the I4 frontier of valid
// controller, source, site and threat observations for much longer.
const EXPANSION_ROUTE_INTEL_MAX_AGE = 150;

function expansionRouteIntelFresh(roomName) {
  const record = worldIntel.get(roomName);
  const observation = record && record.observation;
  const age = Game.time - observation?.lastSeenTick;
  return record?.schemaVersion === 1 &&
    record.roomName === roomName &&
    Number.isSafeInteger(observation?.lastSeenTick) &&
    Number.isSafeInteger(Game.time) &&
    Number.isSafeInteger(age) && age >= 0 &&
    age <= EXPANSION_ROUTE_INTEL_MAX_AGE &&
    Number.isFinite(observation?.confidence) &&
    observation.confidence >= 0.95 &&
    (observation.source === 'scout' ||
     observation.source === 'visible-room');
}

function usableAdjacentRooms(roomName) {
  return adjacentRooms(roomName).filter(name => {
    if (typeof name !== 'string' ||
        !/^[WE][0-9]+[NS][0-9]+$/.test(name)) return false;
    const status = Game.map.getRoomStatus;
    if (typeof status !== 'function') return true;
    try {
      const observed = status.call(Game.map, name)?.status;
      return !observed || observed === 'normal';
    } catch (_) { return true; }
  });
}


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
      const adjacent = usableAdjacentRooms(room.name);
      // Prefer unverified/expired full I0 observations rather than 1500-tick
      // legacy summaries. Keep the old time-rotated patrol when all immediate
      // neighbors are already observed with recent high-confidence intel.
      const candidates = adjacent.filter(r => !expansionRouteIntelFresh(r));
      creep.memory.targetRoom = candidates[0] ||
        (adjacent.length ? adjacent[Game.time % adjacent.length] : null);
    }
  });

  profiler.detailSection('scout.move', function() {
    if (creep.memory.targetRoom) {
      const exitDir = Game.map.findExit(room.name, creep.memory.targetRoom);
      if (exitDir >= 0) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit) creep.moveTo(exit, { reusePath: 50, maxOps: config.PATH_MAX_OPS });
      }
    }
  });
}

module.exports = { run, _test: { adjacentRooms, usableAdjacentRooms,
  expansionRouteIntelFresh, EXPANSION_ROUTE_INTEL_MAX_AGE,
  worldIntelNeedsRefresh, scoutHome, activeScoutName, isActiveScout } };
