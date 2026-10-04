'use strict';

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_AGE = 1500;

function ensure(memoryRoot) {
  memoryRoot = memoryRoot || (typeof Memory !== 'undefined' ? Memory : null);
  if (!memoryRoot) return { schemaVersion: SCHEMA_VERSION, rooms: {} };
  if (!memoryRoot.bot) memoryRoot.bot = {};
  if (!memoryRoot.bot.worldIntel || memoryRoot.bot.worldIntel.schemaVersion !== SCHEMA_VERSION) {
    memoryRoot.bot.worldIntel = { schemaVersion: SCHEMA_VERSION, rooms: {} };
  }
  if (!memoryRoot.bot.worldIntel.rooms) memoryRoot.bot.worldIntel.rooms = {};
  return memoryRoot.bot.worldIntel;
}

function posSnapshot(pos) {
  if (!pos) return null;
  return { x: pos.x, y: pos.y, roomName: pos.roomName || null };
}

function username(value) {
  return value && value.username ? String(value.username) : null;
}

function controllerSnapshot(room) {
  const c = room && room.controller;
  return {
    exists: !!c,
    my: !!(c && c.my),
    level: c && Number.isFinite(c.level) ? c.level : null,
    owner: c ? username(c.owner) : null,
    reservationOwner: c && c.reservation ? username(c.reservation) : null,
    reservationTicks: c && c.reservation && Number.isFinite(c.reservation.ticksToEnd) ? c.reservation.ticksToEnd : null,
    safeMode: c && Number.isFinite(c.safeMode) ? c.safeMode : null,
    pos: c ? posSnapshot(c.pos) : null
  };
}

function sourceSnapshot(room) {
  if (!room || typeof room.find !== 'function') return [];
  const sources = room.find(FIND_SOURCES) || [];
  return sources.map(source => ({
    id: source.id || null,
    pos: posSnapshot(source.pos)
  }));
}

function mineralSnapshot(room) {
  if (!room || typeof room.find !== 'function' || typeof FIND_MINERALS === 'undefined') return null;
  const minerals = room.find(FIND_MINERALS) || [];
  if (!minerals.length) return null;
  const mineral = minerals[0];
  return {
    id: mineral.id || null,
    type: mineral.mineralType || null,
    pos: posSnapshot(mineral.pos)
  };
}

function exitSnapshot(roomName, game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const map = game && game.map;
  if (!map || typeof map.describeExits !== 'function') return [];
  const exits = map.describeExits(roomName) || {};
  return Object.keys(exits).sort().map(direction => ({
    direction: Number(direction),
    roomName: exits[direction]
  }));
}

function structureSnapshot(room) {
  if (!room || typeof room.find !== 'function') return { count: 0, byType: {}, ownedByType: {} };
  const structures = room.find(FIND_STRUCTURES) || [];
  const byType = {};
  const ownedByType = {};
  for (const structure of structures) {
    const type = String(structure.structureType || 'unknown');
    byType[type] = (byType[type] || 0) + 1;
    if (structure.my) ownedByType[type] = (ownedByType[type] || 0) + 1;
  }
  return { count: structures.length, byType, ownedByType };
}

function threatSnapshot(room) {
  if (!room || typeof room.find !== 'function') return { hostileCreeps: 0, lastObservedHostileTick: null };
  const hostiles = room.find(FIND_HOSTILE_CREEPS) || [];
  return {
    hostileCreeps: hostiles.length,
    lastObservedHostileTick: hostiles.length && typeof Game !== 'undefined' ? Game.time : null
  };
}

function roomStatus(roomName, game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const map = game && game.map;
  if (!map || typeof map.getRoomStatus !== 'function') return null;
  try {
    const value = map.getRoomStatus(roomName);
    return value && value.status ? String(value.status) : null;
  } catch (err) {
    return null;
  }
}

