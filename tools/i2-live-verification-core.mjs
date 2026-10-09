const RANK = { PASS: 0, WATCH: 1, FAIL: 2 };

export const DEFAULT_I2_WINDOW_TICKS = 100;
export const I2_CPU_WATCH = 5;
export const I2_CPU_FAIL = 10;

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

function roiSnapshot(event, roomName) {
  return roomSnapshot(event, roomName)?.remoteRoi || null;
}

function schedulerSnapshot(event) {
  return event?.ctx?.scheduler?.processes?.['remote-roi-shadow'] || null;
}

function validScore(value) {
  const n = finite(value, null);
  return n !== null && n >= 0 && n <= 100;
}

function validateCandidate(candidate, assumptions) {
  const failures = [];
  if (!candidate || !candidate.roomName) return ['missing-room'];
  const status = candidate.status;
  const state = candidate.recommendedState;
  const score = finite(candidate.score, null);
  const net = finite(candidate.netEnergyPerTick, null);
  const routeHops = finite(candidate.routeHops, null);
  const sourceCount = finite(candidate.sourceCount, null);
  const gross = finite(candidate.grossIncomePerTick, null);
  const cost = finite(candidate.totalCostPerTick, null);
  const confidence = finite(candidate.confidence, null);
  const maxRouteHops = finite(assumptions?.maxRouteHops, null);

  if (status !== 'READY' && status !== 'UNAVAILABLE') failures.push('status');
  if (!['CANDIDATE', 'SUSPENDED', 'THREATENED'].includes(state)) failures.push('recommended-state');
  if (!validScore(score)) failures.push('score');
  if (typeof candidate.economicallyViable !== 'boolean') failures.push('economically-viable');
  if (typeof candidate.capacityBudgetEligible !== 'boolean') failures.push('capacity-budget');

  if (status === 'READY') {
    if (net === null) failures.push('net-energy');
    if (routeHops === null || routeHops < 0 || (maxRouteHops !== null && routeHops > maxRouteHops)) failures.push('route-hops');
    if (sourceCount === null || sourceCount < 1) failures.push('source-count');
    if (gross === null || gross <= 0) failures.push('gross-income');
    if (cost === null || cost < 0) failures.push('cost');
    if (confidence === null || confidence < 0 || confidence > 1) failures.push('confidence');
  }

  if (status === 'UNAVAILABLE' && candidate.reason === null) failures.push('unavailable-reason');
  if (state === 'CANDIDATE' && (!candidate.economicallyViable || !candidate.capacityBudgetEligible)) {
    failures.push('candidate-without-positive-budgeted-roi');
  }

  return failures;
}

