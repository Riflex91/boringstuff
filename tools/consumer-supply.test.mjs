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
global.FIND_MY_CONSTRUCTION_SITES = 2;
global.FIND_STRUCTURES = 3;
global.STRUCTURE_SPAWN = 'spawn';
global.STRUCTURE_EXTENSION = 'extension';
global.STRUCTURE_CONTAINER = 'container';
global.STRUCTURE_TOWER = 'tower';
global.STRUCTURE_STORAGE = 'storage';
global.STRUCTURE_LINK = 'link';
global.STRUCTURE_TERMINAL = 'terminal';
global.STRUCTURE_ROAD = 'road';
global.STRUCTURE_RAMPART = 'rampart';
global.STRUCTURE_WALL = 'wall';
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_FULL = -8;

const objects = new Map();
global.Game = {
  getObjectById(id) { return objects.get(id) || null; }
};

function makeStore(capacity, energy) {
  return {
    energy,
    getFreeCapacity(resource) {
      if (resource !== undefined) assert.equal(resource, RESOURCE_ENERGY);
      return capacity - this.energy;
    },
    getCapacity(resource) {
      if (resource !== undefined) assert.equal(resource, RESOURCE_ENERGY);
      return capacity;
    }
  };
}

const room = {
  creeps: [],
  sites: [],
  structures: [],
  find(type, opts) {
    let list;
    if (type === FIND_MY_CREEPS) list = this.creeps.slice();
    else if (type === FIND_MY_CONSTRUCTION_SITES) list = this.sites.slice();
    else if (type === FIND_STRUCTURES) list = this.structures.slice();
    else throw new Error(`unexpected find type: ${type}`);
    return opts && opts.filter ? list.filter(opts.filter) : list;
  }
};

function makeConsumer(id, role, energy, waiting = 0, fallback = false, range = 5) {
  const creep = {
    id,
    room,
    memory: { role, waitingEnergyTicks: waiting, logisticsFallback: fallback },
    store: makeStore(100, energy),
    pos: {
      range,
      findClosestByPath(list) { return Array.isArray(list) ? (list[0] || null) : null; }
    },
    spawning: false,
    moveTo() {}
  };
  objects.set(id, creep);
  return creep;
}

function makeHauler(id, rangeMap = {}, carried = 300) {
  const creep = {
    id,
    room,
    memory: { role: 'hauler' },
    name: id,
    store: makeStore(300, carried),
    spawning: false,
    pos: {
      getRangeTo(target) { return rangeMap[target.id] ?? target.pos?.range ?? 10; }
    },
    transfer() { return ERR_NOT_IN_RANGE; },
    moveTo() {}
  };
  objects.set(id, creep);
  return creep;
}

const energy = require('../game/energy.js');

// A partially used but actively working high-priority builder must not steal a
// delivery from an actually empty consumer. v0.2.14 targeted every consumer
// with free capacity and therefore repeatedly topped up builders/workers.
{
  const builder = makeConsumer('builder-active', 'builder', 50, 0, false, 2);
  const upgrader = makeConsumer('upgrader-empty', 'upgrader', 0, 0, false, 8);
  const hauler = makeHauler('hauler-a');
  room.creeps = [builder, upgrader, hauler];

  assert.equal(energy.consumerNeedsDelivery(builder), false);
  assert.equal(energy.consumerNeedsDelivery(upgrader), true);
  assert.equal(energy._test.selectConsumerTarget(hauler).id, upgrader.id);
}

// Waiting age outranks static role priority. A long-waiting upgrader should be
// served before a newly waiting builder.
{
  const builder = makeConsumer('builder-new', 'builder', 0, 2, false, 2);
  const upgrader = makeConsumer('upgrader-old', 'upgrader', 0, 11, false, 8);
  const hauler = makeHauler('hauler-b');
  room.creeps = [builder, upgrader, hauler];

  assert.equal(energy._test.selectConsumerTarget(hauler).id, upgrader.id);
}

// Fallback means the request already exceeded the normal wait threshold. It
// remains urgent even though role.worker resets waitingEnergyTicks to zero when
// fallback begins.
{
  const worker = makeConsumer('worker-wait', 'worker', 0, 11, false, 3);
  const upgrader = makeConsumer('upgrader-fallback', 'upgrader', 0, 0, true, 7);
  const hauler = makeHauler('hauler-c');
  room.creeps = [worker, upgrader, hauler];

  assert.equal(energy._test.selectConsumerTarget(hauler).id, upgrader.id);
}

