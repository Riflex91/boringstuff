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
global.FIND_MY_CREEPS = 1;
global.FIND_MY_STRUCTURES = 2;
global.FIND_STRUCTURES = 3;
global.STRUCTURE_SPAWN = 'spawn';
global.STRUCTURE_EXTENSION = 'extension';
global.STRUCTURE_TOWER = 'tower';
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.Game = { time: 2000, getObjectById: () => null };

const energy = require('../game/energy.js');
const role = require('../game/role.hauler.js');
const config = require('../game/config.js');

function store(capacity, amount) {
  return { energy: amount,
    getCapacity(resource) { assert.equal(resource, RESOURCE_ENERGY); return capacity; },
    getFreeCapacity() { return capacity - this.energy; }
  };
}
function room() {
  const r = {
    name: 'E8N1', energyAvailable: 1050, energyCapacityAvailable: 1050,
    creeps: [], structures: [],
    find(type, options) {
      const xs = type === FIND_MY_CREEPS ? this.creeps
        : type === FIND_MY_STRUCTURES ? this.structures : null;
      if (!xs) throw new Error('Unexpected find type ' + type);
      return options?.filter ? xs.filter(options.filter) : xs.slice();
    }
  };
  r.structures = [
    { structureType: STRUCTURE_SPAWN, store: store(300, 300) },
    { structureType: STRUCTURE_EXTENSION, store: store(50, 50) },
    { structureType: STRUCTURE_TOWER, store: store(1000, 600) }
  ];
  return r;
}
function makeHauler(id, r, energyAmount, range = 3) {
  return {
    id, name: id, room: r, spawning: false,
    memory: { role: 'hauler', delivering: false },
    store: store(300, energyAmount),
    pos: { getRangeTo() { return range; } },
    transfer() { return ERR_NOT_IN_RANGE; },
    moveTo() {}
  };
}
function consumer(id, r, waiting = 4, fallback = false) {
  return {
    id, room: r, spawning: false,
    memory: { role: 'worker', waitingEnergyTicks: waiting,
      logisticsFallback: fallback },
    store: store(100, 0),
    pos: { getRangeTo() { return 3; } }
  };
}
const r = room();
const ready = makeHauler('ready', r, 240);
ready.memory.delivering = true;
const partial = makeHauler('partial', r, 75);
const urgent = consumer('urgent', r, 4);
r.creeps = [ready, partial, urgent];
const objects = new Map([[urgent.id, urgent]]);
Game.getObjectById = id => objects.get(id) || null;

assert.equal(energy._test.haulerReadyToDeliver(partial), false);
assert.equal(energy._test.haulerReadyToDeliver(ready), true);
assert.equal(energy._test.rescueInfrastructureSafe(r), true);
assert.deepEqual(energy._test.selectConsumerGuardHaulers(r).map(c => c.id), ['partial']);
assert.equal(energy.shouldRescueConsumer(partial), true);
assert.equal(energy.shouldRescueConsumer(ready), false);
assert.equal(energy.shouldPrioritizeConsumer(ready), false,
  'infrastructure-ready hauler must remain outside consumer guards');

const regularDeliver = energy.deliver;
const regularConsumer = energy.deliverToConsumer;
const readyCalls = [];
try {
  energy.deliver = () => { readyCalls.push('infrastructure'); return true; };
  energy.deliverToConsumer = () => { readyCalls.push('consumer'); return true; };
  role.run(ready);
  assert.deepEqual(readyCalls, ['infrastructure'],
    'protected ready hauler must actually run infrastructure-first');
} finally {
  energy.deliver = regularDeliver;
  energy.deliverToConsumer = regularConsumer;
}


