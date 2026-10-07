const RANK = { PASS: 0, WATCH: 1, FAIL: 2 };

export const DEFAULT_P3_WINDOW_TICKS = 100;
export const DEFAULT_P3_MAX_GRID_TILES = 900;
export const DEFAULT_P3_MAX_AUGMENTATIONS = 10000;
export const P3_CPU_WATCH = 10;
export const P3_CPU_FAIL = 20;

function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function check(id, status, message, data = {}) {
  return { id, status, message, data };
}

function summarize(checks) {
  let outcome = 'PASS';
  for (const item of checks) {
    if (RANK[item.status] > RANK[outcome]) outcome = item.status;
  }
  return {
    outcome,
    checks,
    counts: {
      pass: checks.filter(item => item.status === 'PASS').length,
      watch: checks.filter(item => item.status === 'WATCH').length,
      fail: checks.filter(item => item.status === 'FAIL').length
    }
  };
}

function roomSnapshot(event, roomName) {
  if (!event || event.code !== 'STATUS_SNAPSHOT') return null;
  return event.ctx?.rooms?.[roomName] || null;
}

function defenseSnapshot(event, roomName) {
  return roomSnapshot(event, roomName)?.defenseMinCut || null;
}

function plannerSnapshot(event, roomName) {
  return roomSnapshot(event, roomName)?.plannerVNext || null;
}

function schedulerSnapshot(event) {
  return event?.ctx?.scheduler?.processes?.['defense-mincut-shadow'] || null;
}

function validScore(value) {
  const n = finite(value, null);
  return n !== null && n >= 0 && n <= 100;
}

