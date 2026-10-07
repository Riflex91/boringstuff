const RANK = { PASS: 0, WATCH: 1, FAIL: 2 };

export const DEFAULT_P2_WINDOW_TICKS = 100;
export const DEFAULT_P2_MAX_ANCHORS = 6;
export const DEFAULT_P2_PATH_BUDGET = 24;

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

function plannerSnapshot(event, roomName) {
  const room = roomSnapshot(event, roomName);
  return room?.plannerVNext || null;
}

function schedulerSnapshot(event) {
  return event?.ctx?.scheduler?.processes?.['planner-vnext-shadow'] || null;
}

export function evaluateP2Shadow(input = {}) {
  const events = Array.isArray(input.events) ? input.events : [];
  const roomName = String(input.roomName || 'E8N1').toUpperCase();
  const startTick = Number(input.startTick);
  const tickCount = Number.isInteger(input.tickCount) && input.tickCount > 0
    ? input.tickCount
    : DEFAULT_P2_WINDOW_TICKS;
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
      planner: plannerSnapshot(event, roomName),
      scheduler: schedulerSnapshot(event)
    }))
    .filter(sample => sample.planner)
    .sort((a, b) => a.tick - b.tick);

  const checks = [];
  if (!samples.length) {
    checks.push(check(
      'planner-evidence',
      complete ? 'FAIL' : 'WATCH',
      complete
        ? `No P2 plannerVNext STATUS_SNAPSHOT evidence was found for ${roomName}.`
        : `No P2 plannerVNext sample has arrived yet for ${roomName}.`
    ));
  } else {
    checks.push(check(
      'planner-evidence',
      'PASS',
      `Observed ${samples.length} P2 plannerVNext STATUS_SNAPSHOT sample(s) for ${roomName}.`,
      { ticks: samples.map(sample => sample.tick) }
    ));
  }

  const badAuthority = samples.filter(sample =>
    sample.planner?.authority !== 'SHADOW' ||
    sample.planner?.legacyPlannerAuthority !== 'UNCHANGED'
  );
  if (badAuthority.length) {
    checks.push(check(
      'shadow-authority',
      'FAIL',
      'P2 authority or legacy planner authority changed unexpectedly.',
      { samples: badAuthority.map(sample => ({ tick: sample.tick, authority: sample.planner?.authority, legacyPlannerAuthority: sample.planner?.legacyPlannerAuthority })) }
    ));
  } else if (samples.length) {
    checks.push(check(
      'shadow-authority',
      'PASS',
      'P2 remained SHADOW and legacy planner authority remained unchanged.'
    ));
  } else {
    checks.push(check('shadow-authority', complete ? 'FAIL' : 'WATCH', 'No P2 authority evidence is available yet.'));
  }

  const nonReady = samples.filter(sample => sample.planner?.status !== 'READY');
  if (nonReady.length) {
    checks.push(check(
      'plan-ready',
      'FAIL',
      'P2 did not produce a valid READY shadow plan in every observed sample.',
      { samples: nonReady.map(sample => ({ tick: sample.tick, status: sample.planner?.status })) }
    ));
  } else if (samples.length) {
    checks.push(check('plan-ready', 'PASS', 'P2 produced a READY shadow plan.'));
  } else {
    checks.push(check('plan-ready', complete ? 'FAIL' : 'WATCH', 'No P2 plan status is available yet.'));
  }

  const boundFailures = [];
  for (const sample of samples) {
    const plan = sample.planner;
    const candidateAnchorCount = finite(plan?.candidateAnchorCount, null);
    const evaluatedCandidateCount = finite(plan?.evaluatedCandidateCount, null);
    const pathSearchBudget = finite(plan?.pathSearchBudget, null);
    const pathSearches = finite(plan?.pathSearches, null);
    const selected = plan?.selected;
    const feasibility = selected?.feasibility || {};
    const routes = selected?.routes || {};
    const components = selected?.components || {};

    if (candidateAnchorCount === null || candidateAnchorCount < 1 || candidateAnchorCount > DEFAULT_P2_MAX_ANCHORS) {
      boundFailures.push({ tick: sample.tick, reason: 'candidateAnchorCount', candidateAnchorCount });
    }
    if (evaluatedCandidateCount === null || candidateAnchorCount === null || evaluatedCandidateCount !== candidateAnchorCount * 2) {
      boundFailures.push({ tick: sample.tick, reason: 'evaluatedCandidateCount', evaluatedCandidateCount, candidateAnchorCount });
    }
    if (pathSearchBudget === null || pathSearchBudget < 0 || pathSearchBudget > DEFAULT_P2_PATH_BUDGET ||
        pathSearches === null || pathSearches < 0 || pathSearches > pathSearchBudget) {
      boundFailures.push({ tick: sample.tick, reason: 'path-budget', pathSearchBudget, pathSearches });
    }
    if (!selected || selected.valid !== true) {
      boundFailures.push({ tick: sample.tick, reason: 'selected-invalid', selected });
      continue;
    }
    const score = finite(selected.score, null);
    const extensionRatio = finite(feasibility.extensionRatio, null);
    const ratio = finite(feasibility.ratio, null);
    const criticalBlocked = finite(feasibility.criticalBlocked, null);
    if (score === null || score < 0 || score > 100 ||
        extensionRatio === null || extensionRatio < 0.5 || extensionRatio > 1 ||
        ratio === null || ratio <= 0 || ratio > 1 ||
        criticalBlocked !== 0) {
      boundFailures.push({ tick: sample.tick, reason: 'selected-feasibility', score, extensionRatio, ratio, criticalBlocked });
    }
    for (const [name, value] of Object.entries(components)) {
      const n = finite(value, null);
      if (n === null || n < 0 || n > 100) {
        boundFailures.push({ tick: sample.tick, reason: 'component', name, value });
      }
    }
    const exact = finite(routes.exactRouteCount, 0);
    const fallback = finite(routes.fallbackRouteCount, 0);
    if (exact + fallback <= 0) {
      boundFailures.push({ tick: sample.tick, reason: 'route-evidence', routes });
    }
  }

  checks.push(boundFailures.length
    ? check('plan-contract', 'FAIL', 'P2 live telemetry violated planner bounds or feasibility contracts.', { failures: boundFailures.slice(0, 20) })
    : samples.length
      ? check('plan-contract', 'PASS', 'P2 candidate, path-budget, score and feasibility contracts remained valid.')
      : check('plan-contract', complete ? 'FAIL' : 'WATCH', 'No P2 contract evidence is available yet.'));

  const exactRouteSamples = samples.filter(sample => finite(sample.planner?.selected?.routes?.exactRouteCount, 0) > 0);
  if (exactRouteSamples.length) {
    checks.push(check(
      'p1-route-evidence',
      'PASS',
      'P2 used exact P1-backed in-room route evidence in live planning.',
      { ticks: exactRouteSamples.map(sample => sample.tick) }
    ));
  } else if (samples.length) {
    checks.push(check(
      'p1-route-evidence',
      'WATCH',
      'P2 produced a plan using only geometric fallback route costs in this window.',
      { samples: samples.map(sample => ({ tick: sample.tick, routes: sample.planner?.selected?.routes })) }
    ));
  } else {
    checks.push(check('p1-route-evidence', complete ? 'FAIL' : 'WATCH', 'No P1/P2 route evidence is available yet.'));
  }

  const schedulerSamples = samples.filter(sample => sample.scheduler);
  const ran = schedulerSamples.filter(sample => finite(sample.scheduler?.runCount, 0) > 0);
  if (!schedulerSamples.length) {
    checks.push(check(
      'scheduler-isolation',
      complete ? 'FAIL' : 'WATCH',
      'No planner-vnext-shadow scheduler state was present in STATUS_SNAPSHOT telemetry.'
    ));
  } else if (!ran.length) {
    checks.push(check('scheduler-isolation', 'FAIL', 'planner-vnext-shadow never ran according to scheduler telemetry.', { schedulerSamples }));
  } else {
    checks.push(check(
      'scheduler-isolation',
      'PASS',
      'planner-vnext-shadow is tracked as an independent scheduler process.',
      {
        latest: ran.at(-1).scheduler
      }
    ));
  }

  const freshnessWarnings = [];
  for (const sample of samples) {
    const planTick = finite(sample.planner?.planTick, null);
    if (planTick === null || planTick > sample.tick) {
      freshnessWarnings.push({ tick: sample.tick, planTick, reason: 'INVALID_PLAN_TICK' });
      continue;
    }
    const age = sample.tick - planTick;
    if (age > 500) freshnessWarnings.push({ tick: sample.tick, planTick, age, reason: 'STALE_PLAN' });
  }
  checks.push(freshnessWarnings.length
    ? check('plan-freshness', 'WATCH', 'P2 shadow plan telemetry was older than the preferred live-observation age.', { warnings: freshnessWarnings })
    : samples.length
      ? check('plan-freshness', 'PASS', 'P2 shadow plan telemetry remained fresh enough for live observation.')
      : check('plan-freshness', complete ? 'FAIL' : 'WATCH', 'No P2 freshness evidence is available yet.'));

  const latest = samples.at(-1) || null;
  return {
    mode: 'p2-shadow',
    roomName,
    startTick,
    endTick,
    tickCount,
    evidenceMaxTick,
    complete,
    latestTick: latest?.tick ?? null,
    latestPlanner: latest?.planner || null,
    latestScheduler: latest?.scheduler || null,
    ...summarize(checks)
  };
}
