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

const capacity = require('../game/capacity.vector.js');

function creep(role, parts) {
  return {
    memory: { role },
    getActiveBodyparts(type) { return parts[type] || 0; }
  };
}

{
  const h = capacity.fromCreep(creep('harvester', { work: 5, carry: 1, move: 3 }));
  assert.equal(h.workHarvest, 5);
  assert.equal(h.workBuild, 0);
  assert.equal(h.carry, 1);
  assert.equal(h.moveEffective, 3);
}

{
  const w = capacity.fromCreep(creep('worker', { work: 2, carry: 2, move: 2 }));
  assert.equal(w.workHarvest, 0);
  assert.equal(w.workBuild, 2);
  assert.equal(w.workRepair, 2);
  assert.equal(w.workUpgrade, 2);
  assert.equal(w.carry, 2);
  assert.equal(capacity.deliveredForRequest(w, { demand: { capability: 'bootstrap' } }), 2);
}

{
  const body = capacity.fromBody(['carry','carry','move'], 'hauler');
  assert.equal(body.carry, 2);
  assert.equal(body.moveEffective, 1);
  assert.equal(body.workHarvest, 0);
}

{
  const total = capacity.sum([
    creep('worker', { work: 2, carry: 1, move: 1 }),
    creep('hauler', { carry: 4, move: 2 })
  ]);
  assert.equal(total.workBuild, 2);
  assert.equal(total.carry, 5);
  assert.equal(total.moveEffective, 3);
}

console.log('capacity vector tests passed');