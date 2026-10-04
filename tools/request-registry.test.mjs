import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);
const registry = require('../game/request.registry.js');

function spec(key, amount = 5) {
  return {
    dedupeKey: key,
    domain: 'economy',
    kind: 'TEST_CAPACITY',
    target: { roomName: 'E1N1' },
    demand: { capability: 'workHarvest', amount, minimumUsefulAmount: 1 },
    priority: { base: 50, urgency: 10, strategicClass: 'CORE_ECONOMY' },
    utility: { current: amount, marginalModel: 'LINEAR' },
    evidence: { source: 'test' },
    shadow: true
  };
}

{
  const memory = {};
  const first = registry.upsert('E1N1', spec('economy:test', 5), memory, { time: 10 });
  assert.equal(first.status, registry.STATUS.OPEN);
  assert.equal(first.createdTick, 10);
  assert.equal(first.updatedTick, 10);
  assert.equal(first.demand.amount, 5);

  const same = registry.upsert('E1N1', spec('economy:test', 7), memory, { time: 11 });
  assert.equal(same.id, first.id);
  assert.equal(same.createdTick, 10);
  assert.equal(same.updatedTick, 11);
  assert.equal(same.demand.amount, 7);
  assert.equal(registry.list('E1N1', memory).length, 1);
}

{
  const memory = {};
  registry.upsert('E1N1', spec('reserve:test'), memory, { time: 20 });
  const reservation = registry.reserve('E1N1', 'reserve:test', {
    ownerType: 'creep', ownerId: 'c1', amount: 3, validUntilTick: 25
  }, memory, { time: 21 });
  assert.equal(reservation.amount, 3);
  let request = registry.list('E1N1', memory)[0];
  assert.equal(request.status, registry.STATUS.RESERVED);
  assert.equal(request.reservations.length, 1);

  registry.reserve('E1N1', 'reserve:test', {
    ownerType: 'creep', ownerId: 'c1', amount: 4, validUntilTick: 26
  }, memory, { time: 22 });
  request = registry.list('E1N1', memory)[0];
  assert.equal(request.reservations.length, 1);
  assert.equal(request.reservations[0].amount, 4);
  assert.equal(request.reservations[0].createdTick, 21);

  registry.reconcile('E1N1', ['reserve:test'], memory, { time: 27 });
  request = registry.list('E1N1', memory)[0];
  assert.equal(request.reservations.length, 0);
  assert.equal(request.status, registry.STATUS.OPEN);
}

{
  const memory = {};
  registry.upsert('E1N1', spec('block:test'), memory, { time: 30 });
  registry.block('E1N1', 'block:test', 'NO_PATH', 35, memory, { time: 31 });
  let request = registry.list('E1N1', memory)[0];
  assert.equal(request.status, registry.STATUS.BLOCKED);
  assert.equal(request.blocked.failureCount, 1);
  assert.equal(request.blocked.reason, 'NO_PATH');

  registry.upsert('E1N1', spec('block:test'), memory, { time: 34 });
  request = registry.list('E1N1', memory)[0];
  assert.equal(request.status, registry.STATUS.BLOCKED);

  registry.upsert('E1N1', spec('block:test'), memory, { time: 35 });
  request = registry.list('E1N1', memory)[0];
  assert.equal(request.status, registry.STATUS.OPEN);
  assert.equal(request.blocked.reason, null);
}

{
  const memory = {};
  registry.upsert('E1N1', spec('progress:test', 5), memory, { time: 40 });
  let request = registry.progress('E1N1', 'progress:test', 2, memory, { time: 41 });
  assert.equal(request.status, registry.STATUS.IN_PROGRESS);
  assert.equal(request.progress.amount, 2);
  assert.equal(request.progress.lastProgressTick, 41);

  request = registry.progress('E1N1', 'progress:test', 3, memory, { time: 42 });
  assert.equal(request.status, registry.STATUS.SATISFIED);
  assert.equal(request.progress.amount, 5);

  request = registry.upsert('E1N1', spec('progress:test', 5), memory, { time: 43 });
  assert.equal(request.status, registry.STATUS.OPEN);
  assert.equal(request.progress.amount, 0);
}

{
  const memory = {};
  const deadlineSpec = spec('deadline:test');
  deadlineSpec.deadlineTick = 50;
  registry.upsert('E1N1', deadlineSpec, memory, { time: 49 });
  registry.reconcile('E1N1', ['deadline:test'], memory, { time: 51 });
  const request = registry.list('E1N1', memory)[0];
  assert.equal(request.status, registry.STATUS.EXPIRED);
}

{
  const memory = {};
  registry.upsert('E1N1', spec('gone:test'), memory, { time: 60 });
  registry.reconcile('E1N1', [], memory, { time: 61 });
  let summary = registry.snapshot('E1N1', memory);
  assert.equal(summary.total, 0);
  assert.equal(summary.stored, 1);
  assert.equal(summary.terminal, 1);
  assert.equal(summary.byStatus.SATISFIED, 1);
  assert.deepEqual(summary.byDomain, {});

  const result = registry.reconcile('E1N1', [], memory, { time: 72 }, 10);
  assert.equal(result.pruned, 1);
  summary = registry.snapshot('E1N1', memory);
  assert.equal(summary.stored, 0);
}

{
  const memory = {};
  registry.upsert('E1N1', spec('a:test'), memory, { time: 80 });
  const b = spec('b:test');
  b.domain = 'logistics';
  registry.upsert('E1N1', b, memory, { time: 80 });
  registry.block('E1N1', 'b:test', 'WAIT', 90, memory, { time: 80 });
  const summary = registry.snapshot('E1N1', memory);
  assert.equal(summary.total, 2);
  assert.equal(summary.open, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.stored, 2);
  assert.equal(summary.terminal, 0);
  assert.equal(summary.byDomain.economy, 1);
  assert.equal(summary.byDomain.logistics, 1);
}

console.log('request registry tests passed');