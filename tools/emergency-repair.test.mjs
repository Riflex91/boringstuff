import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.RESOURCE_ENERGY = 'energy';
global.STRUCTURE_SPAWN = 'spawn';
global.STRUCTURE_EXTENSION = 'extension';
global.STRUCTURE_TOWER = 'tower';
global.STRUCTURE_STORAGE = 'storage';
global.STRUCTURE_CONTAINER = 'container';
global.STRUCTURE_LINK = 'link';
global.STRUCTURE_TERMINAL = 'terminal';
global.STRUCTURE_ROAD = 'road';
global.STRUCTURE_RAMPART = 'rampart';
global.STRUCTURE_WALL = 'constructedWall';
global.FIND_STRUCTURES = 1;
global.FIND_MY_CREEPS = 2;
global.FIND_MY_SPAWNS = 3;
global.FIND_MY_CONSTRUCTION_SITES = 4;
global.FIND_DROPPED_RESOURCES = 5;
global.FIND_TOMBSTONES = 6;
global.FIND_RUINS = 7;
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.ERR_BUSY = -4;
global.WORK = 'work';
global.CARRY = 'carry';
global.MOVE = 'move';
global.BODYPART_COST = { work: 100, carry: 50, move: 50 };
global.CREEP_SPAWN_TIME = 3;
global.Memory = { creeps: {} };
global.Game = { time: 92100, creeps: {} };

const priority = require('../game/work.priority.js');
const workerRole = require('../game/role.worker.js');
const spawnManager = require('../game/spawn.manager.js');
const config = require('../game/config.js');

function structure(id, type, hits, max = 1000, my = true) {
  return { id, structureType: type, hits, hitsMax: max, my };
}

const spawn = structure('spawn', STRUCTURE_SPAWN, 200);
const tower = structure('tower', STRUCTURE_TOWER, 100);
const storage = structure('storage', STRUCTURE_STORAGE, 10);
const road = structure('road', STRUCTURE_ROAD, 1);
const wall = structure('wall', STRUCTURE_WALL, 1, 100000);
assert.deepEqual(priority.emergencyRepairTargets([road, wall, storage, tower, spawn]),
  [spawn], 'a near road/storage/tower must not displace an endangered spawn');
assert.deepEqual(priority.emergencyRepairTargets([storage, tower]), [tower],
  'tower protects the room before storage');
assert.deepEqual(priority.emergencyRepairTargets([storage, road]), [storage]);
assert.equal(priority.hasEmergencyRepair([road, wall]), false);
assert.equal(priority.isEmergencyRepair(structure('hostile', STRUCTURE_SPAWN, 50, 1000, false)), false);
assert.equal(priority.isEmergencyRepair(structure('unknown', STRUCTURE_SPAWN, 1, NaN)), false);
assert.equal(priority.isEmergencyRepair(structure('zero', STRUCTURE_SPAWN, 0)), false);
assert.equal(priority.isEmergencyRepair(structure('healthy', STRUCTURE_SPAWN, 350)), false);
assert.equal(priority.isEmergencyRepair(structure('injured', STRUCTURE_SPAWN, 349)), true);
assert.deepEqual(priority.emergencyRepairTargets([
  structure('second', STRUCTURE_SPAWN, 300),
  structure('first', STRUCTURE_SPAWN, 100)
]).map(x => x.id), ['first', 'second']);

const activeRoom = {
  name: 'E8N1',
  controller: { level: 3 },
  sites: [{ id: 'extension-site', structureType: STRUCTURE_EXTENSION }],
  structures: [road, tower, spawn],
  haulers: [{ memory: { role: 'hauler' }, spawning: false },
    { memory: { role: 'hauler' }, spawning: false }],
  find(type, options) {
    let values;
    if (type === FIND_STRUCTURES) values = this.structures;
    else if (type === FIND_MY_CREEPS) values = this.haulers;
    else if (type === FIND_MY_CONSTRUCTION_SITES) values = this.sites;
    else throw new Error('Unexpected find ' + type);
    return options && options.filter ? values.filter(options.filter) : values.slice();
  }
};
let actions = [];
let moved = null;
const builder = {
  room: activeRoom,
  memory: { role: 'builder', working: true },
  store: { energy: 100, getFreeCapacity: () => 0 },
  pos: {
    findClosestByPath(list, options) {
      assert.equal(options.maxOps, config.PATH_MAX_OPS);
      return list[0] || null;
    }
  },
  repair(target) { actions.push('repair:' + target.id); return ERR_NOT_IN_RANGE; },
  build(target) { actions.push('build:' + target.id); return OK; },
  moveTo(target, options) { moved = { target, options }; return OK; }
};
workerRole.run(builder);
assert.deepEqual(actions, ['repair:spawn'],
  'builder must save a critical spawn before new construction');
assert.equal(moved.target, spawn);
assert.equal(moved.options.maxOps, config.PATH_MAX_OPS);
assert.equal(moved.options.reusePath, 10);

// With no critical infrastructure, original build-first behavior is preserved.
actions = [];
spawn.hits = 500;
tower.hits = 500;
workerRole.run(builder);
assert.deepEqual(actions, ['build:extension-site']);
spawn.hits = 200;
tower.hits = 100;

