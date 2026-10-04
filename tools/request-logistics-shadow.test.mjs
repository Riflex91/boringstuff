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
global.STRUCTURE_CONTAINER = 'container';
global.STRUCTURE_SPAWN = 'spawn';
global.STRUCTURE_EXTENSION = 'extension';
global.STRUCTURE_TOWER = 'tower';

const logistics = require('../game/request.logistics.shadow.js');

function pos(x, y, roomName = 'E1N1') {
  return {
    x, y, roomName,
    getRangeTo(other) {
      const p = other && other.pos ? other.pos : other;
      return Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
    }
  };
}

function store(energy, capacity) {
  return {
    energy,
    getFreeCapacity(resource) {
      assert.equal(resource, 'energy');
      return Math.max(0, capacity - energy);
    }
  };
}

function structure(id, type, x, y, energy, capacity, my = true) {
  return { id, structureType: type, pos: pos(x, y), store: store(energy, capacity), my };
}

function creep(id, role, x, y, energy, capacity, wait = 0, fallback = false) {
  return {
    id,
    name: id,
    room: { name: 'E1N1' },
    pos: pos(x, y),
    memory: { role, waitingEnergyTicks: wait, logisticsFallback: fallback },
    store: {
      energy,
      getFreeCapacity(resource) {
        assert.equal(resource, 'energy');
        return Math.max(0, capacity - energy);
      }
    }
  };
}

{
  const sourceA = { id: 'source-a', pos: pos(5, 5) };
  const sourceB = { id: 'source-b', pos: pos(40, 40) };
  const sourceContainer = structure('src-cont', 'container', 5, 6, 600, 2000);
  const controllerContainer = structure('ctrl-cont', 'container', 20, 21, 0, 1000);
  const spawn = structure('spawn1', 'spawn', 10, 10, 50, 300);
  const extension = structure('ext1', 'extension', 11, 10, 0, 50);
  const worker = creep('worker1', 'worker', 15, 15, 0, 100, 4, true);
  const state = {
    room: {
      name: 'E1N1',
      controller: { id: 'controller1', my: true, pos: pos(20, 20) }
    },
    spawn,
    structures: [sourceContainer, controllerContainer, spawn, extension],
    sources: [sourceA, sourceB],
    creeps: [worker],
    energyAvailable: 25,
    energyCapacityAvailable: 550,
    emergency: false
  };

  const specs = logistics.specs(state);
  const byKind = specs.reduce((acc, spec) => {
    (acc[spec.kind] ||= []).push(spec);
    return acc;
  }, {});

  assert.equal(byKind.PICKUP.length, 1);
  assert.equal(byKind.PICKUP[0].source.id, 'src-cont');
  assert.equal(byKind.PICKUP[0].demand.amount, 600);

  assert.equal(byKind.EMERGENCY_DELIVER.length, 3);
  assert.ok(byKind.EMERGENCY_DELIVER.some(x => x.target.id === 'spawn1'));
  assert.ok(byKind.EMERGENCY_DELIVER.some(x => x.target.id === 'ext1'));
  const consumer = byKind.EMERGENCY_DELIVER.find(x => x.target.id === 'worker1');
  assert.ok(consumer);
  assert.equal(consumer.priority.strategicClass, 'CORE_ECONOMY');

  assert.equal(byKind.RESERVE.length, 1);
  assert.equal(byKind.RESERVE[0].demand.amount, 275);
  assert.equal(byKind.RESERVE[0].target.id, 'spawn1');

  assert.equal(byKind.BALANCE.length, 1);
  assert.equal(byKind.BALANCE[0].source.id, 'src-cont');
  assert.equal(byKind.BALANCE[0].target.id, 'ctrl-cont');
  assert.equal(byKind.BALANCE[0].demand.amount, 600);

  const summary = logistics.summary(specs);
  assert.equal(summary.authority, 'SHADOW');
  assert.equal(summary.total, 6);
  assert.equal(summary.byKind.PICKUP, 1);
  assert.equal(summary.byKind.EMERGENCY_DELIVER, 3);
  assert.equal(summary.byKind.RESERVE, 1);
  assert.equal(summary.byKind.BALANCE, 1);
}

{
  const source = { id: 'source-a', pos: pos(5, 5) };
  const sourceContainer = structure('src-cont', 'container', 5, 6, 500, 2000);
  const spawn = structure('spawn1', 'spawn', 10, 10, 300, 300);
  const worker = creep('worker1', 'worker', 15, 15, 50, 100, 0, false);
  const state = {
    room: { name: 'E1N1', controller: { my: true, pos: pos(20, 20) } },
    spawn,
    structures: [sourceContainer, spawn],
    sources: [source],
    creeps: [worker],
    energyAvailable: 550,
    energyCapacityAvailable: 550,
    emergency: false
  };
  const specs = logistics.specs(state);
  assert.equal(specs.filter(x => x.kind === 'RESERVE').length, 0);
  assert.equal(specs.filter(x => x.kind === 'EMERGENCY_DELIVER').length, 0);
  assert.equal(specs.filter(x => x.kind === 'DELIVER').length, 0);
  assert.equal(specs.filter(x => x.kind === 'PICKUP').length, 1);
}

{
  const worker = creep('worker1', 'worker', 10, 10, 0, 100, 0, false);
  const state = {
    room: { name: 'E1N1' },
    structures: [],
    sources: [],
    creeps: [worker],
    energyAvailable: 550,
    energyCapacityAvailable: 550,
    emergency: false,
    spawn: null
  };
  const specs = logistics.specs(state);
  const delivery = specs.find(x => x.target && x.target.id === 'worker1');
  assert.ok(delivery);
  assert.equal(delivery.kind, 'DELIVER');
  assert.equal(delivery.demand.amount, 100);
}

console.log('logistics request shadow tests passed');
