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

function requiresProductiveAttribution(version) {
  const m = String(version || '').match(/^0\.2\.(\d+)/);
  return !!m && Number(m[1]) >= 19;
}

function attributionReady(last100) {
  const p = last100?.productiveFlow;
  if (!p || typeof p !== 'object') return false;
  const required = [
    p.consumerTicks,
    p.waitingConsumerTicks,
    p.criticalConsumerTicks,
    p.fallbackConsumerTicks,
    p.averageConstructionCapacityPerTick,
    p.averageDedicatedControllerCapacityPerTick,
    p.actualProductiveThroughputPerTick
  ];
  return required.every(v => Number.isFinite(Number(v)));
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
        ticks: finiteTick(last100?.ticks),
        attributionReady: attributionReady(last100)
      };
    })
    .filter(x => x.startTick !== null && x.endTick !== null && x.ticks !== null)
    .sort((a, b) => a.endTick - b.endTick || a.eventTick - b.eventTick);
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
  const requireAttribution = requiresProductiveAttribution(version);
  const candidate = windows.find(x =>
    x.ticks >= 100 &&
    x.startTick > deployTick &&
    x.endTick >= x.startTick + 99 &&
    (!requireAttribution || x.attributionReady)
  );
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
    while (
      expectedStartTick <= deployTick ||
      (requireAttribution && !latestWindow.attributionReady && expectedEndTick <= latestEvidenceTick)
    ) {
      expectedStartTick = expectedEndTick + 1;
      expectedEndTick = expectedStartTick + 99;
    }
  } else {
    expectedStartTick = Math.floor(deployTick / 100) * 100 + 101;
    expectedEndTick = expectedStartTick + 99;
    while (expectedStartTick <= deployTick) {
      expectedStartTick = expectedEndTick + 1;
      expectedEndTick = expectedStartTick + 99;
    }
  }

  const secondsPerTick = estimateSecondsPerTick(events);
  const remainingTicks = expectedEndTick === null
    ? 0
    : Math.max(0, expectedEndTick - Math.max(deployTick, latestEvidenceTick));
  const remainingSeconds = Math.max(0, Math.ceil(remainingTicks * secondsPerTick));

  return {
    ready: false,
    deployTick,
    latestEvidenceTick,
    expectedStartTick,
    expectedEndTick,
    remainingSeconds
  };
}

export function formatWaitStatus(status) {
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