// Reservation regression: after one hauler commits to the oldest request, a
// second hauler must choose another consumer instead of dogpiling the same one.
{
  const builder = makeConsumer('builder-r', 'builder', 0, 8, false, 2);
  const upgrader = makeConsumer('upgrader-r', 'upgrader', 0, 12, false, 8);
  const hauler1 = makeHauler('hauler-r1');
  const hauler2 = makeHauler('hauler-r2');
  room.creeps = [builder, upgrader, hauler1, hauler2];

  assert.equal(energy.deliverToConsumer(hauler1), true);
  assert.equal(hauler1.memory.consumerTargetId, upgrader.id);
  assert.equal(energy._test.selectConsumerTarget(hauler2).id, builder.id);
}

// v0.2.20 live regression: a partial emergency delivery must resume productive
// work immediately. The consumer must not keep waiting merely because its carry
// is not completely full.
{
  const target = makeConsumer('worker-partial-after', 'worker', 0, 7, true, 2);
  target.memory.working = false;
  const hauler = makeHauler('hauler-partial-fill', {}, 50);
  hauler.memory.consumerTargetId = target.id;
  hauler.transfer = (consumer) => {
    consumer.store.energy = 50;
    return OK;
  };
  room.creeps = [target, hauler];

  assert.equal(energy.deliverToConsumer(hauler), true);
  assert.equal(target.store.energy, 50);
  assert.equal(target.memory.working, true);
  assert.equal(target.memory.waitingEnergyTicks, 0);
  assert.equal(target.memory.logisticsFallback, false);
  assert.equal(hauler.memory.consumerTargetId, undefined);
  assert.equal(energy.consumerNeedsDelivery(target), false);
}

// Once a reserved target is fully supplied, the reservation and fallback state
// are cleared immediately so the hauler can take a different request next tick.
{
  const target = makeConsumer('worker-full-after', 'worker', 0, 7, true, 2);
  const hauler = makeHauler('hauler-fill');
  hauler.memory.consumerTargetId = target.id;
  hauler.transfer = (consumer) => {
    consumer.store.energy = 100;
    return OK;
  };
  room.creeps = [target, hauler];

  assert.equal(energy.deliverToConsumer(hauler), true);
  assert.equal(hauler.memory.consumerTargetId, undefined);
  assert.equal(target.memory.working, true);
  assert.equal(target.memory.waitingEnergyTicks, 0);
  assert.equal(target.memory.logisticsFallback, false);
}


// Starvation guard: with redundant hauling and a consumer already waiting,
// exactly one delivery-ready hauler is diverted from infrastructure refill.
// The closest ready hauler is chosen so the guard resolves the wait quickly.
{
  const consumer = makeConsumer('worker-guard', 'worker', 0, 4, false, 5);
  const hauler1 = makeHauler('hauler-g1', { [consumer.id]: 8 });
  const hauler2 = makeHauler('hauler-g2', { [consumer.id]: 2 });
  const hauler3 = makeHauler('hauler-g3', { [consumer.id]: 5 });
  room.creeps = [consumer, hauler1, hauler2, hauler3];

  assert.equal(energy.isCriticalConsumerRequest(consumer), true);
  assert.equal(energy._test.selectConsumerGuardHauler(room).id, hauler2.id);
  assert.equal(energy.shouldPrioritizeConsumer(hauler1), false);
  assert.equal(energy.shouldPrioritizeConsumer(hauler2), true);
  assert.equal(energy.shouldPrioritizeConsumer(hauler3), false);
}

// With three live haulers and several critical consumers, two delivery-ready
// guards may serve consumers while one hauler remains outside the guard set for
// hard infrastructure. This is the measured v0.2.20 case: 3 haulers, 4
// consumer requests, but only one reservation under the old single-guard rule.
{
  const worker = makeConsumer('worker-guard-scale', 'worker', 0, 6, false, 3);
  const builder = makeConsumer('builder-guard-scale', 'builder', 0, 4, true, 6);
  const upgrader = makeConsumer('upgrader-guard-scale', 'upgrader', 0, 3, false, 8);
  const hauler1 = makeHauler('hauler-gs1', {
    [worker.id]: 1,
    [builder.id]: 6,
    [upgrader.id]: 8
  });
  const hauler2 = makeHauler('hauler-gs2', {
    [worker.id]: 5,
    [builder.id]: 1,
    [upgrader.id]: 7
  });
  const hauler3 = makeHauler('hauler-gs3', {
    [worker.id]: 6,
    [builder.id]: 7,
    [upgrader.id]: 1
  });
  room.creeps = [worker, builder, upgrader, hauler1, hauler2, hauler3];

  const guards = energy._test.selectConsumerGuardHaulers(room);
  assert.equal(guards.length, 2);
  assert.deepEqual(guards.map(h => h.id).sort(), [hauler1.id, hauler2.id].sort());
  assert.equal(energy.shouldPrioritizeConsumer(hauler1), true);
  assert.equal(energy.shouldPrioritizeConsumer(hauler2), true);
  assert.equal(energy.shouldPrioritizeConsumer(hauler3), false);
}

