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
function observe(states, game, memory) {
  return observer.observe(states, game, memory,
    observer.capturePreIntentWaiting(states, game));
}
const hauler=(id)=>({id,spawning:false,memory:{role:'hauler'}});
const consumer=(id)=>({id,spawning:false,memory:{
  role:'worker',waitingEnergyTicks:0,logisticsFallback:false
}});
const h1=hauler('h1'),h2=hauler('h2');
const A=consumer('A'),B=consumer('B'),C=consumer('C'),
  D=consumer('D'),E=consumer('E');
let ev=[];
const room={name:'E1N1',getEventLog:()=>ev};
const state={room,creeps:[h1,h2,A,B,C,D,E]};
function transfer(actor,target,amount){
  return {event:EVENT_TRANSFER,objectId:actor,
    data:{targetId:target,resourceType:RESOURCE_ENERGY,amount}};
}
{
  const memory={};
  const initial=JSON.stringify({h1,h2,A,B,C,D,E});
  let result=[];
  for(let tick=1000;tick<=1099;tick++){
    A.memory.waitingEnergyTicks=(tick>=1001&&tick<=1004)?tick-1000:0;
    B.memory.waitingEnergyTicks=(tick>=1010&&tick<=1014)?tick-1009:0;
    C.memory.waitingEnergyTicks=(tick>=1020&&tick<=1025)?tick-1019:0;
    D.memory.waitingEnergyTicks=(tick>=1030)?tick-1029:0;
    E.memory.waitingEnergyTicks=(tick>=1050&&tick<=1055)?tick-1049:0;
    state.creeps=tick<=1025?[h1,h2,A,B,C,D,E]:[h1,h2,A,B,D,E];
    ev=tick===1005?[transfer('h1','A',15)]
      :tick===1053?[transfer('h2','E',8)]:[];
    result=observe([state],{time:tick},memory);
    assert.equal(result.length,tick===1099?1:0);
    assert.deepEqual(observe([state],{time:tick},memory),[],
      'Replay of a tick must not double-count waiting episodes');
  }
  const x=result[0];
  assert.equal(x.schemaVersion,4);
  assert.equal(x.observedTicks,100);
  assert.equal(x.confirmedConsumerEnergyLowerBound,23);
  assert.equal(x.confirmedFirstDeliveryForPreviouslyWaitingConsumers,2);
  assert.equal(x.sampledWaitingTicksBeforeFirstConfirmedDeliveryTotal,7);
  assert.equal(x.observedWaitingConsumerTicks,91);
  assert.equal(x.observedWaitingConsumerTicksBeforeFirstReceipt,88);
  assert.equal(x.observedWaitingEpisodeStarts,5);
  assert.equal(x.observedWaitingEpisodesStoppedWithoutHaulerReceipt,1);
  assert.equal(x.observedWaitingEpisodesStoppedAfterHaulerReceipt,2);
  assert.equal(x.observedWaitingEpisodesLostVisibility,1);
  assert.equal(x.maximumConcurrentWaitingConsumersWithoutFirstReceipt,2);
  assert.equal(x.openWaitingEpisodesAtWindowEnd,1);
  assert.equal(x.openWaitingEpisodesWithoutConfirmedReceiptAtWindowEnd,1);
  assert.equal(x.waitingServiceSuccessRate,null);
  assert.equal(x.trueEndToEndTransportLatencyTicks,null);
  assert.equal(x.topologySwitchAuthorized,false);
  // Observer itself does not mutate creep state, only our per-tick fixture.
  assert.equal(h1.memory.role,'hauler');
  assert.equal(JSON.parse(initial).A.memory.role,A.memory.role);
}
{
  const memory={};
  let report=[];
  for(let tick=2000;tick<=2099;tick++){
    const W=consumer('W');
    W.memory.waitingEnergyTicks=tick>=2050?tick-2049:0;
    state.creeps=[h1,h2,W];
    ev=[];
    report=observe([state],{time:tick},memory);
  }
  assert.equal(report[0].observedWaitingEpisodeStarts,1);
  assert.equal(report[0].confirmedFirstDeliveryForPreviouslyWaitingConsumers,0);
  assert.equal(report[0].observedWaitingEpisodesStoppedWithoutHaulerReceipt,0);
  assert.equal(report[0].openWaitingEpisodesAtWindowEnd,1,
    'Unresolved at a window boundary is right-censored, not classified failure');
  assert.equal(report[0].openWaitingEpisodesWithoutConfirmedReceiptAtWindowEnd,1);
  for(let tick=2100;tick<=2199;tick++){
    const W=consumer('W');
    W.memory.waitingEnergyTicks=tick<=2105?tick-2049:0;
    state.creeps=[h1,h2,W];
    ev=tick===2103?[transfer('h1','W',12)]:[];
    report=observe([state],{time:tick},memory);
  }
  assert.equal(report[0].observedWaitingEpisodeStarts,0,
    'Waiting episode carried across adjacent 100-tick windows, not restarted');
  assert.equal(report[0].confirmedFirstDeliveryForPreviouslyWaitingConsumers,1);
  assert.equal(report[0].sampledWaitingTicksBeforeFirstConfirmedDeliveryTotal,53,
    'Observed wait length includes contiguous earlier-window samples');
  assert.equal(report[0].observedWaitingEpisodesStoppedAfterHaulerReceipt,1);
  assert.equal(report[0].openWaitingEpisodesAtWindowEnd,0);
}
{
  const memory={};
  state.creeps=[h1,h2,A];A.memory.waitingEnergyTicks=5;ev=[];
  observe([state],{time:3000},memory);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1
    .waiting.A.firstTick,3000);
  observe([state],{time:3002},memory);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1
    .waiting.A.firstTick,3002,'Missing tick resets wait history');
  const rec=memory.bot.e5SettledConsumerEnergy.rooms.E1N1;
  rec.waiting.A.firstTick=-1;
  observe([state],{time:3003},memory);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1
    .waiting.A.firstTick,3003,'Corrupted wait data resets, not misreports');
  const old=room.getEventLog;
  room.getEventLog=()=>{throw Error('unavailable');};
  observe([state],{time:3004},memory);
  room.getEventLog=old;
  assert.equal(Object.keys(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.waiting).length,0);
  ev=[transfer('h1','A',5)];
  observe([state],{time:3005},memory);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window
    .firstConfirmedWaitingDeliveries,0);
}
{
  const memory={bot:{e5SettledConsumerEnergy:{
    schemaVersion:2,rooms:{E1N1:{window:{
      startGameTick:4000,lastGameTick:4099,ticks:100
    },lastWindow:{confirmedFirstDeliveryForPreviouslyWaitingConsumers:12}}}
  }}};
  state.creeps=[h1,h2,A];A.memory.waitingEnergyTicks=1;ev=[];
  observe([state],{time:4100},memory);
  assert.equal(memory.bot.e5SettledConsumerEnergy.schemaVersion,4);
  assert.equal(observer.snapshot('E1N1',memory),null,
    'Old v2 episode evidence must not survive migration');
}
const src=fs.readFileSync(path.join(here,
  '../game/logistics.settled.delivery.evidence.js'),'utf8');
for(const forbidden of [/\.transfer\s*\(/,/\.withdraw\s*\(/,
  /\.moveTo\s*\(/,/\.spawnCreep\s*\(/,/Memory\s*\./]){
  assert.equal(forbidden.test(src),false,
    'Episode observer must have no gameplay authority');
}
console.log('E5 censor-aware waiting episode census: starts, stopped, visibility, confirmed first receipt and open windows PASS');
