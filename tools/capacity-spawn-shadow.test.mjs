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
global.CLAIM = 'claim';
global.ATTACK = 'attack';
global.RANGED_ATTACK = 'ranged_attack';
global.HEAL = 'heal';
global.TOUGH = 'tough';
global.BODYPART_COST = { work: 100, carry: 50, move: 50, claim: 600, attack: 80, ranged_attack: 150, heal: 250, tough: 10 };
global.CREEP_SPAWN_TIME = 3;
global.CREEP_LIFE_TIME = 1500;
global.FIND_MY_SPAWNS = 1;

const planner = require('../game/spawn.capacity.shadow.js');

function makeCreep(name, role, parts, ttl, spawning = false) {
  return {
    id: name, name, spawning, ticksToLive: ttl, memory: { role },
    getActiveBodyparts(type) { return parts[type] || 0; }
  };
}

function makeSpawn(name, remaining = 0, spawningName = null) {
  return {
    id: name, name,
    spawning: spawningName ? { name: spawningName, remainingTime: remaining } : null
  };
}

function state(options = {}) {
  const spawns = options.spawns || [makeSpawn('Spawn1')];
  return {
    room: {
      name: 'E1N1',
      find(type) { return type === FIND_MY_SPAWNS ? spawns : []; }
    },
    spawn: spawns[0] || null,
    creeps: options.creeps || [],
    sources: [{ id: 's1' }, { id: 's2' }],
    energyAvailable: options.energyAvailable ?? 550,
    energyCapacityAvailable: options.energyCapacity ?? 550,
    economyModel: {
      sourceContainersReady: 2,
      sourceRoutes: options.routes || [
        { sourceId: 's1', spawnDistance: 10 },
        { sourceId: 's2', spawnDistance: 20 }
      ]
    }
  };
}

function capacityRequest(kind, capability, amount, options = {}) {
  return {
    id: options.id || ('req|' + kind),
    dedupeKey: options.dedupeKey || ('capacity:' + kind),
    kind,
    status: 'OPEN',
    target: { roomName: 'E1N1' },
    demand: { capability, amount },
    priority: {
      base: options.base ?? 90,
      urgency: options.urgency ?? 0,
      strategicClass: options.strategicClass || 'CORE_ECONOMY'
    },
    utility: { current: options.utility ?? 0 }
  };
}

{
  assert.equal(planner._test.roleForRequest(capacityRequest('HARVEST_CAPACITY','workHarvest',5)), 'harvester');
  assert.equal(planner._test.roleForRequest(capacityRequest('HAUL_CAPACITY','carry',6)), 'hauler');
  assert.equal(planner._test.roleForRequest(capacityRequest('RECOVERY_CAPACITY','bootstrap',1)), 'worker');
  assert.equal(planner._test.roleForRequest({ kind: 'BUILD' }), null);
}

{
  const s = state({ energyCapacity: 550 });
  const r = capacityRequest('HARVEST_CAPACITY', 'workHarvest', 5);
  const body = planner._test.bodyFor('harvester', 550, s, false);
  assert.equal(planner._test.bodyCost(body), 550);
  assert.equal(planner._test.capacityForBody(body, 'harvester', r), 3);
}

{
  // Current deficit: two 3-WORK bodies are required to cover 5 WORK.
  const s = state({ creeps: [] });
  const r = capacityRequest('HARVEST_CAPACITY', 'workHarvest', 5);
  const plan = planner.plan(s, [r], { time: 1000 });
  assert.equal(plan.summary.requirementCount, 1);
  assert.equal(plan.summary.deficitCount, 1);
  assert.equal(plan.spawnRequests.length, 2);
  assert.equal(plan.spawnRequests[0].capacityDelivered, 3);
  assert.equal(plan.spawnRequests[1].capacityDelivered, 3);
  assert.equal(plan.spawnRequests[1].capacityApplied, 2);
  assert.equal(plan.deficits[0].active, 0);
  assert.equal(plan.deficits[0].queued, 0);
  assert.equal(plan.deficits[0].uncoveredAfterPlan, 0);
}

{
  // Pre-spawn: current 5 WORK satisfies demand, but TTL is below productive-start horizon.
  const dying = makeCreep('miner-old', 'harvester', { work: 5, carry: 1, move: 4 }, 40);
  const s = state({ creeps: [dying], energyCapacity: 800, energyAvailable: 800 });
  const r = capacityRequest('HARVEST_CAPACITY', 'workHarvest', 5);
  const plan = planner.plan(s, [r], { time: 2000 });
  assert.equal(plan.deficits[0].active, 5);
  assert.equal(plan.deficits[0].projectedSurviving, 0);
  assert.equal(plan.deficits[0].preSpawn, true);
  assert.equal(plan.spawnRequests.length, 1);
  assert.ok(plan.spawnRequests[0].predicted.productiveStartTick > 2000);
}

