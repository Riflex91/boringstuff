import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { parseBotMemory, inspectDeployment } from './ci-deployment-guard.mjs';

const id = '20261010-verified';
const record = (c, t, x = {}, l = 'INFO') => ({ c, t, x, l });
const state = {
  deploymentId: id, deploymentTick: 1000,
  telemetryJournal: {
    events: [record('DEPLOYMENT_MARKER', 1000, { deploymentId: id })],
    snapshots: [record('STATUS_SNAPSHOT', 1100, {
      cpu: 12, bucket: 9000,
      rooms: { E8N1: {
        rcl: 3, creeps: { harvester: 2, worker: 1, hauler: 2 },
        constructionSites: 4, energyAvailable: 800, energyCapacity: 800,
        consumerSupply: { criticalConsumers: [] }
      } }
    })]
  }
};
assert.deepEqual(parseBotMemory({ data: JSON.stringify(state) }), state);
assert.deepEqual(parseBotMemory({ data: { data: JSON.stringify(state) } }), state);
const compressed = 'gz:' + gzipSync(Buffer.from(JSON.stringify(state))).toString('base64');
assert.deepEqual(parseBotMemory({ ok: 1, data: compressed }), state);
assert.deepEqual(parseBotMemory({ data: { data: compressed } }), state);
assert.deepEqual(parseBotMemory({ data: JSON.stringify({ data: compressed }) }), state);
assert.equal(parseBotMemory({ data: 'gz:not-gzip' }), null);
assert.equal(parseBotMemory({ data: 'gz:' }), null);
assert.equal(parseBotMemory({ data: 'garbage' }), null);
assert.equal(parseBotMemory({ data: null }), null);
assert.equal(parseBotMemory({ data: 'gz:' + gzipSync(Buffer.alloc(4_500_000)).toString('base64') }), null);
const ok = inspectDeployment(state, id, 100);
assert.equal(ok.status, 'PASS');
assert.equal(ok.observedTicks, 100);
assert.equal(ok.snapshotTick, 1100);
assert.equal(ok.roles.hauler, 2);
assert.equal(ok.checkedCpuSnapshots, 1);
assert.equal(ok.minimumSnapshotBucket, 9000);
assert.equal(ok.maximumSnapshotCpu, 12);
assert.deepEqual(ok.roomEvidence, {
  sampledRoomSnapshots: 1, sampledEnergySnapshots: 1,
  minimumEnergyAvailable: 800, maximumEnergyAvailable: 800,
  sampledCriticalConsumerSnapshots: 1, snapshotsWithCriticalConsumers: 0,
  maximumObservedCriticalConsumers: 0, criticalConsumerCountMayBeCapped: false,
  sampledConsumerDetailSnapshots: 1, invalidConsumerDetailSnapshots: 0,
  snapshotsWithWaitingConsumers: 0, snapshotsWithFallbackConsumers: 0,
  maximumObservedWaitingConsumers: 0, maximumObservedFallbackConsumers: 0,
  sampledReservationSnapshots: 0, invalidReservationSnapshots: 0,
  maximumObservedReservedHaulers: null, snapshotsWithDuplicateReservations: 0,
  maximumObservedDuplicateReservations: null, snapshotsWithEmptyReservedHaulers: 0,
  reservationListMayBeCapped: false,
  sampledCriticalReservationLinkSnapshots: 0,
  invalidOrMissingCriticalReservationLinkSnapshots: 1,
  maximumObservedCriticalWithoutStickyReservation: null,
  maximumObservedCriticalWithStickyReservation: null,
  maximumObservedCriticalWithLoadedStickyReservation: null,
  snapshotsWithCriticalWithoutStickyReservation: 0,
  criticalReservationLinkMayBePartial: false,
  sampledCompleteEconomyWindows: 0, invalidPostDeployEconomyWindows: 0,
  observedCompleteEconomyTicks: 0, observedEconomyConsumerTicks: null,
  observedEconomyWaitingConsumerTicks: null,
  observedEconomyCriticalConsumerTicks: null,
  observedEconomyFallbackConsumerTicks: null
});
// Existing game snapshot fields provide passive reservation/fallback evidence,
// without additional game code, extra events or settled-transfer claims.
{
  const withReservations = structuredClone(state);
  const room = withReservations.telemetryJournal.snapshots[0].x.rooms.E8N1;
  room.consumerSupply.criticalConsumers = [
    { id: 'w1', waiting: 7, fallback: true },
    { id: 'w2', waiting: 2, fallback: false }
  ];
  room.consumerSupply.consumerReservations = [
    { hauler: 'h1', targetId: 'w1', carried: 150, delivering: true },
    { hauler: 'h2', targetId: 'w1', carried: 0, delivering: false },
    { hauler: 'h3', targetId: 'w2', carried: 75, delivering: false }
  ];
  const withMetrics = inspectDeployment(withReservations, id, 100);
  assert.equal(withMetrics.status, 'PASS');
  assert.equal(withMetrics.roomEvidence.sampledConsumerDetailSnapshots, 1);
  assert.equal(withMetrics.roomEvidence.snapshotsWithWaitingConsumers, 1);
  assert.equal(withMetrics.roomEvidence.snapshotsWithFallbackConsumers, 1);
  assert.equal(withMetrics.roomEvidence.maximumObservedWaitingConsumers, 2);
  assert.equal(withMetrics.roomEvidence.maximumObservedFallbackConsumers, 1);
  assert.equal(withMetrics.roomEvidence.sampledReservationSnapshots, 1);
  assert.equal(withMetrics.roomEvidence.maximumObservedReservedHaulers, 3);
  assert.equal(withMetrics.roomEvidence.snapshotsWithDuplicateReservations, 1);
  assert.equal(withMetrics.roomEvidence.maximumObservedDuplicateReservations, 1);
  assert.equal(withMetrics.roomEvidence.snapshotsWithEmptyReservedHaulers, 1);
  assert.equal(withMetrics.roomEvidence.sampledCriticalReservationLinkSnapshots, 1);
  assert.equal(withMetrics.roomEvidence.maximumObservedCriticalWithStickyReservation, 2);
  assert.equal(withMetrics.roomEvidence.maximumObservedCriticalWithLoadedStickyReservation, 2);
  assert.equal(withMetrics.roomEvidence.maximumObservedCriticalWithoutStickyReservation, 0);
  assert.equal(withMetrics.roomEvidence.snapshotsWithCriticalWithoutStickyReservation, 0);

  const lackingTarget = structuredClone(withReservations);
  lackingTarget.telemetryJournal.snapshots[0].x.rooms.E8N1.consumerSupply.consumerReservations
    .splice(2, 1);
  const uncovered = inspectDeployment(lackingTarget, id, 100).roomEvidence;
  assert.equal(uncovered.sampledCriticalReservationLinkSnapshots, 1);
  assert.equal(uncovered.maximumObservedCriticalWithoutStickyReservation, 1);
  assert.equal(uncovered.maximumObservedCriticalWithStickyReservation, 1);
  assert.equal(uncovered.maximumObservedCriticalWithLoadedStickyReservation, 1);
  assert.equal(uncovered.snapshotsWithCriticalWithoutStickyReservation, 1);

  const missingIdentity = structuredClone(lackingTarget);
  delete missingIdentity.telemetryJournal.snapshots[0].x.rooms.E8N1.consumerSupply
    .criticalConsumers[1].id;
  const unknownLink = inspectDeployment(missingIdentity, id, 100).roomEvidence;
  assert.equal(unknownLink.sampledCriticalReservationLinkSnapshots, 0);
  assert.equal(unknownLink.invalidOrMissingCriticalReservationLinkSnapshots, 1);
  assert.equal(unknownLink.maximumObservedCriticalWithoutStickyReservation, null);

  const duplicateIdentity = structuredClone(lackingTarget);
  duplicateIdentity.telemetryJournal.snapshots[0].x.rooms.E8N1.consumerSupply
    .criticalConsumers[1].id = 'w1';
  assert.equal(inspectDeployment(duplicateIdentity, id, 100)
    .roomEvidence.sampledCriticalReservationLinkSnapshots, 0);

  // No identities or IDs leak into the compact evidence object.
  assert.equal(JSON.stringify(withMetrics.roomEvidence).includes('w1'), false);

  const missing = structuredClone(withReservations);
  delete missing.telemetryJournal.snapshots[0].x.rooms.E8N1.consumerSupply.consumerReservations;
  delete missing.telemetryJournal.snapshots[0].x.rooms.E8N1.consumerSupply.criticalConsumers;
  const missingMetrics = inspectDeployment(missing, id, 100);
  assert.equal(missingMetrics.roomEvidence.sampledConsumerDetailSnapshots, 0);
  assert.equal(missingMetrics.roomEvidence.maximumObservedWaitingConsumers, null);
  assert.equal(missingMetrics.roomEvidence.sampledReservationSnapshots, 0);
  assert.equal(missingMetrics.roomEvidence.maximumObservedDuplicateReservations, null);

  const corrupt = structuredClone(withReservations);
  corrupt.telemetryJournal.snapshots[0].x.rooms.E8N1.consumerSupply.consumerReservations[1].carried = 'unknown';
  corrupt.telemetryJournal.snapshots[0].x.rooms.E8N1.consumerSupply.criticalConsumers[1].waiting = 'unknown';
  const badMetrics = inspectDeployment(corrupt, id, 100);
  assert.equal(badMetrics.roomEvidence.sampledReservationSnapshots, 0);
  assert.equal(badMetrics.roomEvidence.invalidReservationSnapshots, 1);
  assert.equal(badMetrics.roomEvidence.maximumObservedDuplicateReservations, null);
  assert.equal(badMetrics.roomEvidence.sampledConsumerDetailSnapshots, 0);
  assert.equal(badMetrics.roomEvidence.invalidConsumerDetailSnapshots, 1);

  const capped = structuredClone(withReservations);
  const snapshot = capped.telemetryJournal.snapshots[0].x.rooms.E8N1.consumerSupply;
  snapshot.consumerReservations = Array.from({ length: 8 }, (_, index) => ({
    targetId: 'target-' + index, carried: 5, delivering: false
  }));
  assert.equal(inspectDeployment(capped, id, 100).roomEvidence.reservationListMayBeCapped, true);
  assert.equal(inspectDeployment(capped, id, 100)
    .roomEvidence.criticalReservationLinkMayBePartial, true);

  // An empty critical-consumer list with a present empty reservation list is
  // a genuine zero, unlike a missing array or missing consumer identifier.
  const zero = structuredClone(withReservations);
  zero.telemetryJournal.snapshots[0].x.rooms.E8N1.consumerSupply.criticalConsumers = [];
  zero.telemetryJournal.snapshots[0].x.rooms.E8N1.consumerSupply.consumerReservations = [];
  const zeroLinks = inspectDeployment(zero, id, 100).roomEvidence;
  assert.equal(zeroLinks.sampledCriticalReservationLinkSnapshots, 1);
  assert.equal(zeroLinks.maximumObservedCriticalWithoutStickyReservation, 0);
}

