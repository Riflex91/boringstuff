import assert from 'node:assert/strict';
import { analyzeSupplyEvidence } from './consumer-supply-analysis-core.mjs';

const version = '0.3.0-shadow.15-node24';
const receipt = { version, deploymentId: 'approved-future-release',
  server: 'newbieland', branch: 'chatgpt' };
const event = (tick, code, ctx, jseq) =>
  ({ tick, code, ctx, jseq, v: version, level: 'INFO' });
const marker = event(1000, 'DEPLOYMENT_MARKER',
  { deploymentId: receipt.deploymentId, version }, 1);
function diag(tick = 1025, jseq = 2) {
  return event(tick, 'CONSUMER_SUPPLY_DIAG', {
    room: 'E8N1', phase: 'AFTER_CREEP_INTENTS_BEFORE_RESOLUTION',
    sampledCreepCount: 5,
    haulers: { live: 2, energyPositive: 1, zeroEnergy: 1,
      deliveringFlag: 1, readyByGuardRule: 1, capacityUnknown: 0,
      totalCarriedEnergy: 140 },
    consumers: { live: 3, waiting: 2, fallback: 1, critical: 2, empty: 1 },
    decisions: { guardChecks: 2, guardSelected: 1, uniqueGuardHaulers: 1 },
    consumerTransfers: { attempted: 2, accepted: 1, notInRange: 1, other: 0 },
    infrastructureTransfers: { attempted: 1, accepted: 0, notInRange: 1, other: 0 },
    haulerAcquisitions: { attempted: 0, accepted: 0, notInRange: 0, other: 0 },
    acceptedIsIntentNotSettled: true
  }, jseq);
}
const heartbeat = event(1025, 'ROOM_HEARTBEAT', {
  room: 'E8N1', energy: '1050/1050',
  creeps: { hauler: 2 },
  economyModel: { consumerFallbackCount: 2, consumerWaitingCount: 3 }
}, 3);
const snapshot = event(1125, 'STATUS_SNAPSHOT', {
  rooms: { E8N1: { economy: { last100: {
    startTick: 1001, endTick: 1100, ticks: 100,
    productiveFlow: { fallbackConsumerTicks: 68, waitingConsumerTicks: 100,
      consumerTicks: 300 }
  } } } }
}, 4);
const input = [marker, diag(), heartbeat, snapshot];
const result = analyzeSupplyEvidence({ events: input, receipt });
assert.equal(result.state, 'OBSERVATIONS_AVAILABLE');
assert.equal(result.markerTick, 1000);
assert.equal(result.samples.length, 1);
assert.equal(result.samples[0].consumerTransfers.accepted, 1);
assert.equal(result.samples[0].acceptedIsIntentNotSettled, true);
assert.equal(result.samples[0].heartbeat.roomEnergy, 1050);
assert.equal(result.samples[0].heartbeat.fallbackConsumers, 2,
  'pre-handler fallback count must remain distinct from post-handler fallback');
assert.equal(result.samples[0].consumers.fallback, 1);
assert.deepEqual(result.windows.map(w => [w.startTick, w.endTick,
  w.fallbackConsumerTicks, w.diagnosticSampleTicks]), [[1001, 1100, 68, [1025]]]);
assert.equal(result.integrity.completeCadence, false,
  'one 25-tick sample cannot certify complete sampled coverage');

const duplicated = analyzeSupplyEvidence({ events: [
  ...input, { ...diag(), source: 'journal-replay', recovered: true }
], receipt });
assert.equal(duplicated.samples.length, 1, 'collector replay must not double count');
assert.equal(duplicated.windows.length, 1);

const conflicting = diag();
conflicting.ctx.consumerTransfers = { attempted: 2, accepted: 0,
  notInRange: 2, other: 0 };
assert.equal(analyzeSupplyEvidence({ events: [...input, conflicting], receipt }).state,
  'BLOCKED', 'same journal sequence must not carry contradictory payloads');
const duplicateTick = diag(1025, 9);
assert.equal(analyzeSupplyEvidence({ events: [...input, duplicateTick], receipt }).state,
  'REVIEW_REQUIRED', 'two different journal sequences at one room/tick are ambiguous');

const malformed = diag();
malformed.ctx.consumerTransfers.accepted = 2;
assert.equal(analyzeSupplyEvidence({ events: [marker, malformed], receipt }).state,
  'REVIEW_REQUIRED', 'return-code totals must reconcile');
const unjournaled = diag();
delete unjournaled.jseq;
assert.equal(analyzeSupplyEvidence({ events: [marker, unjournaled], receipt }).state,
  'REVIEW_REQUIRED', 'journaled diagnostics must carry sequence provenance');
const settledClaim = diag();
settledClaim.ctx.acceptedIsIntentNotSettled = false;
assert.equal(analyzeSupplyEvidence({ events: [marker, settledClaim], receipt }).state,
  'REVIEW_REQUIRED', 'settlement claims must never be accepted as observation schema');

assert.equal(analyzeSupplyEvidence({ events: [marker, heartbeat, snapshot], receipt }).state,
  'WAIT', 'no diagnostic event does not mean zero fallback');
assert.equal(analyzeSupplyEvidence({ events: [diag()], receipt }).reason,
  'MATCHING_DEPLOYMENT_MARKER_MISSING');
assert.equal(analyzeSupplyEvidence({ events: input,
  receipt: { ...receipt, deploymentId: 'another-deployment' } }).state, 'WAIT');
assert.equal(analyzeSupplyEvidence({ events: [
  ...input, event(1126, 'DEPLOYMENT_MARKER', { deploymentId: 'next', version }, 8)
], receipt }).state, 'BLOCKED', 'a later deployment invalidates previous receipt');
const retained = analyzeSupplyEvidence({ events: [...input,
  { tick: 1050, code: 'TELEMETRY_RETENTION_GAP', ctx: { droppedThroughSeq: 42 } }
], receipt });
assert.equal(retained.integrity.retentionGap, true);
const beforeReceipt = analyzeSupplyEvidence({ events: [
  diag(975, 7), marker, heartbeat
], receipt });
assert.equal(beforeReceipt.state, 'WAIT', 'pre-deployment diagnostics are not valid');
const mixedRoom = analyzeSupplyEvidence({ events: input, receipt, roomName: 'E8N2' });
assert.equal(mixedRoom.samples.length, 0);
assert.equal(mixedRoom.state, 'WAIT');

console.log('receipt-pinned consumer supply offline parser: PASS');
