import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.RESOURCE_ENERGY = 'energy';
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_NO_PATH = -2;
global.CARRY = 'carry';
global.MOVE = 'move';
global.BODYPART_COST = { carry: 50, move: 50 };
global.CREEP_SPAWN_TIME = 3;

const observer = require('../game/consumer.supply.observer.js');
const config = require('../game/config.js');
const room = { name: 'E8N1' };
function creep(id, role, carried, capacity, memory = {}) {
  return { id, name: id, room, spawning: false,
    memory: { role, ...memory },
    store: { energy: carried, getCapacity(resource) {
      assert.equal(resource, RESOURCE_ENERGY);
      return capacity;
    } }
  };
}
const loaded = creep('loaded', 'hauler', 300, 300, { delivering: true });
const collecting = creep('collecting', 'hauler', 25, 300, { delivering: false });
const fallback = creep('fallback', 'upgrader', 0, 100,
  { logisticsFallback: true, waitingEnergyTicks: 0 });
const waiting = creep('waiting', 'worker', 0, 100,
  { logisticsFallback: false, waitingEnergyTicks: 3 });
const g = global.Game = { time: 1000, cpu: { bucket: 8000, limit: 30,
  getUsed() { return 10; } }, creeps: { loaded, collecting, fallback, waiting } };
const eventRows = [];
const logger = { info(code, msg, ctx, opts) { eventRows.push({ code, msg, ctx, opts }); } };
const state = { room };
const before = JSON.stringify(g.creeps);

assert.equal(observer._test.sampled(g), true);
assert.equal(observer._test.eligible(g), true);
assert.deepEqual(observer._test.haulerReadiness(loaded),
  { carried: 300, capacity: 300, ready: true });
assert.equal(observer._test.haulerReadiness(collecting).ready, false);
assert.equal(observer._test.haulerReadiness(
  creep('unknown-delivering', 'hauler', 10, undefined, { delivering: true })).ready,
  true, 'legacy guard accepts delivering hauler even when capacity is unknown');
assert.equal(observer._test.haulerReadiness(
  creep('unknown-loaded', 'hauler', 99, undefined)).ready,
  true, 'legacy guard applies the 50-unit floor when capacity is unknown');
assert.equal(observer._test.haulerReadiness(
  creep('unknown-low', 'hauler', 20, undefined)).ready, false);
assert.equal(observer._test.haulerReadiness(
  { ...collecting, store: { energy: 99 } }).ready, false,
  'missing capacity reader must remain ineligible as in legacy guard');
observer.recordGuard(loaded, true);
observer.recordGuard(loaded, true);
observer.recordGuard(collecting, false);
observer.recordRescue(collecting, true);
observer.recordRescue(collecting, true);
observer.recordRescue(loaded, false);
observer.recordResult(loaded, 'consumer', OK);
observer.recordResult(loaded, 'consumer', ERR_NOT_IN_RANGE);
observer.recordConsumerTravel(loaded, waiting, OK);
observer.recordResult(loaded, 'consumer', -8);
observer.recordResult(loaded, 'infrastructure', OK);
observer.recordResult(collecting, 'haulerAcquisition', ERR_NOT_IN_RANGE);
const locatedCollecting = { ...collecting, pos: { getRangeTo() { return 9; } } };
observer.recordAcquisitionTravel(locatedCollecting, { id:'source' }, OK);
observer.recordAcquisitionTravel(locatedCollecting, { id:'source' }, ERR_NO_PATH);

