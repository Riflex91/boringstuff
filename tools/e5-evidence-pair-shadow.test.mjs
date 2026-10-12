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
const pair=require('../game/logistics.evidence.pair.shadow.js');
const cpuEvidence=require('../game/logistics.hauler.cpu.evidence.js');
const settledEvidence=require('../game/logistics.settled.delivery.evidence.js');

function cpuWindow(){
  const w=cpuEvidence._test.newWindow(1000);
  w.ticks=100;w.lastTick=1099;w.totalRoleCpu=250;
  w.totalHaulerTicks=200;w.activeHaulerTicks=100;
  return cpuEvidence._test.summarize(w,1099);
}
function deliveryWindow(){
  const w=settledEvidence._test.newWindow(1000);
  w.ticks=100;w.lastGameTick=1099;
  w.deliveryEvents=2;w.deliveredEnergy=50;w.ticksWithDelivery=2;
  w.waitingConsumerTicks=9;
  w.waitingConsumerTicksBeforeFirstReceipt=5;
  w.waitingEpisodeObservedStarts=2;
  w.firstConfirmedWaitingDeliveries=1;
  w.firstReceiptWithoutUniqueLoadedSticky=1;
  w.sampledWaitingTicksToFirstDeliveryTotal=4;
  w.maxSampledWaitingTicksToFirstDelivery=4;
  w.waitingEpisodesStoppedWithoutObservedReceipt=0;
  w.waitingEpisodesStoppedAfterObservedReceipt=1;
  w.waitingEpisodesLostVisibility=0;
  w.maxConcurrentUnservedWaitingConsumers=2;
  const result=settledEvidence._test.summarize(w,'E1N1');
  result.openWaitingEpisodesAtWindowEnd=1;
  result.openWaitingEpisodesWithoutConfirmedReceiptAtWindowEnd=1;
  return result;
}
const cpu=cpuWindow(),delivery=deliveryWindow();
assert.equal(delivery.waitingObservationPhase,'BEFORE_CREEP_INTENTS');
assert.equal(pair._test.validCpu(cpu),true);
assert.equal(pair._test.validDelivery(delivery,'E1N1'),true);
const original=JSON.stringify({cpu,delivery});
const report=pair.assess('E1N1',1099,cpu,delivery);
assert.equal(report.status,'ALIGNED_OBSERVATION');
assert.equal(report.authority,'SHADOW');
assert.equal(report.actionAuthority,'NONE');
assert.equal(report.topologySwitchAuthorized,false);
assert.deepEqual(report.alignedWindow,{
  gameStartTick:1000,gameEndTick:1099,observedTicks:100,
  settlementEventStartTick:999,settlementEventEndTick:1098
});
assert.deepEqual(report.measuredHaulerRoleCpu,{
  total:250,perGameTick:2.5,totalHaulerCreepTicks:200
});
assert.deepEqual(report.confirmedConsumerDeliveryLowerBound,{
  energy:50,events:2,energyPerGameTick:0.5
});
assert.deepEqual(report.observedWaiting,{
  consumerTicks:9,consumerTicksWithoutFirstReceipt:5,
  episodesStillOpen:1,firstConfirmedReceipts:1,
  consumerTicksWithLoadedSticky:0,
  firstReceiptsFromSameExclusiveLoadedSticky:0,
  firstReceiptsFromDifferentHaulerThanExclusiveSticky:0,
  firstReceiptsWithoutUniqueLoadedSticky:1
});
assert.equal(report.routeAttributableCpuPerTick,null);
assert.equal(report.fullRouteEnergyPerTick,null);
assert.equal(report.comparableCostPerEnergy,null);
assert.equal(report.economicWinner,null);
assert.equal(JSON.stringify({cpu,delivery}),original,
  'Paired evidence is immutable and does not modify existing snapshots');

// An aligned 100-tick sample with zero *observed consumer* transfers cannot
// justify a fabricated infinite cost-per-energy, route loss or lack of supply.
{
  const d=deliveryWindow();
  d.confirmedConsumerDeliveryEvents=0;
  d.confirmedConsumerEnergyLowerBound=0;
  d.confirmedConsumerEnergyPerTickLowerBound=0;
  d.ticksWithConfirmedConsumerDelivery=0;
  d.confirmedFirstDeliveryForPreviouslyWaitingConsumers=0;
  d.firstConfirmedReceiptWithoutUniqueLoadedSticky=0;
  const p=pair.assess('E1N1',1099,cpu,d);
  assert.equal(p.status,'ALIGNED_OBSERVATION');
  assert.equal(p.confirmedConsumerDeliveryLowerBound.energy,0);
  assert.equal(p.comparableCostPerEnergy,null);
  assert.equal(p.topologySwitchAuthorized,false);
}

// Any CPU window ending one tick earlier or later, despite containing 100
// measurements, is NOT causally comparable with this settlement window.
{
  const a={...cpu,startTick:999,endTick:1098};
  const p=pair.assess('E1N1',1099,a,delivery);
  assert.equal(p.status,'DEFERRED');
  assert.equal(p.reason,'STALE_E5_EVIDENCE_WINDOW');
}
{
  const a={...cpu,startTick:1001,endTick:1100};
  const p=pair.assess('E1N1',1099,a,delivery);
  assert.equal(p.reason,'STALE_E5_EVIDENCE_WINDOW');
}
{
  const a={...cpu,startTick:999};
  const p=pair.assess('E1N1',1099,a,delivery);
  assert.equal(p.reason,'INVALID_OR_UNSUPPORTED_E5_EVIDENCE');
}
for(const [reason,args] of [
  ['NO_MEASURED_HAULER_CPU_WINDOW',[null,delivery]],
  ['NO_SETTLED_CONSUMER_WINDOW',[cpu,null]],
  ['STALE_E5_EVIDENCE_WINDOW',[cpu,{...delivery,
    startGameTick:999,endGameTick:1098,startEventTick:998,endEventTick:1097}]]
]){
  const p=pair.assess('E1N1',1099,...args);
  assert.equal(p.status,'DEFERRED',reason);
  assert.equal(p.reason,reason);
  assert.equal(p.confirmedConsumerDeliveryLowerBound,null);
  assert.equal(p.comparableCostPerEnergy,null);
}
assert.equal(pair.assess('E1N1',NaN,cpu,delivery).reason,'INVALID_ROOM_OR_TICK');
assert.equal(pair.assess('',1099,cpu,delivery).status,'DEFERRED');