// Worker and repairer roles also receive emergency triage. Upgraders retain
// their controller assignment and are not diverted onto repairs.
for (const role of ['worker', 'repairer']) {
  actions = [];
  builder.memory.role = role;
  workerRole.run(builder);
  assert.deepEqual(actions, ['repair:spawn']);
}
builder.memory.role = 'upgrader';
builder.upgradeController = () => { actions.push('upgrade'); return OK; };
actions = [];
workerRole.run(builder);
assert.deepEqual(actions, ['upgrade']);
builder.memory.role = 'builder';

// If a threatened structure is unreachable, keep doing productive work.
actions = [];
const findOriginal = builder.pos.findClosestByPath;
builder.pos.findClosestByPath = (items, options) => {
  assert.equal(options.maxOps, config.PATH_MAX_OPS);
  return items.some(x => x.id === 'spawn') ? null : items[0];
};
workerRole.run(builder);
assert.deepEqual(actions, ['build:extension-site']);
builder.pos.findClosestByPath = findOriginal;

// When only one hauler survives, the original hard-infrastructure refill
// precedes emergency repair, preserving bootstrap recovery.
const energy = require('../game/energy.js');
const oldDeliver = energy.deliver;
const trace = [];
try {
  activeRoom.haulers.pop();
  energy.deliver = () => { trace.push('refill'); return true; };
  builder.repair = () => { trace.push('repair'); return OK; };
  workerRole.run(builder);
  assert.deepEqual(trace, ['refill']);
} finally {
  activeRoom.haulers.push({ memory: { role: 'hauler' }, spawning: false });
  energy.deliver = oldDeliver;
}

function spawnFixture() {
  const creeps = [
    { memory: { role: 'harvester' }, ticksToLive: 800 },
    { memory: { role: 'worker' }, ticksToLive: 800 },
    { memory: { role: 'hauler' }, ticksToLive: 800 }
  ];
  let spawned = null;
  const site = { id: 'site', structureType: STRUCTURE_EXTENSION };
  const spawnObject = {
    spawning: false,
    spawnCreep(parts, name, options) {
      spawned = { parts, name, options };
      return OK;
    }
  };
  const room = {
    name: 'E8N1',
    find(type, opts) {
      const values = type === FIND_MY_CREEPS ? creeps
        : type === FIND_MY_SPAWNS ? [spawnObject] : [];
      return opts?.filter ? values.filter(opts.filter) : values.slice();
    }
  };
  const state = {
    room, spawn: spawnObject,
    rcl: 3, energyAvailable: 800, energyCapacityAvailable: 800,
    energyStored: 300, sites: [site],
    structures: [structure('critical', STRUCTURE_SPAWN, 200)],
    hostileCreeps: [], sources: [{ id: 'source-1' }],
    economyModel: {
      recommendedHarvesterCount: 1, recommendedHarvesterWorkParts: 2,
      harvesterWorkParts: 2, recommendedHaulerCount: 1
    },
    economyMetrics: { energyCappedStreak: 0, spawnIdleStreak: 0 },
    emergency: false, byRole: {}
  };
  return { state, creeps, spawned: () => spawned };
}

{
  const fixture = spawnFixture();
  assert.equal(spawnManager.desired(fixture.state).repairer, 1);
  assert.equal(spawnManager.spawnOne(fixture.state), true);
  assert.equal(fixture.spawned().options.memory.role, 'repairer',
    'critical repairer must preempt builder and upgrader growth');
}
{
  const fixture = spawnFixture();
  fixture.creeps.splice(2, 1); // no hauler
  assert.equal(spawnManager.spawnOne(fixture.state), true);
  assert.equal(fixture.spawned().options.memory.role, 'hauler',
    'restore one transport carrier before emergency repairer');
}
{
  const fixture = spawnFixture();
  fixture.creeps.splice(1, 1); // no worker
  assert.equal(spawnManager.spawnOne(fixture.state), true);
  assert.equal(fixture.spawned().options.memory.role, 'worker',
    'retain essential worker before additional repairer');
}
{
  const fixture = spawnFixture();
  fixture.creeps.splice(0, 1); // no harvester
  assert.equal(spawnManager.spawnOne(fixture.state), true);
  assert.equal(fixture.spawned().options.memory.role, 'harvester',
    'restore mining before additional repairer');
}
{
  const fixture = spawnFixture();
  fixture.state.structures[0].hits = 450;
  assert.equal(spawnManager.desired(fixture.state).repairer, 1,
    'ordinary damage still uses existing dedicated repairer demand');
  assert.equal(spawnManager.spawnOne(fixture.state), true);
  assert.equal(fixture.spawned().options.memory.role, 'upgrader',
    'noncritical damage must retain old essential upgrader ordering');
}
{
  const fixture = spawnFixture();
  fixture.state.emergency = true;
  const want = spawnManager.desired(fixture.state);
  assert.equal(want.repairer, 0);
  assert.equal(spawnManager.spawnOne(fixture.state), false,
    'emergency bootstrap does not spawn an optional repairer');
}
console.log('active infrastructure repair triage and spawn dispatch PASS');
