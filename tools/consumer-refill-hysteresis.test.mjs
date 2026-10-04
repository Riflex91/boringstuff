import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.WORK = 'work';
global.RESOURCE_ENERGY = 'energy';
global.CARRY_CAPACITY = 50;
global.BUILD_POWER = 5;
global.UPGRADE_CONTROLLER_POWER = 1;
global.FIND_MY_CREEPS = 1;
global.FIND_MY_CONSTRUCTION_SITES = 2;
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;

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
  sites: [{ id: 'site-live-like' }],
  find(type, opts) {
    let list;
    if (type === FIND_MY_CREEPS) list = this.creeps.slice();
    else if (type === FIND_MY_CONSTRUCTION_SITES) list = this.sites.slice();
    else throw new Error(`unexpected find type: ${type}`);
    return opts && opts.filter ? list.filter(opts.filter) : list;
  }
};

function makeConsumer(id, energy, waiting = 0, fallback = false, working = true) {
  const creep = {
    id,
    name: id,
    room,
    memory: { role: 'worker', waitingEnergyTicks: waiting, logisticsFallback: fallback, working },
    store: makeStore(100, energy),
    spawning: false,
    getActiveBodyparts(part) { return part === WORK ? 2 : 0; },
    pos: {
      getRangeTo() { return 3; }
    },
    moveTo() {}
  };
  objects.set(id, creep);
  return creep;
}

function makeHauler(id, energy) {
  const creep = {
    id,
    name: id,
    room,
    memory: { role: 'hauler' },
    store: makeStore(300, energy),
    spawning: false,
    pos: {
      getRangeTo() { return 2; }
    },
    transfer(target) {
      const amount = Math.min(this.store.energy, target.store.getFreeCapacity(RESOURCE_ENERGY));
      this.store.energy -= amount;
      target.store.energy += amount;
      return OK;
    },
    moveTo() {}
  };
  objects.set(id, creep);
  return creep;
}

const energy = require('../game/energy.js');

// A 2-WORK builder/worker with construction active can burn 10 e/t.
// The existing 12-tick logistics SLA therefore asks for 120 energy, capped by
// the creep's 100-energy store. One CARRY part of hysteresis starts the refill
// request at 50 energy, before the consumer becomes empty.
{
  const consumer = makeConsumer('worker-low-runway', 50, 0, false, true);
  const partial = makeHauler('hauler-low-runway', 50);
  const empty = makeHauler('hauler-empty', 0);
  room.creeps = [consumer, partial, empty];

  assert.equal(energy._test.consumerEnergyUsePerTick(consumer), 10);
  assert.equal(energy._test.consumerRefillTargetEnergy(consumer), 100);
  assert.equal(energy._test.consumerRefillRequestThresholdEnergy(consumer), 50);
  assert.equal(energy._test.consumerRefillEnergyNeeded(consumer), 50);
  assert.equal(energy._test.consumerHasLowRunway(consumer), true);
  assert.equal(energy.consumerNeedsDelivery(consumer), true);
  assert.equal(energy.isCriticalConsumerRequest(consumer), true);
  assert.equal(energy._test.haulerReadyToDeliver(partial), false);
  assert.equal(energy._test.selectConsumerEarlyDispatchHauler(room).id, partial.id);

  partial.memory.consumerTargetId = consumer.id;
  assert.equal(energy.deliverToConsumer(partial), true);
  assert.equal(consumer.store.energy, 100);
  assert.equal(consumer.memory.working, true);
  assert.equal(consumer.memory.waitingEnergyTicks, 0);
  assert.equal(consumer.memory.logisticsFallback, false);
  assert.equal(partial.memory.consumerTargetId, undefined);
}

// An empty 2-WORK construction consumer still has a 100-energy refill target,
// but one CARRY unit is enough to resume a useful work burst. The low-runway
// request remains active at 50 energy, so a second hauler may top the consumer
// up instead of waiting for it to become empty again.
{
  const consumer = makeConsumer('worker-empty-critical', 0, 4, true, false);
  const partial = makeHauler('hauler-short', 50);
  const empty = makeHauler('hauler-empty-2', 0);
  room.creeps = [consumer, partial, empty];

  assert.equal(energy._test.consumerRefillTargetEnergy(consumer), 100);
  assert.equal(energy._test.consumerResumeTargetEnergy(consumer), 50);
  assert.equal(energy._test.consumerRefillEnergyNeeded(consumer), 100);
  assert.equal(energy._test.consumerUsefulDeliveryEnergyNeeded(consumer), 50);
  assert.equal(energy._test.selectConsumerEarlyDispatchHauler(room).id, partial.id);
  assert.equal(energy.shouldInterruptPickupForConsumer(partial), true);

  partial.memory.consumerTargetId = consumer.id;
  assert.equal(energy.deliverToConsumer(partial), true);
  assert.equal(consumer.store.energy, 50);
  assert.equal(consumer.memory.working, true);
  assert.equal(consumer.memory.waitingEnergyTicks, 0);
  assert.equal(consumer.memory.logisticsFallback, false);
  assert.equal(partial.memory.consumerTargetId, undefined);
  assert.equal(energy.consumerNeedsDelivery(consumer), true);
  assert.equal(energy.isCriticalConsumerRequest(consumer), true);
}

// A transfer below one useful work burst must not clear fallback, but its
// completed travel reservation must be released so another hauler can help.
{
  const consumer = makeConsumer('worker-undersized-transfer', 0, 5, true, false);
  const short = makeHauler('hauler-undersized-transfer', 20);
  short.memory.consumerTargetId = consumer.id;
  room.creeps = [consumer, short];

  assert.equal(energy.deliverToConsumer(short), true);
  assert.equal(consumer.store.energy, 20);
  assert.equal(consumer.memory.working, false);
  assert.equal(consumer.memory.waitingEnergyTicks, 5);
  assert.equal(consumer.memory.logisticsFallback, true);
  assert.equal(short.memory.consumerTargetId, undefined);
}


// role.worker must shorten fallback residency only when live logistics exists.
// At one CARRY unit, work resumes and the low-runway request remains active;
// without a hauler, historical full-carry self-supply behavior is preserved.
{
  const roleWorker = require('../game/role.worker.js');

  const consumer = makeConsumer('worker-fallback-resume', 50, 0, true, false);
  const hauler1 = makeHauler('hauler-fallback-resume-1', 0);
  const hauler2 = makeHauler('hauler-fallback-resume-2', 0);
  room.creeps = [consumer, hauler1, hauler2];

  assert.equal(roleWorker._test.needsEnergy(consumer), false);
  assert.equal(consumer.memory.working, true);
  assert.equal(consumer.memory.logisticsFallback, false);
  assert.equal(consumer.memory.waitingEnergyTicks, 0);
  assert.equal(energy.consumerNeedsDelivery(consumer), true);

  const solo = makeConsumer('worker-fallback-solo', 50, 0, true, false);
  room.creeps = [solo];
  assert.equal(roleWorker._test.needsEnergy(solo), true);
  assert.equal(solo.memory.working, false);
  assert.equal(solo.memory.logisticsFallback, true);
}

console.log('consumer refill hysteresis tests passed');
