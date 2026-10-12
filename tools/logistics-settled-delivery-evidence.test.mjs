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
const creep=(id,role)=>({id,name:id,spawning:false,memory:{role}});
const hauler=creep('hauler1','hauler');
const hauler2=creep('hauler2','hauler');
const consumer=creep('worker1','worker');
const builder=creep('builder1','builder');
const other=creep('harvest1','harvester');
let currentEvents=[];
const room={name:'E1N1',getEventLog(){return currentEvents;}};
const state={room,creeps:[hauler,hauler2,consumer,builder,other]};
const settled=(objectId,targetId,amount,resourceType='energy')=>({
  event:EVENT_TRANSFER,objectId,data:{targetId,amount,resourceType}
});
const events=()=>[
  settled('hauler1','worker1',20),
  settled('hauler2','builder1',5),
  settled('hauler1','structureStorage',99),
  settled('worker1','hauler1',30),
  settled('hauler2','builder1',9,'O'),
  {event:999,objectId:'hauler1',data:{targetId:'worker1',amount:50}}
];
{
  currentEvents=events();
  const prior=JSON.stringify({state,currentEvents});
  assert.deepEqual(observer._test.inspectRoom(state),{
    deliveredEnergy:25,deliveryEvents:2,rawEventCount:6
  });
  assert.equal(JSON.stringify({state,currentEvents}),prior,
    'Settlement observer may not mutate game state or events');
  currentEvents=[settled('hauler1','worker1',19),
    settled('hauler1','builder1',6)];
  assert.equal(observer._test.inspectRoom(state),null,
    'Impossible duplicate transfer events by one hauler fail closed');
  currentEvents=[settled('hauler1','worker1',0)];
  assert.equal(observer._test.inspectRoom(state),null);
  currentEvents=[{event:EVENT_TRANSFER,objectId:'hauler1'}];
  assert.equal(observer._test.inspectRoom(state),null,
    'Malformed authoritative event is unknown, not zero');
  currentEvents=Array.from({length:251},()=>({event:999}));
  assert.equal(observer._test.inspectRoom(state),null,
    'Overlarge event log fails closed instead of truncated census');
  currentEvents=[];
  assert.deepEqual(observer._test.inspectRoom(state),{
    deliveredEnergy:0,deliveryEvents:0,rawEventCount:0
  },'Genuine empty event log supports a measured zero');
  const old=room.getEventLog;
  room.getEventLog=()=>{throw Error('unsupported');};
  assert.equal(observer._test.inspectRoom(state),null);
  room.getEventLog=old;
}
{
  currentEvents=events();
  const memory={};
  let completed=[];
  for(let now=1000;now<=1099;now++){
    completed=observe([state],{time:now},memory);
    if(now<1099)assert.deepEqual(completed,[]);
    assert.deepEqual(observe([state],{time:now},memory),[],
      'Same tick replay cannot double count previous-tick transfers');
  }
  assert.equal(completed.length,1);
  const w=completed[0];
  assert.equal(w.startGameTick,1000);
  assert.equal(w.endGameTick,1099);
  assert.equal(w.startEventTick,999);
  assert.equal(w.endEventTick,1098);
  assert.equal(w.observedTicks,100);
  assert.equal(w.confirmedConsumerDeliveryEvents,200);
  assert.equal(w.confirmedConsumerEnergyLowerBound,2500);
  assert.equal(w.confirmedConsumerEnergyPerTickLowerBound,25);
  assert.equal(w.ticksWithConfirmedConsumerDelivery,100);
  assert.equal(w.schemaVersion,4);
  assert.equal(w.confirmedFirstDeliveryForPreviouslyWaitingConsumers,0);
  assert.equal(w.sampledWaitingTicksBeforeFirstConfirmedDeliveryTotal,0);
  assert.equal(w.averageSampledWaitingTicksBeforeFirstConfirmedDelivery,null);
  assert.equal(w.maximumSampledWaitingTicksBeforeFirstConfirmedDelivery,null);
  assert.equal(w.trueEndToEndTransportLatencyTicks,null);
  assert.equal(w.fullTransportEnergyPerTick,null);
  assert.equal(w.transportLatencyTicks,null);
  assert.equal(w.routeAttributableCpuPerTick,null);
  assert.equal(w.topologySwitchAuthorized,false);
  assert.equal(w.actionAuthority,'NONE');
  assert.deepEqual(observer.snapshot('E1N1',memory),w);
  assert.deepEqual(observe([state],{time:1099},memory),[]);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window.ticks,0,
    '100th game tick replay cannot fabricate another window');
  assert.deepEqual(observe([state],{time:1100},memory),[]);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window.ticks,1);
  // Now a target dies: the new event can no longer be safely attributed.
  // The observer reports a conservative LOWER BOUND, never full throughput.
  const reduced={...state,creeps:[hauler,hauler2,builder,other]};
  assert.deepEqual(observer._test.inspectRoom(reduced),{
    deliveredEnergy:5,deliveryEvents:1,rawEventCount:6
  });
}
{
  const memory={};
  currentEvents=[settled('hauler1','worker1',10)];
  for(let t=2000;t<=2049;t++){
    assert.deepEqual(observe([state],{time:t},memory),[]);
  }
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window.ticks,50);
  // A missing game tick destroys continuity; the next 100 actual distinct
  // ticks are required again before a complete settlement summary is emitted.
  observe([state],{time:2051},memory);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window.startGameTick,2051);
  for(let t=2052;t<=2149;t++){
    assert.deepEqual(observe([state],{time:t},memory),[]);
  }
  const complete=observe([state],{time:2150},memory);
  assert.equal(complete.length,1);
  assert.equal(complete[0].observedTicks,100);
  assert.equal(complete[0].confirmedConsumerEnergyLowerBound,1000);
  observe([state],{time:500},memory);
  assert.equal(observer.snapshot('E1N1',memory),null,
    'Time rewind cannot reuse stale previous-round settled evidence');
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window.startGameTick,500);
}
{
  const memory={};
  currentEvents=[];
  let result=[];
  for(let t=3000;t<=3099;t++)result=observe([state],{time:t},memory);
  assert.equal(result[0].confirmedConsumerEnergyLowerBound,0);
  assert.equal(result[0].confirmedConsumerDeliveryEvents,0);
  assert.equal(result[0].ticksWithConfirmedConsumerDelivery,0);
  currentEvents=[settled('hauler1','worker1',10)];
  for(let t=3100;t<=3120;t++)observe([state],{time:t},memory);
  currentEvents=[{event:EVENT_TRANSFER,objectId:'hauler1'}];
  assert.deepEqual(observe([state],{time:3121},memory),[]);
  assert.equal(observer.snapshot('E1N1',memory),null,
    'Malformed event log invalidates complete historical window too');
  currentEvents=[settled('hauler1','worker1',10)];
  observe([state],{time:3122},memory);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window.ticks,1);
}
{
  const memory={};
  currentEvents=[];
  observe([state],{time:8000},memory);
  const rec=memory.bot.e5SettledConsumerEnergy.rooms.E1N1;
  rec.window.ticks=99;rec.window.lastGameTick=7;
  observe([state],{time:8001},memory);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window.ticks,1,
    'Malformed persisted counters reset to new room record');
}
{
  const memory={};
  currentEvents=[];
  assert.deepEqual(observe([
    {room:{name:'E1N1'}},{room:{name:'E2N2'}},
    {room:{name:'E3N3'}},{room:{name:'E4N4'}}
  ],{time:3000},memory),[]);
  assert.equal(memory.bot,undefined,'>3 rooms must not claim partial evidence');
  assert.deepEqual(observe([state,state],{time:3000},memory),[]);
  assert.equal(memory.bot,undefined,'Ambiguous owned room identities fail closed');
  assert.deepEqual(observe([state],{time:NaN},memory),[]);
  assert.equal(memory.bot,undefined);
}
const src=fs.readFileSync(path.join(here,'../game/logistics.settled.delivery.evidence.js'),'utf8');
for(const forbidden of [
  /\.transfer\s*\(/,/\.withdraw\s*\(/,/\.moveTo\s*\(/,
  /\.spawnCreep\s*\(/,/\.createConstructionSite\s*\(/,
  /Memory\s*\./,/\.getUsed\s*\(/
])assert.equal(forbidden.test(src),false,
  'Settlement observer is passive, must not issue game intents/extra CPU probes');
const main=fs.readFileSync(path.join(here,'../game/main.js'),'utf8');
assert.ok(main.includes("const settledDeliveryEvidence = require('logistics.settled.delivery.evidence')"));
assert.ok(main.includes('settledDeliveryEvidence.observe('));
assert.ok(main.includes("E5_SETTLED_CONSUMER_DELIVERY_WINDOW"));
console.log('E5 genuine previous-tick consumer settlement events, bounded 100-tick lower-bound PASS');
