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
global.BODYPART_COST = { work: 100, carry: 50, move: 50 };
global.CREEP_SPAWN_TIME = 3;
global.OK = 0;
global.ERR_NOT_ENOUGH_ENERGY = -6;
global.ERR_BUSY = -4;
global.STRUCTURE_WALL = 'wall';
global.STRUCTURE_RAMPART = 'rampart';
global.FIND_MY_CREEPS = 1;
global.FIND_MY_SPAWNS = 2;

const manager = require('../game/spawn.manager.js');
function colony({
  ttl = 29, haulers = 2, want = 2, containers = 2,
  capacity = 550, available = 550, workerCount = 2,
  emergency = false, rcl = 2, spawning = false
} = {}) {
  global.Memory = { creeps: {}, bot: { logs: [], logDedupe: {} }, rooms: {} };
  global.Game = { time: 78279000, creeps: {} };
  const population = [];
  for (const role of ['harvester', 'harvester', 'upgrader']) {
    population.push({ name: role + '-' + population.length,
      memory: { role }, ticksToLive: 800 });
  }
  for (let i = 0; i < workerCount; i++) {
    population.push({ name: 'worker-' + i, memory: {role:'worker'},
      ticksToLive: 800 });
  }
  for (let i = 0; i < haulers; i++) {
    population.push({ name: 'hauler-' + i, memory: { role:'hauler' },
      ticksToLive: i === 0 ? ttl : 800 });
  }
  let issued = null;
  const spawn = {
    spawning: spawning ? {name:'hauler-spawning'} : null,
    spawnCreep(parts, name, opts) {
      issued = {parts, name, opts};
      return OK;
    }
  };
  if (spawning) Memory.creeps['hauler-spawning'] = {role:'hauler'};
  const room = {name:'W37S79',
    find(type, opts) {
      const list = type === FIND_MY_CREEPS ? population :
        type === FIND_MY_SPAWNS ? [spawn] : [];
      return opts?.filter ? list.filter(opts.filter) : list;
    }
  };
  const state = {
    rcl, room, spawn, sites: [], structures: [], hostileCreeps: [],
    sources: [{id:'s1'},{id:'s2'}], energyStored:0,
    energyAvailable:available, energyCapacityAvailable:capacity,
    emergency, economyMetrics:{energyCappedStreak:0,spawnIdleStreak:0},
    economyModel:{
      sourceContainersReady:containers, recommendedHaulerCount:want,
      recommendedHarvesterCount:2,
      recommendedHarvesterWorkParts:4, harvesterWorkParts:4
    },
    byRole:{harvester:2,worker:workerCount,upgrader:1,hauler:haulers,builder:0}
  };
  return {state, spawned:()=>issued, population};
}
{
  const x=colony();
  const horizon=manager._test.productivePrespawnHorizon('hauler',x.state);
  assert.equal(horizon,30,'9-part capacity-550 hauler needs 27 spawn ticks + 3');
  assert.equal(manager._test.countRoleAvailable(x.state,'hauler'),1);
  assert.equal(manager._test.countRole(x.state.room,'hauler'),2);
  assert.equal(manager.spawnOne(x.state),true);
  assert.equal(x.spawned().opts.memory.role,'hauler');
  assert.equal(x.spawned().parts.length,9);
  assert.equal(x.spawned().name,'hau-W37S79-78279000');
}
{
  const x=colony({ttl:31});
  assert.equal(manager._test.countRoleAvailable(x.state,'hauler'),2);
  assert.equal(manager.spawnOne(x.state),false,
    'healthy haulers do not cause speculative extra spawns');
}
{
  const x=colony({ttl:30});
  assert.equal(manager.spawnOne(x.state),true,
    'replace at the exact TTL overlap boundary');
}
{
  const x=colony({haulers:3,want:2});
  assert.equal(manager._test.countRoleAvailable(x.state,'hauler'),2);
  assert.equal(manager.spawnOne(x.state),false,
    'surplus hauler aging out must not cause a fourth transporter');
}
for (const options of [
  {want:1},{containers:1},{rcl:1},{emergency:true}
]) {
  const x=colony(options);
  assert.equal(manager._test.productivePrespawnHorizon('hauler',x.state),0,
    'hauler prespawn only for mature non-emergency 2+ carrier logistics');
}
{
  const x=colony({available:300});
  assert.equal(manager.spawnOne(x.state),false);
  assert.equal(x.spawned(),null,
    'optional prespawn must not spend scarce energy on a small hauler');
}
{
  const x=colony({available:450});
  assert.equal(manager.spawnOne(x.state),true,
    'full replacement body may spawn without waiting for unused room capacity');
  assert.equal(x.spawned().parts.length,9);
}
{
  const x=colony({haulers:1,available:300});
  assert.equal(manager.spawnOne(x.state),true,
    'actual missing hauler must keep existing affordable-body recovery');
  assert.equal(x.spawned().parts.length,6);
}
{
  const x=colony({workerCount:1});
  assert.equal(manager.spawnOne(x.state),true);
  assert.equal(x.spawned().opts.memory.role,'worker',
    'existing core worker priority outranks early transport overlap');
}
{
  const x=colony({spawning:true});
  assert.equal(manager._test.countRoleAvailable(x.state,'hauler'),2);
  assert.equal(manager.spawnOne(x.state),false,
    'busy spawn and already-spawning replacement are never duplicated');
}
{
  const x=colony({ttl:1,containers:1});
  assert.equal(manager.spawnOne(x.state),false,
    'mobile bootstrap logistics has no speculative TTL replacement');
}

console.log('RCL2+ bounded essential hauler prespawn regressions PASS');
