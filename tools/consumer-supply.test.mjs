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
global.FIND_DROPPED_RESOURCES = 10;
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
global.ERR_NO_PATH = -2;
global.ERR_INVALID_TARGET = -7;
global.ERR_BUSY = -4;
global.ERR_TIRED = -11;

const objects = new Map();
global.Game = {
  time: 1000,
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

function makeHauler(id, rangeMap = {}) {
  const creep = {
    id,
    room,
    memory: { role: 'hauler' },
    name: id,
    store: makeStore(300, 300),
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

const config = require('../game/config.js');
const energy = require('../game/energy.js');

// Failed pickup/withdraw intents do not represent delivered energy or even
// progress. The waiting counter must keep aging so a genuine unresolved
// consumer request can trigger the existing bounded self-supply fallback.
// A successful intent and ERR_NOT_IN_RANGE with a movement remain in progress.
{
  const worker = makeConsumer('worker-failed-local-energy', 'worker', 0, 2, false, 2);
  const haulerA = makeHauler('hauler-failed-acquire-a');
  const haulerB = makeHauler('hauler-failed-acquire-b');
  room.creeps = [worker, haulerA, haulerB];
  const drop = { resourceType: RESOURCE_ENERGY, amount: 30 };
  worker.pos.findInRange = () => [drop];
  const roleWorker = require('../game/role.worker.js');
  let pickupResult = -6; // ERR_NOT_ENOUGH_RESOURCES: stale dropped energy
  const movement = [];
  worker.pickup = () => pickupResult;
  worker.moveTo = (...args) => { movement.push(args); return OK; };
  assert.equal(energy.acquireForConsumer(worker), false);
  assert.equal(roleWorker._test.acquireWorkEnergy(worker), true);
  assert.equal(worker.memory.waitingEnergyTicks, 3,
    'failed local pickup must age the existing hauler wait');
  assert.equal(worker.memory.logisticsFallback, false);
  assert.equal(movement.length, 0, 'failed intent is not a move target');

  // Previously each failed local pickup reset waiting to zero forever,
  // preventing the configured fallback threshold from ever being reached.
  const originalAcquire = energy.acquire;
  try {
    energy.acquire = () => true;
    worker.memory.waitingEnergyTicks = config.CONSUMER_HAULER_WAIT_TICKS;
    assert.equal(roleWorker._test.acquireWorkEnergy(worker), true);
    assert.equal(worker.memory.waitingEnergyTicks, 0);
    assert.equal(worker.memory.logisticsFallback, true,
      'repeated failed pickup must reach the real fallback path');
  } finally {
    energy.acquire = originalAcquire;
  }
  worker.memory.logisticsFallback = false;
  worker.memory.waitingEnergyTicks = 3;

  pickupResult = OK;
  assert.equal(roleWorker._test.acquireWorkEnergy(worker), true);
  assert.equal(worker.memory.waitingEnergyTicks, 4,
    'pickup() OK is an accepted intent, not proof of engine-settled energy');
  pickupResult = ERR_NOT_IN_RANGE;
  worker.memory.waitingEnergyTicks = 2;
  assert.equal(roleWorker._test.acquireWorkEnergy(worker), true);
  assert.equal(worker.memory.waitingEnergyTicks, 3,
    'moveTo() OK is route intent, not a received-energy acknowledgement');
  assert.equal(movement.length, 1);
  assert.equal(movement[0][0], drop);
  assert.equal(movement[0][1].maxOps, config.PATH_MAX_OPS);

  // A movement error is not progress and must preserve the wait counter.
  worker.moveTo = (...args) => { movement.push(args); return ERR_NO_PATH; };
  worker.memory.waitingEnergyTicks = 2;
  assert.equal(energy.acquireForConsumer(worker), false);
  assert.equal(roleWorker._test.acquireWorkEnergy(worker), true);
  assert.equal(worker.memory.waitingEnergyTicks, 3);
  worker.moveTo = (...args) => { movement.push(args); return ERR_BUSY; };
  assert.equal(energy.acquireForConsumer(worker), false);
  worker.moveTo = (...args) => { movement.push(args); return OK; };
  movement.length = 1;

  worker.pos.findInRange = () => [];
  room.storage = { store: makeStore(500, 200) };
  let withdrawResult = -7; // ERR_INVALID_TARGET
  worker.withdraw = () => withdrawResult;
  assert.equal(energy.acquireForConsumer(worker), false);
  withdrawResult = OK;
  assert.equal(energy.acquireForConsumer(worker), true);
  withdrawResult = ERR_NOT_IN_RANGE;
  assert.equal(energy.acquireForConsumer(worker), true);
  assert.equal(movement.length, 2);
  assert.equal(movement[1][0], room.storage);
  delete room.storage;

  const upgrader = makeConsumer('upgrader-failed-buffer', 'upgrader', 0, 1, false, 2);
  const controllerBuffer = { structureType: STRUCTURE_CONTAINER, store: makeStore(500, 200) };
  room.controller = { pos: { findInRange: () => [controllerBuffer] } };
  upgrader.pos.findInRange = () => [];
  upgrader.withdraw = () => -6; // ERR_NOT_ENOUGH_RESOURCES
  room.creeps = [upgrader, haulerA, haulerB];
  assert.equal(energy.acquireForConsumer(upgrader), false);
  upgrader.withdraw = () => OK;
  assert.equal(energy.acquireForConsumer(upgrader), true);
  delete room.controller;
}

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

// An empty hauler's previous sticky claim must not block a different
// energy-ready hauler. Reclaim the ghost assignment before reserving; no
// simultaneous duplicate live assignments are ever left in Creep Memory.
// This can happen when the ready carrier runs before the depleted one.
{
  const critical = makeConsumer('worker-empty-sticky-critical', 'worker', 0, 8, true, 2);
  const depleted = makeHauler('hauler-empty-sticky');
  depleted.store.energy = 0;
  depleted.memory.delivering = true;
  depleted.memory.consumerTargetId = critical.id;
  const ready = makeHauler('hauler-empty-sticky-ready');
  ready.memory.delivering = true;
  room.creeps = [critical, ready, depleted];

  assert.equal(energy._test.selectConsumerTarget(ready, true).id, critical.id);
  assert.equal(depleted.memory.consumerTargetId, undefined,
    'an unserviceable zero-energy assignment must be reclaimed');
  assert.equal(ready.memory.consumerTargetId, undefined,
    'selection alone does not reserve for the chosen hauler');
  assert.equal(energy.deliverToConsumer(ready, true), true);
  assert.equal(ready.memory.consumerTargetId, critical.id);
  assert.equal(energy.isCriticalConsumerRequest(critical), true,
    'accepted movement must not hide unsatisfied starvation');
}

// A hauler whose moveTo() has a terminal routing error cannot fulfill its
// sticky critical reservation. Another carrier must be able to take over
// even when the failed hauler still has a full CARRY load.
{
  const starved = makeConsumer('worker-terminal-route', 'worker', 0, 8, true);
  const trapped = makeHauler('hauler-terminal-route');
  const backup = makeHauler('hauler-backup-route');
  trapped.memory.delivering = backup.memory.delivering = true;
  trapped.transfer = () => ERR_NOT_IN_RANGE;
  let rc = ERR_NO_PATH;
  trapped.moveTo = () => rc;
  room.creeps = [starved, trapped, backup];
  assert.equal(energy.deliverToConsumer(trapped, true), false);
  assert.equal(trapped.memory.consumerTargetId, undefined);
  assert.equal(energy._test.selectConsumerTarget(backup, true).id, starved.id,
    'terminal unreachable reservation must not monopolize demand');
  assert.equal(energy.deliverToConsumer(backup, true), true);
  assert.equal(backup.memory.consumerTargetId, starved.id);
  assert.equal(energy.isCriticalConsumerRequest(starved), true,
    'failed move is not delivered energy');

  // A different terminal path error must also release its reservation.
  backup.memory.consumerTargetId = undefined;
  rc = ERR_INVALID_TARGET;
  assert.equal(energy.deliverToConsumer(trapped, true), false);
  assert.equal(trapped.memory.consumerTargetId, undefined);

  // A transient busy movement is NOT evidence that the route is terminal.
  rc = ERR_BUSY;
  assert.equal(energy.deliverToConsumer(trapped, true), true);
  assert.equal(trapped.memory.consumerTargetId, starved.id);
  assert.equal(energy._test.selectConsumerTarget(backup, true), null,
    'a still viable sticky reservation remains exclusive');
  // Fatigue can block movement for a tick; it is not a pathfinding failure
  // and must not release a valid sticky assignment to a competing hauler.
  rc = ERR_TIRED;
  assert.equal(energy.deliverToConsumer(trapped, true), true);
  assert.equal(trapped.memory.consumerTargetId, starved.id);
  assert.equal(energy._test.selectConsumerTarget(backup, true), null,
    'fatigued carrier keeps its claim until it can move again');
  assert.equal(starved.store.energy, 0,
    'temporary movement failure never proves settled delivery');
  rc = OK;
  assert.equal(energy.deliverToConsumer(trapped, true), true);
  assert.equal(trapped.memory.consumerTargetId, starved.id);
}

// A positive but UNDER-threshold hauler cannot hold a critical consumer
// hostage after the conditions for its emergency rescue disappear. The
// caller may run before the collector has an opportunity to clear its own
// stale reservation, so reclaim at target-selection time.
{
  const critical = makeConsumer('worker-live-underfilled-sticky', 'worker', 0, 5, true);
  const partial = makeHauler('hauler-live-underfilled');
  partial.store.energy = 30;
  partial.memory.delivering = false;
  partial.memory.consumerTargetId = critical.id;
  const ready = makeHauler('hauler-other-ready');
  ready.memory.delivering = true;
  room.creeps = [critical, partial, ready];

  assert.equal(energy._test.selectConsumerTarget(ready, true).id, critical.id,
    'a partial carrier with no current rescue authorization must not block a loaded hauler');
  assert.equal(partial.memory.consumerTargetId, undefined,
    'reclaim an unserviceable positive-CARRY reservation immediately');
  assert.equal(energy.deliverToConsumer(ready,true), true);
  assert.equal(ready.memory.consumerTargetId, critical.id);
  assert.equal(critical.store.energy, 0,
    'transfer movement is not evidence of engine-settled energy');

  // An explicitly delivering hauler with any positive CARRY remains ready
  // under the existing guard rule, even below the ordinary 50% threshold.
  partial.memory.delivering = true;
  partial.store.energy = 30;
  partial.memory.consumerTargetId = critical.id;
  delete ready.memory.consumerTargetId;
  assert.equal(energy._test.selectConsumerTarget(ready,true), null);
  assert.equal(partial.memory.consumerTargetId, critical.id,
    'a delivery-ready carrier keeps its still-serviceable sticky target');
}

// A selected emergency guard can have a sticky reservation for a *fresh*
// empty (noncritical) consumer. It must drop that stale priority and deliver
// to a genuinely waiting/fallbacking consumer instead of spending the limited
// infrastructure-override slot on normal top-off. Normal deliveries may still
// serve the noncritical consumer when infrastructure priorities allow.
{
  const fresh = makeConsumer('worker-stale-guard-fresh', 'worker', 0, 0, false, 1);
  const starved = makeConsumer('upgrader-stale-guard-critical', 'upgrader', 0, 9, true, 7);
  const guard = makeHauler('hauler-stale-guard', { [starved.id]: 1 });
  const backup = makeHauler('hauler-stale-backup', { [starved.id]: 8 });
  guard.memory.consumerTargetId = fresh.id;
  guard.memory.delivering = true;
  backup.memory.delivering = true;
  room.creeps = [fresh, starved, guard, backup];

  const transfers = [];
  guard.transfer = target => { transfers.push(target.id); return ERR_NOT_IN_RANGE; };
  assert.equal(energy.consumerNeedsDelivery(fresh), true);
  assert.equal(energy.isCriticalConsumerRequest(fresh), false);
  assert.equal(energy.isCriticalConsumerRequest(starved), true);
  assert.equal(energy.shouldPrioritizeConsumer(guard), true);
  assert.equal(energy.shouldPrioritizeConsumer(backup), false);
  assert.equal(require('../game/role.hauler.js').run(guard), undefined);
  assert.deepEqual(transfers, [starved.id]);
  assert.equal(guard.memory.consumerTargetId, starved.id);
  assert.equal(fresh.memory.waitingEnergyTicks, 0);

  // Once a target is genuinely critical, its existing sticky reservation
  // remains valid; no needless emergency retargeting or guard oscillation.
  transfers.length = 0;
  assert.equal(energy.deliverToConsumer(guard, true), true);
  assert.deepEqual(transfers, [starved.id]);
  assert.equal(guard.memory.consumerTargetId, starved.id);

  // With no critical requests, a plain delivery still honors the old sticky
  // empty target; the change is restricted to explicit emergency calls.
  starved.memory.waitingEnergyTicks = 0;
  starved.memory.logisticsFallback = false;
  guard.memory.consumerTargetId = fresh.id;
  transfers.length = 0;
  assert.equal(energy.shouldPrioritizeConsumer(guard), false);
  assert.equal(energy.deliverToConsumer(guard), true);
  assert.deepEqual(transfers, [fresh.id]);
  assert.equal(guard.memory.consumerTargetId, fresh.id);
}

// Partial-load rescue is also an emergency override. When its guard is
// authorized, it must not keep pursuing a normal, freshly empty target.
// The real room/infrastructure rescue eligibility remains separately guarded.
{
  const fresh = makeConsumer('worker-rescue-fresh', 'worker', 0, 0, false, 1);
  const starved = makeConsumer('upgrader-rescue-critical', 'upgrader', 0, 6, true, 5);
  const rescuer = makeHauler('hauler-partial-rescue', { [starved.id]: 2 });
  rescuer.store.energy = 30;
  rescuer.memory.delivering = false;
  rescuer.memory.consumerTargetId = fresh.id;
  room.creeps = [fresh, starved, rescuer];
  const transfers = [];
  rescuer.transfer = target => { transfers.push(target.id); return ERR_NOT_IN_RANGE; };
  const savedRescueRule = energy.shouldRescueConsumer;
  try {
    energy.shouldRescueConsumer = () => true;
    require('../game/role.hauler.js').run(rescuer);
  } finally {
    energy.shouldRescueConsumer = savedRescueRule;
  }
  assert.deepEqual(transfers, [starved.id]);
  assert.equal(rescuer.memory.consumerTargetId, starved.id);
  assert.equal(rescuer.memory.delivering, false,
    'rescue should not force an underfilled hauler into normal delivery mode');
}

// Accepted OK is NOT an engine-settled delivery. A reserved target must
// retain its waiting/fallback state and sticky assignment until a subsequent
// consumer turn sees energy in its actual store.
{
  const roleWorker = require('../game/role.worker.js');
  const target = makeConsumer('worker-full-after', 'worker', 0, 7, true, 2);
  target.memory.working = false;
  const hauler = makeHauler('hauler-fill');
  hauler.memory.consumerTargetId = target.id;
  hauler.transfer = () => OK; // no simulated engine settlement yet
  room.creeps = [target, hauler];

  Game.time = 1000;
  assert.equal(energy.deliverToConsumer(hauler), true);
  assert.equal(hauler.memory.consumerTargetId, target.id);
  assert.equal(target.store.energy, 0);
  assert.equal(target.memory.waitingEnergyTicks, 7);
  assert.equal(target.memory.logisticsFallback, true);
  assert.equal(target.memory.lastHaulerIntentTick, 1000);
  assert.equal(energy.isCriticalConsumerRequest(target), true);
  assert.equal(roleWorker._test.needsEnergy(target), true,
    'same-tick accepted intent must not restart empty consumer');

  // Screeps applies the transfer only between ticks.
  Game.time = 1001;
  target.store.energy = 100;
  assert.equal(roleWorker._test.needsEnergy(target), false);
  assert.equal(target.memory.working, true);
  assert.equal(target.memory.waitingEnergyTicks, 0);
  assert.equal(target.memory.logisticsFallback, false);
  assert.equal(target.memory.lastHaulerIntentTick, undefined);
  assert.equal(energy._test.currentConsumerTarget(hauler), null);
  assert.equal(hauler.memory.consumerTargetId, undefined);
}

// A partial settled load remains usable without allowing accepted intents to
// erase an unresolved critical request in the current tick.
{
  const roleWorker = require('../game/role.worker.js');
  const target = makeConsumer('builder-partial-hauler', 'builder', 0, 6, false, 2);
  target.memory.working = false;
  const hauler = makeHauler('hauler-partial');
  hauler.transfer = () => OK;
  room.creeps = [target, hauler];

  Game.time = 1002;
  assert.equal(energy.deliverToConsumer(hauler), true);
  assert.equal(target.memory.waitingEnergyTicks, 6);
  assert.equal(target.store.energy, 0);
  assert.equal(target.memory.lastHaulerIntentTick, 1002);

  Game.time = 1003;
  target.store.energy = 30; // next-tick actual store, not transfer() return
  assert.equal(roleWorker._test.needsEnergy(target), false);
  assert.equal(target.memory.working, true);
  assert.equal(target.memory.waitingEnergyTicks, 0);
  assert.equal(target.memory.lastHaulerIntentTick, undefined);
  assert.equal(energy.consumerNeedsDelivery(target), false);
}

// Even after a partially settled load, a fallback consumer must stop
// self-harvest once productive energy is visibly available on a later turn.
{
  const roleWorker = require('../game/role.worker.js');
  const target = makeConsumer('upgrader-partial-fallback-clear', 'upgrader', 0, 0, true, 2);
  target.memory.working = false;
  const hauler = makeHauler('hauler-partial-fallback-clear');
  hauler.transfer = () => OK;
  room.creeps = [target, hauler];

  Game.time = 1004;
  assert.equal(energy.deliverToConsumer(hauler), true);
  assert.equal(target.memory.logisticsFallback, true);
  assert.equal(energy.isCriticalConsumerRequest(target), true);
  Game.time = 1005;
  target.store.energy = 95;
  assert.equal(roleWorker._test.needsEnergy(target), false);
  assert.equal(target.memory.logisticsFallback, false);
  assert.equal(energy.isCriticalConsumerRequest(target), false);
}

// An accepted intent which never executes must not clear starvation or
// fabricate productive partial energy, even when the hint becomes stale.
{
  const roleWorker = require('../game/role.worker.js');
  const target = makeConsumer('builder-unsatisfied-intent', 'builder', 0, 4, true, 2);
  target.memory.working = false;
  const hauler = makeHauler('hauler-unsatisfied-intent');
  hauler.transfer = () => OK;
  room.creeps = [target, hauler];
  Game.time = 1006;
  assert.equal(energy.deliverToConsumer(hauler), true);
  Game.time = 1007;
  assert.equal(roleWorker._test.needsEnergy(target), true);
  assert.equal(target.memory.logisticsFallback, true);
  assert.equal(target.memory.waitingEnergyTicks, 4);
  assert.equal(hauler.memory.consumerTargetId, target.id);
  Game.time = 1008;
  target.store.energy = 30; // e.g. fallback harvest, not hauler receipt
  assert.equal(roleWorker._test.needsEnergy(target), true,
    'expired intent must not be misreported as a confirmed partial load');
  assert.equal(target.memory.logisticsFallback, true);
}

// Regress handler execution ordering: a consumer can already carry partial
// fallback-harvested energy when a hauler receives OK earlier in the same tick.
// Accepted intents must not turn OLD energy into a fabricated new delivery.
{
  const roleWorker = require('../game/role.worker.js');
  const target = makeConsumer('worker-old-partial-unchanged', 'worker', 35, 0, true, 2);
  target.memory.working = false;
  const hauler = makeHauler('hauler-old-partial-unchanged');
  hauler.transfer = () => OK;
  room.creeps = [target, hauler];
  Game.time = 1100;
  assert.equal(energy.deliverToConsumer(hauler, true), true);
  assert.equal(target.memory.lastHaulerIntentTick, 1100);
  assert.equal(target.memory.lastHaulerIntentEnergy, 35);
  assert.equal(roleWorker._test.needsEnergy(target), true,
    'same-tick accepted intent is not engine settlement, even with old CARRY');
  assert.equal(target.memory.logisticsFallback, true);
  Game.time = 1101;
  assert.equal(roleWorker._test.needsEnergy(target), true,
    'unchanged next-tick partial store is not new hauler energy');
  assert.equal(target.memory.logisticsFallback, true);
  Game.time = 1102;
  target.store.energy = 50;
  assert.equal(roleWorker._test.needsEnergy(target), true,
    'stale intent hint must not claim energy gained only two ticks later');
  assert.equal(target.memory.working, false);
}

// If a hauler runs BEFORE the worker in two adjacent ticks, the newly
// accepted second intent must not erase the preceding tick's real store gain.
{
  const roleWorker = require('../game/role.worker.js');
  const target = makeConsumer('worker-consecutive-intents', 'worker', 30, 0, true, 2);
  target.memory.working = false;
  const hauler = makeHauler('hauler-consecutive-intents');
  hauler.transfer = () => OK;
  room.creeps = [target, hauler];
  Game.time = 1110;
  assert.equal(energy.deliverToConsumer(hauler, true), true);
  assert.equal(target.memory.lastHaulerIntentEnergy, 30);
  Game.time = 1111;
  target.store.energy = 45; // 15 actual new CARRY since previous intent
  assert.equal(energy.deliverToConsumer(hauler, true), true);
  assert.equal(target.memory.lastHaulerIntentTick, 1110,
    'preserve last-tick gain through newly accepted same-tick intent');
  assert.equal(target.memory.lastHaulerIntentEnergy, 30);
  assert.equal(roleWorker._test.needsEnergy(target), false);
  assert.equal(target.memory.working, true);
  assert.equal(target.memory.logisticsFallback, false);
  assert.equal(target.memory.lastHaulerIntentEnergy, undefined);
}

// If the older intent did not yield an increase, the newer accepted intent
// must replace the witness; only its eventual NEXT-tick increase may count.
{
  const roleWorker = require('../game/role.worker.js');
  const target = makeConsumer('worker-retry-no-first-receipt', 'worker', 25, 0, true, 2);
  target.memory.working = false;
  const hauler = makeHauler('hauler-retry-no-first-receipt');
  hauler.transfer = () => OK;
  room.creeps = [target, hauler];
  Game.time = 1120;
  assert.equal(energy.deliverToConsumer(hauler, true), true);
  Game.time = 1121;
  assert.equal(energy.deliverToConsumer(hauler, true), true);
  assert.equal(target.memory.lastHaulerIntentTick, 1121);
  assert.equal(target.memory.lastHaulerIntentEnergy, 25);
  assert.equal(roleWorker._test.needsEnergy(target), true);
  Game.time = 1122;
  target.store.energy = 40;
  assert.equal(roleWorker._test.needsEnergy(target), false);
  assert.equal(target.memory.logisticsFallback, false);
}

// Two critical consumers retain separate sticky guards on accepted intents,
// while the third delivery-ready hauler remains available for infrastructure.
{
  const a = makeConsumer('worker-unsettled-a', 'worker', 0, 4, true, 2);
  const b = makeConsumer('upgrader-unsettled-b', 'upgrader', 0, 7, false, 6);
  const h1 = makeHauler('hauler-unsettled-a', {[a.id]: 1, [b.id]: 8});
  const h2 = makeHauler('hauler-unsettled-b', {[a.id]: 9, [b.id]: 1});
  const reserve = makeHauler('hauler-infra-reserve');
  h1.transfer = h2.transfer = () => OK;
  room.creeps = [a, b, h1, h2, reserve];
  Game.time = 1010;
  assert.deepEqual(energy._test.selectConsumerGuardHaulers(room).map(h => h.id),
    [h1.id, h2.id]);
  assert.equal(energy.deliverToConsumer(h1, true), true);
  assert.equal(energy.deliverToConsumer(h2, true), true);
  assert.equal(h1.memory.consumerTargetId, a.id);
  assert.equal(h2.memory.consumerTargetId, b.id);
  assert.equal(reserve.memory.consumerTargetId, undefined);
  assert.equal(energy.isCriticalConsumerRequest(a), true);
  assert.equal(energy.isCriticalConsumerRequest(b), true);
}

// Partial energy without an explicit hauler-delivery marker must not resume
// work. This preserves the fill-before-work behavior of self-harvest fallback.
{
  const roleWorker = require('../game/role.worker.js');
  const target = makeConsumer('builder-partial-self', 'builder', 30, 0, true, 2);
  target.memory.working = false;
  room.creeps = [target];

  Game.time = 1002;
  assert.equal(roleWorker._test.needsEnergy(target), true);
  assert.equal(target.memory.working, false);
  assert.equal(target.memory.logisticsFallback, true);
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

// With three live haulers and multiple critical consumers, two guards may
// serve consumers concurrently while one hauler remains outside the guard set
// for hard infrastructure. This is the bounded severe-pressure behavior.
{
  const consumer1 = makeConsumer('worker-guard-severe-1', 'worker', 0, 5, false, 4);
  const consumer2 = makeConsumer('upgrader-guard-severe-2', 'upgrader', 0, 7, true, 6);
  const hauler1 = makeHauler('hauler-gs1', {
    [consumer1.id]: 1,
    [consumer2.id]: 9
  });
  const hauler2 = makeHauler('hauler-gs2', {
    [consumer1.id]: 8,
    [consumer2.id]: 2
  });
  const hauler3 = makeHauler('hauler-gs3', {
    [consumer1.id]: 5,
    [consumer2.id]: 5
  });
  room.creeps = [consumer1, consumer2, hauler1, hauler2, hauler3];

  const guards = energy._test.selectConsumerGuardHaulers(room);
  assert.deepEqual(guards.map(c => c.id), [hauler1.id, hauler2.id]);
  assert.equal(energy.shouldPrioritizeConsumer(hauler1), true);
  assert.equal(energy.shouldPrioritizeConsumer(hauler2), true);
  assert.equal(energy.shouldPrioritizeConsumer(hauler3), false);
}

// The infrastructure reserve must be able to DELIVER, not merely exist.
// With one energy-ready hauler and another empty/nonready carrier, the old
// count-based policy diverted the only ready hauler to the critical consumer.
{
  const critical = makeConsumer('worker-one-ready-critical', 'worker', 0, 8, true);
  const ready = makeHauler('hauler-one-ready');
  ready.memory.delivering = true;
  const depleted = makeHauler('hauler-one-ready-empty');
  depleted.store.energy = 0;
  depleted.memory.delivering = false;
  room.creeps = [critical, ready, depleted];

  assert.deepEqual(energy._test.selectConsumerGuardHaulers(room), [],
    'never divert the only energy-ready infrastructure carrier');
  assert.equal(energy.shouldPrioritizeConsumer(ready), false);

  depleted.store.energy = 75; // not delivery-ready, may rescue only if safe
  assert.deepEqual(energy._test.selectConsumerGuardHaulers(room), [],
    'a collecting partial hauler is not a ready infrastructure reserve');
  const thirdEmpty = makeHauler('hauler-one-ready-third-empty');
  thirdEmpty.store.energy = 0;
  room.creeps = [critical, ready, depleted, thirdEmpty];
  assert.deepEqual(energy._test.selectConsumerGuardHaulers(room), [],
    'additional empty/collecting carriers never increase ready guard capacity');
}

// With three haulers but only two carrying delivery-ready loads, exactly
// one normal guard may serve consumers, leaving one real ready infra carrier.
{
  const first = makeConsumer('worker-two-ready-critical-a', 'worker', 0, 8, true, 2);
  const second = makeConsumer('upgrader-two-ready-critical-b', 'upgrader', 0, 7, true, 4);
  const readyA = makeHauler('hauler-two-ready-a', {[first.id]: 1});
  const readyB = makeHauler('hauler-two-ready-b', {[second.id]: 1});
  const collecting = makeHauler('hauler-not-ready');
  collecting.store.energy = 75;
  collecting.memory.delivering = false;
  room.creeps = [first, second, readyA, readyB, collecting];

  const guards = energy._test.selectConsumerGuardHaulers(room);
  assert.equal(guards.length, 1,
    'two ready carriers cannot both be redirected away from infrastructure');
  const remainingReady = [readyA, readyB].filter(h => !guards.some(g => g.id === h.id));
  assert.equal(remainingReady.length, 1);
  assert.equal(energy.shouldPrioritizeConsumer(remainingReady[0]), false);
  assert.equal(energy._test.haulerReadyToDeliver(remainingReady[0]), true);
}

// Two old sticky reservations for the same critical consumer must not
// consume both emergency guard slots and starve another distinct request.
// The duplicate hauler remains available to the ordinary infrastructure
// delivery path; no creep Memory is mutated by guard selection.
{
  const firstConsumer = makeConsumer('worker-duplicate-reservation', 'worker', 0, 8, true, 3);
  const secondConsumer = makeConsumer('upgrader-unreserved-critical', 'upgrader', 0, 9, false, 5);
  const reserved = makeHauler('hauler-dup-a', {
    [firstConsumer.id]: 2, [secondConsumer.id]: 9
  });
  const duplicate = makeHauler('hauler-dup-b', {
    [firstConsumer.id]: 1, [secondConsumer.id]: 5
  });
  const unreserved = makeHauler('hauler-dup-c', {
    [firstConsumer.id]: 7, [secondConsumer.id]: 1
  });
  reserved.memory.consumerTargetId = firstConsumer.id;
  duplicate.memory.consumerTargetId = firstConsumer.id;
  room.creeps = [firstConsumer, secondConsumer, reserved, duplicate, unreserved];

  const guards = energy._test.selectConsumerGuardHaulers(room);
  assert.deepEqual(guards.map(c => c.id), [reserved.id, unreserved.id]);
  assert.equal(energy.shouldPrioritizeConsumer(reserved), true);
  assert.equal(energy.shouldPrioritizeConsumer(duplicate), false);
  assert.equal(energy.shouldPrioritizeConsumer(unreserved), true);
  assert.equal(energy._test.selectConsumerTarget(unreserved).id, secondConsumer.id);
  assert.equal(duplicate.memory.consumerTargetId, firstConsumer.id,
    'guard calculation may not rewrite live creep reservations');

  // If every ready hauler carries the same sticky reservation, use only
  // one emergency guard rather than duplicate a consumer transfer.
  unreserved.memory.consumerTargetId = firstConsumer.id;
  assert.deepEqual(energy._test.selectConsumerGuardHaulers(room).map(c => c.id),
    [reserved.id]);
  assert.equal(energy.shouldPrioritizeConsumer(duplicate), false);
  assert.equal(energy.shouldPrioritizeConsumer(unreserved), false);
  delete unreserved.memory.consumerTargetId;
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


// Integration of the guard into role.hauler: a selected guard must attempt a
// consumer transfer before the normal infrastructure delivery path. A normal
// hauler keeps infrastructure first. This protects the priority ordering from
// future refactors of role.hauler.
{
  const roleHauler = require('../game/role.hauler.js');
  const original = {
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


{
  // Worker target selection and movement must both carry the bounded PathFinder
  // budget. This guards against the measured multi-CPU findClosestByPath +
  // moveTo spike on a single worker tick.
  const roleWorker = require('../game/role.worker.js');
  const builder = makeConsumer('builder-path-budget', 'builder', 50, 0, false, 2);
  builder.memory.working = true;
  const hauler1 = makeHauler('hauler-path-budget-1');
  const hauler2 = makeHauler('hauler-path-budget-2');
  room.creeps = [builder, hauler1, hauler2];
  const site = { id: 'site-path-budget', structureType: STRUCTURE_EXTENSION, pos: {} };
  room.sites = [site];

  let closestOpts = null;
  let moveOpts = null;
  builder.pos.findClosestByPath = (targets, opts) => {
    closestOpts = opts;
    return Array.isArray(targets) ? targets[0] : null;
  };
  builder.build = () => ERR_NOT_IN_RANGE;
  builder.moveTo = (target, opts) => {
    assert.equal(target, site);
    moveOpts = opts;
  };

  roleWorker.run(builder);
  assert.equal(closestOpts.maxOps, config.PATH_MAX_OPS);
  assert.equal(moveOpts.maxOps, config.PATH_MAX_OPS);
  room.sites = [];
}

console.log('consumer supply tests passed');


// With two critical requests and three ready haulers, a sticky guard already
// covers the nearer request. The remaining guard must be selected by distance
// to the uncovered critical consumer, not distance to any critical consumer.
{
  const covered = makeConsumer('critical-covered-distance', 'worker', 0, 8, true);
  const uncovered = makeConsumer('critical-uncovered-distance', 'upgrader', 0, 8, true);
  const sticky = makeHauler('hauler-distance-sticky');
  sticky.memory.delivering = true;
  sticky.memory.consumerTargetId = covered.id;
  const nearCovered = makeHauler('hauler-distance-near-covered', {
    [covered.id]: 1, [uncovered.id]: 15
  });
  const nearUncovered = makeHauler('hauler-distance-near-uncovered', {
    [covered.id]: 9, [uncovered.id]: 2
  });
  nearCovered.memory.delivering = true;
  nearUncovered.memory.delivering = true;
  room.creeps = [covered, uncovered, sticky, nearCovered, nearUncovered];
  assert.equal(energy.shouldPrioritizeConsumer(sticky), true);
  assert.equal(energy.shouldPrioritizeConsumer(nearUncovered), true,
    'second guard should favor the critical request without ready sticky coverage');
  assert.equal(energy.shouldPrioritizeConsumer(nearCovered), false,
    'keep the third ready hauler for infrastructure');
}


// Readiness must agree with the role's transition from collecting to
// delivering: the full threshold is capacity-dependent, with a 50-energy
// floor. An underfilled hauler is not an infrastructure-ready reserve.
{
  const roleHauler = require('../game/role.hauler.js');
  const hauler = makeHauler('hauler-readiness-transition');
  hauler.store.energy = 149;
  hauler.memory.delivering = false;
  room.creeps = [hauler];
  assert.equal(energy._test.haulerReadyToDeliver(hauler), false);
  // No energy source: the role may attempt collection, but must not claim
  // a delivery-ready load before the threshold is reached.
  const acquireOriginal = energy.acquireForHauler;
  const rescueOriginal = energy.shouldRescueConsumer;
  try {
    energy.acquireForHauler = () => true;
    energy.shouldRescueConsumer = () => false;
    roleHauler.run(hauler);
  } finally {
    energy.acquireForHauler = acquireOriginal;
    energy.shouldRescueConsumer = rescueOriginal;
  }
  assert.equal(hauler.memory.delivering, false);
  hauler.store.energy = 150;
  assert.equal(energy._test.haulerReadyToDeliver(hauler), true);
  // Explicit delivering state remains ready for any positive remaining load.
  hauler.store.energy = 1;
  hauler.memory.delivering = true;
  assert.equal(energy._test.haulerReadyToDeliver(hauler), true);
  hauler.store.energy = 0;
  assert.equal(energy._test.haulerReadyToDeliver(hauler), false);
}

// End-to-end: consumer transfer stays unfulfilled on ERR_NOT_IN_RANGE, but
// the observer classifies the accompanying move return and geometric range.
{
  const supplyObserver=require('../game/consumer.supply.observer.js');
  const oldTime=Game.time;
  const oldName=room.name;
  Game.time=4025;
  room.name='E8N1';
  const critical=makeConsumer('travel-critical','worker',0,8,true);
  const blocked=makeHauler('travel-no-path',{[critical.id]:9});
  blocked.memory.delivering=true;
  blocked.moveTo=()=>ERR_NO_PATH;
  const moving=makeHauler('travel-moving',{[critical.id]:3});
  moving.memory.delivering=true;
  moving.moveTo=()=>OK;
  room.creeps=[critical,blocked,moving];
  assert.equal(energy.deliverToConsumer(blocked,true),false,
    'terminally unreachable route still releases its sticky reservation');
  assert.equal(blocked.memory.consumerTargetId,undefined);
  assert.equal(energy.deliverToConsumer(moving,true),true);
  assert.equal(moving.memory.consumerTargetId,critical.id);
  const counters=supplyObserver._test.getRoomCounters(room.name);
  assert.equal(counters.consumer.notInRange,2);
  assert.deepEqual(counters.consumerTravel,{
    moveAttempts:2,rangeAtMost5:1,range6to10:1,rangeOver10:0,
    rangeUnknown:0,moveAccepted:1,moveNoPath:1,moveInvalidTarget:0,
    moveTemporarilyBlocked:0,moveOther:0
  });
  assert.equal(critical.store.energy,0,
    'accepted move intents are not settled consumer energy transfers');
  Game.time=oldTime;
  if (oldName === undefined) delete room.name;
  else room.name=oldName;
}
