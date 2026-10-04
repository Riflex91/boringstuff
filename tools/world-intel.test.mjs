import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.FIND_SOURCES = 1;
global.FIND_MINERALS = 2;
global.FIND_STRUCTURES = 3;
global.FIND_HOSTILE_CREEPS = 4;

const worldIntel = require('../game/world.intel.js');

function makeRoom(name, hostileCount = 0) {
  const sources = [
    { id: 's1', pos: { x: 10, y: 20, roomName: name } },
    { id: 's2', pos: { x: 40, y: 30, roomName: name } }
  ];
  const minerals = [
    { id: 'm1', mineralType: 'H', pos: { x: 25, y: 25, roomName: name } }
  ];
  const structures = [
    { structureType: 'road', my: false },
    { structureType: 'spawn', my: true },
    { structureType: 'extension', my: true }
  ];
  const hostiles = Array.from({ length: hostileCount }, (_, i) => ({ id: 'h' + i }));
  return {
    name,
    controller: {
      my: false,
      level: 3,
      owner: { username: 'Enemy' },
      reservation: { username: 'Enemy', ticksToEnd: 1200 },
      safeMode: 50,
      pos: { x: 20, y: 20, roomName: name }
    },
    find(type) {
      if (type === FIND_SOURCES) return sources;
      if (type === FIND_MINERALS) return minerals;
      if (type === FIND_STRUCTURES) return structures;
      if (type === FIND_HOSTILE_CREEPS) return hostiles;
      return [];
    }
  };
}

{
  const memory = {};
  const game = {
    time: 1000,
    rooms: {},
    map: {
      describeExits() { return { 1: 'E1N2', 3: 'E2N1' }; },
      getRoomStatus() { return { status: 'normal' }; }
    }
  };
  const room = makeRoom('E1N1', 2);
  game.rooms[room.name] = room;
  global.Game = game;

  const record = worldIntel.observeRoom(room, memory, game, 'test-visible');
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.roomName, 'E1N1');
  assert.equal(record.observation.lastSeenTick, 1000);
  assert.equal(record.observation.confidence, 1);
  assert.equal(record.observation.source, 'test-visible');
  assert.equal(record.classification.roomStatus, 'normal');
  assert.equal(record.controller.exists, true);
  assert.equal(record.controller.owner, 'Enemy');
  assert.equal(record.controller.reservationOwner, 'Enemy');
  assert.equal(record.controller.reservationTicks, 1200);
  assert.equal(record.resources.sourceCount, 2);
  assert.equal(record.resources.sources[0].pos.roomName, 'E1N1');
  assert.equal(record.resources.mineral.type, 'H');
  assert.equal(record.topology.exits.length, 2);
  assert.equal(record.structures.count, 3);
  assert.equal(record.structures.byType.road, 1);
  assert.equal(record.structures.ownedByType.spawn, 1);
  assert.equal(record.threat.hostileCreeps, 2);
  assert.equal(record.threat.lastHostileTick, 1000);

  const fresh = worldIntel.freshness('E1N1', 1100, 1500, memory);
  assert.deepEqual(fresh, { known: true, fresh: true, age: 100, confidence: 1 });
  const stale = worldIntel.freshness('E1N1', 2601, 1500, memory);
  assert.equal(stale.known, true);
  assert.equal(stale.fresh, false);
  assert.equal(stale.age, 1601);

  // No hostiles later: preserve historical lastHostileTick.
  game.time = 1200;
  const clearRoom = makeRoom('E1N1', 0);
  const clear = worldIntel.observeRoom(clearRoom, memory, game, 'test-visible');
  assert.equal(clear.threat.hostileCreeps, 0);
  assert.equal(clear.threat.lastHostileTick, 1000);

  const json = JSON.stringify(clear);
  assert.equal(typeof json, 'string');
  assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(json), 'find'), false);
}

{
  const memory = {
    intel: {
      W1N1: {
        tick: 500,
        owner: null,
        reservation: 'Friend',
        sources: 1,
        hostileCreeps: 3
      }
    }
  };
  const game = {
    time: 900,
    map: {
      describeExits() { return { 5: 'W1N2' }; },
      getRoomStatus() { return { status: 'normal' }; }
    }
  };
  global.Game = game;

  const migrated = worldIntel.migrateLegacy(memory, game);
  assert.equal(migrated, 1);
  const record = worldIntel.get('W1N1', memory);
  assert.equal(record.observation.confidence, 0.5);
  assert.equal(record.observation.source, 'legacy-memory-intel');
  assert.equal(record.controller.exists, null);
  assert.equal(record.controller.owner, null);
  assert.equal(record.controller.reservationOwner, 'Friend');
  assert.equal(record.resources.sourceCount, 1);
  assert.equal(record.resources.sources.length, 0);
  assert.equal(record.threat.hostileCreeps, 3);
  assert.equal(record.threat.lastHostileTick, 500);

  // Existing VNext record is never overwritten by legacy migration.
  memory.intel.W1N1.tick = 800;
  assert.equal(worldIntel.migrateLegacy(memory, game), 0);
  assert.equal(worldIntel.get('W1N1', memory).observation.lastSeenTick, 500);
}

{
  const memory = {};
  const game = { time: 20, rooms: {}, map: {} };
  global.Game = game;
  const roomA = makeRoom('E2N2', 0);
  const roomB = makeRoom('E2N3', 0);
  game.rooms[roomB.name] = roomB;
  game.rooms[roomA.name] = roomA;
  const records = worldIntel.observeVisibleRooms(game, memory);
  assert.equal(records.length, 2);
  assert.equal(records[0].roomName, 'E2N2');
  assert.equal(records[1].roomName, 'E2N3');
  assert.equal(records[0].classification.roomStatus, null);
  assert.equal(records[0].topology.exits.length, 0);
  assert.equal(worldIntel.snapshot(memory).roomCount, 2);
}

{
  const memory = {};
  global.Game = { time: 77 };
  const unknown = worldIntel.freshness('NO_ROOM', undefined, undefined, memory);
  assert.deepEqual(unknown, { known: false, fresh: false, age: null, confidence: 0 });
}

console.log('world intel tests passed');