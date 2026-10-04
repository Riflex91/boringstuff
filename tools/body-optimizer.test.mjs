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

const optimizer = require('../game/body.optimizer.js');

{
  const p = optimizer._test.normalizeTerrain({ road: 2, plain: 6, swamp: 2 });
  assert.equal(Math.round(p.road * 10), 2);
  assert.equal(Math.round(p.plain * 10), 6);
  assert.equal(Math.round(p.swamp * 10), 2);
  assert.equal(p.source, 'OBSERVED');
  assert.equal(optimizer._test.normalizeTerrain(null).source, 'DEFAULT_PLAIN');
}

{
  const road = optimizer._test.estimatedTravelTicks(20, 6, 3, { road: 1 });
  const plain = optimizer._test.estimatedTravelTicks(20, 6, 3, { plain: 1 });
  const swamp = optimizer._test.estimatedTravelTicks(20, 6, 3, { swamp: 1 });
  assert.ok(road < plain);
  assert.ok(plain < swamp);
}

{
  const result = optimizer.optimize({
    role: 'harvester', capability: 'workHarvest', requestedCapacity: 5,
    energyBudget: 800, routeDistance: 20, terrainProfile: { plain: 1 }
  });
  assert.ok(result);
  assert.equal(result.capacityDelivered, 5);
  assert.ok(result.cost <= 800);
  assert.ok(result.parts <= 50);
  assert.ok(result.body.filter(p => p === WORK).length >= 5);
  assert.ok(result.body.includes(CARRY));
  assert.ok(result.body.includes(MOVE));
  assert.ok(result.travelTicks > 0);
  assert.ok(result.productiveLifetime > 0);
  assert.ok(result.expectedRoi > 0);
}

{
  const result = optimizer.optimize({
    role: 'hauler', capability: 'carry', requestedCapacity: 6,
    energyBudget: 450, routeDistance: 20, terrainProfile: { road: 1 }
  });
  assert.ok(result);
  assert.equal(result.capacityDelivered, 6);
  assert.equal(result.body.filter(p => p === CARRY).length, 6);
  assert.ok(result.body.filter(p => p === MOVE).length >= 1);
  assert.ok(result.cost <= 450);
}

{
  const result = optimizer.optimize({
    role: 'worker', capability: 'bootstrap', requestedCapacity: 2,
    energyBudget: 600, routeDistance: 0
  });
  assert.ok(result);
  assert.equal(result.capacityDelivered, 2);
  assert.equal(result.body.filter(p => p === WORK).length, 2);
  assert.equal(result.body.filter(p => p === CARRY).length, 2);
  assert.ok(result.body.filter(p => p === MOVE).length >= 2);
}

{
  const unboosted = optimizer.optimize({
    role: 'harvester', capability: 'workHarvest', requestedCapacity: 4,
    energyBudget: 600, routeDistance: 10, terrainProfile: { plain: 1 }
  });
  const boosted = optimizer.optimize({
    role: 'harvester', capability: 'workHarvest', requestedCapacity: 4,
    energyBudget: 600, routeDistance: 10, terrainProfile: { plain: 1 },
    boosts: { workHarvest: 2 }
  });
  assert.ok(unboosted && boosted);
  assert.equal(boosted.boostMultiplier, 2);
  assert.ok(boosted.body.filter(p => p === WORK).length <= unboosted.body.filter(p => p === WORK).length);
  assert.ok(boosted.capacityDelivered >= 4);
}

{
  const shortRoad = optimizer.optimize({
    role: 'hauler', capability: 'carry', requestedCapacity: 6,
    energyBudget: 600, routeDistance: 5, terrainProfile: { road: 1 }
  });
  const longSwamp = optimizer.optimize({
    role: 'hauler', capability: 'carry', requestedCapacity: 6,
    energyBudget: 600, routeDistance: 30, terrainProfile: { swamp: 1 }
  });
  assert.ok(shortRoad && longSwamp);
  assert.ok(longSwamp.travelTicks >= shortRoad.travelTicks);
  assert.ok(longSwamp.body.filter(p => p === MOVE).length >= shortRoad.body.filter(p => p === MOVE).length);
}

{
  const capped = optimizer.optimize({
    role: 'hauler', capability: 'carry', requestedCapacity: 100,
    energyBudget: 10000, routeDistance: 10, terrainProfile: { plain: 1 }, maxParts: 50
  });
  assert.ok(capped);
  assert.ok(capped.parts <= 50);
  assert.ok(capped.capacityDelivered < 100);
}

{
  assert.equal(optimizer.optimize({ role:'harvester', capability:'workHarvest', requestedCapacity:1, energyBudget:0 }), null);
  assert.equal(optimizer.optimize({ role:'unknown', capability:'unknown', requestedCapacity:1, energyBudget:1000 }), null);
}

console.log('body optimizer tests passed');