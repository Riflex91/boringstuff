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

const matcher = require('../game/logistics.matching.shadow.js');
const registry = require('../game/request.registry.js');

function pos(x, y, roomName = 'E1N1') {
  return {
    x, y, roomName,
    getRangeTo(other) {
      const p = other && other.pos ? other.pos : other;
      return Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
    }
  };
}

function hauler(id, x, y, energy = 0, capacity = 50) {
  return {
    id,
    name: id,
    spawning: false,
    room: { name: 'E1N1' },
    pos: pos(x, y),
    memory: { role: 'hauler' },
    store: {
      energy,
      getFreeCapacity(resource) {
        assert.equal(resource, 'energy');
        return Math.max(0, capacity - energy);
      },
      getCapacity(resource) {
        assert.equal(resource, 'energy');
        return capacity;
      }
    }
  };
}

function endpoint(id, x, y) {
  return { roomName: 'E1N1', id, pos: { x, y, roomName: 'E1N1' } };
}

function pickup(key, amount, x = 5, y = 5) {
  return {
    dedupeKey: key,
    domain: 'logistics',
    kind: 'PICKUP',
    source: endpoint(key + '-src', x, y),
    target: { roomName: 'E1N1' },
    demand: {
      resourceType: 'energy',
      capability: 'transportEnergy',
      amount,
      minimumUsefulAmount: Math.min(50, amount),
      maximumUsefulAmount: amount
    },
    priority: { base: 80, urgency: 0, strategicClass: 'CORE_ECONOMY' },
    utility: { current: amount, marginalModel: 'SATURATING' },
    evidence: { source: 'test' },
    shadow: true
  };
}

function delivery(key, amount, x, y, emergency = false, base = 80, urgency = 0) {
  return {
    dedupeKey: key,
    domain: 'logistics',
    kind: emergency ? 'EMERGENCY_DELIVER' : 'DELIVER',
    source: null,
    target: endpoint(key + '-target', x, y),
    demand: {
      resourceType: 'energy',
      capability: 'transportEnergy',
      amount,
      minimumUsefulAmount: Math.min(50, amount),
      maximumUsefulAmount: amount
    },
    priority: {
      base,
      urgency,
      strategicClass: emergency ? 'CORE_ECONOMY' : 'PRODUCTIVE_WORK'
    },
    utility: { current: amount, marginalModel: 'SATURATING' },
    evidence: { source: 'test' },
    shadow: true
  };
}

function add(memory, time, specs) {
  for (const spec of specs) registry.upsert('E1N1', spec, memory, { time });
  return registry.list('E1N1', memory);
}

{
  const memory = {};
  const specs = [
    pickup('pickup-main', 200, 5, 5),
    delivery('critical-a', 50, 15, 10, true, 100, 50),
    delivery('critical-b', 50, 20, 10, true, 95, 40)
  ];
  const requests = add(memory, 100, specs);
  const state = {
    room: { name: 'E1N1' },
    creeps: [
      hauler('h1', 6, 5, 0, 50),
      hauler('h2', 7, 5, 0, 50)
    ]
  };

  const plan = matcher.plan(state, requests, memory, { time: 100 });
  assert.equal(plan.authority, 'SHADOW');
  assert.equal(plan.summary.haulerCount, 2);
  assert.equal(plan.summary.jobCount, 2);
  assert.equal(plan.summary.pairedJobCount, 2);
  assert.equal(plan.summary.directCarriedJobCount, 0);
  assert.equal(plan.summary.criticalRequestCount, 2);
  assert.equal(plan.summary.criticalMatchedCount, 2);
  assert.equal(plan.summary.unmatchedCriticalCount, 0);
  assert.equal(plan.summary.reservedAmount, 100);
  assert.equal(new Set(plan.jobs.map(j => j.haulerId)).size, 2);
  assert.equal(new Set(plan.jobs.map(j => j.demandRequestId)).size, 2);
  assert.ok(plan.jobs.every(j => j.mode === 'PICKUP_DELIVER'));
  assert.ok(plan.jobs.every(j => j.reservationIds.length === 2));
  assert.equal(plan.requestSummary.reservationCount, 4);

  // E4 reservations are tick-short evidence. E3 upsert on the next tick expires
  // them before a fresh matching pass.
  add(memory, 101, specs);
  assert.equal(registry.snapshot('E1N1', memory).reservationCount, 0);
}

{
  const memory = {};
  const specs = [
    delivery('urgent-partial', 50, 11, 10, true, 100, 80)
  ];
  const requests = add(memory, 200, specs);
  const state = {
    room: { name: 'E1N1' },
    creeps: [hauler('partial', 10, 10, 30, 100)]
  };

  const plan = matcher.plan(state, requests, memory, { time: 200 });
  assert.equal(plan.summary.jobCount, 1);
  assert.equal(plan.summary.directCarriedJobCount, 1);
  assert.equal(plan.summary.pairedJobCount, 0);
  assert.equal(plan.jobs[0].mode, 'DIRECT_CARRIED');
  assert.equal(plan.jobs[0].amount, 30);
  assert.equal(plan.jobs[0].supplyRequestId, null);
  assert.equal(plan.jobs[0].predicted.pickupTick, null);
  assert.equal(plan.requestSummary.reservationCount, 1);
}

