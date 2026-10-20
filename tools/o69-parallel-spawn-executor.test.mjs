import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
Object.assign(global,{
  WORK:'work',CARRY:'carry',MOVE:'move',TOUGH:'tough',
  ATTACK:'attack',RANGED_ATTACK:'ranged_attack',
  BODYPART_COST:{work:100,carry:50,move:50,tough:10,
    attack:80,ranged_attack:150},
  CREEP_SPAWN_TIME:3,OK:0,ERR_BUSY:-4,ERR_NOT_ENOUGH_ENERGY:-6,
  STRUCTURE_WALL:'wall',STRUCTURE_RAMPART:'rampart',
  STRUCTURE_TOWER:'tower'
});
const config=require('../game/config.js');
const planner=require('../game/spawn.parallel.plan.js');
const executor=require('../game/spawn.parallel.execute.js');
assert.equal(config.ENABLE_PARALLEL_SPAWN_EXECUTION,false,
  'O69 must not be release-enabled in a Draft branch');
function fixture({rejectDry=null,rejectLive=null}={}){
 const calls=[];
 const room={name:'E8N1',controller:{my:true,level:3},energyAvailable:800};
 function spawn(name){
  return {
   name,id:'id-'+name,my:true,room,spawning:null,isActive(){return true;},
   spawnCreep(parts,creepName,opts){
    calls.push({name,creepName,role:opts.memory.role,dryRun:!!opts.dryRun,
      cost:parts.reduce((n,p)=>n+BODYPART_COST[p],0)});
    if(opts.dryRun) return name===rejectDry?ERR_BUSY:OK;
    if(name===rejectLive) return ERR_BUSY;
    Memory.creeps[creepName]={...opts.memory};
    this.spawning={name:creepName};
    room.energyAvailable-=calls[calls.length-1].cost;
    return OK;
   }
  };
 }
 const spawns=[spawn('Spawn2'),spawn('Spawn1')];
 const game={time:5000,creeps:{},spawns:Object.fromEntries(
   spawns.map(s=>[s.name,s]))};
 const memory={creeps:{}};
 global.Memory=memory;
 const state={
  room,rcl:3,spawns,spawn:spawns[0],
  creeps:[
   {name:'miner1',memory:{role:'harvester'},ticksToLive:800},
   {name:'miner2',memory:{role:'harvester'},ticksToLive:800},
   {name:'worker1',memory:{role:'worker'},ticksToLive:800},
   {name:'upgrader1',memory:{role:'upgrader'},ticksToLive:800}
  ],
  sources:[{id:'a'},{id:'b'}],sites:[],structures:[],
  hostileCreeps:[{body:[{type:'attack',hits:100}]}],
  byRole:{harvester:2,worker:1,upgrader:1},
  energyStored:1000,energyAvailable:800,energyCapacityAvailable:800,
  emergency:false,economyMetrics:{energyCappedStreak:0,spawnIdleStreak:0},
  economyModel:{recommendedHarvesterCount:2,recommendedHaulerCount:2,
    recommendedHarvesterWorkParts:4,harvesterWorkParts:4,
    sourceContainersReady:2}
 };
 const proposal=planner.plan(state,game,memory);
 assert.deepEqual(proposal.intents.map(i=>i.role),['defender','hauler']);
 return {state,game,memory,calls,proposal,spawns};
}
{
 const f=fixture();
 const out=executor.execute(f.state,f.proposal,f.game,f.memory);
 assert.equal(out.status,'HOLD');
 assert.equal(out.reason,'PARALLEL_EXECUTION_DISABLED');
 assert.equal(f.calls.length,0,'default-off must never call Spawn API');
}
config.ENABLE_PARALLEL_SPAWN_EXECUTION=true;
try{
 {
  const f=fixture();
  const out=executor.execute(f.state,f.proposal,f.game,f.memory);
  assert.equal(out.status,'EXECUTED');
  assert.equal(out.acceptedCount,2);
  assert.equal(out.attemptedCount,2);
  assert.equal(out.spentEnergy,f.proposal.summary.reservedEnergy);
  assert.deepEqual(f.calls.map(c=>c.dryRun),[true,true,false,false]);
  assert.equal(f.calls[0].role,'defender');
  assert.equal(f.calls[1].role,'hauler');
  assert.equal(f.calls.filter(c=>!c.dryRun).length,2);
  assert.equal(new Set(f.calls.map(c=>c.creepName)).size,2);
  assert.equal(f.state.room.energyAvailable,800-out.spentEnergy);
  assert.equal(Object.keys(f.memory.creeps).length,2);
 }
 {
  const f=fixture({rejectDry:'Spawn2'});
  const out=executor.execute(f.state,f.proposal,f.game,f.memory);
  assert.equal(out.status,'HOLD');
  assert.equal(out.reason,'DRY_RUN_REJECTED');
  assert.equal(f.calls.filter(c=>!c.dryRun).length,0,
    'all dryRuns must pass before any real action');
 }
 {
  const f=fixture({rejectLive:'Spawn2'});
  const out=executor.execute(f.state,f.proposal,f.game,f.memory);
  assert.equal(out.status,'PARTIAL_HOLD');
  assert.equal(out.reason,'LIVE_SPAWN_BUSY');
  assert.equal(out.acceptedCount,1);
  assert.equal(out.attemptedCount,2);
  assert.equal(f.calls.filter(c=>!c.dryRun).length,2,
    'ambiguous/failed call is not retried');
  assert.equal(Object.keys(f.memory.creeps).length,1);
 }
 {
  const f=fixture();
  f.state.room.energyAvailable=500;
  const out=executor.execute(f.state,f.proposal,f.game,f.memory);
  assert.equal(out.reason,'STALE_ENERGY_RESERVATION');
  assert.equal(f.calls.length,0);
 }
 {
  const f=fixture();
  f.proposal.intents[0].body=['move'];
  const out=executor.execute(f.state,f.proposal,f.game,f.memory);
  assert.equal(out.reason,'BODY_COST_MISMATCH');
  assert.equal(f.calls.length,0);
 }
 {
  const f=fixture();
  f.spawns[1].spawning={name:'unrelated-job'};
  assert.equal(executor.execute(f.state,f.proposal,f.game,f.memory).reason,
    'STALE_SPAWN');
  assert.equal(f.calls.length,0);
 }
 {
  const f=fixture();
  f.proposal.intents[1].spawnName=f.proposal.intents[0].spawnName;
  assert.equal(executor.execute(f.state,f.proposal,f.game,f.memory).reason,
    'STALE_OR_DUPLICATE_INTENT');
  assert.equal(f.calls.length,0);
 }
 {
  const f=fixture();
  f.game.time++;
  assert.equal(executor.execute(f.state,f.proposal,f.game,f.memory).reason,
    'STALE_OR_DUPLICATE_INTENT');
  assert.equal(f.calls.length,0);
 }
 {
  const f=fixture();
  f.game.spawns.Spawn1={...f.spawns[1]};
  assert.equal(executor.execute(f.state,f.proposal,f.game,f.memory).reason,
    'STALE_SPAWN');
  assert.equal(f.calls.length,0);
 }
 {
  const f=fixture();
  f.state.room.controller.my=false;
  assert.equal(executor.execute(f.state,f.proposal,f.game,f.memory).reason,
    'INVALID_RELEASE_SNAPSHOT');
  assert.equal(f.calls.length,0);
 }
} finally {
 config.ENABLE_PARALLEL_SPAWN_EXECUTION=false;
}
const rm=fs.readFileSync(new URL('../game/room.manager.js',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../game/main.js',import.meta.url),'utf8');
assert.equal((rm.match(/spawnManager\.spawnOne\(state\)/g)||[]).length,1,
 'one legacy fallback invocation; never parallel with O69');
assert.match(rm,/config\.ENABLE_PARALLEL_SPAWN_EXECUTION === true/);
assert.match(rm,/state\.spawnParallelExecution = spawnParallelExecutor\.execute/);
assert.match(main,/spawnParallelExecution:\s*state\.spawnParallelExecution/);
const configSource=fs.readFileSync(new URL('../game/config.js',import.meta.url),'utf8');
assert.match(configSource,/ENABLE_PARALLEL_SPAWN_EXECUTION:\s*false/);
console.log('O69 release-gated parallel executor: default-off, preflight/dry-run, bounded actual intents, no replay PASS');
