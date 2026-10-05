import assert from 'node:assert/strict';
import { formatWaitStatus, resolveAutoStart, waitForAutoStart } from './live-verification-wait.mjs';

const version = '0.3.0-shadow.7-node18';
const room = 'E8N1';

function versionChange(tick = 1000) {
  return { tick, v: version, code: 'VERSION_CHANGE', ctx: { from: '0.2.19-node18', to: version } };
}

function deploymentMarker(tick, deploymentId) {
  return {
    tick,
    v: version,
    code: 'DEPLOYMENT_MARKER',
    ctx: { version, deploymentId }
  };
}

function evidenceTick(tick) {
  return {
    tick,
    capturedAt: new Date(tick * 200).toISOString(),
    v: version,
    code: 'BOT_HEARTBEAT',
    ctx: { cpu: 1, bucket: 10000 }
  };
}

function snapshot(eventTick, startTick, endTick, attribution = true) {
  const productiveFlow = attribution ? {
    consumerTicks: 400,
    waitingConsumerTicks: 20,
    criticalConsumerTicks: 20,
    fallbackConsumerTicks: 0,
    averageConstructionCapacityPerTick: 15,
    averageDedicatedControllerCapacityPerTick: 3,
    actualProductiveThroughputPerTick: 14.8
  } : null;
  return {
    tick: eventTick,
    capturedAt: new Date(eventTick * 200).toISOString(),
    v: version,
    code: 'STATUS_SNAPSHOT',
    ctx: {
      rooms: {
        [room]: {
          economy: { last100: { startTick, endTick, ticks: 100, productiveFlow } }
        }
      }
    }
  };
}

{
  const status = resolveAutoStart([versionChange(1000), snapshot(1000, 901, 1000)], version, 'live', room);
  assert.equal(status.ready, false);
  assert.equal(status.expectedStartTick, 1001);
  assert.equal(status.expectedEndTick, 1100);
  assert.match(formatWaitStatus(status), /^Waiting for data\.\.\.\[\d{2} Min \d{2} Sec remaining\]$/);
}

{
  const first = [versionChange(1000), snapshot(1000, 901, 1000)];
  const second = [...first, snapshot(1100, 1001, 1100)];
  let reads = 0;
  let sleeps = 0;
  const messages = [];

  const result = await waitForAutoStart({
    mode: 'live',
    version,
    roomName: room,
    loadEvents() { return reads++ === 0 ? first : second; },
    sleep: async () => { sleeps++; },
    pollMs: 1,
    onWait(message) { messages.push(message); }
  });

  assert.equal(result.startTick, 1001);
  assert.equal(result.status.endTick, 1100);
  assert.equal(sleeps, 1);
  assert.equal(messages.length, 1);
}

{
  const rows = [
    versionChange(1000),
    snapshot(1000, 901, 1000),
    snapshot(1100, 1001, 1100, false)
  ];
  const status = resolveAutoStart(rows, version, 'live', room);
  assert.equal(status.ready, false);
  assert.equal(status.expectedStartTick, 1101);
  assert.equal(status.expectedEndTick, 1200);
}

{
  const status = resolveAutoStart([versionChange(1000)], version, 'smoke', room);
  assert.equal(status.ready, false);
  assert.equal(status.expectedStartTick, 1001);
  assert.equal(status.expectedEndTick, 1025);
}

{
  const status = resolveAutoStart(
    [versionChange(1000), evidenceTick(1025)],
    version,
    'smoke',
    room
  );
  assert.equal(status.ready, true);
  assert.equal(status.startTick, 1001);
  assert.equal(status.endTick, 1025);
}

{
  // Same-version redeploy: old complete windows must not be reused after the
  // new deployment marker.
  const rows = [
    versionChange(1000),
    snapshot(1100, 1001, 1100),
    deploymentMarker(1150, 'deploy-b'),
    snapshot(1200, 1101, 1200)
  ];
  const status = resolveAutoStart(rows, version, 'live', room);
  assert.equal(status.ready, false);
  assert.equal(status.deployTick, 1150);
  assert.equal(status.deploymentId, 'deploy-b');
  assert.equal(status.boundarySource, 'DEPLOYMENT_MARKER');
  assert.equal(status.expectedStartTick, 1201);
  assert.equal(status.expectedEndTick, 1300);
}