// An existing reservation to a critical consumer stays sticky even if another
// ready hauler is geometrically closer. This prevents guard oscillation while
// the reserved hauler is already travelling to the consumer.
{
  const consumer = makeConsumer('upgrader-guard-reserved', 'upgrader', 0, 3, false, 5);
  const reserved = makeHauler('hauler-gr1', { [consumer.id]: 9 });
  const closer = makeHauler('hauler-gr2', { [consumer.id]: 1 });
  reserved.memory.consumerTargetId = consumer.id;
  room.creeps = [consumer, reserved, closer];

  assert.equal(energy._test.selectConsumerGuardHauler(room).id, reserved.id);
  assert.equal(energy.shouldPrioritizeConsumer(reserved), true);
  assert.equal(energy.shouldPrioritizeConsumer(closer), false);
}

// The guard must never compromise the single-hauler recovery path. With only
// one live hauler, hard infrastructure retains absolute first priority.
{
  const consumer = makeConsumer('builder-single-hauler', 'builder', 0, 0, true, 3);
  const hauler = makeHauler('hauler-only', { [consumer.id]: 2 });
  room.creeps = [consumer, hauler];

  assert.equal(energy.isCriticalConsumerRequest(consumer), true);
  assert.equal(energy._test.selectConsumerGuardHauler(room), null);
  assert.equal(energy.shouldPrioritizeConsumer(hauler), false);
}

// Empty by itself is a normal request, not starvation. The guard activates
// only after the consumer has actually waited or entered fallback.
{
  const consumer = makeConsumer('worker-empty-fresh', 'worker', 0, 0, false, 3);
  const hauler1 = makeHauler('hauler-fresh-1');
  const hauler2 = makeHauler('hauler-fresh-2');
  room.creeps = [consumer, hauler1, hauler2];

  assert.equal(energy.consumerNeedsDelivery(consumer), true);
  assert.equal(energy.isCriticalConsumerRequest(consumer), false);
  assert.equal(energy._test.selectConsumerGuardHauler(room), null);
}


// v0.2.20 early dispatch: if redundant logistics exists, no normal guard is
// delivery-ready, and a consumer is already critical, exactly one partial
// hauler with carried energy may break its pickup leg early.
{
  const consumer = makeConsumer('worker-early-dispatch', 'worker', 0, 4, false, 4);
  const partial = makeHauler('hauler-early-partial', { [consumer.id]: 2 }, 50);
  const empty = makeHauler('hauler-early-empty', { [consumer.id]: 1 }, 0);
  room.creeps = [consumer, partial, empty];

  assert.equal(energy._test.haulerReadyToDeliver(partial), false);
  assert.equal(energy._test.selectConsumerGuardHauler(room), null);
  assert.equal(energy._test.selectConsumerEarlyDispatchHauler(room).id, partial.id);
  assert.equal(energy.shouldInterruptPickupForConsumer(partial), true);
  assert.equal(energy.shouldInterruptPickupForConsumer(empty), false);
}

// A partial pickup must not be interrupted when a normal delivery-ready guard
// is already available for the critical consumer.
{
  const consumer = makeConsumer('worker-ready-guard-exists', 'worker', 0, 4, false, 4);
  const ready = makeHauler('hauler-ready-existing', { [consumer.id]: 4 }, 200);
  const partial = makeHauler('hauler-partial-existing', { [consumer.id]: 1 }, 50);
  room.creeps = [consumer, ready, partial];

  assert.equal(energy._test.selectConsumerGuardHauler(room).id, ready.id);
  assert.equal(energy._test.selectConsumerEarlyDispatchHauler(room), null);
  assert.equal(energy.shouldInterruptPickupForConsumer(partial), false);
}

