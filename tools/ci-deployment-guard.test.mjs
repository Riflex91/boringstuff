import assert from 'node:assert/strict';
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
assert.equal(parseBotMemory({ data: 'garbage' }), null);
const ok = inspectDeployment(state, id, 100);
assert.equal(ok.status, 'PASS');
assert.equal(ok.observedTicks, 100);
assert.equal(ok.snapshotTick, 1100);
assert.equal(ok.roles.hauler, 2);
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
console.log('CI deployment guard and 100-tick provenance checks passed');