{
  // Once a full window begins after the same-version deployment marker, it is
  // selected normally.
  const rows = [
    versionChange(1000),
    snapshot(1100, 1001, 1100),
    deploymentMarker(1150, 'deploy-b'),
    snapshot(1300, 1201, 1300)
  ];
  const status = resolveAutoStart(rows, version, 'live', room);
  assert.equal(status.ready, true);
  assert.equal(status.startTick, 1201);
  assert.equal(status.endTick, 1300);
  assert.equal(status.deploymentId, 'deploy-b');
}

{
  const pending = resolveAutoStart(
    [versionChange(1000), deploymentMarker(1150, 'deploy-b')],
    version,
    'smoke',
    room
  );
  assert.equal(pending.ready, false);
  assert.equal(pending.expectedStartTick, 1150);
  assert.equal(pending.expectedEndTick, 1174);

  const status = resolveAutoStart(
    [versionChange(1000), deploymentMarker(1150, 'deploy-b'), evidenceTick(1174)],
    version,
    'smoke',
    room
  );
  assert.equal(status.ready, true);
  assert.equal(status.startTick, 1150);
  assert.equal(status.endTick, 1174);
  assert.equal(status.boundarySource, 'DEPLOYMENT_MARKER');
}



{
  let reads = 0;
  const first = [versionChange(1000), deploymentMarker(1150, 'deploy-c'), evidenceTick(1160)];
  const second = [...first, evidenceTick(1174)];
  const result = await waitForAutoStart({
    mode: 'smoke',
    version,
    roomName: room,
    loadEvents() { return reads++ === 0 ? first : second; },
    sleep: async () => {},
    pollMs: 1
  });
  assert.equal(result.startTick, 1150);
  assert.equal(result.status.endTick, 1174);
}



{
  // Deployment receipt handshake regression: if the local deploy says the
  // expected deployment is deploy-new but collector evidence still contains
  // only an older marker, auto-start must wait instead of reusing the old
  // already-complete smoke window.
  const rows = [
    versionChange(1000),
    deploymentMarker(1150, 'deploy-old'),
    evidenceTick(1174)
  ];
  const status = resolveAutoStart(rows, version, 'smoke', room, 'deploy-new');
  assert.equal(status.ready, false);
  assert.equal(status.waitingForDeploymentMarker, true);
  assert.equal(status.expectedDeploymentId, 'deploy-new');
  assert.match(formatWaitStatus(status), /deploy-new/);
}

{
  // Once the exact expected marker arrives, the smoke boundary is that marker,
  // even when an older same-version marker and complete smoke remain in logs.
  const rows = [
    versionChange(1000),
    deploymentMarker(1150, 'deploy-old'),
    evidenceTick(1174),
    deploymentMarker(1200, 'deploy-new'),
    evidenceTick(1224)
  ];
  const status = resolveAutoStart(rows, version, 'smoke', room, 'deploy-new');
  assert.equal(status.ready, true);
  assert.equal(status.startTick, 1200);
  assert.equal(status.endTick, 1224);
  assert.equal(status.deploymentId, 'deploy-new');
}


{
  // Once tick evidence reaches the predicted end but the matching STATUS_SNAPSHOT
  // has not arrived yet, report that state explicitly instead of appearing stuck
  // at 00:00.
  const rows = [
    versionChange(1000),
    snapshot(1000, 901, 1000),
    evidenceTick(1100)
  ];
  const status = resolveAutoStart(rows, version, 'live', room);
  assert.equal(status.ready, false);
  assert.equal(status.expectedStartTick, 1001);
  assert.equal(status.expectedEndTick, 1100);
  assert.equal(status.remainingSeconds, 0);
  assert.equal(status.waitingForSnapshot, true);
  assert.match(formatWaitStatus(status), /waiting for complete STATUS_SNAPSHOT/i);
  assert.match(formatWaitStatus(status), /latest evidence tick 1100/i);
}

console.log('live verification wait tests passed');
