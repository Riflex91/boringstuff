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
let lastMoveOpts = null;

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

let cpuUsed = 0;
global.Game = {
  time: 100,
  creeps: {},
  cpu: {
    bucket: 10000,
    getUsed() {
      cpuUsed += 1;
      return cpuUsed;
    }
  },
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

const config = require('../game/config.js');
const scout = require('../game/role.scout.js');

const creep = {
  name: 'primary-scout',
  room,
  memory: { role: 'scout', home: 'E1N1', born: 1 },
  pos: {
    findClosestByRange() {
      return { x: 25, y: 0, roomName: room.name };
    }
  },
  moveTo(target, opts) {
    moveCalls += 1;
    lastMoveOpts = opts;
    return 0;
  }
};
Game.creeps[creep.name] = creep;

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
assert.equal(lastMoveOpts.reusePath, 50);
assert.equal(lastMoveOpts.maxOps, config.PATH_MAX_OPS);
assert.equal(Memory.bot.worldIntel.rooms.E1N1.observation.lastSeenTick, 100);
assert.equal(Memory.bot.cpu.details['scout.legacy-intel'].lastTick, 100);
assert.equal(Memory.bot.cpu.details['scout.world-intel'].lastTick, 100);
assert.equal(Memory.bot.cpu.details['scout.target'].lastTick, 100);
assert.equal(Memory.bot.cpu.details['scout.move'].lastTick, 100);

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
assert.equal(Memory.bot.cpu.details['scout.world-intel'].lastTick, 100);
assert.equal(Memory.bot.cpu.details['scout.legacy-intel'].lastTick, 101);
assert.equal(Memory.bot.cpu.details['scout.target'].lastTick, 101);
assert.equal(Memory.bot.cpu.details['scout.move'].lastTick, 101);

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
assert.equal(Memory.bot.cpu.details['scout.world-intel'].lastTick, 126);

{
  // Extra scouts from the same home colony remain passive. The oldest scout
  // stays active, matching the single-scout spawn policy.
  const extra = {
    name: 'extra-scout',
    room,
    memory: { role: 'scout', home: 'E1N1', born: 2 },
    pos: creep.pos,
    moveTo() {
      moveCalls += 1;
      return 0;
    }
  };
  Game.creeps[extra.name] = extra;
  const beforeFinds = { ...finds };
  const beforeMoves = moveCalls;
  scout.run(extra);
  assert.equal(scout._test.isActiveScout(creep), true);
  assert.equal(scout._test.isActiveScout(extra), false);
  assert.deepEqual(finds, beforeFinds);
  assert.equal(moveCalls, beforeMoves);
}

console.log('scout role tests passed');


{
  // Reproduce Newbieland's I4 starvation: legacy scout Memory.intel was just
  // refreshed, but the full I0 source/claim evidence is older than the
  // 150-tick route preflight. The scout must revisit that stale I0 room
  // before a neighbor whose full I0 evidence is still genuinely fresh.
  const oldMemory=Memory.bot.worldIntel.rooms;
  Memory.bot.worldIntel.rooms={
    E1N1:oldMemory.E1N1,
    E1N2:{schemaVersion:1,roomName:'E1N2',
      observation:{lastSeenTick:10,confidence:1,source:'scout'}},
    E2N1:{schemaVersion:1,roomName:'E2N1',
      observation:{lastSeenTick:199,confidence:1,source:'visible-room'}}
  };
  Game.time=200;
  Memory.intel.E1N2={tick:199};
  Memory.intel.E2N1={tick:150};
  assert.equal(scout._test.expansionRouteIntelFresh('E1N2'),false);
  assert.equal(scout._test.expansionRouteIntelFresh('E2N1'),true);
  creep.memory.targetRoom=null;
  scout.run(creep);
  assert.equal(creep.memory.targetRoom,'E1N2',
    'fresh legacy summaries must not suppress expired full I0 evidence');

  // Exactly 150 ticks old remains eligible; the next tick is stale.
  Memory.bot.worldIntel.rooms.E1N2.observation.lastSeenTick=50;
  assert.equal(scout._test.expansionRouteIntelFresh('E1N2'),true);
  Memory.bot.worldIntel.rooms.E1N2.observation.lastSeenTick=49;
  assert.equal(scout._test.expansionRouteIntelFresh('E1N2'),false);

  // Low-confidence migrated data and future-dated timestamps cannot
  // satisfy the I4 route-intel window.
  Memory.bot.worldIntel.rooms.E1N2.observation.lastSeenTick=200;
  Memory.bot.worldIntel.rooms.E1N2.observation.confidence=0.5;
  Memory.bot.worldIntel.rooms.E1N2.observation.source='legacy-memory-intel';
  assert.equal(scout._test.expansionRouteIntelFresh('E1N2'),false);
  Memory.bot.worldIntel.rooms.E1N2.observation.confidence=1;
  Memory.bot.worldIntel.rooms.E1N2.observation.source='scout';
  Memory.bot.worldIntel.rooms.E1N2.observation.lastSeenTick=201;
  assert.equal(scout._test.expansionRouteIntelFresh('E1N2'),false);

  // A later repaired high-quality observation stops unnecessary priority
  // and retains the bounded fallback patrol.
  Memory.bot.worldIntel.rooms.E1N2.observation.lastSeenTick=200;
  creep.memory.targetRoom=null;
  scout.run(creep);
  assert.ok(['E1N2','E2N1'].includes(creep.memory.targetRoom));
  assert.equal(scout._test.EXPANSION_ROUTE_INTEL_MAX_AGE,150);
  Memory.bot.worldIntel.rooms=oldMemory;
}

{
  // Do not actively scout a closed/novice room when a normal neighbor exists.
  const originalStatus=Game.map.getRoomStatus;
  Game.map.getRoomStatus=name=>({status:name==='E1N2'?'closed':'normal'});
  assert.deepEqual(scout._test.usableAdjacentRooms('E1N1'),['E2N1']);
  const movedBefore=moveCalls;
  creep.memory.targetRoom=null;
  scout.run(creep);
  assert.equal(creep.memory.targetRoom,'E2N1');
  assert.equal(moveCalls,movedBefore+1);
  Game.map.getRoomStatus=originalStatus;
}
