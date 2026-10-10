// Pure, read-only discovery of candidate 100-tick verifier windows.
// Discovery NEVER represents a verifier PASS or gameplay authorization.
const tick = x => Number.isInteger(x) && x >= 0 ? x : null;
const number = x => Number.isFinite(x) ? x : null;
const inRoom = (event, room) => event?.ctx?.rooms?.[room] || null;

function completion(block, markerTick, snapshotTick) {
  const startTick = tick(block?.startTick);
  const endTick = tick(block?.endTick);
  const ticks = tick(block?.ticks);
  if (startTick === null || endTick === null || ticks !== 100 ||
      endTick - startTick !== 99 || startTick < markerTick ||
      endTick > snapshotTick) return null;
  return { startTick, endTick, ticks, carrierTick: snapshotTick };
}

function latestUnique(rows, key, max = 4) {
  const unique = new Map();
  for (const row of rows) {
    const id = row[key];
    const old = unique.get(id);
    if (!old || row.carrierTick < old.carrierTick) unique.set(id, row);
  }
  return [...unique.values()].sort((a, b) => b[key] - a[key]).slice(0, max);
}

export function discoverLiveWindows({ events, receipt, roomName = 'E8N1', limit = 4 } = {}) {
  if (!Array.isArray(events)) throw new Error('events array required');
  if (!receipt?.deploymentId || !receipt?.version || !receipt?.server || !receipt?.branch)
    throw new Error('exact deployment receipt required');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new Error('limit must be an integer 1..20');
  const room = String(roomName).toUpperCase();
  const ordered = events.filter(e => tick(e?.tick) !== null)
    .sort((a,b) => a.tick - b.tick || (number(a.jseq) ?? 0) - (number(b.jseq) ?? 0));
  const latestTick = ordered.at(-1)?.tick ?? null;
  const marker = ordered.findLast(e => e.code === 'DEPLOYMENT_MARKER' &&
    e.v === receipt.version && e.ctx?.deploymentId === receipt.deploymentId &&
    e.ctx?.version === receipt.version);
  if (!marker) return { state: 'WAIT', reason: 'MATCHING_DEPLOYMENT_MARKER_MISSING',
    latestTick, markerTick: null };
  const after = ordered.find(e => e.code === 'DEPLOYMENT_MARKER' &&
    e.tick > marker.tick &&
    (e.ctx?.deploymentId !== receipt.deploymentId || e.v !== receipt.version));
  if (after) return { state: 'BLOCKED', reason: 'SUBSEQUENT_DIFFERENT_DEPLOYMENT',
    latestTick, markerTick: marker.tick, subsequentTick: after.tick };

  const snapshots = ordered.filter(e => e.code === 'STATUS_SNAPSHOT' &&
    e.v === receipt.version && e.tick >= marker.tick && inRoom(e, room));
  const economy = [];
  const e4 = [];
  const p2 = [];
  const i2 = [];
  for (const e of snapshots) {
    const state = inRoom(e, room);
    const eco = completion(state?.economy?.last100, marker.tick, e.tick);
    if (eco && latestTick >= eco.endTick) economy.push({
      ...eco,
      controllerProgress: number(state.economy.last100.controllerProgress),
      constructionProgress: number(state.economy.last100.constructionProgress),
      productiveThroughput: number(state.economy.last100.productiveFlow?.actualProductiveThroughputPerTick)
    });
    const e4Window = state?.logisticsMatchingEvidence?.lastWindow ||
      state?.colonyState?.logisticsMatching?.evidence?.lastWindow;
    const matched = completion(e4Window, marker.tick, e.tick);
    if (matched && latestTick >= matched.endTick) e4.push({
      ...matched,
      duplicateReservationTicks: number(e4Window.duplicateReservationTicks),
      criticalRequestTicks: number(e4Window.criticalRequestTicks),
      criticalCoverageRatio: number(e4Window.criticalCoverageRatio)
    });

    const p2run = tick(e.ctx?.scheduler?.processes?.['planner-vnext-shadow']?.lastRunTick);
    const p2plan = tick(state?.plannerVNext?.planTick);
    if (p2run !== null && p2run === p2plan &&
        p2run >= marker.tick && p2run <= e.tick && e.tick - p2run <= 99 &&
        latestTick >= p2run + 99) p2.push({
      startTick: p2run, endTick: p2run + 99, runTick: p2run, carrierTick: e.tick,
      cpu: number(e.ctx.scheduler.processes['planner-vnext-shadow'].lastCpu),
      planStatus: state.plannerVNext?.status
    });

    const i2run = tick(e.ctx?.scheduler?.processes?.['remote-roi-shadow']?.lastRunTick);
    const i2plan = tick(state?.remoteRoi?.evaluatedTick);
    if (i2run !== null && i2run === i2plan &&
        i2run >= marker.tick && i2run <= e.tick && e.tick - i2run <= 99 &&
        latestTick >= i2run + 99) i2.push({
      startTick: i2run, endTick: i2run + 99, runTick: i2run, carrierTick: e.tick,
      cpu: number(e.ctx.scheduler.processes['remote-roi-shadow'].lastCpu),
      roiStatus: state.remoteRoi?.status
    });
  }
  const last = snapshots.at(-1);
  const status = inRoom(last, room)?.efficiency || null;
  const economyWindows = latestUnique(economy, 'startTick', limit);
  const e4Windows = latestUnique(e4, 'startTick', limit);
  const e4Starts = new Set(e4Windows.map(x => x.startTick));
  const shared = economyWindows.filter(x => e4Starts.has(x.startTick));
  return {
    state: 'READY', reason: 'CANDIDATES_NOT_VERDICTS',
    server: receipt.server, branch: receipt.branch,
    version: receipt.version, deploymentId: receipt.deploymentId,
    room, markerTick: marker.tick, latestTick,
    economyWindows, e4Windows,
    overlappingEconomyE4Windows: shared,
    p2Runs: latestUnique(p2, 'runTick', limit),
    i2Runs: latestUnique(i2, 'runTick', limit),
    latestEfficiency: {
      snapshotTick: last?.tick ?? null,
      status: status?.status ?? null,
      overallScore: number(status?.overallScore),
      reasons: Array.isArray(status?.reasons) ? status.reasons : [],
      components: status?.components || null,
      pressure: status?.pressure || null,
      metrics: status?.metrics || null
    }
  };
}
