import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const dir=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(dir,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
globalThis.EVENT_TRANSFER=21;
globalThis.RESOURCE_ENERGY='energy';
const observer=require('../game/logistics.settled.delivery.evidence.js');

function hauler(id,energy,target) {
  return {id,spawning:false,store:{energy},memory:{
    role:'hauler',consumerTargetId:target
  }};
}
function consumer(id) {
  return {id,spawning:false,memory:{
    role:'worker',waitingEnergyTicks:1,logisticsFallback:false
  }};
}
const c1=consumer('c1'),c2=consumer('c2'),
  c3=consumer('c3'),c4=consumer('c4');
const h1=hauler('h1',60,'c1');
const h2=hauler('h2',45,'c2');
const h3=hauler('h3',70,null);
const h4=hauler('h4',55,'c3');
const h5=hauler('h5',15,'c3'); // ambiguous duplicate loaded sticky
const h6=hauler('h6',55,null);
const room={name:'E1N1',getEventLog(){return events;}};
const state={room,creeps:[h1,h2,h3,h4,h5,h6,c1,c2,c3,c4]};
const transfer=(actor,target,amount)=>({event:EVENT_TRANSFER,objectId:actor,
  data:{targetId:target,resourceType:RESOURCE_ENERGY,amount}});
let events=[];
const memory={};
const before=JSON.stringify(state.creeps);
const first=observer.capturePreIntentWaiting([state],{time:1000});
assert.deepEqual(first.rooms.E1N1.waitingConsumerIds,['c1','c2','c3','c4']);
assert.deepEqual(first.rooms.E1N1.loadedStickyConsumerIds,['c1','c2','c3']);
assert.deepEqual({...first.rooms.E1N1.exclusiveLoadedStickyHaulerByConsumer},
  {c1:'h1',c2:'h2'},
  'duplicate loaded assignments must not pretend to identify one actor');
assert.deepEqual(observer.observe([state],{time:1000},memory,first),[]);
assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window
  .waitingConsumerTicksWithLoadedSticky,3);
assert.equal(JSON.stringify(state.creeps),before,
  'the measurement must not mutate creep memory or store');

for(const c of [c1,c2,c3,c4])c.memory.waitingEnergyTicks=0;
events=[
  transfer('h1','c1',25), // same previously unique loaded sticky
  transfer('h3','c2',10), // OTHER hauler, despite unique loaded sticky h2
  transfer('h4','c3',8),  // two loaded sticky claims: ambiguous
  transfer('h6','c4',12)  // no loaded sticky claim at all
];
const second=observer.capturePreIntentWaiting([state],{time:1001});
assert.deepEqual(observer.observe([state],{time:1001},memory,second),[]);
const w=memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window;
assert.equal(w.firstConfirmedWaitingDeliveries,4);
assert.equal(w.firstReceiptFromSameExclusiveLoadedSticky,1);
assert.equal(w.firstReceiptFromOtherThanExclusiveLoadedSticky,1);
assert.equal(w.firstReceiptWithoutUniqueLoadedSticky,2);
assert.equal(w.deliveredEnergy,55);
assert.equal(w.waitingConsumerTicks,4);
assert.equal(w.waitingConsumerTicksWithLoadedSticky,3);
assert.equal(w.waitingEpisodesStoppedAfterObservedReceipt,4);
assert.deepEqual(observer.observe([state],{time:1001},memory,second),[],
  'same-tick replay must not double-count matched transfers');

// Complete 100 actual ticks and retain strict lower-bound, noncausal labels.
let complete=[];
events=[];
for(let tick=1002;tick<=1099;tick++) {
  const pre=observer.capturePreIntentWaiting([state],{time:tick});
  complete=observer.observe([state],{time:tick},memory,pre);
}
assert.equal(complete.length,1);
const report=complete[0];
assert.equal(report.schemaVersion,5);
assert.equal(report.observedTicks,100);
assert.equal(report.confirmedFirstDeliveryForPreviouslyWaitingConsumers,4);
assert.equal(report.observedWaitingConsumerTicksWithLoadedSticky,3);
assert.equal(report.firstConfirmedReceiptFromSameExclusiveLoadedSticky,1);
assert.equal(report.firstConfirmedReceiptFromOtherThanExclusiveLoadedSticky,1);
assert.equal(report.firstConfirmedReceiptWithoutUniqueLoadedSticky,2);
assert.equal(report.confirmedConsumerEnergyLowerBound,55);
assert.equal(report.waitingServiceSuccessRate,null);
assert.equal(report.routeAttributableCpuPerTick,null);
assert.equal(report.topologySwitchAuthorized,false);

// Malformed pre-intent loaded coverage cannot forge an exact actor match.
{
  const root={};
  const sample=observer.capturePreIntentWaiting([state],{time:2000});
  const fake={...sample,rooms:{...sample.rooms,E1N1:{
    ...sample.rooms.E1N1,
    loadedStickyConsumerIds:['ghost']
  }}};
  assert.deepEqual(observer.observe([state],{time:2000},root,fake),[]);
  assert.equal(observer.snapshot('E1N1',root),null);
}

// A previous incompatible schema window must never be reused as v5.
{
  const root={bot:{e5SettledConsumerEnergy:{schemaVersion:4,rooms:{
    E1N1:{lastWindow:{schemaVersion:4,confirmedConsumerEnergyLowerBound:999}}
  }}}};
  const pre=observer.capturePreIntentWaiting([state],{time:3000});
  observer.observe([state],{time:3000},root,pre);
  assert.equal(root.bot.e5SettledConsumerEnergy.schemaVersion,5);
  assert.equal(observer.snapshot('E1N1',root),null);
}

const source=fs.readFileSync(path.join(dir,
  '../game/logistics.settled.delivery.evidence.js'),'utf8');
for(const forbidden of [
  /\.transfer\s*\(/,/\.withdraw\s*\(/,/\.moveTo\s*\(/,
  /\.spawnCreep\s*\(/,/\.getUsed\s*\(/,/Memory\s*\./
])assert.equal(forbidden.test(source),false,
  'E5 sticky-to-settlement evidence must never issue gameplay actions');
console.log('E5 loaded sticky to engine-confirmed first receipt attribution, 100 ticks, no authority PASS');
