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
global.FIND_DROPPED_RESOURCES = 10;
global.FIND_TOMBSTONES = 11;
global.FIND_STRUCTURES = 3;
global.FIND_SOURCES = 4;
global.STRUCTURE_CONTAINER = 'container';
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_NO_PATH = -2;
global.ERR_INVALID_TARGET = -7;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_BUSY = -4;

const energy = require('../game/energy.js');
const config = require('../game/config.js');
const drop = {resourceType: RESOURCE_ENERGY, amount: 40};
const container = {structureType: STRUCTURE_CONTAINER, store: {energy: 250}};
const tomb = {store: {energy: 30}};
const source = {pos: {getRangeTo() {return 1;}}};
let present = {drop: true, container: true, tomb: true};
const room = {
  name: 'E1N1',
  find(type, opts) {
    const a = type === FIND_SOURCES ? [source] :
      type === FIND_STRUCTURES ? (present.container ? [container] : []) : [];
    return opts?.filter ? a.filter(opts.filter) : a;
  }
};
let pickupRc = OK, moveRc = OK, withdrawRc = OK, tombWithdrawRc = null;
let calls = [];
const carrier = {
  room, memory: {role: 'hauler'}, store: {energy: 0},
  pos: {
    findClosestByPath(targets, opts) {
      if (opts) assert.equal(opts.maxOps, config.PATH_MAX_OPS);
      const a = Array.isArray(targets) ? targets :
        targets === FIND_DROPPED_RESOURCES ? (present.drop ? [drop] : []) :
        targets === FIND_TOMBSTONES ? (present.tomb ? [tomb] : []) : [];
      return (opts?.filter ? a.filter(opts.filter) : a)[0] || null;
    }
  },
  pickup(target) {
    calls.push(['pickup', target]);
    return pickupRc;
  },
  withdraw(target, resource) {
    assert.equal(resource, RESOURCE_ENERGY);
    calls.push(['withdraw', target]);
    return target === tomb && tombWithdrawRc !== null
      ? tombWithdrawRc : withdrawRc;
  },
  moveTo(target, opts) {
    calls.push(['move', target]);
    assert.equal(opts.maxOps, config.PATH_MAX_OPS);
    return moveRc;
  }
};
function reset() {
  calls = []; pickupRc = OK; withdrawRc = OK;
  tombWithdrawRc = null; moveRc = OK;
  present = {drop: true, container: true, tomb: true};
}

// Terminal route failure of a preferred dropped pile must not freeze the
// hauler when a source container can accept a real pickup.
reset();
pickupRc = ERR_NOT_IN_RANGE; moveRc = ERR_NO_PATH;
assert.equal(energy.acquireForHauler(carrier), true);
assert.deepEqual(calls, [
  ['pickup', drop], ['move', drop], ['withdraw', container]
]);

// An exhausted-but-still-listed drop is not a successful pickup intent.
reset();
pickupRc = ERR_NOT_ENOUGH_RESOURCES;
assert.equal(energy.acquireForHauler(carrier), true);
assert.deepEqual(calls, [['pickup', drop], ['withdraw', container]]);

// A confirmed ACCEPTED intent must never be followed by another acquisition
// action in the same tick (the engine has not yet settled its energy).
reset();
assert.equal(energy.acquireForHauler(carrier), true);
assert.deepEqual(calls, [['pickup', drop]]);

// Viable or transiently busy movement must not be overwritten by the alternate.
for (const code of [OK, ERR_BUSY]) {
  reset(); pickupRc = ERR_NOT_IN_RANGE; moveRc = code;
  assert.equal(energy.acquireForHauler(carrier), true);
  assert.deepEqual(calls, [['pickup', drop], ['move', drop]]);
}

// A terminally invalid drop may fall through to a tombstone if there is no
// source container; the acquisition attempt count remains <= 2.
reset();
pickupRc = ERR_INVALID_TARGET;
present.container = false;
assert.equal(energy.acquireForHauler(carrier), true);
assert.deepEqual(calls, [['pickup', drop], ['withdraw', tomb]]);

// Stale, just-emptied source containers and permanently unreachable
// container routes must not hold an empty hauler idle. Fall through to a
// tombstone only after a terminal outcome, never after an accepted intent.
for (const code of [ERR_NOT_ENOUGH_RESOURCES, ERR_INVALID_TARGET]) {
  reset(); present.drop = false; withdrawRc = code;
  tombWithdrawRc = OK;
  assert.equal(energy.acquireForHauler(carrier),true);
  assert.deepEqual(calls,[['withdraw',container],['withdraw',tomb]],
    'terminal source container withdrawal can retry a distinct energy source');
}
for (const code of [ERR_NO_PATH,ERR_INVALID_TARGET]) {
  reset(); present.drop = false;
  withdrawRc = ERR_NOT_IN_RANGE; moveRc = code;
  assert.equal(energy.acquireForHauler(carrier),false,
    'terminal alternate tombstone route must permit role-level repositioning');
  assert.deepEqual(calls,[
    ['withdraw',container],['move',container],
    ['withdraw',tomb],['move',tomb]
  ],'terminally blocked container route can instead approach the tombstone');
}
for (const code of [OK,ERR_BUSY]) {
  reset(); present.drop = false;
  withdrawRc = ERR_NOT_IN_RANGE; moveRc = code;
  assert.equal(energy.acquireForHauler(carrier),true);
  assert.deepEqual(calls,[['withdraw',container],['move',container]],
    'accepted or transient movement must never create a second action');
}
reset(); present.drop = false;
assert.equal(energy.acquireForHauler(carrier),true);
assert.deepEqual(calls,[['withdraw',container]],
  'accepted container withdraw blocks all competing same-tick actions');