{
  const memory = {};
  const specs = [
    delivery('route-a', 50, 15, 10, false, 80, 0),
    delivery('route-b', 50, 15, 10, false, 80, 0)
  ];
  const requests = add(memory, 300, specs);
  const byKey = Object.fromEntries(requests.map(r => [r.dedupeKey, r]));
  const roomState = matcher._test.ensureRoom('E1N1', memory);
  roomState.previousByHauler['reuse'] = {
    supplyRequestId: null,
    demandRequestId: byKey['route-b'].id,
    tick: 299
  };

  const plan = matcher.plan({
    room: { name: 'E1N1' },
    creeps: [hauler('reuse', 10, 10, 50, 50)]
  }, requests, memory, { time: 300 });

  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.jobs[0].demandDedupeKey, 'route-b');
  assert.equal(plan.jobs[0].scoreComponents.routeReuse, 12);
}

{
  const memory = {};
  const specs = [
    pickup('reserved-supply', 100, 5, 5),
    delivery('needs-50', 50, 15, 15, true, 100, 50)
  ];
  let requests = add(memory, 400, specs);
  registry.reserve('E1N1', 'reserved-supply', {
    ownerType: 'other-shadow',
    ownerId: 'other',
    amount: 80,
    validUntilTick: 400
  }, memory, { time: 400 });
  requests = registry.list('E1N1', memory);

  const plan = matcher.plan({
    room: { name: 'E1N1' },
    creeps: [hauler('remaining', 6, 5, 0, 50)]
  }, requests, memory, { time: 400 });

  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.jobs[0].amount, 20);
  const supply = registry.list('E1N1', memory).find(r => r.dedupeKey === 'reserved-supply');
  assert.equal(supply.reservations.length, 2);
  assert.equal(supply.reservations.reduce((sum, r) => sum + r.amount, 0), 100);
}

{
  const memory = {};
  const balance = {
    dedupeKey: 'balance-controller',
    domain: 'logistics',
    kind: 'BALANCE',
    source: endpoint('source-buffer', 5, 5),
    target: endpoint('controller-buffer', 20, 20),
    demand: {
      resourceType: 'energy',
      capability: 'transportEnergy',
      amount: 100,
      minimumUsefulAmount: 50,
      maximumUsefulAmount: 100
    },
    priority: { base: 45, urgency: 0, strategicClass: 'PRODUCTIVE_WORK' },
    utility: { current: 100, marginalModel: 'SATURATING' },
    evidence: { source: 'test' },
    shadow: true
  };
  const requests = add(memory, 450, [balance]);
  const plan = matcher.plan({
    room: { name: 'E1N1' },
    creeps: [hauler('balance-hauler', 6, 5, 0, 50)]
  }, requests, memory, { time: 450 });

  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.jobs[0].mode, 'BALANCE');
  assert.equal(plan.jobs[0].amount, 50);
  assert.equal(plan.jobs[0].supplyRequestId, plan.jobs[0].demandRequestId);
  assert.equal(plan.jobs[0].reservationIds.length, 1);
}

{
  const memory = {};
  const legacy = {
    dedupeKey: 'legacy-consumer',
    domain: 'logistics',
    kind: 'ENERGY_DELIVERY',
    status: 'OPEN',
    demand: { amount: 50 },
    reservations: []
  };
  const sets = matcher._test.activeSets([legacy]);
  assert.equal(sets.pickup.length, 0);
  assert.equal(sets.demand.length, 0);
  assert.equal(sets.balance.length, 0);
}

{
  // Emergency delivery is a hard demand tier above RESERVE. Numeric score
  // remains the tiebreaker within the same tier, but cannot let reserve work
  // starve an already-waiting productive consumer.
  const memory = {};
  const emergency = delivery('critical-consumer', 50, 20, 20, true, 65, 0);
  const reserve = {
    dedupeKey: 'reserve-spawn-floor',
    domain: 'logistics',
    kind: 'RESERVE',
    source: null,
    target: endpoint('spawn', 11, 10),
    demand: {
      resourceType: 'energy',
      capability: 'reserveEnergy',
      amount: 50,
      minimumUsefulAmount: 50,
      maximumUsefulAmount: 50
    },
    priority: { base: 100, urgency: 100, strategicClass: 'RECOVERY' },
    utility: { current: 50, marginalModel: 'SATURATING' },
    evidence: { source: 'test' },
    shadow: true
  };
  const requests = add(memory, 500, [emergency, reserve]);
  const plan = matcher.plan({
    room: { name: 'E1N1' },
    creeps: [hauler('tier-hauler', 10, 10, 50, 50)]
  }, requests, memory, { time: 500 });

  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.jobs[0].requestKind, 'EMERGENCY_DELIVER');
  assert.equal(plan.jobs[0].demandDedupeKey, 'critical-consumer');
  assert.equal(plan.jobs[0].demandTier, 1);

  const emergencyCandidate = { demand: { kind: 'EMERGENCY_DELIVER' }, score: 1, deliveryEta: 50, amount: 1, haulerId: 'a', mode: 'DIRECT_CARRIED' };
  const reserveCandidate = { demand: { kind: 'RESERVE' }, score: 999, deliveryEta: 1, amount: 50, haulerId: 'a', mode: 'DIRECT_CARRIED' };
  assert.equal(matcher._test.demandTier(emergencyCandidate), 1);
  assert.equal(matcher._test.demandTier(reserveCandidate), 0);
  assert.equal(matcher._test.better(emergencyCandidate, reserveCandidate), true);
}

{
  const deferred = matcher.deferredSnapshot('LOW_CPU');
  assert.equal(deferred.authority, 'SHADOW');
  assert.equal(deferred.summary.deferred, true);
  assert.equal(deferred.summary.deferReason, 'LOW_CPU');
  assert.equal(deferred.jobs.length, 0);
}

console.log('logistics matching shadow tests passed');
