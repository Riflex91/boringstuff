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
