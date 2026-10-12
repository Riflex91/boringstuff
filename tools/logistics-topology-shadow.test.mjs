import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const e5=require('../game/logistics.topology.shadow.js');
const roomName='E1N1';
const pos=(x,y)=>({x,y,roomName});
const source=(id,x,y)=>({id,pos:pos(x,y)});
const struct=(id,type,x,y)=>({id,structureType:type,my:true,pos:pos(x,y)});
const w={
  schemaVersion:2,authority:'SHADOW_EVIDENCE',
  startTick:2000,endTick:2099,ticks:100,
  deferredRatio:0,
  averageConsumerWaiting:0.25,
  averageConsumerCritical:0.15,
  averageConsumerFallback:0.04,
  unmatchedCriticalTicks:6,criticalRequestTicks:15,
  duplicateReservationTicks:0,
  haulerUtilization:0.6,averagePredictedTransportTicks:10.3
};
function populated(rcl=2) {
  return {
    rcl,room:{name:roomName,controller:{level:rcl}},
    sources:[source('s1',5,5),source('s2',40,40)],
    structures:[
      struct('buffer1','container',6,5),
      struct('buffer2','container',39,40),
      struct('store','storage',25,25),
      struct('link1','link',5,6),
      struct('link2','link',26,25),
      struct('terminal','terminal',28,25)
    ],
    creeps:[
      {id:'h1',memory:{role:'hauler'}},
      {id:'h2',memory:{role:'hauler'}}
    ],
    economyModel:{
      mode:'dedicated-hauler',
      sourceRoutes:[
        {sourceId:'s1',spawnDistance:13,containerReady:true},
        {sourceId:'s2',spawnDistance:20,containerReady:true}
      ]
    }
  };
}
const s=populated();
const snapshot=JSON.stringify({s,w});
const plan=e5.inspectTopology(s,w,{time:2099});
assert.equal(plan.status,'OBSERVATION_ONLY');
assert.equal(plan.actionAuthority,'NONE');
assert.equal(plan.switchAuthorized,false);
assert.equal(plan.economicWinner,null);
assert.equal(plan.baseline.observedTicks,100);
assert.equal(plan.baseline.averageConsumerFallback,0.04);
assert.equal(plan.baseline.predictedTransportTicks,10.3);
assert.equal(plan.baseline.measuredTransportCpuPerTick,null);
assert.equal(plan.baseline.settledDeliveryLatency,null);
assert.equal(plan.baseline.measuredTransportEnergyPerTick,null);
assert.equal(plan.currentTopology,'dedicated-hauler');
assert.deepEqual(plan.candidates.map(c=>c.mode),e5.MODES);
assert.deepEqual(plan.candidates.map(c=>c.infrastructureStatus),[
  'POSSIBLE','POSSIBLE','POSSIBLE','POSSIBLE','POSSIBLE'
]);
assert.ok(plan.candidates.every(c=>c.economicStatus==='UNVERIFIED' &&
  c.decision==='NO_SWITCH'));
assert.equal(JSON.stringify({s,w}),snapshot,'E5 read-only by construction');
assert.deepEqual(e5.inspectTopology(populated(8),w,{time:2099}).candidates,
  plan.candidates,'E5 does not perform hard RCL-only switches');
assert.equal(e5.inspectTopology(s,w,{time:2100}).status,'DEFERRED',
  'A one-tick stale completed E4 window is not acceptable');
assert.equal(e5.inspectTopology(s,null,{time:2099}).reason,
  'NO_FRESH_COMPLETE_E4_WINDOW');
assert.equal(e5.inspectTopology(s,w,{time:NaN}).reason,
  'NO_VALID_ROOM_OR_TICK');
assert.equal(e5.inspectTopology({room:{name:roomName}},w,{time:2099})
  .candidates.filter(c=>c.infrastructureStatus==='POSSIBLE').length,0,
  'Missing topology evidence cannot be fabricated from RCL');
