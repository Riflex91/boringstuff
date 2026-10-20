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
const config=require('../game/config.js');
const legacy=require('../game/spawn.manager.js');
const parallel=require('../game/spawn.parallel.execute.js');
const roomManager=require('../game/room.manager.js');
const originalLegacy=legacy.spawnOne;
const originalParallel=parallel.execute;
const originalGate=config.ENABLE_PARALLEL_SPAWN_EXECUTION;

const calls=[];
const state={room:{name:'E8N1'},spawnParallelShadow:null};
const game={time:7000};
const memory={creeps:{}};
function check({flag,proposal,expectedStatus,expectedReason=null,
                legacyCount=0,parallelCount=0,parallelOutcome=null,
                parallelThrows=false}) {
  calls.length=0;
  config.ENABLE_PARALLEL_SPAWN_EXECUTION=flag;
  state.spawnParallelShadow=proposal;
  parallel.execute=(s,p,g,m)=>{
    calls.push('parallel');
    assert.equal(s,state);
    assert.equal(p,proposal);
    assert.equal(g,game);
    assert.equal(m,memory);
    if(parallelThrows) throw Error('unknown after an uncertain live intent');
    return parallelOutcome || {status:'EXECUTED',acceptedCount:2,attemptedCount:2};
  };
  const result=roomManager._test.dispatchSpawn(state,game,memory);
  assert.equal(result,state.spawnParallelExecution,'status must be reflected in heartbeat state');
  assert.equal(result.status,expectedStatus);
  if(expectedReason) assert.equal(result.reason,expectedReason);
  assert.equal(calls.filter(x=>x==='legacy').length,legacyCount,
    'legacy must be called at most once and only on approved paths');
  assert.equal(calls.filter(x=>x==='parallel').length,parallelCount,
    'parallel must be called at most once and never with legacy');
  assert.ok(!(calls.includes('legacy') && calls.includes('parallel')),
    'one room/tick cannot mix productive authorities');
}
legacy.spawnOne=s=>{
  calls.push('legacy');
  assert.equal(s,state);
  return true;
};
try {
  const proposed={status:'PLANNED',intents:[{slot:0,role:'harvester'}]};
  const partial={status:'PARTIAL',intents:[{slot:0,role:'defender'}]};
  const deferred={status:'DEFERRED',reason:'LOW_CPU',intents:[]};
  const hold={status:'HOLD',reason:'UNKNOWN_RUNNING_JOB',intents:[]};
  const empty={status:'PLANNED',intents:[]};

  check({flag:false,proposal:proposed,expectedStatus:'DISABLED',
    expectedReason:'RELEASE_GATE_OFF',legacyCount:1});
  check({flag:false,proposal:hold,expectedStatus:'DISABLED',
    legacyCount:1});
  check({flag:true,proposal:deferred,expectedStatus:'DEFERRED',
    expectedReason:'CPU_SHADOW_DEFERRED',legacyCount:1});
  check({flag:true,proposal:proposed,expectedStatus:'EXECUTED',
    parallelCount:1});
  check({flag:true,proposal:partial,expectedStatus:'EXECUTED',
    parallelCount:1});
  check({flag:true,proposal:proposed,expectedStatus:'PARTIAL_HOLD',
    parallelCount:1,parallelOutcome:{status:'PARTIAL_HOLD',
      reason:'LIVE_SPAWN_BUSY',attemptedCount:2,acceptedCount:1}});
  check({flag:true,proposal:proposed,expectedStatus:'HOLD',
    expectedReason:'EXECUTOR_EXCEPTION',parallelCount:1,parallelThrows:true});
  check({flag:true,proposal:hold,expectedStatus:'HOLD',
    expectedReason:'UNKNOWN_RUNNING_JOB'});
  check({flag:true,proposal:empty,expectedStatus:'HOLD',
    expectedReason:'NO_PREPARED_INTENTS'});
  check({flag:true,proposal:null,expectedStatus:'HOLD',
    expectedReason:'NO_PLAN'});
  check({flag:true,proposal:{status:'NO_IDLE',intents:[]},
    expectedStatus:'HOLD',expectedReason:'NO_PREPARED_INTENTS'});
  check({flag:true,proposal:{status:'HOLD',intents:'bad'},
    expectedStatus:'HOLD',expectedReason:'NO_PREPARED_INTENTS'});

  const source=fs.readFileSync(new URL('../game/room.manager.js',import.meta.url),'utf8');
  assert.match(source,/dispatchSpawn\(state, Game, Memory\)/,
    'production room legacy stage calls the same tested dispatcher');
  assert.equal((source.match(/spawnManager\.spawnOne\(state\)/g)||[]).length,1,
    'the single original legacy call site must remain unique');
  assert.equal((source.match(/spawnParallelExecutor\.execute\(state, proposal, game, memory\)/g)||[]).length,1,
    'the active executor must be dispatched only once');
} finally {
  parallel.execute=originalParallel;
  legacy.spawnOne=originalLegacy;
  config.ENABLE_PARALLEL_SPAWN_EXECUTION=originalGate;
}
assert.equal(config.ENABLE_PARALLEL_SPAWN_EXECUTION,false,
  'O69 review code must end with production gate OFF');
console.log('O69 spawn-dispatch integration: default-off, CPU fallback, no dual authority, partial/error no retry PASS');
