import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const evidence=require('../game/logistics.hauler.cpu.evidence.js');

const room=[{room:{name:'E1N1'},creeps:[
  {id:'h1',memory:{role:'hauler'}},
  {id:'h2',memory:{role:'hauler'}}
]}];
const roomWithoutHaulers=[{room:{name:'E1N1'},creeps:[]}];
const input=()=>({'E1N1':{haulers:2,roleCpu:1.25}});
{
  const mem={};
  let completed=[];
  for(let t=1000;t<=1099;t++){
    completed=evidence.observe(room,input(),{time:t},mem);
    if(t<1099)assert.deepEqual(completed,[]);
    // Replaying the same tick (including boundary) never adds another 1.25.
    assert.deepEqual(evidence.observe(room,input(),{time:t},mem),[]);
  }
  assert.equal(completed.length,1);
  const w=completed[0];
  assert.deepEqual(w,{
    room:'E1N1',schemaVersion:1,authority:'SHADOW_EVIDENCE',
    source:'MEASURED_CREEP_ROLE_CPU_NOT_ROUTE_CPU',
    actionAuthority:'NONE',startTick:1000,endTick:1099,observedTicks:100,
    totalRoleCpu:125,haulerRoleCpuPerTick:1.25,
    totalHaulerCreepTicks:200,haulerRoleCpuPerCreepTick:0.625,
    ticksWithActiveHaulers:100,
    settledEnergyPerTick:null,transportRouteCpuPerTick:null,
    comparableAlternativeCpuPerTick:null,topologySwitchAuthorized:false
  });
  const {room:roomId,...windowSummary}=w;
  assert.equal(roomId,'E1N1');
  assert.deepEqual(evidence.snapshot('E1N1',mem),windowSummary);
  assert.deepEqual(evidence.observe(room,input(),{time:1099},mem),[],
    '100th tick replay never opens another evidence batch');
  assert.deepEqual(evidence.observe(room,input(),{time:1100},mem),[]);
  assert.equal(mem.bot.logisticsHaulerCpuEvidence.rooms.E1N1.window.ticks,1);
}
{
  const mem={};
  let result=[];
  for(let t=2000;t<=2039;t++)result=evidence.observe(room,input(),{time:t},mem);
  assert.deepEqual(result,[]);
  result=evidence.observe(room,input(),{time:2041},mem);
  assert.deepEqual(result,[]);
  assert.equal(mem.bot.logisticsHaulerCpuEvidence.rooms.E1N1.window.startTick,2041);
  for(let t=2042;t<=2139;t++){
    result=evidence.observe(room,input(),{time:t},mem);
    assert.deepEqual(result,[]);
  }
  result=evidence.observe(room,input(),{time:2140},mem);
  assert.equal(result[0].observedTicks,100);
  assert.equal(result[0].startTick,2041);
  assert.equal(result[0].endTick,2140);
}
{
  const mem={};
  for(let t=500;t<=599;t++)evidence.observe(room,input(),{time:t},mem);
  assert.ok(evidence.snapshot('E1N1',mem));
  evidence.observe(room,input(),{time:20},mem);
  assert.equal(evidence.snapshot('E1N1',mem),null);
  assert.equal(mem.bot.logisticsHaulerCpuEvidence.rooms.E1N1.window.startTick,20);
  assert.deepEqual(evidence.observe(room,input(),{time:NaN},mem),[]);
}
{
  const mem={bot:{logisticsHaulerCpuEvidence:{schemaVersion:0,rooms:{
    'E1N1':{lastWindow:{observedTicks:100,totalRoleCpu:0}}
  }}}};
  evidence.observe(room,input(),{time:8000},mem);
  assert.equal(evidence.snapshot('E1N1',mem),null);
  assert.equal(mem.bot.logisticsHaulerCpuEvidence.schemaVersion,1);
  const w=mem.bot.logisticsHaulerCpuEvidence.rooms.E1N1.window;
  w.ticks=99;w.lastTick=10;w.startTick=8000;
  evidence.observe(room,input(),{time:8001},mem);
  assert.equal(mem.bot.logisticsHaulerCpuEvidence.rooms.E1N1.window.ticks,1,
    'Malformed persistent tick counters must not certify a window');
}
{
  const mem={};
  const zero={'E1N1':{haulers:0,roleCpu:0}};
  let result=[];
  for(let t=3000;t<=3099;t++)result=evidence.observe(roomWithoutHaulers,zero,{time:t},mem);
  assert.equal(result[0].observedTicks,100);
  assert.equal(result[0].haulerRoleCpuPerTick,0);
  assert.equal(result[0].haulerRoleCpuPerCreepTick,null);
  assert.equal(result[0].ticksWithActiveHaulers,0);
}
{
  const mem={};
  for(let t=7000;t<=7005;t++)evidence.observe(room,input(),{time:t},mem);
  assert.equal(mem.bot.logisticsHaulerCpuEvidence.rooms.E1N1.window.ticks,6);
  evidence.observe(room,{}, {time:7006},mem);
  assert.equal(mem.bot.logisticsHaulerCpuEvidence.rooms.E1N1,undefined,
    'Missing hauler callback cannot claim an idle zero-CPU sample');
  evidence.observe(room,{'E1N1':{haulers:1,roleCpu:0.5}},
    {time:7007},mem);
  assert.equal(mem.bot.logisticsHaulerCpuEvidence.rooms.E1N1,undefined,
    'Incomplete callback count fails closed against owned hauler census');
  evidence.observe(room,input(),{time:7008},mem);
  assert.equal(mem.bot.logisticsHaulerCpuEvidence.rooms.E1N1.window.ticks,1);
  const forged=[{room:{name:'E1N1'},creeps:[
    {id:'same',memory:{role:'hauler'}},
    {id:'same',memory:{role:'hauler'}}
  ]}];
  const before=JSON.stringify(mem);
  assert.deepEqual(evidence.observe(forged,input(),{time:7009},mem),[]);
  assert.equal(JSON.stringify(mem),before,
    'Ambiguous owned hauler identities must leave observer memory untouched');
}
{
  const mem={};
  for(let t=4000;t<=4009;t++)evidence.observe(room,input(),{time:t},mem);
  const before=JSON.stringify(mem);
  for(const bad of [
    {haulers:NaN,roleCpu:1},
    {haulers:-1,roleCpu:1},
    {haulers:1.5,roleCpu:1},
    {haulers:1,roleCpu:Infinity},
    {haulers:1,roleCpu:-0.1},
  ]){
    assert.deepEqual(evidence.observe(room,{'E1N1':bad},{time:4010},mem),[]);
    assert.equal(evidence.snapshot('E1N1',mem),null);
  }
  assert.notEqual(JSON.stringify(mem),before,'Invalid sample clears partial evidence');
  assert.deepEqual(evidence.observe(room,input(),{time:4011},mem),[]);
  assert.equal(mem.bot.logisticsHaulerCpuEvidence.rooms.E1N1.window.ticks,1);
}
{
  const mem={};
  assert.deepEqual(evidence.observe(['E1N1','E2N2','E3N3','E4N4']
    .map(name=>({room:{name}})),{}, {time:100},mem),[]);
  assert.equal(mem.bot,undefined,'Over-cap colony must not persist partial census');
  const invalid=['E1N1','E1N1'].map(name=>({room:{name}}));
  assert.deepEqual(evidence.observe(invalid,{}, {time:100},mem),[]);
  assert.equal(mem.bot,undefined,'Duplicate room identity invalidates census');
}
const source=fs.readFileSync(path.join(here,'../game/logistics.hauler.cpu.evidence.js'),'utf8');
for(const forbidden of [
  /\.transfer\s*\(/,/\.moveTo\s*\(/,/\.spawnCreep\s*\(/,
  /\.createConstructionSite\s*\(/,/\.getUsed\s*\(/,/Memory\s*\./
])assert.equal(forbidden.test(source),false,
  'CPU aggregation must issue no gameplay actions or additional CPU probes');
const manager=fs.readFileSync(path.join(here,'../game/creep.manager.js'),'utf8');
assert.ok(manager.includes('function runAll(onHaulerRoleCpu)'));
assert.ok(manager.includes('onHaulerRoleCpu(creep.room.name, used)'));
const main=fs.readFileSync(path.join(here,'../game/main.js'),'utf8');
assert.ok(main.includes('creepManager.runAll(onHaulerRoleCpu)'));
assert.ok(main.includes('logisticsHaulerCpuEvidence.observe('));
assert.ok(main.includes('E5_HAULER_ROLE_CPU_WINDOW'));
console.log('E5 measured hauler-role CPU: bounded real contiguous ticks and no invented routes PASS');
