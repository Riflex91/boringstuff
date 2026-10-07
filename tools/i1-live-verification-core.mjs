const RANK = { PASS: 0, WATCH: 1, FAIL: 2 };

export const DEFAULT_I1_WINDOW_TICKS = 100;
export const DEFAULT_I1_MAX_REQUESTS = 6;

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

function roomHeartbeat(event, roomName) {
  if (!event || event.code !== 'ROOM_HEARTBEAT') return null;
  if (String(event.ctx?.room || '').toUpperCase() !== String(roomName || '').toUpperCase()) return null;
  return event.ctx || null;
}

function targetNames(frontier) {
  const rows = Array.isArray(frontier?.topRequests) ? frontier.topRequests : [];
  return rows.map(item => String(item?.roomName || '')).filter(Boolean);
}

function nonScoutingDomainSignature(requests) {
  const byDomain = requests?.byDomain || {};
  return Object.keys(byDomain)
    .filter(key => key !== 'scouting')
    .sort()
    .map(key => key + ':' + String(finite(byDomain[key], 0)))
    .join('|');
}

function assignmentShape(sample) {
  return {
    requestCount: finite(sample?.assignments?.requestCount, null),
    unfilledCount: finite(sample?.assignments?.unfilledCount, null),
    totalUnfilled: finite(sample?.assignments?.totalUnfilled, null)
  };
}