assert.equal(observer.flush([state], logger, g), 1);
assert.equal(eventRows.length, 1);
const evt = eventRows[0];
assert.equal(evt.code, 'CONSUMER_SUPPLY_DIAG');
assert.equal(evt.ctx.room, 'E8N1');
assert.equal(evt.ctx.phase, 'AFTER_CREEP_INTENTS_BEFORE_RESOLUTION');
assert.deepEqual(evt.ctx.roomEnergy,{
  observed:false,available:null,capacity:null,full:null
},'unknown room-manager capacity is not full or depleted room energy');
assert.deepEqual(observer._test.snapshotRoomEnergy({
  energyAvailable:550,energyCapacityAvailable:550
}),{observed:true,available:550,capacity:550,full:true});
assert.deepEqual(observer._test.snapshotRoomEnergy({
  energyAvailable:451,energyCapacityAvailable:550
}),{observed:true,available:451,capacity:550,full:false});
for(const state of [
  {energyAvailable:-1,energyCapacityAvailable:550},
  {energyAvailable:551,energyCapacityAvailable:550},
  {energyAvailable:550,energyCapacityAvailable:0},
  {energyAvailable:12.5,energyCapacityAvailable:550},
  {energyAvailable:null,energyCapacityAvailable:550},
  {energyAvailable:550,energyCapacityAvailable:undefined}
]) {
  assert.deepEqual(observer._test.snapshotRoomEnergy(state),
    {observed:false,available:null,capacity:null,full:null},
    'invalid infrastructure state cannot be interpreted as available power');
}
assert.equal(evt.ctx.sampledCreepCount, 4);
assert.deepEqual(evt.ctx.haulers, {
  live: 2, energyPositive: 2, deliveringFlag: 1,
  readyByGuardRule: 1, zeroEnergy: 0, totalCarriedEnergy: 325,
  capacityUnknown: 0, collectingEmpty: 0, collectingPartialBelowThreshold: 1,
  knownTtl: 0, unknownTtl: 2, withinSpawnHorizon: 0,
  minimumKnownTtl: null, spawnHorizonTicks: null,
  prespawnPolicyEligible: null, prespawnPolicyBlockers: null,
  eligibleExpiringHaulers: null
});
assert.deepEqual(evt.ctx.consumers,
  { live: 2, waiting: 1, fallback: 1, critical: 2, empty: 2 });
assert.deepEqual(evt.ctx.decisions,
  { guardChecks: 3, guardSelected: 2, uniqueGuardHaulers: 1,
    rescueChecks: 3, rescueSelected: 2, uniqueRescueHaulers: 1 });
assert.deepEqual(evt.ctx.consumerTransfers,
  { attempted: 3, accepted: 1, notInRange: 1, other: 1 });
assert.deepEqual(evt.ctx.consumerTravel,{
  moveAttempts:1, rangeAtMost5:0, range6to10:0, rangeOver10:0,
  rangeUnknown:1, moveAccepted:1, moveNoPath:0, moveInvalidTarget:0,
  moveTemporarilyBlocked:0, moveOther:0
},'missing position data is an explicitly unknown range, not zero distance');
assert.deepEqual(evt.ctx.infrastructureTransfers,
  { attempted: 1, accepted: 1, notInRange: 0, other: 0 });
assert.deepEqual(evt.ctx.haulerAcquisitions,
  { attempted: 1, accepted: 0, notInRange: 1, other: 0 });