export function evaluateP3Shadow(input = {}) {
  const events = Array.isArray(input.events) ? input.events : [];
  const roomName = String(input.roomName || 'E8N1').toUpperCase();
  const startTick = Number(input.startTick);
  const tickCount = Number.isInteger(input.tickCount) && input.tickCount > 0
    ? input.tickCount
    : DEFAULT_P3_WINDOW_TICKS;

  if (!Number.isInteger(startTick) || startTick < 0) {
    throw new Error('startTick must be a non-negative integer');
  }

  const endTick = startTick + tickCount - 1;
  const evidenceMaxTick = Math.max(-1, ...events.map(event => finite(event?.tick, -1)));
  const complete = evidenceMaxTick >= endTick;
  const samples = events
    .filter(event => {
      const tick = finite(event?.tick, null);
      return tick !== null && tick >= startTick && tick <= endTick && event?.code === 'STATUS_SNAPSHOT';
    })
    .map(event => ({
      tick: finite(event.tick, 0),
      defense: defenseSnapshot(event, roomName),
      planner: plannerSnapshot(event, roomName),
      scheduler: schedulerSnapshot(event)
    }))
    .filter(sample => sample.defense)
    .sort((a, b) => a.tick - b.tick);

  const checks = [];

  if (!samples.length) {
    checks.push(check(
      'mincut-evidence',
      complete ? 'FAIL' : 'WATCH',
      complete
        ? `No P3 defenseMinCut STATUS_SNAPSHOT evidence was found for ${roomName}.`
        : `No P3 defenseMinCut sample has arrived yet for ${roomName}.`
    ));
  } else {
    checks.push(check(
      'mincut-evidence',
      'PASS',
      `Observed ${samples.length} P3 defenseMinCut STATUS_SNAPSHOT sample(s) for ${roomName}.`,
      { ticks: samples.map(sample => sample.tick) }
    ));
  }

  const authorityFailures = samples.filter(sample =>
    sample.defense?.authority !== 'SHADOW' ||
    sample.defense?.legacyPlannerAuthority !== 'UNCHANGED' ||
    sample.defense?.constructionAuthority !== 'NONE'
  );
  if (authorityFailures.length) {
    checks.push(check(
      'shadow-authority',
      'FAIL',
      'P3 authority, construction authority, or legacy planner authority changed unexpectedly.',
      {
        samples: authorityFailures.map(sample => ({
          tick: sample.tick,
          authority: sample.defense?.authority,
          legacyPlannerAuthority: sample.defense?.legacyPlannerAuthority,
          constructionAuthority: sample.defense?.constructionAuthority
        }))
      }
    ));
  } else if (samples.length) {
    checks.push(check(
      'shadow-authority',
      'PASS',
      'P3 remained SHADOW, construction authority remained NONE, and legacy planner authority remained unchanged.'
    ));
  } else {
    checks.push(check('shadow-authority', complete ? 'FAIL' : 'WATCH', 'No P3 authority evidence is available yet.'));
  }

  const nonReady = samples.filter(sample => sample.defense?.status !== 'READY');
  if (nonReady.length) {
    checks.push(check(
      'mincut-ready',
      'FAIL',
      'P3 did not produce a READY defensive cut in every observed sample.',
      { samples: nonReady.map(sample => ({ tick: sample.tick, status: sample.defense?.status, reason: sample.defense?.reason })) }
    ));
  } else if (samples.length) {
    checks.push(check('mincut-ready', 'PASS', 'P3 produced a READY defensive cut.'));
  } else {
    checks.push(check('mincut-ready', complete ? 'FAIL' : 'WATCH', 'No P3 cut status is available yet.'));
  }

  const contractFailures = [];
  for (const sample of samples) {
    const defense = sample.defense || {};
    const graph = defense.graph || {};
    const metrics = defense.metrics || {};
    const score = defense.score || {};
    const bounds = defense.bounds || {};
    const protectedAssetCount = finite(defense.protectedAssetCount, null);
    const trafficTileCount = finite(defense.trafficTileCount, null);
    const rampartCount = finite(defense.rampartCount, null);
    const walkableTiles = finite(graph.walkableTiles, null);
    const nodeCount = finite(graph.nodeCount, null);
    const edgeCount = finite(graph.edgeCount, null);
    const augmentations = finite(graph.augmentations, null);
    const breachRouteCount = finite(metrics.breachRouteCount, null);
    const exposedAssetCount = finite(metrics.exposedAssetCount, null);
    const trafficCrossings = finite(metrics.trafficCrossings, null);
    const exitExposureRatio = finite(metrics.exitExposureRatio, null);
    const repairBurdenIndex = finite(metrics.repairBurdenIndex, null);

    const width = finite(bounds.width, null);
    const height = finite(bounds.height, null);
    const area = finite(bounds.area, null);

    if (protectedAssetCount === null || protectedAssetCount < 1) {
      contractFailures.push({ tick: sample.tick, reason: 'protected-assets', protectedAssetCount });
    }
    if (trafficTileCount === null || trafficTileCount < 0) {
      contractFailures.push({ tick: sample.tick, reason: 'traffic-tiles', trafficTileCount });
    }
    if (area === null || area < 1 || area > DEFAULT_P3_MAX_GRID_TILES ||
        width === null || width < 1 || height === null || height < 1) {
      contractFailures.push({ tick: sample.tick, reason: 'bounds', bounds });
    }
    if (graph.complete !== true ||
        walkableTiles === null || walkableTiles < 1 || walkableTiles > DEFAULT_P3_MAX_GRID_TILES ||
        nodeCount === null || nodeCount < 3 ||
        edgeCount === null || edgeCount < 1 ||
        augmentations === null || augmentations < 0 || augmentations > DEFAULT_P3_MAX_AUGMENTATIONS) {
      contractFailures.push({ tick: sample.tick, reason: 'graph', graph });
    }
    if (rampartCount === null || rampartCount < 0 ||
        (walkableTiles !== null && rampartCount > walkableTiles)) {
      contractFailures.push({ tick: sample.tick, reason: 'rampart-count', rampartCount, walkableTiles });
    }
    if (breachRouteCount !== 0 || exposedAssetCount !== 0) {
      contractFailures.push({ tick: sample.tick, reason: 'breach', breachRouteCount, exposedAssetCount });
    }
    if (trafficCrossings === null || trafficCrossings < 0 ||
        (rampartCount !== null && trafficCrossings > rampartCount)) {
      contractFailures.push({ tick: sample.tick, reason: 'traffic-crossings', trafficCrossings, rampartCount });
    }
    if (exitExposureRatio === null || exitExposureRatio < 0 || exitExposureRatio > 1 ||
        repairBurdenIndex === null || repairBurdenIndex < 0) {
      contractFailures.push({ tick: sample.tick, reason: 'defense-metrics', exitExposureRatio, repairBurdenIndex });
    }
    if (!validScore(score.total)) {
      contractFailures.push({ tick: sample.tick, reason: 'score-total', score: score.total });
    }
    for (const [name, value] of Object.entries(score.components || {})) {
      if (!validScore(value)) contractFailures.push({ tick: sample.tick, reason: 'score-component', name, value });
    }
    if (!validScore(metrics.towerMinimumCoverageScore) || !validScore(metrics.towerAverageCoverageScore)) {
      contractFailures.push({
        tick: sample.tick,
        reason: 'tower-coverage-score',
        minimum: metrics.towerMinimumCoverageScore,
        average: metrics.towerAverageCoverageScore
      });
    }
  }

  checks.push(contractFailures.length
    ? check('mincut-contract', 'FAIL', 'P3 live telemetry violated graph, cut, breach, or scoring contracts.', { failures: contractFailures.slice(0, 20) })
    : samples.length
      ? check('mincut-contract', 'PASS', 'P3 graph, cut, breach, and scoring contracts remained valid.')
      : check('mincut-contract', complete ? 'FAIL' : 'WATCH', 'No P3 contract evidence is available yet.'));

  const dependencyFailures = [];
  const dependencyWatches = [];
  for (const sample of samples) {
    const sourcePlannerTick = finite(sample.defense?.sourcePlannerTick, null);
    const defensePlanTick = finite(sample.defense?.planTick, null);
    const observedP2Tick = finite(sample.planner?.planTick, null);

    if (sourcePlannerTick === null || defensePlanTick === null || sourcePlannerTick >= defensePlanTick) {
      dependencyFailures.push({ tick: sample.tick, sourcePlannerTick, defensePlanTick, observedP2Tick });
      continue;
    }
    if (observedP2Tick !== null && sourcePlannerTick > observedP2Tick) {
      dependencyFailures.push({ tick: sample.tick, sourcePlannerTick, defensePlanTick, observedP2Tick });
      continue;
    }
    if (observedP2Tick !== null && sourcePlannerTick !== observedP2Tick) {
      dependencyWatches.push({ tick: sample.tick, sourcePlannerTick, observedP2Tick });
    }
  }

  if (dependencyFailures.length) {
    checks.push(check(
      'p2-dependency-order',
      'FAIL',
      'P3 dependency ordering was invalid; P3 must consume an earlier READY P2 SHADOW plan.',
      { failures: dependencyFailures }
    ));
  } else if (dependencyWatches.length) {
    checks.push(check(
      'p2-dependency-order',
      'WATCH',
      'P3 used an older valid P2 plan while a newer P2 snapshot was already visible.',
      { samples: dependencyWatches }
    ));
  } else if (samples.length) {
    checks.push(check(
      'p2-dependency-order',
      'PASS',
      'P3 consumed an earlier P2 SHADOW plan and did not execute on the same planner tick.'
    ));
  } else {
    checks.push(check('p2-dependency-order', complete ? 'FAIL' : 'WATCH', 'No P2→P3 dependency evidence is available yet.'));
  }

  const schedulerSamples = samples.filter(sample => sample.scheduler);
  if (!schedulerSamples.length) {
    checks.push(check(
      'scheduler-isolation',
      complete ? 'FAIL' : 'WATCH',
      'No defense-mincut-shadow scheduler state was present in STATUS_SNAPSHOT telemetry.'
    ));
  } else if (!schedulerSamples.some(sample => finite(sample.scheduler?.runCount, 0) > 0)) {
    checks.push(check(
      'scheduler-isolation',
      'FAIL',
      'defense-mincut-shadow never ran according to scheduler telemetry.',
      { schedulerSamples }
    ));
  } else {
    checks.push(check(
      'scheduler-isolation',
      'PASS',
      'defense-mincut-shadow is tracked as an independent scheduler process.',
      { latest: schedulerSamples.at(-1).scheduler }
    ));
  }

  const cpuSamples = schedulerSamples
    .map(sample => ({ tick: sample.tick, cpu: finite(sample.scheduler?.lastCpu, null) }))
    .filter(sample => sample.cpu !== null);
  if (!cpuSamples.length) {
    checks.push(check(
      'mincut-cpu',
      samples.length ? 'WATCH' : (complete ? 'FAIL' : 'WATCH'),
      'No isolated P3 scheduler CPU sample is available yet.'
    ));
  } else {
    const worst = cpuSamples.reduce((a, b) => b.cpu > a.cpu ? b : a);
    if (worst.cpu > P3_CPU_FAIL) {
      checks.push(check(
        'mincut-cpu',
        'FAIL',
        `P3 isolated scheduler CPU exceeded the hard 20 CPU diagnostic threshold: ${worst.cpu}.`,
        { samples: cpuSamples, watchThreshold: P3_CPU_WATCH, failThreshold: P3_CPU_FAIL }
      ));
    } else if (worst.cpu > P3_CPU_WATCH) {
      checks.push(check(
        'mincut-cpu',
        'WATCH',
        `P3 isolated scheduler CPU is high but below the hard threshold: ${worst.cpu}.`,
        { samples: cpuSamples, watchThreshold: P3_CPU_WATCH, failThreshold: P3_CPU_FAIL }
      ));
    } else {
      checks.push(check(
        'mincut-cpu',
        'PASS',
        `P3 isolated scheduler CPU stayed at or below ${P3_CPU_WATCH} CPU.`,
        { samples: cpuSamples, watchThreshold: P3_CPU_WATCH, failThreshold: P3_CPU_FAIL }
      ));
    }
  }

  const stale = [];
  for (const sample of samples) {
    const planTick = finite(sample.defense?.planTick, null);
    if (planTick === null || planTick > sample.tick) {
      stale.push({ tick: sample.tick, planTick, reason: 'INVALID_PLAN_TICK' });
      continue;
    }
    const age = sample.tick - planTick;
    if (age > 1500) stale.push({ tick: sample.tick, planTick, age, reason: 'STALE_PLAN' });
  }
  checks.push(stale.length
    ? check('plan-freshness', 'WATCH', 'P3 defensive artifact was older than its intended freshness horizon.', { warnings: stale })
    : samples.length
      ? check('plan-freshness', 'PASS', 'P3 defensive artifact remained within its freshness horizon.')
      : check('plan-freshness', complete ? 'FAIL' : 'WATCH', 'No P3 freshness evidence is available yet.'));

  const latest = samples.at(-1) || null;
  return {
    mode: 'p3-shadow',
    roomName,
    startTick,
    endTick,
    tickCount,
    evidenceMaxTick,
    complete,
    latestTick: latest?.tick ?? null,
    latestDefense: latest?.defense || null,
    latestPlanner: latest?.planner || null,
    latestScheduler: latest?.scheduler || null,
    ...summarize(checks)
  };
}