const old={...w,schemaVersion:1};
assert.equal(e5.inspectTopology(s,old,{time:2099}).status,'DEFERRED');
for(const [label,modify] of [
  ['fake 100 calls',x=>{x.startTick=2098;}],
  ['missing actual ticks',x=>{x.ticks=98;}],
  ['future completed',x=>{x.endTick=2100;}],
  ['no observer authority',x=>{x.authority='ACTIVE';}],
  ['invalid observed critical ratio',x=>{x.unmatchedCriticalTicks=16;}],
  ['infinite predicted transport',x=>{x.averagePredictedTransportTicks=Infinity;}],
  ['negative utilization',x=>{x.haulerUtilization=-1;}],
  ['duplicate overrun',x=>{x.duplicateReservationTicks=101;}],
  ['deferred overrun',x=>{x.deferredRatio=1.1;}]
]){
  const candidate=structuredClone(w);
  modify(candidate);
  assert.equal(e5.inspectTopology(s,candidate,{time:2099}).status,
    'DEFERRED',label);
}
{
  const x=populated();
  x.economyModel.sourceRoutes.pop();
  const p=e5.inspectTopology(x,w,{time:2099});
  assert.equal(p.candidates.find(c=>c.mode==='SOURCE_LANE')
    .infrastructureStatus,'BLOCKED');
  assert.equal(p.candidates.find(c=>c.mode==='POOLED_HAUL')
    .infrastructureStatus,'BLOCKED');
  assert.equal(p.candidates.find(c=>c.mode==='SELF_HAUL')
    .infrastructureStatus,'POSSIBLE');
}
{
  const x=populated();
  x.economyModel.sourceRoutes[0].containerReady=false;
  const p=e5.inspectTopology(x,w,{time:2099});
  assert.equal(p.candidates.find(c=>c.mode==='SOURCE_LANE').blocker,
    'SOURCE_CONTAINER_INCOMPLETE');
}
{
  const x=populated();
  x.creeps=[x.creeps[0]];
  const p=e5.inspectTopology(x,w,{time:2099});
  assert.equal(p.candidates.find(c=>c.mode==='POOLED_HAUL').blocker,
    'INSUFFICIENT_HAULER_IDENTITIES');
}
{
  const x=populated();
  x.structures=x.structures.filter(st=>st.structureType!=='storage');
  const p=e5.inspectTopology(x,w,{time:2099});
  assert.equal(p.candidates.find(c=>c.mode==='LINKS_HUB').infrastructureStatus,
    'BLOCKED');
  assert.equal(p.candidates.find(c=>c.mode==='TERMINAL').infrastructureStatus,
    'BLOCKED');
}
{
  const x=populated();
  x.structures=x.structures.filter(st=>st.structureType!=='link');
  assert.equal(e5.inspectTopology(x,w,{time:2099}).candidates
    .find(c=>c.mode==='LINKS_HUB').infrastructureStatus,'BLOCKED');
}
{
  const x=populated();
  x.economyModel.sourceRoutes.push({...x.economyModel.sourceRoutes[0]});
  assert.equal(e5.inspectTopology(x,w,{time:2099}).measuredInfrastructure
    .sourceRoutesVerified,false,'Duplicate route identity fails closed');
}
assert.deepEqual(e5.telemetrySummary(plan),{
  authority:'SHADOW',actionAuthority:'NONE',status:'OBSERVATION_ONLY',
  reason:'MISSING_COMPARABLE_SETTLED_ROUTE_ENERGY_CPU_AND_LATENCY',
  evidenceTicks:100,readyInfrastructureModes:e5.MODES,
  economicWinner:null,switchAuthorized:false
});
const moduleSource=fs.readFileSync(path.join(here,'../game/logistics.topology.shadow.js'),'utf8');
for(const forbidden of [
  /\.transfer\s*\(/,/\.moveTo\s*\(/,/\.spawnCreep\s*\(/,
  /\.createConstructionSite\s*\(/,/Memory\s*\./
])assert.equal(forbidden.test(moduleSource),false,
  'Shadow E5 must not contain runtime gameplay actions');
const runtime=fs.readFileSync(path.join(here,'../game/room.manager.js'),'utf8');
assert.ok(runtime.includes('state.logisticsMatchingEvidence.completed'));
assert.ok(runtime.includes('LOGISTICS_TOPOLOGY_SHADOW'));
assert.ok(runtime.includes('logisticsTopologyShadow.inspectTopology('));
console.log('E5 evidence-gated topology infrastructure candidates (no economics/no switches) PASS');