assert.deepEqual(evt.ctx.acquisitionTravel, {
  moveAttempts: 2, rangeAtMost5: 0, range6to10: 2,
  rangeOver10: 0, rangeUnknown: 0, moveAccepted: 1,
  moveNoPath: 1, moveInvalidTarget: 0,
  moveTemporarilyBlocked: 0, moveOther: 0
}, 'acquisition movement returns are not successful energy receipts');
assert.equal(evt.ctx.acceptedIsIntentNotSettled, true);
assert.deepEqual(evt.ctx.reservationCoverage, {
  criticalWithSticky: 0, criticalWithReadySticky: 0,
  criticalWithoutSticky: 2, criticalWithoutReadySticky: 2,
  criticalWithDuplicateSticky: 0, stickyAssignments: 0,
  stickyToNoncritical: 0, stickyWithoutEnergy: 0,
  readyHaulersWithoutSticky: 1, acceptedDeliveryProof: false
});
// Two haulers holding the same critical consumer ID do not represent two
// independently served consumers. A non-ready sticky reservation is visible,
// but must not be mistaken for an energy-ready guard.
{
  const h1 = creep('h1','hauler',300,300,
    { delivering:true,consumerTargetId:'fallback' });
  const h2 = creep('h2','hauler',25,300,
    { delivering:false,consumerTargetId:'fallback' });
  const idle = creep('h3','hauler',0,300,
    { delivering:false,consumerTargetId:'unknown-consumer' });
  const beforeCoverage = JSON.stringify({h1,h2,idle,fallback,waiting});
  const sample = observer._test.sampleRoomCreeps({
    creeps:{h1,h2,idle,fallback,waiting}
  }, 'E8N1');
  assert.deepEqual(sample.reservationCoverage,{
    criticalWithSticky:1,criticalWithReadySticky:1,
    criticalWithoutSticky:1,criticalWithoutReadySticky:1,
    criticalWithDuplicateSticky:1,stickyAssignments:3,
    stickyToNoncritical:1,stickyWithoutEnergy:1,
    readyHaulersWithoutSticky:0,acceptedDeliveryProof:false
  });
  assert.equal(JSON.stringify({h1,h2,idle,fallback,waiting}),beforeCoverage,
    'Optional consumer reservation diagnostics cannot mutate Game creeps');
  const ambiguous = { ...fallback, id: '', name: '' };
  assert.equal(observer._test.sampleRoomCreeps({
    creeps:{h1,ambiguous}
  }, 'E8N1').reservationCoverage,null,
    'Unidentifiable critical consumer must not create fabricated coverage');
}
assert.equal(evt.opts.journal, true);
assert.equal(evt.opts.persist, undefined);
assert.equal(JSON.stringify(g.creeps), before,
  'observer must never mutate creep stores or memory');

g.time = 1001;
observer.recordGuard(loaded, true);
assert.equal(observer.flush([state], logger, g), 0,
  'off-cadence does not emit');
observer.recordRescue(collecting,true);
assert.equal(eventRows.length,1,
  'off-cadence rescue selection must not create a diagnostic event');
assert.equal(eventRows.length, 1);

g.time = 1025;
g.cpu.bucket = config.CPU_BUCKET_LOW - 1;
observer.recordGuard(loaded, true);
assert.equal(observer.flush([state], logger, g), 0,
  'skip optional telemetry under bucket pressure');
g.cpu.bucket = 8000;
g.cpu.getUsed = () => 29.9;
assert.equal(observer.flush([state], logger, g), 0,
  'skip optional telemetry under CPU headroom pressure');
g.cpu.getUsed = () => 10;
assert.equal(observer.flush([state], logger, g), 1);
assert.equal(eventRows[1].ctx.decisions.guardChecks, 1);
assert.equal(eventRows[1].ctx.decisions.guardSelected, 1);
assert.equal(eventRows[1].ctx.acquisitionTravel.moveAttempts, 0,
  'acquisition travel counters must reset between sampling ticks');
assert.equal(eventRows[1].ctx.consumerTransfers.attempted, 0,
  'previous tick action counters must not leak');

g.time = 1050;
const unknownCapacity = creep('unknown', 'hauler', 99, 0);
unknownCapacity.store.getCapacity = () => undefined;
g.creeps = { unknownCapacity };
assert.equal(observer.flush([state], logger, g), 1);
assert.equal(eventRows[2].ctx.haulers.capacityUnknown, 1);
assert.equal(eventRows[2].ctx.haulers.collectingPartialBelowThreshold, 0);
assert.equal(eventRows[2].ctx.haulers.readyByGuardRule, 1,
  'unknown capacity is distinct from actual legacy guard readiness');
g.time = 1075;
g.creeps = Object.fromEntries(Array.from({ length: 121 }, (_, i) =>
  ['c' + i, creep('c' + i, 'hauler', 0, 100)]));
