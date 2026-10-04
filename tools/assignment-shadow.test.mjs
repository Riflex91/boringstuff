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
global.CARRY = 'carry';
global.MOVE = 'move';
global.RESOURCE_ENERGY = 'energy';
global.CARRY_CAPACITY = 50;

const assignment = require('../game/assignment.shadow.js');

function creep(id, role, parts, x = 10, y = 10, energy = 0) {
  return {
    id,
    name: id,
    spawning: false,
    room: { name: 'E1N1' },
    pos: {
      x, y, roomName: 'E1N1',
      getRangeTo(tx, ty) { return Math.max(Math.abs(x - tx), Math.abs(y - ty)); }
    },
    memory: { role },
    store: { energy },
    getActiveBodyparts(type) { return parts[type] || 0; }
  };
}

function request(id, kind, capability, amount, options = {}) {
  return {
    id,
    dedupeKey: options.dedupeKey || id,
    domain: options.domain || 'test',
    kind,
    status: options.status || 'OPEN',
    target: {
      roomName: options.roomName || 'E1N1',
      pos: options.pos || { x: 20, y: 20, roomName: options.roomName || 'E1N1' }
    },
    demand: { capability, amount },
    priority: {
      base: options.base ?? 50,
      urgency: options.urgency ?? 0,
      strategicClass: options.strategicClass || 'STANDARD'
    },
    utility: { current: options.utility ?? amount, marginalModel: 'LINEAR' },
    risk: options.risk || 0,
    deadlineTick: Number.isFinite(options.deadlineTick) ? options.deadlineTick : null,
    progress: { amount: options.progress || 0, lastProgressTick: null },
    reservations: options.reservations || []
  };
}

{
  const h = creep('h1', 'hauler', { carry: 4, move: 2 }, 10, 10, 100);
  const harvester = creep('m1', 'harvester', { work: 5, carry: 1, move: 3 });
  const worker = creep('w1', 'worker', { work: 3, carry: 2, move: 3 }, 10, 10, 50);
  assert.equal(assignment._test.capabilityFor(h, request('r1', 'ENERGY_DELIVERY', null, 100)), 200);
  assert.equal(assignment._test.capabilityFor(h, request('r2', 'HAUL_CAPACITY', 'carry', 4)), 0);
  assert.equal(assignment._test.capabilityFor(harvester, request('r3', 'HARVEST_CAPACITY', 'workHarvest', 5)), 0);
  assert.equal(assignment._test.capabilityFor(worker, request('r4', 'BUILD', 'workBuild', 3)), 3);
  assert.equal(assignment._test.capabilityFor(worker, request('r5', 'RECOVERY_CAPACITY', 'bootstrap', 1)), 0);
  assert.equal(assignment._test.capabilityFor(worker, request('r6', 'ENERGY_DELIVERY', null, 50)), 0);
}

{
  const memory = {};
  const h1 = creep('h1', 'hauler', { carry: 2, move: 1 }, 10, 10, 100);
  const h2 = creep('h2', 'hauler', { carry: 2, move: 1 }, 11, 10, 0);
  const r = request('delivery1', 'ENERGY_DELIVERY', null, 50, { pos: { x: 12, y: 10, roomName: 'E1N1' }, base: 80 });
  const plan = assignment.plan('E1N1', [r], [h1, h2], memory, { time: 100 });
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.assignments[0].executorId, 'h1');
  assert.equal(plan.assignments[0].reservedCapacity, 50);
  assert.equal(plan.unfilled.length, 0);
  assert.equal(plan.summary.assignmentCount, 1);
}

{
  const memory = {};
  const h1 = creep('h1', 'hauler', { carry: 2, move: 1 }, 10, 10, 50);
  const h2 = creep('h2', 'hauler', { carry: 2, move: 1 }, 40, 40, 50);
  const a = request('a', 'ENERGY_DELIVERY', null, 50, { pos: { x: 11, y: 10, roomName: 'E1N1' }, base: 80 });
  const b = request('b', 'ENERGY_DELIVERY', null, 50, { pos: { x: 39, y: 40, roomName: 'E1N1' }, base: 80 });
  const plan = assignment.plan('E1N1', [a, b], [h1, h2], memory, { time: 110 });
  assert.equal(plan.assignments.length, 2);
  const pairs = Object.fromEntries(plan.assignments.map(x => [x.executorId, x.requestId]));
  assert.equal(pairs.h1, 'a');
  assert.equal(pairs.h2, 'b');
  assert.equal(plan.unfilled.length, 0);
}

{
  const memory = {};
  const h = creep('h-cont', 'hauler', { carry: 2, move: 1 }, 10, 10, 0);
  const a = request('req-a', 'ENERGY_DELIVERY', null, 50, { pos: { x: 20, y: 10, roomName: 'E1N1' }, base: 60 });
  const b = request('req-b', 'ENERGY_DELIVERY', null, 50, { pos: { x: 20, y: 10, roomName: 'E1N1' }, base: 60 });
  const roomState = assignment.ensureRoom('E1N1', memory);
  roomState.previousByExecutor['h-cont'] = { requestId: 'req-b', tick: 119 };
  const plan = assignment.plan('E1N1', [a, b], [h], memory, { time: 120 });
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.assignments[0].requestId, 'req-b');
  assert.equal(plan.assignments[0].score.continuationBonus, 20);
}

