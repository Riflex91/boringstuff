// Read-only P3 release-evidence selection. No server, gameplay or file writes.
function nonnegativeTick(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function assessP3Release({ events, receipt, roomName = 'E8N1' } = {}) {
  if (!receipt || !receipt.version || !receipt.deploymentId ||
      !receipt.server || !receipt.branch) {
    throw new Error('Exact deployment receipt with server, branch, version and deploymentId required.');
  }
  if (!Array.isArray(events)) throw new Error('events array required');
  const room = String(roomName || 'E8N1').toUpperCase();
  const ordered = events.filter(e => nonnegativeTick(e?.tick) !== null)
    .sort((a, b) => a.tick - b.tick || (Number(a.jseq) || 0) - (Number(b.jseq) || 0));
  const latestTick = ordered.length ? ordered.at(-1).tick : null;
  const markers = ordered.filter(e => e.code === 'DEPLOYMENT_MARKER');
  const boundary = markers.findLast(e => e.v === receipt.version &&
    e.ctx?.version === receipt.version && e.ctx?.deploymentId === receipt.deploymentId);
  if (!boundary) {
    return { state: 'WAIT', reason: 'MATCHING_DEPLOYMENT_MARKER_MISSING',
      latestTick, markerTick: null, samples: [] };
  }
  const markerTick = boundary.tick;
  const subsequent = markers.find(e => e.tick > markerTick &&
    (e.ctx?.deploymentId !== receipt.deploymentId || e.v !== receipt.version));
  if (subsequent) {
    return { state: 'BLOCKED', reason: 'SUBSEQUENT_DIFFERENT_DEPLOYMENT',
      latestTick, markerTick, subsequentTick: subsequent.tick, samples: [] };
  }
  const firstValidWindowEnd = markerTick + 99;
  const byExecution = new Map();
  const snapshots = ordered.filter(e => e.code === 'STATUS_SNAPSHOT' &&
    e.v === receipt.version && e.tick >= firstValidWindowEnd);
  for (const e of snapshots) {
    const plan = e.ctx?.rooms?.[room]?.defenseMinCut;
    const scheduler = e.ctx?.scheduler?.processes?.['defense-mincut-shadow'];
    const runTick = nonnegativeTick(scheduler?.lastRunTick);
    const planTick = nonnegativeTick(plan?.planTick);
    if (runTick === null || runTick < markerTick || runTick > e.tick ||
        planTick !== runTick || e.tick - runTick > 99) continue;
    if (!Number.isFinite(scheduler.lastCpu) || scheduler.lastCpu < 0) continue;
    const phase = plan.phaseEvidence?.find(p => p?.phase === 'MINCUT');
    if (!phase || !Number.isFinite(phase.cpuUsed) || phase.cpuUsed < 0) continue;
    const sample = {
      runTick,
      snapshotTick: e.tick,
      startTick: e.tick - 99,
      endTick: e.tick,
      schedulerCpu: scheduler.lastCpu,
      mincutPhaseCpu: phase.cpuUsed,
      planStatus: plan.status,
      authority: plan.authority,
      constructionAuthority: plan.constructionAuthority
    };
    // Repeated snapshots of one scheduler execution are ONE measurement.
    const previous = byExecution.get(runTick);
    if (!previous || sample.snapshotTick < previous.snapshotTick) {
      byExecution.set(runTick, sample);
    }
  }
  const samples = [...byExecution.values()].sort((a, b) => a.runTick - b.runTick);
  if (!samples.length) {
    return { state: 'WAIT', reason: 'NO_NEW_MATCHING_P3_EXECUTION_SNAPSHOT',
      latestTick, markerTick, firstValidWindowEnd, samples };
  }
  return { state: 'READY', reason: 'VERIFIER_REQUIRED', latestTick, markerTick,
    firstValidWindowEnd, samples };
}