const badCpu=[
  ['wrong authority',x=>x.authority='ACTIVE'],
  ['unsupported version',x=>x.schemaVersion=99],
  ['fake counter',x=>x.observedTicks=99],
  ['noncontiguous duration',x=>x.startTick=998],
  ['negative CPU',x=>x.totalRoleCpu=-1],
  ['infinite CPU',x=>x.haulerRoleCpuPerTick=Infinity],
  ['impossible creep count',x=>x.totalHaulerCreepTicks=13000],
  ['unauthorized change',x=>x.topologySwitchAuthorized=true],
  ['wrong source',x=>x.source='ENGINE_ROUTE_CPU'],
  ['fake route CPU',x=>x.transportRouteCpuPerTick=4],
  ['wrong role CPU detail',x=>x.haulerRoleCpuPerCreepTick=null],
  ['invented mean CPU',x=>x.haulerRoleCpuPerTick=4],
  ['invented per creep CPU',x=>x.haulerRoleCpuPerCreepTick=4],
  ['zero active ticks with hauler workload',x=>x.ticksWithActiveHaulers=0]
];
for(const [name,change] of badCpu){
  const x=structuredClone(cpu);change(x);
  assert.equal(pair.assess('E1N1',1099,x,delivery).status,'DEFERRED',name);
}
const badDelivery=[
  ['wrong room',x=>x.room='E9N9'],
  ['wrong authority',x=>x.authority='ACTIVE'],
  ['wrong schema',x=>x.schemaVersion=2],
  ['wrong waiting phase',x=>x.waitingObservationPhase='AFTER_CREEP_INTENTS'],
  ['invalid event shift',x=>x.startEventTick=1000],
  ['malformed end event',x=>x.endEventTick=1099],
  ['fake duration',x=>x.observedTicks=99],
  ['negative events',x=>x.confirmedConsumerDeliveryEvents=-1],
  ['more receipts than events',x=>x.confirmedFirstDeliveryForPreviouslyWaitingConsumers=3],
  ['energy below count',x=>x.confirmedConsumerEnergyLowerBound=1],
  ['infinite lower bound',x=>x.confirmedConsumerEnergyPerTickLowerBound=Infinity],
  ['invented mean consumer energy',x=>x.confirmedConsumerEnergyPerTickLowerBound=99],
  ['events but no delivery ticks',x=>x.ticksWithConfirmedConsumerDelivery=0],
  ['invalid waiting sum',x=>x.observedWaitingConsumerTicksBeforeFirstReceipt=10],
  ['fake sticky coverage',x=>x.observedWaitingConsumerTicksWithLoadedSticky=10],
  ['inconsistent sticky receipt attribution',
    x=>x.firstConfirmedReceiptFromSameExclusiveLoadedSticky=2],
  ['invalid open episodes',x=>x.openWaitingEpisodesWithoutConfirmedReceiptAtWindowEnd=2],
  ['missing open episode field',x=>{delete x.openWaitingEpisodesAtWindowEnd;}],
  ['claimed service success',x=>x.waitingServiceSuccessRate=1],
  ['claimed route latency',x=>x.trueEndToEndTransportLatencyTicks=3],
  ['claimed actual complete energy',x=>x.fullTransportEnergyPerTick=500],
  ['claimed route attribution',x=>x.routeAttributableCpuPerTick=1],
  ['unauthorized switch',x=>x.topologySwitchAuthorized=true]
];
for(const [name,change] of badDelivery){
  const x=structuredClone(delivery);change(x);
  const p=pair.assess('E1N1',1099,cpu,x);
  assert.equal(p.status,'DEFERRED',name);
  assert.equal(p.comparableCostPerEnergy,null);
}
assert.equal(pair.assess('E9N9',1099,cpu,delivery).status,'DEFERRED',
  'Never align evidence originating in another room');

const moduleSource=fs.readFileSync(path.join(dir,
  '../game/logistics.evidence.pair.shadow.js'),'utf8');
for(const forbidden of [
  /\.transfer\s*\(/,/\.withdraw\s*\(/,/\.moveTo\s*\(/,
  /\.spawnCreep\s*\(/,/\.getEventLog\s*\(/,/\.getUsed\s*\(/,
  /Memory\s*\./,/\.createConstructionSite\s*\(/
]){
  assert.equal(forbidden.test(moduleSource),false,
    'E5 pairer must be read-only and reuse preexisting windows');
}
const main=fs.readFileSync(path.join(dir,'../game/main.js'),'utf8');
assert.ok(main.includes("require('logistics.evidence.pair.shadow')"));
assert.ok(main.includes('logisticsHaulerCpuEvidence.snapshot(result.room, Memory)'));
assert.ok(main.includes('E5_PAIRED_EVIDENCE_STATUS'));
console.log('E5 aligned independent CPU + settled consumer energy windows, no invented route cost PASS');
