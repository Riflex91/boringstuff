function finiteTick(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function latestDeploymentBoundary(events, version, expectedDeploymentId = null) {
  const markers = (events || [])
    .filter(e =>
      e?.code === 'DEPLOYMENT_MARKER' &&
      (e?.ctx?.version === version || e?.v === version) &&
      (!expectedDeploymentId || e?.ctx?.deploymentId === expectedDeploymentId)
    )
    .sort((a, b) => Number(a.tick) - Number(b.tick));
  if (markers.length) {
    return {
      event: markers.at(-1),
      inclusive: true,
      source: 'DEPLOYMENT_MARKER'
    };
  }

  if (expectedDeploymentId) return null;

  const changes = (events || [])
    .filter(e => e?.code === 'VERSION_CHANGE' && (e?.ctx?.to === version || e?.v === version))
    .sort((a, b) => Number(a.tick) - Number(b.tick));
  if (!changes.length) return null;
  return {
    event: changes.at(-1),
    inclusive: false,
    source: 'VERSION_CHANGE'
  };
}

function estimateSecondsPerTick(events) {
  const samples = (events || [])
    .map(e => ({ tick: finiteTick(e?.tick), time: Date.parse(e?.capturedAt) }))
    .filter(x => x.tick !== null && Number.isFinite(x.time))
    .sort((a, b) => a.tick - b.tick || a.time - b.time);

  const rates = [];
  for (let i = 1; i < samples.length; i++) {
    const dtick = samples[i].tick - samples[i - 1].tick;
    const dsec = (samples[i].time - samples[i - 1].time) / 1000;
    if (dtick > 0 && dsec > 0 && dsec / dtick < 10) rates.push(dsec / dtick);
  }
  if (!rates.length) return 0.2;
  rates.sort((a, b) => a - b);
  return rates[Math.floor(rates.length / 2)];
}

export function resolveAutoStart(events, version, mode, roomName, expectedDeploymentId = null) {
  const boundary = latestDeploymentBoundary(events, version, expectedDeploymentId);
  if (!boundary) {
    if (expectedDeploymentId) {
      return {
        ready: false,
        waitingForDeploymentMarker: true,
        expectedDeploymentId,
        latestEvidenceTick: Math.max(-1, ...(events || []).map(e => finiteTick(e?.tick) ?? -1))
      };
    }
    return {
      ready: false,
      fatal: `No DEPLOYMENT_MARKER or VERSION_CHANGE to ${version} found. Deploy first or pass --start-tick explicitly.`
    };
  }

  const deployTick = Number(boundary.event.tick);
  const minimumStartTick = boundary.inclusive ? deployTick : deployTick + 1;
  const latestEvidenceTick = Math.max(-1, ...(events || []).map(e => finiteTick(e?.tick) ?? -1));

  if (mode === 'smoke') {
    const expectedStartTick = minimumStartTick;
    const expectedEndTick = expectedStartTick + 24;
    if (latestEvidenceTick >= expectedEndTick) {
      return {
        ready: true,
        startTick: expectedStartTick,
        endTick: expectedEndTick,
        deployTick,
        deploymentId: boundary.event?.ctx?.deploymentId || null,
        boundarySource: boundary.source
      };
    }

    const secondsPerTick = estimateSecondsPerTick(events);
    const remainingTicks = Math.max(0, expectedEndTick - Math.max(deployTick, latestEvidenceTick));
    return {
      ready: false,
      deployTick,
      deploymentId: boundary.event?.ctx?.deploymentId || null,
      boundarySource: boundary.source,
      latestEvidenceTick,
      expectedStartTick,
      expectedEndTick,
      remainingSeconds: Math.max(0, Math.ceil(remainingTicks * secondsPerTick))
    };
  }

  const minimumSnapshotTick = minimumStartTick + 99;
  const snapshots = (events || [])
    .filter(e =>
      e?.code === 'STATUS_SNAPSHOT' &&
      (!e?.v || e.v === version) &&
      finiteTick(e?.tick) !== null &&
      finiteTick(e?.tick) >= minimumSnapshotTick &&
      e?.ctx?.rooms?.[roomName]
    )
    .sort((a, b) => Number(a.tick) - Number(b.tick));

  const candidate = snapshots[0] || null;
  if (candidate) {
    const endTick = Number(candidate.tick);
    return {
      ready: true,
      startTick: endTick - 99,
      endTick,
      deployTick,
      deploymentId: boundary.event?.ctx?.deploymentId || null,
      boundarySource: boundary.source,
      snapshotTick: endTick
    };
  }

  // STATUS_SNAPSHOT is emitted on the bot's fixed 100-tick cadence. Choose the
  // first such boundary that can contain a full post-deploy 100-tick window.
  const expectedEndTick = Math.ceil(minimumSnapshotTick / 100) * 100;
  const expectedStartTick = expectedEndTick - 99;
  const secondsPerTick = estimateSecondsPerTick(events);
  const remainingTicks = Math.max(0, expectedEndTick - Math.max(deployTick, latestEvidenceTick));
  const remainingSeconds = Math.max(0, Math.ceil(remainingTicks * secondsPerTick));
  const snapshotOverdue = latestEvidenceTick >= expectedEndTick + 200;

  if (snapshotOverdue) {
    return {
      ready: false,
      fatal:
        `No STATUS_SNAPSHOT was observed at or after the expected live boundary ${expectedEndTick}, ` +
        `even though evidence advanced to tick ${latestEvidenceTick}. Check collector continuity and snapshot emission.`,
      deployTick,
      deploymentId: boundary.event?.ctx?.deploymentId || null,
      boundarySource: boundary.source,
      latestEvidenceTick,
      expectedStartTick,
      expectedEndTick
    };
  }

  return {
    ready: false,
    deployTick,
    deploymentId: boundary.event?.ctx?.deploymentId || null,
    boundarySource: boundary.source,
    latestEvidenceTick,
    expectedStartTick,
    expectedEndTick,
    remainingSeconds,
    waitingForSnapshot: remainingSeconds === 0 && expectedEndTick !== null && latestEvidenceTick >= expectedEndTick
  };
}

export function formatWaitStatus(status) {
  if (status.waitingForDeploymentMarker) {
    return `Waiting for deployment marker ${status.expectedDeploymentId}...`;
  }
  if (status.waitingForSnapshot) {
    return `Window ${status.expectedStartTick}-${status.expectedEndTick} has enough tick data; waiting for complete STATUS_SNAPSHOT (latest evidence tick ${status.latestEvidenceTick})...`;
  }
  const total = Math.max(0, Math.ceil(Number(status.remainingSeconds) || 0));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `Waiting for data...[${minutes} Min ${seconds} Sec remaining]`;
}

export async function waitForAutoStart({
  mode,
  version,
  roomName,
  loadEvents,
  pollMs = 5000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onWait = () => {},
  expectedDeploymentId = null
}) {
  let lastMessage = null;

  for (;;) {
    const events = loadEvents();
    if (!events.length) throw new Error('No bot event evidence is available. Run the collector first.');

    const status = resolveAutoStart(events, version, mode, roomName, expectedDeploymentId);
    if (status.fatal) throw new Error(status.fatal);
    if (status.ready) return { startTick: status.startTick, events, status };

    const message = formatWaitStatus(status);
    if (message !== lastMessage) {
      onWait(message, status);
      lastMessage = message;
    }
    await sleep(pollMs);
  }
}