export function evaluateI2Shadow(input = {}) {
  const events = Array.isArray(input.events) ? input.events : [];
  const roomName = String(input.roomName || 'E8N1').toUpperCase();
  const startTick = Number(input.startTick);
  const tickCount = Number.isInteger(input.tickCount) && input.tickCount > 0
    ? input.tickCount
    : DEFAULT_I2_WINDOW_TICKS;

  if (!Number.isInteger(startTick) || startTick < 0) throw new Error('startTick must be a non-negative integer');

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
      roi: roiSnapshot(event, roomName),
      scheduler: schedulerSnapshot(event)
    }))
    .filter(sample => sample.roi)
    .sort((a, b) => a.tick - b.tick);

  const checks = [];

  if (!samples.length) {
    checks.push(check(
      'roi-evidence',
      complete ? 'FAIL' : 'WATCH',
      complete
        ? `No I2 remoteRoi STATUS_SNAPSHOT evidence was found for ${roomName}.`
        : `No I2 remoteRoi sample has arrived yet for ${roomName}.`
    ));
  } else {
    checks.push(check(
      'roi-evidence',
      'PASS',
      `Observed ${samples.length} I2 remoteRoi STATUS_SNAPSHOT sample(s) for ${roomName}.`,
      { ticks: samples.map(sample => sample.tick) }
    ));
  }

  const authorityFailures = samples.filter(sample =>
    sample.roi?.authority !== 'SHADOW' ||
    sample.roi?.activationAuthority !== 'NONE' ||
    sample.roi?.remoteMiningEnabled !== false
  );
  if (authorityFailures.length) {
    checks.push(check(
      'shadow-authority',
      'FAIL',
      'I2 authority or remote-mining safety contract changed unexpectedly.',
      {
        samples: authorityFailures.map(sample => ({
          tick: sample.tick,
          authority: sample.roi?.authority,
          activationAuthority: sample.roi?.activationAuthority,
          remoteMiningEnabled: sample.roi?.remoteMiningEnabled
        }))
      }
    ));
  } else if (samples.length) {
    checks.push(check(
      'shadow-authority',
      'PASS',
      'I2 remained SHADOW with activation authority NONE and remote mining disabled.'
    ));
  } else {
    checks.push(check('shadow-authority', complete ? 'FAIL' : 'WATCH', 'No I2 authority evidence is available yet.'));
  }

  const statusFailures = samples.filter(sample => sample.roi?.status !== 'READY');
  checks.push(statusFailures.length
    ? check('roi-ready', 'FAIL', 'I2 did not remain READY in every observed sample.', {
        samples: statusFailures.map(sample => ({ tick: sample.tick, status: sample.roi?.status, reason: sample.roi?.reason }))
      })
    : samples.length
      ? check('roi-ready', 'PASS', 'I2 produced a READY remote ROI artifact.')
      : check('roi-ready', complete ? 'FAIL' : 'WATCH', 'No I2 status evidence is available yet.'));

  const contractFailures = [];
  for (const sample of samples) {
    const roi = sample.roi || {};
    const candidateCount = finite(roi.candidateCount, null);
    const readyCount = finite(roi.readyCount, null);
    const viableCount = finite(roi.viableCount, null);
    const recommendedCount = finite(roi.recommendedCandidateCount, null);
    const top = Array.isArray(roi.topCandidates) ? roi.topCandidates : [];
    const assumptions = roi.assumptions || {};

    if (candidateCount === null || candidateCount < 0 ||
        readyCount === null || readyCount < 0 || readyCount > candidateCount ||
        viableCount === null || viableCount < 0 || viableCount > readyCount ||
        recommendedCount === null || recommendedCount < 0 || recommendedCount > viableCount) {
      contractFailures.push({ tick: sample.tick, reason: 'count-order', candidateCount, readyCount, viableCount, recommendedCount });
    }

    if (top.length > 8 || (candidateCount !== null && top.length > candidateCount)) {
      contractFailures.push({ tick: sample.tick, reason: 'top-candidate-bound', top: top.length, candidateCount });
    }

    const names = top.map(item => item?.roomName).filter(Boolean);
    if (new Set(names).size !== names.length) {
      contractFailures.push({ tick: sample.tick, reason: 'duplicate-candidate', names });
    }

    for (const candidate of top) {
      const failures = validateCandidate(candidate, assumptions);
      if (failures.length) contractFailures.push({ tick: sample.tick, roomName: candidate?.roomName, failures, candidate });
    }

    if (roi.bestCandidate) {
      const failures = validateCandidate(roi.bestCandidate, assumptions);
      if (failures.length) contractFailures.push({ tick: sample.tick, reason: 'best-candidate', failures, candidate: roi.bestCandidate });
    }
  }

  checks.push(contractFailures.length
    ? check('roi-contract', 'FAIL', 'I2 live telemetry violated ROI/count/candidate contracts.', { failures: contractFailures.slice(0, 20) })
    : samples.length
      ? check('roi-contract', 'PASS', 'I2 ROI counts and candidate telemetry remained within contract bounds.')
      : check('roi-contract', complete ? 'FAIL' : 'WATCH', 'No I2 contract evidence is available yet.'));

  const activationFailures = [];
  for (const sample of samples) {
    const candidates = [
      ...(Array.isArray(sample.roi?.topCandidates) ? sample.roi.topCandidates : []),
      ...(sample.roi?.bestCandidate ? [sample.roi.bestCandidate] : [])
    ];
    for (const candidate of candidates) {
      if (candidate?.recommendedState === 'ACTIVE') {
        activationFailures.push({ tick: sample.tick, roomName: candidate.roomName });
      }
    }
  }
  checks.push(activationFailures.length
    ? check('no-activation', 'FAIL', 'I2 emitted ACTIVE remote state despite SHADOW-only authority.', { failures: activationFailures })
    : samples.length
      ? check('no-activation', 'PASS', 'I2 emitted no ACTIVE remote state; recommendations remained evidence-only.')
      : check('no-activation', complete ? 'FAIL' : 'WATCH', 'No I2 activation evidence is available yet.'));

  const candidateSamples = samples.filter(sample => finite(sample.roi?.candidateCount, 0) > 0);
  checks.push(candidateSamples.length
    ? check('candidate-observation', 'PASS', 'At least one live I2 candidate was observed.', {
        samples: candidateSamples.map(sample => ({ tick: sample.tick, candidateCount: sample.roi.candidateCount }))
      })
    : check(
        'candidate-observation',
        'WATCH',
        complete
          ? 'I2 stayed safe but no known remote candidate was available in this window.'
          : 'The I2 window is incomplete and no remote candidate has been observed yet.'
      ));

  const schedulerSamples = samples.filter(sample => sample.scheduler);
  // Cached I2 ROI and lastCpu can predate the deployment despite being
  // serialized into a new-version STATUS_SNAPSHOT. Match run to artifact.
  const releaseRuns = schedulerSamples.filter(sample => {
    const runTick = sample.scheduler?.lastRunTick;
    return Number.isInteger(runTick) && runTick >= startTick && runTick <= sample.tick &&
      sample.roi?.evaluatedTick === runTick;
  });
  if (!schedulerSamples.length) {
    checks.push(check(
      'scheduler-isolation',
      complete ? 'FAIL' : 'WATCH',
      'No remote-roi-shadow scheduler state was present in STATUS_SNAPSHOT telemetry.'
    ));
  } else if (!schedulerSamples.some(sample => finite(sample.scheduler?.runCount, 0) > 0)) {
    checks.push(check(
      'scheduler-isolation',
      'FAIL',
      'remote-roi-shadow never ran according to scheduler telemetry.',
      { schedulerSamples }
    ));
  } else if (!releaseRuns.length) {
    checks.push(check(
      'scheduler-isolation',
      'WATCH',
      'I2 scheduler data exists, but no matching ROI evaluation/execution belongs to this verification window.',
      { latest: schedulerSamples.at(-1).scheduler }
    ));
  } else {
    checks.push(check(
      'scheduler-isolation',
      'PASS',
      'remote-roi-shadow is tracked as an independent scheduler process.',
      { latest: releaseRuns.at(-1).scheduler }
    ));
  }

  const cpuSamples = releaseRuns
    .map(sample => ({ tick: sample.tick, runTick: sample.scheduler.lastRunTick,
      cpu: finite(sample.scheduler?.lastCpu, null) }))
    .filter(sample => sample.cpu !== null);
  if (!cpuSamples.length) {
    checks.push(check(
      'roi-cpu',
      'WATCH',
      'No I2 CPU reading from this verification window; cached pre-window lastCpu is excluded.',
      { latest: schedulerSamples.at(-1)?.scheduler || null }
    ));
  } else {
    const worst = cpuSamples.reduce((a, b) => b.cpu > a.cpu ? b : a);
    if (worst.cpu > I2_CPU_FAIL) {
      checks.push(check(
        'roi-cpu',
        'FAIL',
        `I2 isolated scheduler CPU exceeded the hard ${I2_CPU_FAIL} CPU diagnostic threshold: ${worst.cpu}.`,
        { samples: cpuSamples, watchThreshold: I2_CPU_WATCH, failThreshold: I2_CPU_FAIL }
      ));
    } else if (worst.cpu > I2_CPU_WATCH) {
      checks.push(check(
        'roi-cpu',
        'WATCH',
        `I2 isolated scheduler CPU is high but below the hard threshold: ${worst.cpu}.`,
        { samples: cpuSamples, watchThreshold: I2_CPU_WATCH, failThreshold: I2_CPU_FAIL }
      ));
    } else {
      checks.push(check(
        'roi-cpu',
        'PASS',
        `I2 isolated scheduler CPU stayed at or below ${I2_CPU_WATCH} CPU.`,
        { samples: cpuSamples, watchThreshold: I2_CPU_WATCH, failThreshold: I2_CPU_FAIL }
      ));
    }
  }

  const stale = [];
  for (const sample of samples) {
    const evaluatedTick = finite(sample.roi?.evaluatedTick, null);
    if (evaluatedTick === null || evaluatedTick > sample.tick) {
      stale.push({ tick: sample.tick, evaluatedTick, reason: 'INVALID_EVALUATED_TICK' });
      continue;
    }
    const age = sample.tick - evaluatedTick;
    if (age > 1000) stale.push({ tick: sample.tick, evaluatedTick, age, reason: 'STALE_ROI' });
  }
  checks.push(stale.length
    ? check('roi-freshness', 'WATCH', 'I2 remote ROI artifact exceeded its intended freshness horizon.', { warnings: stale })
    : samples.length
      ? check('roi-freshness', 'PASS', 'I2 remote ROI artifact remained within its freshness horizon.')
      : check('roi-freshness', complete ? 'FAIL' : 'WATCH', 'No I2 freshness evidence is available yet.'));

  const latest = samples.at(-1) || null;
  return {
    mode: 'i2-shadow',
    roomName,
    startTick,
    endTick,
    tickCount,
    evidenceMaxTick,
    complete,
    latestTick: latest?.tick ?? null,
    latestRoi: latest?.roi || null,
    latestScheduler: latest?.scheduler || null,
    ...summarize(checks)
  };
}