// Single-hauler recovery remains immutable: even a critical consumer cannot
// pull the sole partial hauler off its normal pickup/infrastructure loop.
{
  const consumer = makeConsumer('worker-single-early', 'worker', 0, 5, false, 3);
  const partial = makeHauler('hauler-single-early', { [consumer.id]: 2 }, 50);
  room.creeps = [consumer, partial];

  assert.equal(energy._test.selectConsumerEarlyDispatchHauler(room), null);
  assert.equal(energy.shouldInterruptPickupForConsumer(partial), false);
}

// Integration of the guard into role.hauler: a selected guard must attempt a
// consumer transfer before the normal infrastructure delivery path. A normal
// hauler keeps infrastructure first. This protects the priority ordering from
// future refactors of role.hauler.
{
  const roleHauler = require('../game/role.hauler.js');
  const original = {
    shouldInterruptPickupForConsumer: energy.shouldInterruptPickupForConsumer,
    shouldPrioritizeConsumer: energy.shouldPrioritizeConsumer,
    deliverToConsumer: energy.deliverToConsumer,
    deliver: energy.deliver,
    clearConsumerTarget: energy.clearConsumerTarget,
    deliverToControllerBuffer: energy.deliverToControllerBuffer
  };

  const creep = makeHauler('hauler-role-order');
  creep.memory.delivering = true;
  const calls = [];

  energy.shouldPrioritizeConsumer = () => true;
  energy.deliverToConsumer = () => { calls.push('consumer'); return true; };
  energy.deliver = () => { calls.push('infrastructure'); return true; };
  energy.clearConsumerTarget = () => { calls.push('clear'); };
  energy.deliverToControllerBuffer = () => false;

  roleHauler.run(creep);
  assert.deepEqual(calls, ['consumer']);

  calls.length = 0;
  energy.shouldPrioritizeConsumer = () => false;
  roleHauler.run(creep);
  assert.deepEqual(calls, ['infrastructure', 'clear']);

  Object.assign(energy, original);
}

// v0.2.20 role integration: a partial hauler selected for early dispatch must
// skip the acquisition leg and attempt the consumer transfer in the same tick.
{
  const roleHauler = require('../game/role.hauler.js');
  const original = {
    shouldInterruptPickupForConsumer: energy.shouldInterruptPickupForConsumer,
    shouldPrioritizeConsumer: energy.shouldPrioritizeConsumer,
    deliverToConsumer: energy.deliverToConsumer,
    acquireForHauler: energy.acquireForHauler
  };
  const creep = makeHauler('hauler-role-early', {}, 50);
  const calls = [];

  energy.shouldInterruptPickupForConsumer = () => true;
  energy.shouldPrioritizeConsumer = () => true;
  energy.deliverToConsumer = () => { calls.push('consumer'); return true; };
  energy.acquireForHauler = () => { calls.push('acquire'); return true; };

  roleHauler.run(creep);
  assert.equal(creep.memory.delivering, true);
  assert.deepEqual(calls, ['consumer']);

  Object.assign(energy, original);
}


// v0.2.18: once logistics has two live haulers, productive consumers stop
// donating their own work energy back into spawn/extensions. This removes a
// measured churn loop where a builder/worker would refill infrastructure, go
// empty, wait for the same energy to be hauled back, and sometimes enter
// self-supply fallback. With only one hauler, the historical recovery behavior
// remains infrastructure-first.
{
  const roleWorker = require('../game/role.worker.js');
  const builder = makeConsumer('builder-dedicated-work', 'builder', 50, 0, false, 2);
  builder.memory.working = true;
  const hauler1 = makeHauler('hauler-dw1');
  const hauler2 = makeHauler('hauler-dw2');
  room.creeps = [builder, hauler1, hauler2];
  room.sites = [{ id: 'site-dw', structureType: STRUCTURE_EXTENSION, pos: {} }];

  assert.equal(roleWorker._test.liveHaulerCount(room), 2);
  assert.equal(roleWorker._test.shouldAssistInfrastructure(builder), false);

  const originalDeliver = energy.deliver;
  const calls = [];
  energy.deliver = () => { calls.push('infrastructure'); return true; };
  builder.build = () => { calls.push('build'); return OK; };
  roleWorker.run(builder);
  assert.deepEqual(calls, ['build']);

  calls.length = 0;
  room.creeps = [builder, hauler1];
  assert.equal(roleWorker._test.liveHaulerCount(room), 1);
  assert.equal(roleWorker._test.shouldAssistInfrastructure(builder), true);
  roleWorker.run(builder);
  assert.deepEqual(calls, ['infrastructure']);

  energy.deliver = originalDeliver;
  room.sites = [];
}

console.log('consumer supply tests passed');
