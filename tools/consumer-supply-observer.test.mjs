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
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;

const observer = require('../game/consumer.supply.observer.js');
const config = require('../game/config.js');
const room = { name: 'E8N1' };
function creep(id, role, carried, capacity, memory = {}) {
  return { id, name: id, room, spawning: false,
    memory: { role, ...memory },
    store: { energy: carried, getCapacity(resource) {
      assert.equal(resource, RESOURCE_ENERGY);
      return capacity;
    } }
  };
}
const loaded = creep('loaded', 'hauler', 300, 300, { delivering: true });
const collecting = creep('collecting', 'hauler', 25, 300, { delivering: false });
const fallback = creep('fallback', 'upgrader', 0, 100,
  { logisticsFallback: true, waitingEnergyTicks: 0 });
const waiting = creep('waiting', 'worker', 0, 100,
  { logisticsFallback: false, waitingEnergyTicks: 3 });
const g = global.Game = { time: 1000, cpu: { bucket: 8000, limit: 30,
  getUsed() { return 10; } }, creeps: { loaded, collecting, fallback, waiting } };
const eventRows = [];
const logger = { info(code, msg, ctx, opts) { eventRows.push({ code, msg, ctx, opts }); } };
const state = { room };
const before = JSON.stringify(g.creeps);

assert.equal(observer._test.sampled(g), true);
assert.equal(observer._test.eligible(g), true);
assert.deepEqual(observer._test.haulerReadiness(loaded),
  { carried: 300, capacity: 300, ready: true });
assert.equal(observer._test.haulerReadiness(collecting).ready, false);
observer.recordGuard(loaded, true);
observer.recordGuard(loaded, true);
observer.recordGuard(collecting, false);
observer.recordResult(loaded, 'consumer', OK);
observer.recordResult(loaded, 'consumer', ERR_NOT_IN_RANGE);
observer.recordResult(loaded, 'consumer', -8);
observer.recordResult(loaded, 'infrastructure', OK);
observer.recordResult(collecting, 'haulerAcquisition', ERR_NOT_IN_RANGE);

assert.equal(observer.flush([state], logger, g), 1);
assert.equal(eventRows.length, 1);
const evt = eventRows[0];
assert.equal(evt.code, 'CONSUMER_SUPPLY_DIAG');
assert.equal(evt.ctx.room, 'E8N1');
assert.equal(evt.ctx.phase, 'AFTER_CREEP_INTENTS_BEFORE_RESOLUTION');
assert.equal(evt.ctx.sampledCreepCount, 4);
assert.deepEqual(evt.ctx.haulers, {
  live: 2, energyPositive: 2, deliveringFlag: 1,
  readyByGuardRule: 1, zeroEnergy: 0, totalCarriedEnergy: 325,
  capacityUnknown: 0
});
assert.deepEqual(evt.ctx.consumers,
  { live: 2, waiting: 1, fallback: 1, critical: 2, empty: 2 });
assert.deepEqual(evt.ctx.decisions,
  { guardChecks: 3, guardSelected: 2, uniqueGuardHaulers: 1 });
assert.deepEqual(evt.ctx.consumerTransfers,
  { attempted: 3, accepted: 1, notInRange: 1, other: 1 });
assert.deepEqual(evt.ctx.infrastructureTransfers,
  { attempted: 1, accepted: 1, notInRange: 0, other: 0 });
assert.deepEqual(evt.ctx.haulerAcquisitions,
  { attempted: 1, accepted: 0, notInRange: 1, other: 0 });
assert.equal(evt.ctx.acceptedIsIntentNotSettled, true);
assert.equal(evt.opts.journal, true);
assert.equal(evt.opts.persist, undefined);
assert.equal(JSON.stringify(g.creeps), before,
  'observer must never mutate creep stores or memory');

g.time = 1001;
observer.recordGuard(loaded, true);
assert.equal(observer.flush([state], logger, g), 0,
  'off-cadence does not emit');
assert.equal(eventRows.length, 1);

g.time = 1025;
g.cpu.bucket = config.CPU_BUCKET_LOW - 1;
observer.recordGuard(loaded, true);
assert.equal(observer.flush([state], logger, g), 0,
  'skip optional telemetry under bucket pressure');
g.cpu.bucket = 8000;
g.cpu.getUsed = () => 29.9;
assert.equal(observer.flush([state], logger, g), 0,
  'skip optional telemetry under CPU headroom pressure');
g.cpu.getUsed = () => 10;
assert.equal(observer.flush([state], logger, g), 1);
assert.equal(eventRows[1].ctx.decisions.guardChecks, 1);
assert.equal(eventRows[1].ctx.decisions.guardSelected, 1);
assert.equal(eventRows[1].ctx.consumerTransfers.attempted, 0,
  'previous tick action counters must not leak');

g.time = 1050;
const unknownCapacity = creep('unknown', 'hauler', 99, 0);
unknownCapacity.store.getCapacity = () => undefined;
g.creeps = { unknownCapacity };
assert.equal(observer.flush([state], logger, g), 1);
assert.equal(eventRows[2].ctx.haulers.capacityUnknown, 1);
assert.equal(eventRows[2].ctx.haulers.readyByGuardRule, 0);
g.time = 1075;
g.creeps = Object.fromEntries(Array.from({ length: 121 }, (_, i) =>
  ['c' + i, creep('c' + i, 'hauler', 0, 100)]));
assert.equal(observer.flush([state], logger, g), 0,
  'oversized creep enumeration must skip, not report partial counts');

// Strict multi-room sampling bound: do not report an arbitrary partial
// three-room census if runtime ever grows to four owned rooms.
g.time = 1100;
g.creeps = { loaded };
const fourRooms = ['E8N1', 'E8N2', 'E9N1', 'E9N2']
  .map(name => ({ room: { name } }));
const priorCount = eventRows.length;
assert.equal(observer.flush(fourRooms, logger, g), 0);
assert.equal(eventRows.length, priorCount,
  'more than three owned rooms must skip optional telemetry altogether');
assert.equal(observer.flush(fourRooms.slice(0, 3), logger, g), 3,
  'three rooms remain inside supported optional sample bound');
assert.equal(eventRows.length, priorCount + 3);

console.log('post-creep observer: read-only guard and intent diagnostics PASS');