// Full 100-tick economy windows give continuous consumer-creep-tick counts
// inside their window, unlike two 100-tick cadence snapshots. No overlap
// with a prior deployment, no duplicates, and malformed windows stay UNKNOWN.
{
  const withWindow = structuredClone(state);
  const room = withWindow.telemetryJournal.snapshots[0].x.rooms.E8N1;
  room.economy = { last100: {
    startTick: 1001, endTick: 1100, ticks: 100,
    productiveFlow: { consumerTicks: 300, waitingConsumerTicks: 40,
      criticalConsumerTicks: 50, fallbackConsumerTicks: 25 }
  } };
  const good = inspectDeployment(withWindow, id, 100).roomEvidence;
  assert.equal(good.sampledCompleteEconomyWindows, 1);
  assert.equal(good.observedCompleteEconomyTicks, 100);
  assert.equal(good.observedEconomyConsumerTicks, 300);
  assert.equal(good.observedEconomyWaitingConsumerTicks, 40);
  assert.equal(good.observedEconomyCriticalConsumerTicks, 50);
  assert.equal(good.observedEconomyFallbackConsumerTicks, 25);
  assert.equal(good.invalidPostDeployEconomyWindows, 0);

  const oldWindow = structuredClone(withWindow);
  oldWindow.telemetryJournal.snapshots[0].x.rooms.E8N1.economy.last100.startTick = 901;
  oldWindow.telemetryJournal.snapshots[0].x.rooms.E8N1.economy.last100.endTick = 1000;
  const old = inspectDeployment(oldWindow, id, 100).roomEvidence;
  assert.equal(old.sampledCompleteEconomyWindows, 0);
  assert.equal(old.observedEconomyFallbackConsumerTicks, null,
    'a window crossing the deployment boundary is not release evidence');

  const repeated = structuredClone(withWindow);
  const repeatedSample = structuredClone(repeated.telemetryJournal.snapshots[0]);
  repeatedSample.t = 1150;
  repeated.telemetryJournal.snapshots.push(repeatedSample);
  const oneWindow = inspectDeployment(repeated, id, 100).roomEvidence;
  assert.equal(oneWindow.sampledCompleteEconomyWindows, 1,
    'the same immutable window must never be added twice');
  assert.equal(oneWindow.observedEconomyFallbackConsumerTicks, 25);

  const conflicted = structuredClone(repeated);
  conflicted.telemetryJournal.snapshots[1].x.rooms.E8N1.economy
    .last100.productiveFlow.fallbackConsumerTicks = 20;
  const mismatch = inspectDeployment(conflicted, id, 100).roomEvidence;
  assert.equal(mismatch.sampledCompleteEconomyWindows, 0);
  assert.equal(mismatch.invalidPostDeployEconomyWindows, 1);
  assert.equal(mismatch.observedEconomyFallbackConsumerTicks, null);

  const invalidCounter = structuredClone(withWindow);
  invalidCounter.telemetryJournal.snapshots[0].x.rooms.E8N1.economy
    .last100.productiveFlow.fallbackConsumerTicks = '25';
  const corrupted = inspectDeployment(invalidCounter, id, 100).roomEvidence;
  assert.equal(corrupted.sampledCompleteEconomyWindows, 0);
  assert.equal(corrupted.invalidPostDeployEconomyWindows, 1);
  assert.equal(corrupted.observedEconomyFallbackConsumerTicks, null);

  const overcount = structuredClone(withWindow);
  overcount.telemetryJournal.snapshots[0].x.rooms.E8N1.economy
    .last100.productiveFlow.waitingConsumerTicks = 301;
  assert.equal(inspectDeployment(overcount, id, 100)
    .roomEvidence.sampledCompleteEconomyWindows, 0);

  const outsideCarrier = structuredClone(withWindow);
  outsideCarrier.telemetryJournal.snapshots[0].x.rooms.E8N1.economy
    .last100.endTick = 1099;
  assert.equal(inspectDeployment(outsideCarrier, id, 100)
    .roomEvidence.sampledCompleteEconomyWindows, 0);
}
// A low-energy intermediate snapshot with waiting consumers is reportable
// evidence even if the final post-window snapshot has recovered.
const pressured = structuredClone(state);
pressured.telemetryJournal.snapshots.unshift(record('STATUS_SNAPSHOT', 1050, {
  cpu: 11, bucket: 8500,
  rooms: { E8N1: { rcl: 3, creeps: { hauler: 2 },
    energyAvailable: 120, energyCapacity: 800,
    consumerSupply: { criticalConsumers: [{ role: 'worker' }, { role: 'upgrader' }] }
  } }
}));
const pressure = inspectDeployment(pressured, id, 100);
assert.equal(pressure.status, 'PASS');
assert.equal(pressure.roomEvidence.sampledRoomSnapshots, 2);
assert.equal(pressure.roomEvidence.sampledEnergySnapshots, 2);
assert.equal(pressure.roomEvidence.minimumEnergyAvailable, 120);
assert.equal(pressure.roomEvidence.maximumEnergyAvailable, 800);
assert.equal(pressure.roomEvidence.sampledCriticalConsumerSnapshots, 2);
assert.equal(pressure.roomEvidence.snapshotsWithCriticalConsumers, 1);
assert.equal(pressure.roomEvidence.maximumObservedCriticalConsumers, 2);
assert.equal(pressure.criticalConsumers, 0); // Final snapshot, not peak.
// Missing telemetry fields are UNKNOWN, never represented as zero.
const absent = structuredClone(state);
delete absent.telemetryJournal.snapshots[0].x.rooms.E8N1.consumerSupply;
delete absent.telemetryJournal.snapshots[0].x.rooms.E8N1.energyAvailable;
const unknown = inspectDeployment(absent, id, 100);
assert.equal(unknown.status, 'PASS');
assert.equal(unknown.criticalConsumers, null);
assert.equal(unknown.roomEvidence.sampledEnergySnapshots, 0);
assert.equal(unknown.roomEvidence.minimumEnergyAvailable, null);
assert.equal(unknown.roomEvidence.maximumEnergyAvailable, null);
assert.equal(unknown.roomEvidence.sampledCriticalConsumerSnapshots, 0);
assert.equal(unknown.roomEvidence.maximumObservedCriticalConsumers, null);
assert.equal(unknown.roomEvidence.snapshotsWithCriticalConsumers, 0); // zero sampled positives only
// Snapshot may list at most eight critical consumers: do not equate the
// list length with an uncapped population count.
const capped = structuredClone(state);
capped.telemetryJournal.snapshots[0].x.rooms.E8N1.consumerSupply.criticalConsumers =
  Array.from({length: 8}, () => ({ role: 'worker' }));