reset(); present.drop = false; present.tomb = false;
withdrawRc = ERR_NOT_ENOUGH_RESOURCES;
assert.equal(energy.acquireForHauler(carrier),false);
assert.deepEqual(calls,[['withdraw',container]],
  'terminal empty container with no alternate source permits role-level fallback');

reset(); present.drop = false; present.tomb = false;
withdrawRc = ERR_NOT_IN_RANGE; moveRc = ERR_NO_PATH;
assert.equal(energy.acquireForHauler(carrier),false);
assert.deepEqual(calls,[['withdraw',container],['move',container]],
  'unreachable container and no alternate permits role-level repositioning');

// Even if an earlier dropped pile failed, stop after a successful tombstone
// intent and never exceed the bounded sequence of three attempted sources.
reset(); pickupRc = ERR_NOT_ENOUGH_RESOURCES;
withdrawRc = ERR_NOT_ENOUGH_RESOURCES;
tombWithdrawRc = OK;
assert.equal(energy.acquireForHauler(carrier),true);
assert.deepEqual(calls,[
  ['pickup',drop],['withdraw',container],['withdraw',tomb]
]);

// The final tombstone candidate is not a successful collection when its
// energy disappeared, the target became invalid, or routing is terminal.
for (const code of [ERR_NOT_ENOUGH_RESOURCES, ERR_INVALID_TARGET]) {
  reset();
  present.drop = false; present.container = false;
  tombWithdrawRc = code;
  assert.equal(energy.acquireForHauler(carrier), false,
    'terminal tombstone withdrawal allows role-level positioning fallback');
  assert.deepEqual(calls, [['withdraw', tomb]]);
}
for (const code of [ERR_NO_PATH, ERR_INVALID_TARGET]) {
  reset();
  present.drop = false; present.container = false;
  tombWithdrawRc = ERR_NOT_IN_RANGE; moveRc = code;
  assert.equal(energy.acquireForHauler(carrier), false,
    'terminal tombstone route permits role-level positioning fallback');
  assert.deepEqual(calls, [['withdraw', tomb], ['move', tomb]]);
}
for (const code of [OK, ERR_BUSY]) {
  reset();
  present.drop = false; present.container = false;
  tombWithdrawRc = ERR_NOT_IN_RANGE; moveRc = code;
  assert.equal(energy.acquireForHauler(carrier), true,
    'accepted or transient tombstone movement remains in progress');
  assert.deepEqual(calls, [['withdraw', tomb], ['move', tomb]]);
}

// Integration: real acquisition paths must populate the sampled diagnostic
// with the actual move return code, without generating new creep intents.
{
  const observer = require('../game/consumer.supply.observer.js');
  const previousGame = global.Game;
  const previousPos = carrier.pos;
  const snapshots = [];
  const logger = { info(_code, _msg, ctx) { snapshots.push(ctx); } };
  global.Game = {
    time: 2000,
    creeps: { carrier },
    cpu: { bucket: 10000, limit: 30, getUsed() { return 1; } }
  };
  carrier.pos = { ...previousPos, getRangeTo() { return 9; } };
  for (const scenario of [
    { tick: 2000, kind: 'drop', code: OK },
    { tick: 2025, kind: 'container', code: ERR_NO_PATH },
    { tick: 2050, kind: 'tomb', code: ERR_BUSY }
  ]) {
    reset();
    global.Game.time = scenario.tick;
    present.drop = scenario.kind === 'drop';
    present.container = scenario.kind === 'container';
    present.tomb = scenario.kind === 'tomb';
    pickupRc = withdrawRc = tombWithdrawRc = ERR_NOT_IN_RANGE;
    moveRc = scenario.code;
    energy.acquireForHauler(carrier);
    assert.equal(observer.flush([{ room }], logger, global.Game), 1);
    const travel = snapshots.at(-1).acquisitionTravel;
    assert.equal(travel.moveAttempts, 1);
    assert.equal(travel.range6to10, 1);
    assert.equal(travel.moveAccepted, scenario.code === OK ? 1 : 0);
    assert.equal(travel.moveNoPath, scenario.code === ERR_NO_PATH ? 1 : 0);
    assert.equal(travel.moveTemporarilyBlocked, scenario.code === ERR_BUSY ? 1 : 0);
    assert.equal(snapshots.at(-1).haulerAcquisitions.notInRange, 1);
    assert.equal(snapshots.at(-1).acceptedIsIntentNotSettled, true);
  }
  carrier.pos = previousPos;
  global.Game = previousGame;
}

// No viable resource: report false and let the established role-level
// harvester/container positioning fallback run.
reset();
present = {drop: false, container: false, tomb: false};
assert.equal(energy.acquireForHauler(carrier), false);
assert.deepEqual(calls, []);
console.log('hauler terminal drop-source failover tests passed');