assert.equal(observer.flush([state], logger, g), 0,
  'oversized creep enumeration must skip, not report partial counts');

// Strict multi-room sampling bound: do not report an arbitrary partial
// three-room census if runtime ever grows to four owned rooms.
g.time = 1100;
g.creeps = { loaded };
const fourRooms = ['E8N1', 'E8N2', 'E9N1', 'E9N2']
  .map(name => ({ room: { name } }));
const priorCount = eventRows.length;
assert.equal(observer.flush(fourRooms, logger, g), 0);
assert.equal(eventRows.length, priorCount,
  'more than three owned rooms must skip optional telemetry altogether');
assert.equal(observer.flush(fourRooms.slice(0, 3), logger, g), 3,
  'three rooms remain inside supported optional sample bound');
assert.equal(eventRows.length, priorCount + 3);

// Cross-check the actual legacy selector instead of relying on a duplicated
// interpretation of its capacity rule.
const legacyEnergy = require('../game/energy.js');
for (const candidate of [loaded, collecting,
  creep('parity-unknown-loaded', 'hauler', 99, undefined),
  creep('parity-unknown-low', 'hauler', 20, undefined),
  creep('parity-delivering', 'hauler', 10, undefined, { delivering: true }),
  { ...collecting, store: { energy: 99 } }]) {
  assert.equal(observer._test.haulerReadiness(candidate).ready,
    legacyEnergy._test.haulerReadyToDeliver(candidate),
    'observation readiness must equal unchanged production guard');
}

// Boundary matrix: telemetry must never diverge from the production selector
// around the 50-energy floor, half-capacity threshold, and delivering override.
for (const capacity of [undefined, 0, 50, 100, 101, 300]) {
  for (const carried of [0, 1, 24, 49, 50, 51, 99, 100, 150]) {
    for (const delivering of [false, true]) {
      const candidate = creep('boundary', 'hauler', carried, capacity,
        { delivering });
      assert.equal(observer._test.haulerReadiness(candidate).ready,
        legacyEnergy._test.haulerReadyToDeliver(candidate),
        `readiness mismatch capacity=${capacity} carried=${carried} delivering=${delivering}`);
    }
  }
}

// Exercise the real logger -> slim() -> durable journal serialization path.
// Diagnostic counts must remain actual numbers, without identifiers.
g.time = 1125;
g.creeps = { loaded, collecting, fallback, waiting };
global.Memory = { bot: { version: config.VERSION, sessionId: 'synthetic-test' } };
const actualLogger = require('../game/logger.js');
const telemetryJournal = require('../game/telemetry.journal.js');
const originalLog = console.log;
const consoleLines = [];
try {
  console.log = line => { consoleLines.push(line); };
  observer.recordResult(loaded, 'consumer', OK);
  assert.equal(observer.flush([state], actualLogger, g), 1);
} finally {
  console.log = originalLog;
}
assert.equal(consoleLines.length, 1);
const parsed = JSON.parse(consoleLines[0].replace(/^\[BOTLOG\]/, ''));
assert.equal(parsed.code, 'CONSUMER_SUPPLY_DIAG');
assert.equal(parsed.ctx.consumerTransfers.accepted, 1);
assert.equal(parsed.ctx.haulers.readyByGuardRule, 1);
assert.equal(parsed.ctx.haulers.collectingPartialBelowThreshold, 1);
assert.equal(parsed.ctx.acceptedIsIntentNotSettled, true);
assert.equal(parsed.jseq, 1);
assert.equal(parsed.ctx.consumers.fallback, 1);
assert.equal(JSON.stringify(parsed.ctx).includes('loaded'), false,
  'no hauler identity may leave the logger/journal as an aggregate diagnostic');