assert.equal(inspectDeployment(capped, id, 100).roomEvidence.criticalConsumerCountMayBeCapped, true);
// A healthy final bucket must not conceal a critical post-deploy snapshot.
const dipped = structuredClone(state);
dipped.telemetryJournal.snapshots.unshift(record('STATUS_SNAPSHOT', 1050, {
  cpu: 17, bucket: 800, rooms: { E8N1: { rcl: 3, creeps: {} } }
}));
const dip = inspectDeployment(dipped, id, 100);
assert.equal(dip.status, 'FAIL');
assert.equal(dip.reason, 'INTERMEDIATE_CPU_BUCKET_CRITICAL');
assert.deepEqual(dip.criticalSnapshotTicks, [1050]);
assert.equal(dip.minimumSnapshotBucket, 800);
// Intermediate healthy samples are reported, not incorrectly treated as pass
// for every unsampled game tick.
dipped.telemetryJournal.snapshots[0].x.bucket = 1200;
const healthy = inspectDeployment(dipped, id, 100);
assert.equal(healthy.status, 'PASS');
assert.equal(healthy.checkedCpuSnapshots, 2);
assert.equal(healthy.minimumSnapshotBucket, 1200);
assert.equal(healthy.maximumSnapshotCpu, 17);
// Samples from before the exact deployment boundary must not contaminate it.
dipped.telemetryJournal.snapshots.unshift(record('STATUS_SNAPSHOT', 990, {
  cpu: 999, bucket: 100, rooms: { E8N1: { rcl: 3, creeps: {} } }
}));
assert.equal(inspectDeployment(dipped, id, 100).status, 'PASS');
assert.equal(inspectDeployment(dipped, id, 100).checkedCpuSnapshots, 2);
assert.equal(inspectDeployment(state, 'old', 100).status, 'WAIT');
assert.equal(inspectDeployment(state, id, 101).status, 'WAIT');
assert.equal(inspectDeployment(null, id).status, 'WAIT');
const malformed = structuredClone(state);
malformed.telemetryJournal.events = [];
assert.equal(inspectDeployment(malformed, id).reason, 'MISSING_DEPLOYMENT_MARKER');
const fatal = structuredClone(state);
fatal.telemetryJournal.events.push(record('MAIN_FATAL', 1030, {}, 'FATAL'));
assert.equal(inspectDeployment(fatal, id).reason, 'RUNTIME_FATAL_OR_CRITICAL_CPU');
const cpu = structuredClone(state);
cpu.telemetryJournal.snapshots[0].x.bucket = 800;
assert.equal(inspectDeployment(cpu, id).reason, 'INVALID_CPU_OR_LOW_BUCKET');
const noRoom = structuredClone(state);
delete noRoom.telemetryJournal.snapshots[0].x.rooms.E8N1;
assert.equal(inspectDeployment(noRoom, id).reason, 'NO_ROOM_STATUS_AFTER_DEPLOYMENT');
const incomplete = structuredClone(state);
incomplete.telemetryJournal.snapshots[0].t = 1099;
assert.equal(inspectDeployment(incomplete, id, 100).status, 'WAIT');
// Newer journal records alone cannot validate the room snapshot for 100 ticks.
const staleSnapshot = structuredClone(incomplete);
staleSnapshot.telemetryJournal.events.push(record('HEARTBEAT', 1101));
const stale = inspectDeployment(staleSnapshot, id, 100);
assert.equal(stale.status, 'WAIT');
assert.equal(stale.reason, 'POST_WINDOW_STATUS_SNAPSHOT_PENDING');
assert.equal(stale.minimumSnapshotTick, 1100);
// A qualifying 100+ tick snapshot unlocks a pass even with earlier snapshots.
staleSnapshot.telemetryJournal.snapshots.push(structuredClone(state.telemetryJournal.snapshots[0]));
assert.equal(inspectDeployment(staleSnapshot, id, 100).status, 'PASS');
// Invalid room data in a qualifying snapshot still fails closed.
const badFresh = structuredClone(staleSnapshot);
delete badFresh.telemetryJournal.snapshots[1].x.rooms.E8N1;
assert.equal(inspectDeployment(badFresh, id, 100).reason, 'NO_ROOM_STATUS_AFTER_DEPLOYMENT');
console.log('CI deployment guard and 100-tick provenance checks passed');