export function evaluateI1Shadow(input = {}) {
  const events = Array.isArray(input.events) ? input.events : [];
  const roomName = String(input.roomName || 'E8N1').toUpperCase();
  const startTick = Number(input.startTick);
  const tickCount = Number.isInteger(input.tickCount) && input.tickCount > 0
    ? input.tickCount
    : DEFAULT_I1_WINDOW_TICKS;
  const maxRequests = Number.isInteger(input.maxRequests) && input.maxRequests > 0
    ? input.maxRequests
    : DEFAULT_I1_MAX_REQUESTS;

  if (!Number.isInteger(startTick) || startTick < 0) {
    throw new Error('startTick must be a non-negative integer');
  }

  const endTick = startTick + tickCount - 1;
  const evidenceMaxTick = Math.max(-1, ...events.map(event => finite(event?.tick, -1)));
  const complete = evidenceMaxTick >= endTick;
  const samples = events
    .filter(event => {
      const tick = finite(event?.tick, null);
      return tick !== null && tick >= startTick && tick <= endTick;
    })
    .map(event => ({ tick: finite(event.tick, 0), ctx: roomHeartbeat(event, roomName) }))
    .filter(sample => sample.ctx)
    .sort((a, b) => a.tick - b.tick);

  const checks = [];
  const expectedSamples = Math.max(1, Math.floor((tickCount - 1) / 25) + 1);
  if (!samples.length) {
    checks.push(check(
      'heartbeat-evidence',
      complete ? 'FAIL' : 'WATCH',
      complete
        ? `No ROOM_HEARTBEAT evidence was found for ${roomName} in the complete I1 window.`
        : `No ROOM_HEARTBEAT evidence has arrived yet for ${roomName}.`
    ));
  } else if (complete && samples.length < Math.min(3, expectedSamples)) {
    checks.push(check(
      'heartbeat-evidence',
      'WATCH',
      'The I1 window is complete but contains fewer heartbeat samples than expected.',
      { samples: samples.length, expectedSamples }
    ));
  } else {
    checks.push(check(
      'heartbeat-evidence',
      'PASS',
      `Observed ${samples.length} ROOM_HEARTBEAT I1 samples for ${roomName}.`,
      { samples: samples.length, expectedSamples }
    ));
  }

  const missingFrontier = samples.filter(sample => !sample.ctx?.scoutingFrontier);
  const badAuthority = samples.filter(sample =>
    sample.ctx?.scoutingFrontier &&
    sample.ctx.scoutingFrontier.authority !== 'SHADOW'
  );
  if (missingFrontier.length) {
    checks.push(check(
      'shadow-authority',
      complete ? 'FAIL' : 'WATCH',
      'scoutingFrontier telemetry is missing from one or more heartbeat samples.',
      { ticks: missingFrontier.map(sample => sample.tick) }
    ));
  } else if (badAuthority.length) {
    checks.push(check(
      'shadow-authority',
      'FAIL',
      'I1 scouting authority was not SHADOW in every observed sample.',
      { samples: badAuthority.map(sample => ({ tick: sample.tick, authority: sample.ctx.scoutingFrontier?.authority })) }
    ));
  } else if (samples.length) {
    checks.push(check(
      'shadow-authority',
      'PASS',
      'I1 remained strictly SHADOW for every observed heartbeat sample.'
    ));
  } else {
    checks.push(check('shadow-authority', complete ? 'FAIL' : 'WATCH', 'No I1 authority sample is available yet.'));
  }

  const boundFailures = [];
  for (const sample of samples) {
    const frontier = sample.ctx?.scoutingFrontier;
    if (!frontier) continue;
    const requestCount = finite(frontier.requestCount, null);
    const maxDepth = finite(frontier.maxDepth, null);
    const top = Array.isArray(frontier.topRequests) ? frontier.topRequests : [];
    const names = targetNames(frontier);
    const uniqueNames = new Set(names);

    if (requestCount === null || requestCount < 0 || requestCount > maxRequests) {
      boundFailures.push({ tick: sample.tick, reason: 'requestCount', requestCount, maxRequests });
    }
    if (maxDepth === null || maxDepth < 1 || maxDepth > 6) {
      boundFailures.push({ tick: sample.tick, reason: 'maxDepth', maxDepth });
    }
    if (requestCount !== null && top.length > requestCount) {
      boundFailures.push({ tick: sample.tick, reason: 'topRequests>requestCount', top: top.length, requestCount });
    }
    if (top.length > maxRequests || uniqueNames.size !== names.length) {
      boundFailures.push({ tick: sample.tick, reason: 'topRequests-bounds-or-duplicate', names });
    }

    for (const item of top) {
      const depth = finite(item?.depth, null);
      const score = finite(item?.score, null);
      const urgency = finite(item?.urgency, null);
      if (!item?.roomName || String(item.roomName).toUpperCase() === roomName ||
          depth === null || maxDepth === null || depth < 1 || depth > maxDepth ||
          score === null || score < 1 || score > 100 ||
          urgency === null || urgency < 0 || urgency > 100) {
        boundFailures.push({ tick: sample.tick, reason: 'invalid-top-request', item, maxDepth });
      }
    }
  }

  checks.push(boundFailures.length
    ? check('frontier-bounds', 'FAIL', 'Observed I1 frontier telemetry violated bounded-request/depth contracts.', { failures: boundFailures.slice(0, 20) })
    : samples.length
      ? check('frontier-bounds', 'PASS', 'Observed I1 frontier request count, depth and top-request telemetry stayed within contract bounds.')
      : check('frontier-bounds', complete ? 'FAIL' : 'WATCH', 'No frontier-bound evidence is available yet.'));

  const registryMismatches = [];
  for (const sample of samples) {
    if (!sample.ctx?.scoutingFrontier || !sample.ctx?.requests) continue;
    const frontierCount = finite(sample.ctx.scoutingFrontier.requestCount, null);
    const registryCount = finite(sample.ctx.requests?.byDomain?.scouting, 0);
    if (frontierCount !== null && frontierCount !== registryCount) {
      registryMismatches.push({ tick: sample.tick, frontierCount, registryCount });
    }
  }
  checks.push(registryMismatches.length
    ? check('registry-sync', 'FAIL', 'I1 frontier request count disagreed with the E0 scouting-domain registry count.', { mismatches: registryMismatches })
    : samples.length
      ? check('registry-sync', 'PASS', 'I1 frontier demand stayed synchronized with the E0 scouting-domain registry.')
      : check('registry-sync', complete ? 'FAIL' : 'WATCH', 'No E0/I1 registry synchronization evidence is available yet.'));

  let closure = null;
  for (let i = 1; i < samples.length && !closure; i++) {
    const before = samples[i - 1];
    const after = samples[i];
    const beforeFrontier = before.ctx?.scoutingFrontier;
    const afterFrontier = after.ctx?.scoutingFrontier;
    if (!beforeFrontier || !afterFrontier) continue;
    const beforeNames = new Set(targetNames(beforeFrontier));
    const afterNames = new Set(targetNames(afterFrontier));
    const disappeared = [...beforeNames].filter(name => !afterNames.has(name));
    const beforeCount = finite(beforeFrontier.requestCount, 0);
    const afterCount = finite(afterFrontier.requestCount, 0);
    if (afterCount < beforeCount || disappeared.length) {
      closure = {
        fromTick: before.tick,
        toTick: after.tick,
        beforeCount,
        afterCount,
        disappeared
      };
    }
  }
  checks.push(closure
    ? check('request-reconciliation', 'PASS', 'Observed live I1 request reconciliation/closure between heartbeat samples.', closure)
    : check(
        'request-reconciliation',
        'WATCH',
        complete
          ? 'No I1 request closure transition occurred in this window. Static tests cover fresh-intel closure; a live transition was not observed.'
          : 'The I1 window is incomplete; no request closure transition has been observed yet.'
      ));

  const isolationCandidates = [];
  const isolationMismatches = [];
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1];
    const after = samples[i];
    const beforeScout = finite(before.ctx?.scoutingFrontier?.requestCount, null);
    const afterScout = finite(after.ctx?.scoutingFrontier?.requestCount, null);
    if (beforeScout === null || afterScout === null || beforeScout === afterScout) continue;

    const beforeSignature = nonScoutingDomainSignature(before.ctx?.requests);
    const afterSignature = nonScoutingDomainSignature(after.ctx?.requests);
    if (beforeSignature !== afterSignature) continue;

    const beforeAssignment = assignmentShape(before.ctx);
    const afterAssignment = assignmentShape(after.ctx);
    if (beforeAssignment.requestCount === null || afterAssignment.requestCount === null ||
        beforeAssignment.unfilledCount === null || afterAssignment.unfilledCount === null) continue;

    const candidate = {
      fromTick: before.tick,
      toTick: after.tick,
      scoutRequests: [beforeScout, afterScout],
      nonScoutingDomains: beforeSignature,
      assignmentsBefore: beforeAssignment,
      assignmentsAfter: afterAssignment
    };
    isolationCandidates.push(candidate);

    if (beforeAssignment.requestCount !== afterAssignment.requestCount ||
        beforeAssignment.unfilledCount !== afterAssignment.unfilledCount ||
        beforeAssignment.totalUnfilled !== afterAssignment.totalUnfilled) {
      isolationMismatches.push(candidate);
    }
  }

  if (isolationMismatches.length) {
    checks.push(check(
      'e1-isolation',
      'WATCH',
      'Scout demand changed while non-scout domain counts were stable, but E1 evidence also changed. This is not sufficient to attribute inflation to I1; inspect the transition.',
      { transitions: isolationMismatches.slice(0, 10) }
    ));
  } else if (isolationCandidates.length) {
    checks.push(check(
      'e1-isolation',
      'PASS',
      'Observed scout-demand changes with stable non-scout domains while E1 request/unfilled evidence remained unchanged.',
      { transitions: isolationCandidates.slice(0, 10) }
    ));
  } else {
    checks.push(check(
      'e1-isolation',
      'WATCH',
      'No live transition isolated a change in scouting demand while non-scout domains stayed stable. Static contract tests still exclude SCOUT_INTEL from E1.'
    ));
  }

  const latest = samples.at(-1) || null;
  const summary = summarize(checks);
  return {
    mode: 'i1-shadow',
    roomName,
    startTick,
    endTick,
    tickCount,
    evidenceMaxTick,
    complete,
    latestTick: latest?.tick ?? null,
    latestFrontier: latest?.ctx?.scoutingFrontier || null,
    latestRequests: latest?.ctx?.requests || null,
    latestAssignments: latest?.ctx?.assignments || null,
    ...summary
  };
}