const stored = telemetryJournal.recent(1)[0];
assert.equal(stored.c, 'CONSUMER_SUPPLY_DIAG');
assert.equal(stored.x.consumerTransfers.accepted, 1);
assert.equal(stored.x.haulers.readyByGuardRule, 1);
assert.equal(stored.x.haulers.collectingPartialBelowThreshold, 1);

// Compare lifetime observation against the production hauler body size at
// RCL2 550-energy capacity. No identifiers leave aggregate diagnostics.
{
  const liveRoom = { name: 'E8N1', energyCapacityAvailable: 550 };
  const expiring = creep('expiring-hauler','hauler',150,300,{delivering:true});
  const healthy = creep('healthy-hauler','hauler',150,300,{delivering:true});
  const noTtl = creep('unknown-ttl-hauler','hauler',0,300);
  for (const h of [expiring,healthy,noTtl]) h.room = liveRoom;
  expiring.ticksToLive=30;
  healthy.ticksToLive=31;
  assert.equal(observer._test.haulerReplacementHorizon(expiring),30);
  const sample=observer._test.sampleRoomCreeps({
    creeps: {expiring,healthy,noTtl}
  },'E8N1');
  assert.equal(sample.haulers.knownTtl,2);
  assert.equal(sample.haulers.unknownTtl,1);
  assert.equal(sample.haulers.withinSpawnHorizon,1);
  assert.equal(sample.haulers.minimumKnownTtl,30);
  assert.equal(sample.haulers.spawnHorizonTicks,30);
  assert.equal(sample.haulers.prespawnPolicyEligible,null);
  assert.equal(sample.haulers.prespawnPolicyBlockers,null);
  assert.equal(sample.haulers.eligibleExpiringHaulers,null);
  const spawnManager = require('../game/spawn.manager.js');
  const eligibleState={room:liveRoom,rcl:2,emergency:false,
    energyAvailable:550,energyCapacityAvailable:550,
    sources:[{id:'a'},{id:'b'}],
    economyModel:{sourceContainersReady:2,recommendedHaulerCount:2}};
  const eligible=observer._test.sampleRoomCreeps({
    creeps:{expiring,healthy,noTtl}
  },'E8N1',eligibleState);
  assert.equal(eligible.haulers.prespawnPolicyEligible,true);
  assert.deepEqual(eligible.haulers.prespawnPolicyBlockers,[]);
  assert.equal(eligible.haulers.eligibleExpiringHaulers,1);
  assert.equal(spawnManager._test.productivePrespawnHorizon(
    'hauler',eligibleState),30,
    'observed policy must match the production hauler prespawn horizon');
  const disabledStates=[
    {...eligibleState,economyModel:{...eligibleState.economyModel,
      sourceContainersReady:1}},
    {...eligibleState,economyModel:{...eligibleState.economyModel,
      recommendedHaulerCount:1}},
    {...eligibleState,rcl:1},
    {...eligibleState,emergency:true}
  ];
  for(const disabledState of disabledStates) {
    assert.equal(observer._test.haulerPrespawnPolicyEligible(disabledState),false);
    assert.equal(spawnManager._test.productivePrespawnHorizon(
      'hauler',disabledState),0,
      'observer and productive prespawn must agree about disabled states');
    const blocked=observer._test.sampleRoomCreeps({
      creeps:{expiring,healthy,noTtl}
    },'E8N1',disabledState);
    assert.equal(blocked.haulers.withinSpawnHorizon,1,
      'physical TTL horizon is still observable');
    assert.equal(blocked.haulers.prespawnPolicyBlockers.length,1);
    assert.equal(blocked.haulers.eligibleExpiringHaulers,0,
      'disabled policy cannot report a replaceable expiring hauler');
  }
  assert.equal(observer._test.haulerPrespawnPolicyEligible({
    ...eligibleState,economyModel:null}),null,
    'unknown economy model is not equivalent to policy ineligibility');
  assert.deepEqual(observer._test.haulerPrespawnPolicyBlockers({
    ...eligibleState, rcl:1, emergency:true, sources:[],
    economyModel:{sourceContainersReady:1,recommendedHaulerCount:1}
  }), [
    'RCL_BELOW_2','COLONY_EMERGENCY','NO_SOURCES',
    'SOURCE_CONTAINER_COVERAGE_MISMATCH',
    'MODELED_HAULER_DEMAND_BELOW_TWO'
  ], 'expose all simultaneously observed reasons, not a guessed root cause');
  assert.deepEqual(disabledStates.map(state =>
    observer._test.haulerPrespawnPolicyBlockers(state)),[
    ['SOURCE_CONTAINER_COVERAGE_MISMATCH'],
    ['MODELED_HAULER_DEMAND_BELOW_TWO'],
    ['RCL_BELOW_2'],
    ['COLONY_EMERGENCY']
  ]);
  liveRoom.energyCapacityAvailable=undefined;
  assert.equal(observer._test.haulerReplacementHorizon(expiring),null);
  const missing=observer._test.sampleRoomCreeps({
    creeps: {expiring,healthy,noTtl}
  },'E8N1');
  assert.equal(missing.haulers.spawnHorizonTicks,null);
  assert.equal(missing.haulers.withinSpawnHorizon,0,
    'missing room capacity cannot fabricate a prespawn risk count');
}
console.log('post-creep observer: read-only guard and intent diagnostics PASS');