{
  // No premature replacement while TTL safely exceeds the predicted start horizon.
  const healthy = makeCreep('miner-young', 'harvester', { work: 5, carry: 1, move: 4 }, 500);
  const s = state({ creeps: [healthy], energyCapacity: 800, energyAvailable: 800 });
  const r = capacityRequest('HARVEST_CAPACITY', 'workHarvest', 5);
  const plan = planner.plan(s, [r], { time: 2100 });
  assert.equal(plan.deficits[0].deficit, 0);
  assert.equal(plan.spawnRequests.length, 0);
}

{
  // Spawn congestion extends replacement lead and can make an otherwise healthy creep non-surviving.
  const miner = makeCreep('miner-congested', 'harvester', { work: 5, carry: 1, move: 4 }, 80);
  const idle = planner.plan(state({ creeps: [miner], energyCapacity: 800, energyAvailable: 800 }), [
    capacityRequest('HARVEST_CAPACITY','workHarvest',5)
  ], { time: 2200 });
  assert.equal(idle.spawnRequests.length, 0);

  const busySpawn = makeSpawn('Spawn1', 100, 'other-creep');
  const busy = planner.plan(state({ creeps: [miner], spawns: [busySpawn], energyCapacity: 800, energyAvailable: 800 }), [
    capacityRequest('HARVEST_CAPACITY','workHarvest',5)
  ], { time: 2200 });
  assert.equal(busy.spawnRequests.length, 1);
  assert.equal(busy.spawnRequests[0].predicted.queueDelay, 100);
}

{
  // Synchronized deaths cause multiple replacements, but each planned body subtracts future need.
  const a = makeCreep('miner-a', 'harvester', { work: 3, carry: 1, move: 2 }, 30);
  const b = makeCreep('miner-b', 'harvester', { work: 3, carry: 1, move: 2 }, 30);
  const plan = planner.plan(state({ creeps: [a,b] }), [
    capacityRequest('HARVEST_CAPACITY','workHarvest',6)
  ], { time: 2300 });
  assert.equal(plan.spawnRequests.length, 2);
  assert.equal(plan.spawnRequests[0].predicted.queueDelay, 0);
  assert.ok(plan.spawnRequests[1].predicted.queueDelay > 0);
}

{
  // Two idle spawns can satisfy two replacement bodies concurrently.
  const plan = planner.plan(state({ spawns: [makeSpawn('A'), makeSpawn('B')] }), [
    capacityRequest('HARVEST_CAPACITY','workHarvest',6)
  ], { time: 2400 });
  assert.equal(plan.spawnRequests.length, 2);
  assert.equal(plan.spawnRequests[0].predicted.queueDelay, 0);
  assert.equal(plan.spawnRequests[1].predicted.queueDelay, 0);
  assert.notEqual(plan.spawnRequests[0].predicted.spawnId, plan.spawnRequests[1].predicted.spawnId);
}

{
  // Already spawning capacity is counted only when it can arrive before the next proposed body.
  const spawningHauler = makeCreep('haul-new', 'hauler', { carry: 6, move: 3 }, null, true);
  const spawn = makeSpawn('Spawn1', 10, 'haul-new');
  const plan = planner.plan(state({ creeps: [spawningHauler], spawns: [spawn], energyCapacity: 450, energyAvailable: 450 }), [
    capacityRequest('HAUL_CAPACITY','carry',6)
  ], { time: 2500 });
  assert.equal(plan.deficits[0].spawning, 6);
  assert.equal(plan.deficits[0].deficit, 0);
  assert.equal(plan.spawnRequests.length, 0);
}

{
  // Recovery outranks normal economy and consumes the first spawn slot.
  const recovery = capacityRequest('RECOVERY_CAPACITY','bootstrap',1,{ strategicClass:'RECOVERY', base:100, id:'recovery' });
  const mining = capacityRequest('HARVEST_CAPACITY','workHarvest',3,{ base:95, id:'mining' });
  const plan = planner.plan(state({ energyCapacity: 300, energyAvailable: 300 }), [mining, recovery], { time: 2600 });
  assert.equal(plan.spawnRequests[0].role, 'worker');
  assert.equal(plan.spawnRequests[0].sourceRequestId, 'recovery');
  assert.ok(plan.spawnRequests.slice(1).some(x => x.sourceRequestId === 'mining'));
  const miningRequest = plan.spawnRequests.find(x => x.sourceRequestId === 'mining');
  assert.ok(miningRequest.predicted.queueDelay > 0);
}

{
  const deferred = planner.deferredSnapshot('LOW_CPU');
  assert.equal(deferred.summary.deferred, true);
  assert.equal(deferred.summary.deferReason, 'LOW_CPU');
  assert.equal(deferred.spawnRequests.length, 0);
}

console.log('capacity spawn shadow tests passed');