let target = null, moves = [];
partial.transfer = c => { target = c; return ERR_NOT_IN_RANGE; };
partial.moveTo = (c, options) => { moves.push({ c, options }); };
const originalAcquire = energy.acquireForHauler;
let acquisitions = 0;
energy.acquireForHauler = () => { acquisitions++; return true; };
try {
  role.run(partial);
  assert.equal(target, urgent, 'partially loaded hauler must issue consumer intent');
  assert.equal(partial.memory.consumerTargetId, urgent.id,
    'target reservation should be sticky across out-of-range rescue ticks');
  assert.equal(partial.memory.delivering, false,
    'rescue must not force normal delivery mode');
  assert.equal(moves.length, 1);
  assert.equal(moves[0].c, urgent);
  assert.equal(moves[0].options.maxOps, config.PATH_MAX_OPS);
  assert.equal(acquisitions, 0);

  Game.time++;
  role.run(partial);
  assert.equal(acquisitions, 0, 'unchanged safe conditions preserve active rescue');

  // A spawn refill event must immediately abort new rescue work.
  r.energyAvailable = 750;
  Game.time++;
  assert.equal(energy.shouldRescueConsumer(partial), false);
  role.run(partial);
  assert.equal(partial.memory.consumerTargetId, undefined,
    'fallback to normal acquisition must release consumer reservation');
  assert.equal(acquisitions, 1);
  r.energyAvailable = 1050;

  r.structures[2].store.energy = 499;
  assert.equal(energy.shouldRescueConsumer(partial), false,
    'tower below 50% forbids new diversion');
  r.structures[2].store.energy = 600;
  r.structures[2].store.getCapacity = () => undefined;
  assert.equal(energy.shouldRescueConsumer(partial), false,
    'unknown tower capacity must fail closed');
  r.structures[2].store = store(1000, 600);
  r.structures[0].store.energy = 200;
  assert.equal(energy.shouldRescueConsumer(partial), false,
    'spawn underfilled forbids new diversion');
  r.structures[0].store.energy = 300;

  // A single live hauler always retains infrastructure priority.
  r.creeps = [partial, urgent];
  assert.equal(energy.shouldRescueConsumer(partial), false);
  role.run(partial);
  assert.equal(acquisitions, 2);

  // A ready infrastructure hauler must really exist, not merely a live one.
  const anotherPartial = makeHauler('other-partial', r, 20);
  r.creeps = [partial, anotherPartial, urgent];
  assert.equal(energy.shouldRescueConsumer(partial), false);

  // Fresh empty consumers do not meet the emergency rescue threshold.
  r.creeps = [ready, partial, urgent];
  urgent.memory.waitingEnergyTicks = 0;
  assert.equal(energy.shouldRescueConsumer(partial), false);
  urgent.memory.waitingEnergyTicks = 2;
  assert.equal(energy.shouldRescueConsumer(partial), false);
  urgent.memory.waitingEnergyTicks = 3;
  assert.equal(energy.shouldRescueConsumer(partial), true);
  urgent.memory.waitingEnergyTicks = 0;
  urgent.memory.logisticsFallback = true;
  assert.equal(energy.shouldRescueConsumer(partial), true,
    'existing fallback remains urgent even when waiting ticks reset');
  urgent.memory.logisticsFallback = false;
  urgent.memory.waitingEnergyTicks = 4;

  // Too-small load must collect, not divert a 1-energy carrier.
  partial.store.energy = 20;
  assert.equal(energy.shouldRescueConsumer(partial), false);
  partial.store.energy = 75;

  // If an existing ready hauler reserved the only urgent consumer, do not
  // create a duplicate rescue assignment.
  ready.memory.consumerTargetId = urgent.id;
  assert.equal(energy.shouldRescueConsumer(partial), false);
  ready.memory.consumerTargetId = undefined;

  // Same-tick simultaneous candidates choose exactly one stable rescuer.
  const closer = makeHauler('closer', r, 75, 1);
  partial.pos.getRangeTo = () => 7;
  r.creeps = [ready, partial, closer, urgent];
  assert.deepEqual(energy._test.selectConsumerGuardHaulers(r).map(c => c.id),
    ['closer']);
  assert.equal(energy.shouldRescueConsumer(partial), false);
  assert.equal(energy.shouldRescueConsumer(closer), true);
  closer.memory.consumerTargetId = urgent.id;
  assert.equal(energy.shouldRescueConsumer(closer), true,
    'an existing valid rescue reservation outranks geometrical selection');
  closer.memory.consumerTargetId = undefined;

  r.creeps = [ready, partial, urgent];
  r.energyAvailable = undefined;
  assert.equal(energy.shouldRescueConsumer(partial), false,
    'unobservable infrastructure capacity must fail closed');

  // Existing normal guards still behave normally when rescue is ineligible.
  r.energyAvailable = 750;
  ready.memory.consumerTargetId = undefined;
  assert.deepEqual(energy._test.selectConsumerGuardHaulers(r).map(c => c.id),
    ['ready']);
} finally {
  energy.acquireForHauler = originalAcquire;
}
console.log('active consumer rescue behavior and infrastructure interlocks PASS');
