function finiteTick(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function latestVersionChange(events, version) {
  return (events || [])
    .filter(e => e?.code === 'VERSION_CHANGE' && (e?.ctx?.to === version || e?.v === version))
    .sort((a, b) => Number(a.tick) - Number(b.tick))
    .at(-1) || null;
}

function snapshotWindows(events, version, roomName) {
  return (events || [])
    .filter(e => e?.code === 'STATUS_SNAPSHOT' && (!e?.v || e.v === version))
    .map(e => {
      const last100 = e?.ctx?.rooms?.[roomName]?.economy?.last100;
      return {
        eventTick: finiteTick(e?.tick),
        startTick: finiteTick(last100?.startTick),
        endTick: finiteTick(last100?.endTick),
        ticks: finiteTick(last100?.ticks)
      };
    })
    .filter(x => x.startTick !== null && x.endTick !== null && x.ticks !== null)
    .sort((a, b) => a.endTick - b.endTick || a.eventTick - b.eventTick);
}

export function resolveAutoStart(events, version, mode, roomName) {
  const change = latestVersionChange(events, version);
  if (!change) {
    return {
      ready: false,
      fatal: `No VERSION_CHANGE to ${version} found. Deploy first or pass --start-tick explicitly.`
    };
  }

  const deployTick = Number(change.tick);
  if (mode === 'smoke') {
    return { ready: true, startTick: deployTick + 1, deployTick };
  }

  const windows = snapshotWindows(events, version, roomName);
  const candidate = windows.find(x => x.ticks >= 100 && x.startTick > deployTick && x.endTick >= x.startTick + 99);
  if (candidate) {
    return {
      ready: true,
      startTick: candidate.startTick,
      endTick: candidate.endTick,
      deployTick
    };
  }

  const latestEvidenceTick = Math.max(-1, ...(events || []).map(e => finiteTick(e?.tick) ?? -1));
  const latestWindow = windows.at(-1) || null;
  let expectedStartTick = null;
  let expectedEndTick = null;

  if (latestWindow && latestWindow.ticks >= 100 && latestWindow.endTick >= latestWindow.startTick + 99) {
    expectedStartTick = latestWindow.startTick;
    expectedEndTick = latestWindow.endTick;
    while (expectedStartTick <= deployTick) {
      expectedStartTick = expectedEndTick + 1;
      expectedEndTick = expectedStartTick + 99;
    }
  }

  return {
    ready: false,
    deployTick,
    latestEvidenceTick,
    expectedStartTick,
    expectedEndTick
  };
}

export function formatWaitStatus(status) {
  const current = status.latestEvidenceTick >= 0 ? ` latest evidence tick ${status.latestEvidenceTick}.` : '';
  if (status.expectedStartTick !== null && status.expectedEndTick !== null) {
    return `Waiting for complete post-deploy 100-tick window ${status.expectedStartTick}-${status.expectedEndTick};${current}`;
  }
  return `Waiting for the first complete post-deploy 100-tick STATUS_SNAPSHOT after deployment tick ${status.deployTick};${current}`;
}

export async function waitForAutoStart({
  mode,
  version,
  roomName,
  loadEvents,
  pollMs = 5000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onWait = () => {}
}) {
  let lastMessage = null;

  for (;;) {
    const events = loadEvents();
    if (!events.length) throw new Error('No bot event evidence is available. Run the collector first.');

    const status = resolveAutoStart(events, version, mode, roomName);
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
