// Read-only P3 release-evidence selection. No server, gameplay or file writes.
function nonnegativeTick(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function observableWorkload(plan) {
  const bounds = plan?.bounds || {};
  const graph = plan?.graph || {};
  const metrics = plan?.metrics || {};
  const positiveOrZero = v => Number.isFinite(v) && v >= 0 ? v : null;
  return {
    boundsArea: positiveOrZero(bounds.area),
    boundsWidth: positiveOrZero(bounds.width),
    boundsHeight: positiveOrZero(bounds.height),
    protectedAssetCount: positiveOrZero(plan?.protectedAssetCount),
    trafficTileCount: positiveOrZero(plan?.trafficTileCount),
    walkableTiles: positiveOrZero(graph.walkableTiles),
    graphNodeCount: positiveOrZero(graph.nodeCount),
    graphEdgeCount: positiveOrZero(graph.edgeCount),
    graphAugmentations: positiveOrZero(graph.augmentations),
    rampartCount: positiveOrZero(plan?.rampartCount),
    towerCount: positiveOrZero(metrics.towerCount)
  };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

// Diagnostics only. Matching aggregate counters do NOT prove equal terrain,
// full cut geometry, solver inputs, JIT state, or workload equivalence.
export function compareP3ReleaseSamples(first, second) {
  const dimensions = [
    'boundsArea', 'boundsWidth', 'boundsHeight',
    'protectedAssetCount', 'trafficTileCount',
    'walkableTiles', 'graphNodeCount', 'graphEdgeCount',
    'rampartCount', 'towerCount'
  ];
  const a = first?.workload || {};
  const b = second?.workload || {};
  const known = dimensions.filter(k => Number.isFinite(a[k]) && Number.isFinite(b[k]));
  const changed = known.filter(k => a[k] !== b[k]);
  const geometryCountersMatch = known.length === dimensions.length
    ? changed.length === 0 : null;
  const delta = {};
  const cpuFields = {
    scheduler: [first?.schedulerCpu, second?.schedulerCpu],
    topology: [first?.phases?.PROTECTED_TOPOLOGY, second?.phases?.PROTECTED_TOPOLOGY],
    mincut: [first?.phases?.MINCUT, second?.phases?.MINCUT],
    scoring: [first?.phases?.DEFENSE_SCORE, second?.phases?.DEFENSE_SCORE],
    outsidePhases: [first?.cpuOutsidePhases, second?.cpuOutsidePhases]
  };
  for (const [key, [x, y]] of Object.entries(cpuFields)) {
    delta[key] = Number.isFinite(x) && Number.isFinite(y) ? round3(y - x) : null;
  }
  return {
    fromRunTick: first?.runTick ?? null,
    toRunTick: second?.runTick ?? null,
    knownGeometryFields: known.length,
    geometryFieldCount: dimensions.length,
    changedGeometryFields: changed,
    geometryCountersMatch,
    cpuDeltaSecondMinusFirst: delta,
    comparableEndToEndSpeedup: false,
    caveat: 'Observable geometry counters are not proof of identical work, warm-up state, or causal speedup.'
  };
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
    const phases = {};
    for (const name of ['PROTECTED_TOPOLOGY', 'MINCUT', 'DEFENSE_SCORE']) {
      const entries = plan.phaseEvidence.filter(p => p?.phase === name);
      if (entries.length !== 1 || !Number.isFinite(entries[0].cpuUsed) ||
          entries[0].cpuUsed < 0) {
        phases[name] = null;
      } else {
        phases[name] = entries[0].cpuUsed;
      }
    }
    const measured = Object.values(phases).filter(v => v !== null);
    const allMeasured = measured.length === 3;
    const accountedCpu = allMeasured
      ? Math.round(measured.reduce((sum, v) => sum + v, 0) * 1000) / 1000
      : null;
    // Profiling spans and rounding mean this is a diagnostic gap, not a
    // proven algorithm bottleneck or exact attribution to any one subsystem.
    const cpuOutsidePhases = allMeasured
      ? Math.round((scheduler.lastCpu - accountedCpu) * 1000) / 1000 : null;
    const sample = {
      workload: observableWorkload(plan),
      phases,
      accountedCpu,
      cpuOutsidePhases,
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
