import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);
Object.assign(global, {
  WORK: 'work', CARRY: 'carry', MOVE: 'move', TOUGH: 'tough',
  ATTACK: 'attack', RANGED_ATTACK: 'ranged_attack',
  BODYPART_COST: {work:100, carry:50, move:50, tough:10,
    attack:80, ranged_attack:150},
  CREEP_SPAWN_TIME:3, STRUCTURE_WALL:'wall', STRUCTURE_RAMPART:'rampart',
  STRUCTURE_TOWER:'tower'
});
const planner = require('../game/spawn.parallel.plan.js');

function creep(name, role, ttl=1000) {
  return { name, memory:{role,home:'E8N1'}, ticksToLive:ttl };
}
function fixture({busyRole=null, withHostile=true, energy=800,
                  inactive=false, reverse=false} = {}) {
  const room = {name:'E8N1',controller:{my:true,level:3}};
  const createSpawn = name => ({
    name, id:'id-'+name, my:true, room, spawning:null,
    isActive() { return !inactive; },
    spawnCreep() { throw Error('O68 is strictly non-executable'); }
  });
  const spawns = [createSpawn('Spawn2'),createSpawn('Spawn1')];
  const memory = {creeps:{}};
  if (busyRole) {
    spawns.push(createSpawn('Spawn3'));
    spawns[2].spawning={name:'existing-private-job'};
    memory.creeps['existing-private-job']={role:busyRole,home:'E8N1'};
  }
  if (reverse) spawns.reverse();
  const creeps = [
    creep('miner-1','harvester'), creep('miner-2','harvester'),
    creep('worker-1','worker'), creep('upgrader-1','upgrader')
  ];
  const state = {
    room,spawns,spawn:spawns[0],creeps,rcl:3,
    byRole:{harvester:2,worker:1,upgrader:1},
    sites:[],structures:[],sources:[{id:'a'},{id:'b'}],
    hostileCreeps: withHostile ? [{body:[{type:'attack',hits:100}]}] : [],
    emergency:false,energyAvailable:energy,energyCapacityAvailable:800,
    energyStored:2000,
    economyMetrics:{energyCappedStreak:0,spawnIdleStreak:0},
    economyModel:{
      recommendedHarvesterCount:2,recommendedHaulerCount:2,
      sourceContainersReady:2,recommendedHarvesterWorkParts:4,
      harvesterWorkParts:4
    }
  };
  const game={time:1234,creeps:{}};
  return {state,game,memory,spawns,creeps};
}
function execute(f) { return planner.plan(f.state,f.game,f.memory); }
function invariant(plan, energy) {
  assert.equal(plan.authority,'SHADOW');
  assert.equal(plan.actionAuthority,'NONE');
  assert.equal(plan.summary.actionAuthority,'NONE');
  assert.equal(plan.summary.reservedEnergy,
    plan.intents.reduce((s,i)=>s+i.cost,0));
  assert.ok(plan.summary.reservedEnergy<=energy);
  assert.equal(plan.summary.remainingEnergy,
    energy-plan.summary.reservedEnergy);
  assert.equal(new Set(plan.intents.map(i=>i.spawnName)).size,
    plan.intents.length);
  for(const job of plan.intents) {
    assert.ok(job.body.length>=1 && job.body.length<=50);
    assert.equal(job.cost,job.body.reduce((s,p)=>
      s+BODYPART_COST[p],0));
  }
}
{
  const f=fixture();
  const before=JSON.stringify({creeps:f.creeps,memory:f.memory});
  const result=execute(f);
  assert.equal(result.status,'PLANNED');
  assert.deepEqual(result.intents.map(x=>x.spawnName),
    ['Spawn1','Spawn2'],'stable deterministic slot order');
  assert.deepEqual(result.intents.map(x=>x.role),
    ['defender','hauler'],'defense must precede logistics');
  invariant(result,800);
  assert.equal(JSON.stringify({creeps:f.creeps,memory:f.memory}),before,
    'planner must not mutate live creeps or Memory');
  assert.deepEqual(execute(f).intents,result.intents,'pure and repeatable');
  assert.deepEqual(execute(fixture({reverse:true})).intents,result.intents,
    'input ordering cannot change assignments');
  assert.equal(JSON.stringify(result.summary).includes('Spawn'),false,
    'public telemetry must not publish Spawn names');
}
{
  const f=fixture({busyRole:'defender'});
  f.creeps.push(creep('hauler-one','hauler'));
  const result=execute(f);
  invariant(result,800);
  assert.equal(result.intents.filter(x=>x.role==='defender').length,0,
    'ongoing defender job satisfies defender demand');
  assert.equal(result.intents.filter(x=>x.role==='hauler').length,1,
    'ongoing defender and existing carrier cannot duplicate missing roles');
}
{
  const f=fixture({busyRole:'hauler'});
  f.creeps.push(creep('hauler-one','hauler'));
  const result=execute(f);
  invariant(result,800);
  assert.equal(result.intents[0]?.role,'defender',
    'defender still leads after carrier demand is satisfied');
  assert.equal(result.intents.filter(i=>i.role==='hauler').length,0,
    'already-running carrier and one live carrier satisfy all two slots');
}
{
  const f=fixture();
  f.state.hostileCreeps=[{body:Array.from({length:9},
    ()=>({type:'attack',hits:100}))}];
  const result=execute(f);
  invariant(result,800);
  assert.deepEqual(result.intents.map(i=>i.role),['defender','defender'],
    'multiple real defense deficits are distinct and can be reserved');
}
{
  const f=fixture({energy:300});
  f.creeps.splice(0,1);
  f.state.byRole.harvester=1;
  const result=execute(f);
  invariant(result,300);
  assert.equal(result.intents[0]?.role,'defender');
  assert.equal(result.intents.some(x=>x.role==='upgrader'),false,
    'optional controller throughput never leapfrogs critical shortages');
  assert.ok(result.intents.length<=2);
}
{
  const f=fixture({withHostile:false});
  const result=execute(f);
  invariant(result,800);
  assert.equal(result.intents.some(x=>x.role==='defender'),false);
}
{
  // With no productive workforce, two essential 200-energy recovery bodies
  // must be able to share one room energy budget without an upgrader leapfrog.
  const f=fixture({withHostile:false,energy:500});
  f.state.emergency=true;
  f.state.creeps=[];
  f.state.byRole={};
  const result=execute(f);
  invariant(result,500);
  assert.deepEqual(result.intents.map(x=>x.role),['harvester','worker']);
  assert.equal(result.summary.reservedEnergy,400);
}
{
  const f=fixture({inactive:true});
  assert.equal(execute(f).status,'NO_IDLE');
}
{
  const f=fixture({busyRole:'hauler'});
  delete f.memory.creeps['existing-private-job'];
  assert.equal(execute(f).reason,'UNKNOWN_RUNNING_JOB',
    'missing original job identity cannot cause speculative overproduction');
}
{
  const f=fixture();
  f.spawns[0].my=false;
  assert.equal(execute(f).status,'HOLD');
  f.spawns[0].my=true;
  f.spawns[0].room={name:'W1N1'};
  assert.equal(execute(f).reason,'INVALID_SPAWN_FLEET');
}
{
  const f=fixture();
  f.state.spawns.push(f.spawns[0]);
  assert.equal(execute(f).reason,'INVALID_SPAWN_FLEET',
    'duplicate Spawn may not receive duplicate reservation');
}
{
  const f=fixture();
  f.state.spawns.push({...f.spawns[0],name:'Spawn3',id:'third-id'});
  f.state.spawns.push({...f.spawns[0],name:'Spawn4',id:'fourth-id'});
  assert.equal(execute(f).reason,'SPAWN_LIMIT');
}
{
  const f=fixture();
  f.state.energyAvailable=801;
  assert.equal(execute(f).reason,'INVALID_ROOM_SNAPSHOT');
  f.state.energyAvailable=800;
  f.game.time=NaN;
  assert.equal(execute(f).reason,'INVALID_ROOM_SNAPSHOT');
}
{
  const f=fixture();
  f.state.creeps=Array.from({length:257},(_,i)=>creep('c'+i,'worker'));
  assert.equal(execute(f).reason,'INVALID_ROOM_SNAPSHOT');
}
{
  const f=fixture();
  const result=planner.deferred('LOW_CPU');
  assert.equal(result.status,'DEFERRED');
  assert.equal(result.summary.plannedCount,0);
  assert.equal(result.actionAuthority,'NONE');
}
const source=fs.readFileSync(new URL('../game/spawn.parallel.plan.js',import.meta.url),'utf8');
for (const forbidden of [/\.spawnCreep\s*\(/,/\.cancel\s*\(/,
    /\.renewCreep\s*\(/,/\.createConstructionSite\s*\(/,
    /delete\s+Memory\.creeps/,/\bfetch\s*\(/]) {
  assert.doesNotMatch(source, forbidden,'planner must be offline-only');
}
const roomManager=fs.readFileSync(new URL('../game/room.manager.js',import.meta.url),'utf8');
const gameMain=fs.readFileSync(new URL('../game/main.js',import.meta.url),'utf8');
assert.equal((roomManager.match(/spawnManager\.spawnOne\(state\)/g)||[]).length,1,
 'existing productive executor remains exactly one per room/tick');
assert.match(roomManager,/spawnParallelPlan\.plan\(state, Game, Memory\)/);
assert.match(gameMain,/spawnParallel:\s*state\.spawnParallelShadow/);
console.log('O68 deterministic multi-spawn shadow reservations, dedupe, priorities and energy: PASS');
