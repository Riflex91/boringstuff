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
globalThis.EVENT_TRANSFER=21;
globalThis.RESOURCE_ENERGY='energy';
const observer=require('../game/logistics.settled.delivery.evidence.js');

const a={id:'h1',spawning:false,memory:{role:'hauler'}};
const b={id:'h2',spawning:false,memory:{role:'hauler'}};
const c={id:'c1',spawning:false,memory:{role:'worker',waitingEnergyTicks:0}};
const q={id:'c2',spawning:false,memory:{role:'upgrader',waitingEnergyTicks:0}};
let events=[];
const room={name:'E1N1',getEventLog:()=>events};
const state={room,creeps:[a,b,c,q]};
function delivered(actor,target,amount){
  return {event:EVENT_TRANSFER,objectId:actor,
    data:{targetId:target,resourceType:RESOURCE_ENERGY,amount}};
}
const emptySummary=()=>{
  const w=observer._test.newWindow(1);
  for(let t=1;t<=100;t++){
    w.ticks++;w.lastGameTick=t;
  }
  return observer._test.summarize(w,'E1N1');
};
assert.equal(emptySummary().confirmedFirstDeliveryForPreviouslyWaitingConsumers,0);
assert.equal(emptySummary().averageSampledWaitingTicksBeforeFirstConfirmedDelivery,null);
{
  const memory={};
  let out=[];
  for(let t=4000;t<=4099;t++){
    // One four-sample uninterrupted, previously observed wait (4006–4009),
    // then the actual energy transfer settled at 4009, observed at 4010.
    c.memory.waitingEnergyTicks=t>=4006 && t<=4009 ? t-4005 : 0;
    // Two-sample wait on the independently identified other consumer.
    q.memory.waitingEnergyTicks=t>=4030 && t<=4031 ? t-4029 : 0;
    events=[];
    if(t===4010)events=[delivered('h1','c1',15)];
    if(t===4032)events=[delivered('h2','c2',20)];
    out=observer.observe([state],{time:t},memory);
    assert.equal(out.length,t===4099?1:0);
  }
  const w=out[0];
  assert.equal(w.schemaVersion,2);
  assert.equal(w.observedTicks,100);
  assert.equal(w.confirmedConsumerDeliveryEvents,2);
  assert.equal(w.confirmedConsumerEnergyLowerBound,35);
  assert.equal(w.confirmedFirstDeliveryForPreviouslyWaitingConsumers,2);
  assert.equal(w.sampledWaitingTicksBeforeFirstConfirmedDeliveryTotal,6);
  assert.equal(w.averageSampledWaitingTicksBeforeFirstConfirmedDelivery,3);
  assert.equal(w.maximumSampledWaitingTicksBeforeFirstConfirmedDelivery,4);
  assert.equal(w.trueEndToEndTransportLatencyTicks,null);
  assert.equal(w.transportLatencyTicks,null);
  assert.equal(w.actionAuthority,'NONE');
  assert.equal(w.topologySwitchAuthorized,false);
  assert.equal(observer.snapshot('E1N1',memory).confirmedFirstDeliveryForPreviouslyWaitingConsumers,2);
}
{
  // Even repeated partial energy settlements during one continuing wait are
  // a SINGLE first-delivery witness, not evidence of two completed services.
  const memory={};
  let result=[];
  for(let t=5000;t<=5099;t++){
    c.memory.waitingEnergyTicks=t>=5010&&t<=5018 ? t-5009 : 0;
    q.memory.waitingEnergyTicks=0;
    events=t===5014?[delivered('h1','c1',5)]
      :t===5016?[delivered('h2','c1',10)]:[];
    result=observer.observe([state],{time:t},memory);
  }
  assert.equal(result[0].confirmedConsumerDeliveryEvents,2);
  assert.equal(result[0].confirmedFirstDeliveryForPreviouslyWaitingConsumers,1);
  assert.equal(result[0].sampledWaitingTicksBeforeFirstConfirmedDeliveryTotal,4);
}
{
  // A previous-tick transfer to a currently visible consumer is confirmed,
  // but without a PREVIOUSLY OBSERVED wait it cannot prove wait resolution.
  const memory={};
  const seen=[];
  for(let t=6000;t<=6099;t++){
    c.memory.waitingEnergyTicks=t===6010?1:0;
    q.memory.waitingEnergyTicks=0;
    events=t===6010?[delivered('h1','c1',25)]:[];
    seen.push(...observer.observe([state],{time:t},memory));
  }
  assert.equal(seen[0].confirmedConsumerEnergyLowerBound,25);
  assert.equal(seen[0].confirmedFirstDeliveryForPreviouslyWaitingConsumers,0);
}
{
  // Tick discontinuities and missing game event logs invalidate the waiting
  // history; the following event cannot invent a valid earlier wait.
  const memory={};
  c.memory.waitingEnergyTicks=1;events=[];
  observer.observe([state],{time:7000},memory);
  c.memory.waitingEnergyTicks=2;events=[delivered('h1','c1',12)];
  observer.observe([state],{time:7002},memory);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1
    .window.firstConfirmedWaitingDeliveries,0);
  c.memory.waitingEnergyTicks=3;events=[];
  observer.observe([state],{time:7003},memory);
  const old=room.getEventLog;
  room.getEventLog=()=>{throw Error('events unavailable');};
  observer.observe([state],{time:7004},memory);
  room.getEventLog=old;
  c.memory.waitingEnergyTicks=0;events=[delivered('h1','c1',12)];
  observer.observe([state],{time:7005},memory);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1
    .window.firstConfirmedWaitingDeliveries,0);
}
{
  // Identity ambiguity must not turn into a fabricated confirmed service.
  const memory={};
  const ambiguous={...state,creeps:[a,b,c,{...q,id:'c1'}]};
  c.memory.waitingEnergyTicks=4;events=[delivered('h1','c1',10)];
  assert.equal(observer._test.inspectRoom(ambiguous,true),null);
  assert.deepEqual(observer.observe([ambiguous],{time:8000},memory),[]);
  assert.equal(observer.snapshot('E1N1',memory),null);
}
const src=fs.readFileSync(path.join(here,'../game/logistics.settled.delivery.evidence.js'),'utf8');
for(const forbidden of [
  /\.transfer\s*\(/,/\.withdraw\s*\(/,/\.moveTo\s*\(/,
  /\.spawnCreep\s*\(/,/\.createConstructionSite\s*\(/,
  /Memory\s*\./,/\.getUsed\s*\(/
]){
  assert.equal(forbidden.test(src),false,
    'Waiting-to-settlement witness must not issue game or extra CPU actions');
}
console.log('E5 previous-waiting -> first real settled delivery: bounded, noncausal and 100 actual ticks PASS');
