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

global.Memory = {};

const finds = { sources: 0, minerals: 0, structures: 0, hostiles: 0 };
let describeExitsCalls = 0;
let moveCalls = 0;

const room = {
  name: 'E1N1',
  controller: null,
  find(type) {
    if (type === FIND_SOURCES) {
      finds.sources += 1;
      return [{ id: 's1', pos: { x: 10, y: 10, roomName: this.name } }];
    }
    if (type === FIND_MINERALS) {
      finds.minerals += 1;
      return [];
    }
    if (type === FIND_STRUCTURES) {
      finds.structures += 1;
      return [];
    }
    if (type === FIND_HOSTILE_CREEPS) {
      finds.hostiles += 1;
      return [];
    }
    return [];
  }
};

global.Game = {
  time: 100,
  map: {
    describeExits() {
      describeExitsCalls += 1;
      return { 1: 'E1N2', 3: 'E2N1' };
    },
    getRoomStatus() {
      return { status: 'normal' };
    },
    findExit() {
      return 1;
    }
  }
};

const scout = require('../game/role.scout.js');

const creep = {
  room,
  memory: {},
  pos: {
    findClosestByRange() {
      return { x: 25, y: 0, roomName: room.name };
    }
  },
  moveTo() {
    moveCalls += 1;
    return 0;
  }
};

// First observation is stale/unknown, so the scout still creates full I0 intel.
scout.run(creep);
assert.equal(Memory.intel.E1N1.tick, 100);
assert.equal(creep.memory.targetRoom, 'E1N2');
assert.equal(finds.sources, 2);
assert.equal(finds.hostiles, 2);
assert.equal(finds.minerals, 1);
assert.equal(finds.structures, 1);
assert.equal(describeExitsCalls, 2);
assert.equal(moveCalls, 1);
assert.equal(Memory.bot.worldIntel.rooms.E1N1.observation.lastSeenTick, 100);

// Fresh shared world intel suppresses the duplicate full snapshot. Legacy scout
// intel remains current and target/movement behavior is unchanged.
Game.time = 101;
creep.memory.targetRoom = null;
const beforeTargetRefreshExits = describeExitsCalls;
scout.run(creep);
assert.equal(Memory.intel.E1N1.tick, 101);
assert.equal(creep.memory.targetRoom, 'E1N2');
assert.equal(finds.sources, 3);
assert.equal(finds.hostiles, 3);
assert.equal(finds.minerals, 1);
assert.equal(finds.structures, 1);
assert.equal(describeExitsCalls - beforeTargetRefreshExits, 1);
assert.equal(Memory.bot.worldIntel.rooms.E1N1.observation.lastSeenTick, 100);

// At exactly INTEL_INTERVAL age, the scheduled global pass is due later in the
// same tick, so the scout does not duplicate it.
Game.time = 125;
scout.run(creep);
assert.equal(finds.minerals, 1);
assert.equal(finds.structures, 1);

// If the shared record actually becomes older than INTEL_INTERVAL, the scout
// refreshes it as a fallback.
Game.time = 126;
scout.run(creep);
assert.equal(finds.minerals, 2);
assert.equal(finds.structures, 2);
assert.equal(Memory.bot.worldIntel.rooms.E1N1.observation.lastSeenTick, 126);

console.log('scout role tests passed');
