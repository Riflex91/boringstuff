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
const hauler={id:'hauler1',spawning:false,memory:{role:'hauler'}};
const worker={id:'worker1',spawning:false,memory:{
  role:'worker',waitingEnergyTicks:3,logisticsFallback:true}};
let events=[];
const room={name:'E1N1',getEventLog:()=>events};
const state={room,creeps:[hauler,worker]};
const settled=(amount)=>({event:EVENT_TRANSFER,objectId:'hauler1',
  data:{targetId:'worker1',amount,resourceType:RESOURCE_ENERGY}});

// Important production ordering: snapshot waiting BEFORE role.hauler can
// clear it on an accepted transfer() intent. This is not a real settlement.
{
  const memory={};
  const prior=observer.capturePreIntentWaiting([state],{time:1000});
  assert.deepEqual([...prior.rooms.E1N1.waitingConsumerIds],['worker1']);
  const priorJson=JSON.stringify(prior);
  worker.memory.waitingEnergyTicks=0;
  worker.memory.logisticsFallback=false; // accepted intent has side effects
  events=[];                              // server has NOT settled anything
  assert.deepEqual(observer.observe([state],{time:1000},memory,prior),[]);
  assert.equal(JSON.stringify(prior),priorJson,
    'Frozen-before-intents witness must be independent of later Memory edits');
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1
    .waiting.worker1.firstTick,1000);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window
    .firstConfirmedWaitingDeliveries,0,
    'An accepted intent is not a settled energy receipt');

  // The NEXT game tick exposes the prior tick's real engine transfer event.
  events=[settled(17)];
  const current=observer.capturePreIntentWaiting([state],{time:1001});
  assert.deepEqual(current.rooms.E1N1.waitingConsumerIds,[]);
  observer.observe([state],{time:1001},memory,current);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window
    .firstConfirmedWaitingDeliveries,1,
    'Prior pre-intent waiting and later actual transfer must correlate');
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window
    .sampledWaitingTicksToFirstDeliveryTotal,1);
  assert.equal(memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window
    .waitingEpisodesStoppedAfterObservedReceipt,1);

  events=[];
  for(let t=1002;t<=1099;t++){
    const capture=observer.capturePreIntentWaiting([state],{time:t});
    const done=observer.observe([state],{time:t},memory,capture);
    if(t===1099){
      assert.equal(done[0].schemaVersion,4);
      assert.equal(done[0].waitingObservationPhase,'BEFORE_CREEP_INTENTS');
      assert.equal(done[0].confirmedConsumerEnergyLowerBound,17);
      assert.equal(done[0].confirmedFirstDeliveryForPreviouslyWaitingConsumers,1);
      assert.equal(done[0].sampledWaitingTicksBeforeFirstConfirmedDeliveryTotal,1);
      assert.equal(done[0].observedWaitingEpisodesStoppedAfterHaulerReceipt,1);
      assert.equal(done[0].waitingServiceSuccessRate,null);
      assert.equal(done[0].trueEndToEndTransportLatencyTicks,null);
      assert.equal(done[0].topologySwitchAuthorized,false);
    } else assert.deepEqual(done,[]);
  }
}
{
  const memory={};
  worker.memory.waitingEnergyTicks=9;
  worker.memory.logisticsFallback=true;
  events=[];
  const pre=observer.capturePreIntentWaiting([state],{time:2000});
  assert.deepEqual(observer.observe([state],{time:2000},memory),[],
    'No pre-intent witness means no evidence');
  assert.equal(memory.bot,undefined,'Missing witness cannot persist a fake zero');
  assert.deepEqual(observer.observe([state],{time:2000},memory,
    {...pre,tick:2001}),[],
    'A future/old capture cannot be reused at the wrong game tick');
  assert.equal(memory.bot,undefined);
  // No engine event after accepted intent: do not claim a completed delivery.
  observer.observe([state],{time:2000},memory,pre);
  worker.memory.waitingEnergyTicks=0;
  worker.memory.logisticsFallback=false;
  const second=observer.capturePreIntentWaiting([state],{time:2001});
  observer.observe([state],{time:2001},memory,second);
  const w=memory.bot.e5SettledConsumerEnergy.rooms.E1N1.window;
  assert.equal(w.firstConfirmedWaitingDeliveries,0);
  assert.equal(w.waitingEpisodesStoppedWithoutObservedReceipt,1);
}
{
  const duplicate={room,creeps:[hauler,worker,{...worker}]};
  assert.equal(observer.capturePreIntentWaiting([duplicate],{time:3000}),
    null,'Duplicate consumer identities are not an observed waiting census');
  const wrongCensus={tick:3000,rooms:{E1N1:{
    consumerIds:['fabricated'],waitingConsumerIds:['fabricated']
  }}};
  const memory={};
  assert.deepEqual(observer.observe([state],{time:3000},memory,
    wrongCensus),[]);
  assert.equal(observer.snapshot('E1N1',memory),null,
    'Mismatch between before/after identity must invalidate measurement');
}
const runtime=fs.readFileSync(path.join(dir,'../game/main.js'),'utf8');
const snapshotIndex=runtime.indexOf(
  'settledDeliveryEvidence.capturePreIntentWaiting(roomStates, Game)');
const actionsIndex=runtime.indexOf('creepManager.runAll(onHaulerRoleCpu)');
const observationIndex=runtime.indexOf('settledDeliveryEvidence.observe(');
assert.ok(snapshotIndex>=0 && actionsIndex>snapshotIndex &&
  observationIndex>actionsIndex,
  'Pre-intent witness must be captured before active hauler work');
const source=fs.readFileSync(path.join(dir,
  '../game/logistics.settled.delivery.evidence.js'),'utf8');
for(const forbidden of [
  /.transfers*(/,/.withdraws*(/,/.moveTos*(/,
  /.spawnCreeps*(/,/.getUseds*(/,/Memorys*./
]) assert.equal(forbidden.test(source),false,
  'Pre-intent witness is passive and does not alter active gameplay');
console.log('E5 pre-intent waiting snapshot vs accepted transfer intent and next-tick confirmed event PASS');