{
  const memory = {};
  const w = creep('worker1', 'worker', { work: 2, carry: 2, move: 2 }, 10, 10, 50);
  const normal = request('build1', 'BUILD', 'workBuild', 2, { base: 95, utility: 20, pos: { x: 11, y: 10, roomName: 'E1N1' } });
  const recovery = request('recovery1', 'RECOVERY_WORK', 'workBuild', 1, {
    base: 80, utility: 1, strategicClass: 'RECOVERY', pos: { x: 40, y: 40, roomName: 'E1N1' }
  });
  const plan = assignment.plan('E1N1', [normal, recovery], [w], memory, { time: 130 });
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.assignments[0].requestId, 'recovery1');
  assert.equal(plan.assignments[0].score.emergencyBonus, 100);
}

{
  const memory = {};
  const h = creep('h-res', 'hauler', { carry: 2, move: 1 }, 10, 10, 100);
  const r = request('reserved', 'ENERGY_DELIVERY', null, 100, {
    reservations: [{ amount: 100 }], base: 100
  });
  const plan = assignment.plan('E1N1', [r], [h], memory, { time: 140 });
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.unfilled.length, 0);
}

{
  const memory = {};
  const h = creep('h-fail', 'hauler', { carry: 2, move: 1 }, 10, 10, 100);
  const r = request('fail-request', 'ENERGY_DELIVERY', null, 50, { base: 100 });
  assignment.recordFailure('E1N1', 'h-fail', 'fail-request', 'NO_PATH', 155, memory, { time: 150 });
  let plan = assignment.plan('E1N1', [r], [h], memory, { time: 151 });
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.unfilled.length, 1);
  plan = assignment.plan('E1N1', [r], [h], memory, { time: 155 });
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.assignments[0].executorId, 'h-fail');
}

{
  const memory = {};
  const h = creep('h-switch', 'hauler', { carry: 2, move: 1 }, 10, 10, 50);
  const a = request('switch-a', 'ENERGY_DELIVERY', null, 50, { base: 80 });
  let plan = assignment.plan('E1N1', [a], [h], memory, { time: 160 });
  assert.equal(plan.summary.switchCount, 0);
  const b = request('switch-b', 'ENERGY_DELIVERY', null, 50, { base: 80 });
  plan = assignment.plan('E1N1', [b], [h], memory, { time: 161 });
  assert.equal(plan.summary.switchCount, 1);
  assert.equal(plan.assignments[0].requestId, 'switch-b');
}

{
  const memory = {};
  const h = creep('h-deadline', 'hauler', { carry: 1, move: 1 }, 10, 10, 0);
  const normal = request('normal', 'ENERGY_DELIVERY', null, 50, { base: 70, deadlineTick: null });
  const urgent = request('urgent', 'ENERGY_DELIVERY', null, 50, { base: 50, deadlineTick: 170 });
  const plan = assignment.plan('E1N1', [normal, urgent], [h], memory, { time: 170 });
  assert.equal(plan.assignments[0].requestId, 'urgent');
  assert.equal(plan.assignments[0].score.deadline, 100);
}

{
  const memory = {};
  const h = creep('h-blocked', 'hauler', { carry: 2, move: 1 });
  const blocked = request('blocked', 'ENERGY_DELIVERY', null, 50, { status: 'BLOCKED', base: 100 });
  const plan = assignment.plan('E1N1', [blocked], [h], memory, { time: 180 });
  assert.equal(plan.summary.requestCount, 0);
  assert.equal(plan.assignments.length, 0);
}

{
  const capacity = request('capacity-only', 'HAUL_CAPACITY', 'carry', 4, { base: 100 });
  assert.equal(assignment._test.requestAssignable(capacity), false);
  for (const kind of ['PICKUP', 'DELIVER', 'BALANCE', 'RESERVE', 'EMERGENCY_DELIVER']) {
    assert.equal(assignment._test.requestAssignable(request('e3-' + kind, kind, 'transportEnergy', 50)), false);
  }
  const work = request('work-only', 'BUILD', 'workBuild', 2, { base: 50 });
  assert.equal(assignment._test.requestAssignable(work), true);
}

{
  const memory = {};
  const h = creep('h-defer', 'hauler', { carry: 2, move: 1 }, 10, 10, 50);
  const r = request('defer-r', 'ENERGY_DELIVERY', null, 50, { base: 80 });
  const plan = assignment.plan('E1N1', [r], [h], memory, { time: 190 });
  assert.equal(plan.summary.planTick, 190);
  assert.equal(plan.summary.deferred, false);
  const deferred = assignment.deferredSnapshot('E1N1', 'LOW_CPU', memory);
  assert.equal(deferred.planTick, 190);
  assert.equal(deferred.deferred, true);
  assert.equal(deferred.deferReason, 'LOW_CPU');
  assert.equal(deferred.assignmentCount, plan.summary.assignmentCount);
}

console.log('assignment shadow tests passed');