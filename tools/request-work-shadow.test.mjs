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
global.BUILD_POWER = 5;
global.REPAIR_POWER = 100;
global.STRUCTURE_SPAWN = 'spawn';
global.STRUCTURE_EXTENSION = 'extension';
global.STRUCTURE_CONTAINER = 'container';
global.STRUCTURE_TOWER = 'tower';
global.STRUCTURE_STORAGE = 'storage';
global.STRUCTURE_LINK = 'link';
global.STRUCTURE_TERMINAL = 'terminal';
global.STRUCTURE_ROAD = 'road';
global.STRUCTURE_RAMPART = 'rampart';
global.STRUCTURE_WALL = 'constructedWall';

const workRequests = require('../game/request.work.shadow.js');

function pos(x, y, roomName = 'E1N1') { return { x, y, roomName }; }

function creep(id, role, work) {
  return {
    id,
    memory: { role },
    spawning: false,
    getActiveBodyparts(type) { return type === 'work' ? work : 0; }
  };
}

{
  assert.equal(workRequests._test.constructionPriority({ structureType: 'spawn' }), 0);
  assert.equal(workRequests._test.constructionPriority({ structureType: 'extension' }), 1);
  assert.equal(workRequests._test.constructionPriority({ structureType: 'road' }), 20);
  assert.equal(workRequests._test.constructionPriority({ structureType: 'constructedWall' }), 31);
}

{
  const state = {
    room: { name: 'E1N1' },
    sites: [
      { id: 'spawn-site', structureType: 'spawn', progress: 0, progressTotal: 100, pos: pos(10, 10) },
      { id: 'road-site', structureType: 'road', progress: 20, progressTotal: 120, pos: pos(15, 15) }
    ]
  };
  const specs = workRequests._test.buildSpecs(state);
  assert.equal(specs.length, 2);
  const byKey = Object.fromEntries(specs.map(s => [s.dedupeKey, s]));
  assert.equal(byKey['work:build:spawn-site'].kind, 'BUILD');
  assert.equal(byKey['work:build:spawn-site'].demand.capability, 'workBuild');
  assert.equal(byKey['work:build:spawn-site'].demand.amount, 20);
  assert.equal(byKey['work:build:spawn-site'].priority.strategicClass, 'INFRASTRUCTURE');
  assert.ok(byKey['work:build:spawn-site'].priority.base > byKey['work:build:road-site'].priority.base);
}

{
  const normal = { id: 'road1', structureType: 'road', hits: 500, hitsMax: 1000, pos: pos(20, 20) };
  const healthy = { id: 'road2', structureType: 'road', hits: 800, hitsMax: 1000, pos: pos(21, 20) };
  const wall = { id: 'wall1', structureType: 'constructedWall', hits: 1000, hitsMax: 1000000, pos: pos(22, 20) };
  assert.equal(workRequests._test.repairTargetHits(normal, 2), 650);
  assert.equal(workRequests._test.repairTargetHits(healthy, 2), null);
  assert.ok(workRequests._test.repairTargetHits(wall, 2) >= 10000);

  const specs = workRequests._test.repairSpecs({
    room: { name: 'E1N1' },
    rcl: 2,
    structures: [normal, healthy, wall]
  });
  assert.equal(specs.length, 2);
  const normalSpec = specs.find(s => s.dedupeKey === 'work:repair:road1');
  assert.equal(normalSpec.kind, 'REPAIR');
  assert.equal(normalSpec.demand.capability, 'workRepair');
  assert.equal(normalSpec.demand.amount, 2);
}

{
  const state = {
    room: {
      name: 'E1N1',
      controller: { id: 'controller1', my: true, level: 3, ticksToDowngrade: 9000, pos: pos(25, 25) }
    },
    creeps: [
      creep('worker1', 'worker', 2),
      creep('builder1', 'builder', 3),
      creep('hauler1', 'hauler', 0)
    ]
  };
  const spec = workRequests._test.upgradeSpec(state);
  assert.equal(spec.kind, 'UPGRADE');
  assert.equal(spec.demand.capability, 'workUpgrade');
  assert.equal(spec.demand.amount, 5);
  assert.equal(spec.priority.urgency, 30);
}

{
  const state = {
    room: {
      name: 'E1N1',
      controller: { id: 'controller1', my: true, level: 3, ticksToDowngrade: 20000, pos: pos(25, 25) }
    },
    rcl: 3,
    creeps: [creep('worker1', 'worker', 2)],
    sites: [{ id: 'ext-site', structureType: 'extension', progress: 0, progressTotal: 50, pos: pos(11, 11) }],
    structures: [{ id: 'road1', structureType: 'road', hits: 100, hitsMax: 1000, pos: pos(12, 12) }]
  };
  const specs = workRequests.specs(state);
  assert.equal(specs.length, 3);
  assert.deepEqual(specs.map(s => s.kind).sort(), ['BUILD', 'REPAIR', 'UPGRADE']);
  assert.deepEqual(specs.map(s => s.dedupeKey), specs.map(s => s.dedupeKey).slice().sort());
}

{
  const state = { room: { name: 'E1N1', controller: { my: true, level: 8 } }, creeps: [creep('w', 'worker', 2)] };
  assert.equal(workRequests._test.upgradeSpec(state), null);
}

console.log('work request shadow tests passed');