// Consumer transfer movement histogram has no pathfinder calls, stable
// room-bound aggregate counts, and classifies terminal/temporary move results.
{
  global.ERR_NO_PATH = -2;
  global.ERR_INVALID_TARGET = -7;
  global.ERR_BUSY = -4;
  global.ERR_TIRED = -11;
  g.time = 2025;
  const target={id:'consumer-target'};
  const moves=[
    [2,OK,'rangeAtMost5'],
    [7,ERR_NO_PATH,'range6to10'],
    [15,ERR_INVALID_TARGET,'rangeOver10'],
    [4,ERR_BUSY,'rangeAtMost5'],
    [9,ERR_TIRED,'range6to10'],
    [null,-8,'rangeUnknown']
  ];
  const beforeMemory=JSON.stringify(loaded.memory);
  for(const [range,rc] of moves) {
    const carrier={...loaded,
      pos:range===null?{getRangeTo(){throw Error('bad read');}}:
        {getRangeTo(x){assert.equal(x,target);return range;}}};
    observer.recordConsumerTravel(carrier,target,rc);
  }
  const travel=observer._test.getRoomCounters(room.name).consumerTravel;
  assert.deepEqual(travel,{
    moveAttempts:6, rangeAtMost5:2,range6to10:2,rangeOver10:1,
    rangeUnknown:1,moveAccepted:1,moveNoPath:1,
    moveInvalidTarget:1,moveTemporarilyBlocked:2,moveOther:1
  });
  assert.equal(JSON.stringify(loaded.memory),beforeMemory,
    'distance/move observations cannot mutate the carrier');
  g.time=2026;
  observer.recordConsumerTravel(loaded,target,OK);
  assert.equal(observer._test.getRoomCounters(room.name),null,
    'only actual 25-tick samples accumulate travel evidence');
}
// Distinguish an empty collector from a positive but below-threshold collector.
{
  const empty = creep('empty-collector','hauler',0,300,{delivering:false});
  const partial = creep('partial-collector','hauler',75,300,{delivering:false});
  const ready = creep('ready-collector','hauler',150,300,{delivering:false});
  const sample = observer._test.sampleRoomCreeps({creeps:{empty,partial,ready}},'E8N1');
  assert.equal(sample.haulers.collectingEmpty,1);
  assert.equal(sample.haulers.collectingPartialBelowThreshold,1);
  assert.equal(sample.haulers.readyByGuardRule,1);
  assert.equal(sample.haulers.zeroEnergy,1);
}