function observeRoom(room, memoryRoot, game, source) {
  if (!room || !room.name) return null;
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const store = ensure(memoryRoot);
  const tick = game && Number.isFinite(game.time) ? game.time : null;
  const threat = threatSnapshot(room);
  const previous = store.rooms[room.name] || null;

  const record = {
    schemaVersion: SCHEMA_VERSION,
    roomName: room.name,
    observation: {
      lastSeenTick: tick,
      confidence: 1,
      source: source || 'visible-room'
    },
    classification: {
      roomStatus: roomStatus(room.name, game)
    },
    controller: controllerSnapshot(room),
    resources: {
      sources: sourceSnapshot(room),
      sourceCount: 0,
      mineral: mineralSnapshot(room)
    },
    topology: {
      exits: exitSnapshot(room.name, game)
    },
    structures: structureSnapshot(room),
    threat: {
      hostileCreeps: threat.hostileCreeps,
      lastHostileTick: threat.hostileCreeps
        ? tick
        : (previous && previous.threat ? previous.threat.lastHostileTick || null : null)
    },
    economics: {
      remoteScore: previous && previous.economics ? previous.economics.remoteScore || null : null,
      expansionRoomQuality: previous && previous.economics ? previous.economics.expansionRoomQuality || null : null,
      dynamicScoreTick: previous && previous.economics ? previous.economics.dynamicScoreTick || null : null
    }
  };
  record.resources.sourceCount = record.resources.sources.length;
  store.rooms[room.name] = record;
  return record;
}

function observeVisibleRooms(game, memoryRoot) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  if (!game || !game.rooms) return [];
  const observed = [];
  const names = Object.keys(game.rooms).sort();
  for (const name of names) {
    const record = observeRoom(game.rooms[name], memoryRoot, game, 'visible-room');
    if (record) observed.push(record);
  }
  return observed;
}

function migrateLegacy(memoryRoot, game) {
  memoryRoot = memoryRoot || (typeof Memory !== 'undefined' ? Memory : null);
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const store = ensure(memoryRoot);
  if (!memoryRoot || !memoryRoot.intel) return 0;
  let migrated = 0;

  for (const roomName in memoryRoot.intel) {
    if (store.rooms[roomName]) continue;
    const old = memoryRoot.intel[roomName] || {};
    store.rooms[roomName] = {
      schemaVersion: SCHEMA_VERSION,
      roomName,
      observation: {
        lastSeenTick: Number.isFinite(old.tick) ? old.tick : null,
        confidence: 0.5,
        source: 'legacy-memory-intel'
      },
      classification: { roomStatus: roomStatus(roomName, game) },
      controller: {
        exists: old.owner !== undefined || old.reservation !== undefined,
        my: false,
        level: null,
        owner: old.owner || null,
        reservationOwner: old.reservation || null,
        reservationTicks: null,
        safeMode: null,
        pos: null
      },
      resources: {
        sources: [],
        sourceCount: Number.isFinite(old.sources) ? old.sources : 0,
        mineral: null
      },
      topology: { exits: exitSnapshot(roomName, game) },
      structures: { count: null, byType: {}, ownedByType: {} },
      threat: {
        hostileCreeps: Number.isFinite(old.hostileCreeps) ? old.hostileCreeps : 0,
        lastHostileTick: Number.isFinite(old.hostileCreeps) && old.hostileCreeps > 0 && Number.isFinite(old.tick) ? old.tick : null
      },
      economics: { remoteScore: null, expansionRoomQuality: null, dynamicScoreTick: null }
    };
    migrated += 1;
  }
  return migrated;
}

function get(roomName, memoryRoot) {
  const store = ensure(memoryRoot);
  return store.rooms[roomName] || null;
}

function freshness(roomName, nowTick, maxAge, memoryRoot) {
  const record = get(roomName, memoryRoot);
  maxAge = Number.isFinite(maxAge) ? Math.max(0, maxAge) : DEFAULT_MAX_AGE;
  if (!record || !record.observation || !Number.isFinite(record.observation.lastSeenTick)) {
    return { known: false, fresh: false, age: null, confidence: 0 };
  }
  const age = Math.max(0, Number(nowTick) - record.observation.lastSeenTick);
  return {
    known: true,
    fresh: age <= maxAge,
    age,
    confidence: Number.isFinite(record.observation.confidence) ? record.observation.confidence : 0
  };
}

function snapshot(memoryRoot) {
  const store = ensure(memoryRoot);
  return {
    schemaVersion: store.schemaVersion,
    roomCount: Object.keys(store.rooms).length
  };
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_MAX_AGE,
  ensure,
  observeRoom,
  observeVisibleRooms,
  migrateLegacy,
  get,
  freshness,
  snapshot,
  _test: {
    posSnapshot,
    controllerSnapshot,
    sourceSnapshot,
    mineralSnapshot,
    exitSnapshot,
    structureSnapshot,
    threatSnapshot,
    roomStatus
  }
};