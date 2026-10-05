export const EXPECTED_NODE_VERSION = '18.20.4';
export const EXPECTED_BOT_VERSION = '0.3.0-shadow.5-node18';

const RANK = { PASS: 0, WATCH: 1, FAIL: 2 };

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roomFromEvent(event, roomName = 'E8N1') {
  if (!event || typeof event !== 'object') return null;
  if (event.code === 'ROOM_HEARTBEAT') {
    return String(event.ctx?.room || '').toUpperCase() === roomName.toUpperCase() ? event.ctx : null;
  }
  return event.ctx?.rooms?.[roomName] || null;
}

function check(id, status, message, data = {}) {
  return { id, status, message, data };
}

function summarize(checks) {
  let outcome = 'PASS';
  for (const c of checks) if (RANK[c.status] > RANK[outcome]) outcome = c.status;
  return {
    outcome,
    checks,
    counts: {
      pass: checks.filter(c => c.status === 'PASS').length,
      watch: checks.filter(c => c.status === 'WATCH').length,
      fail: checks.filter(c => c.status === 'FAIL').length
    }
  };
}

export function detectJseqGaps(events, droppedThroughSeq = 0) {
  const seqs = [...new Set((events || []).map(e => finite(e?.jseq, 0)).filter(n => n > 0))].sort((a, b) => a - b);
  const dropped = Math.max(0, finite(droppedThroughSeq, 0));
  const gaps = [];
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i] <= seqs[i - 1] + 1) continue;
    const from = seqs[i - 1] + 1;
    const to = seqs[i] - 1;
    gaps.push({ from, to, coveredByRetention: to <= dropped });
  }
  return { seqs, gaps, droppedThroughSeq: dropped };
}

export function selectTickWindow(events, { startTick, tickCount, version = EXPECTED_BOT_VERSION } = {}) {
  if (!Number.isInteger(startTick) || startTick < 0) throw new Error('startTick must be a non-negative integer');
  if (!Number.isInteger(tickCount) || tickCount < 1) throw new Error('tickCount must be a positive integer');
  const endTick = startTick + tickCount - 1;
  const evidenceMaxTick = Math.max(-1, ...(events || []).map(e => finite(e?.tick, -1)));
  const filtered = (events || []).filter(e => {
    const tick = finite(e?.tick, null);
    if (tick === null || tick < startTick || tick > endTick) return false;
    return !version || !e?.v || e.v === version;
  });
  return { startTick, endTick, tickCount, evidenceMaxTick, complete: evidenceMaxTick >= endTick, events: filtered };
}

function baseChecks({ events, startTick, endTick, evidenceMaxTick = -1, complete = false, nodeVersion, botVersion, roomName, rawErrors = [], collectorErrors = [], droppedThroughSeq = 0 }) {
  const checks = [];
  checks.push(nodeVersion === EXPECTED_NODE_VERSION
    ? check('node-version', 'PASS', `Node runtime is ${EXPECTED_NODE_VERSION}.`, { actual: nodeVersion })
    : check('node-version', 'FAIL', `Node runtime must be exactly ${EXPECTED_NODE_VERSION}.`, { actual: nodeVersion, expected: EXPECTED_NODE_VERSION }));

  const wrongVersion = events.filter(e => e?.v && e.v !== botVersion);
  checks.push(wrongVersion.length === 0
    ? check('bot-version', 'PASS', `Window contains only ${botVersion} bot events.`, { botVersion })
    : check('bot-version', 'FAIL', 'Window contains events from another bot version.', { botVersion, wrongVersions: [...new Set(wrongVersion.map(e => e.v))] }));

  checks.push(complete
    ? check('window-complete', 'PASS', `Evidence reaches tick ${endTick}.`, { startTick, endTick })
    : check('window-complete', 'WATCH', `Evidence does not yet reach tick ${endTick}; retry after the window completes.`, { startTick, endTick, maxTick: evidenceMaxTick }));

  const runtimeErrors = events.filter(e => ['ERROR', 'FATAL'].includes(String(e?.level || '').toUpperCase()));
  const raw = (rawErrors || []).filter(Boolean);
  checks.push(runtimeErrors.length === 0 && raw.length === 0
    ? check('runtime-errors', 'PASS', 'No bot/runtime errors were observed in the window.')
    : check('runtime-errors', 'FAIL', 'Bot/runtime error evidence was observed.', { botErrors: runtimeErrors.map(e => ({ tick: e.tick, code: e.code, msg: e.msg })), rawErrors: raw.slice(0, 20) }));

  const collector = (collectorErrors || []).filter(Boolean);
  checks.push(collector.length === 0
    ? check('collector-health', 'PASS', 'No collector errors were observed in the window.')
    : check('collector-health', 'WATCH', 'Collector errors occurred in the window; verify telemetry completeness.', { collectorErrors: collector.slice(0, 20) }));

  const cpu = events.filter(e => e?.code === 'BOT_HEARTBEAT').map(e => ({ tick: e.tick, cpu: finite(e?.ctx?.cpu, null), bucket: finite(e?.ctx?.bucket, null) }));
  const badCpu = cpu.filter(x => x.cpu !== null && x.cpu > 20);
  const criticalBucket = cpu.filter(x => x.bucket !== null && x.bucket < 1000);
  const lowBucket = cpu.filter(x => x.bucket !== null && x.bucket >= 1000 && x.bucket < 3000);
  if (!cpu.length) checks.push(check('cpu-bucket', complete ? 'FAIL' : 'WATCH', complete ? 'No BOT_HEARTBEAT CPU/bucket evidence was found in the complete window.' : 'No BOT_HEARTBEAT sample has arrived yet for the incomplete window.'));
  else if (badCpu.length || criticalBucket.length) checks.push(check('cpu-bucket', 'FAIL', 'CPU or bucket crossed a hard safety threshold.', { badCpu, criticalBucket }));
  else if (lowBucket.length) checks.push(check('cpu-bucket', 'WATCH', 'CPU is acceptable but bucket entered the low range.', { lowBucket }));
  else checks.push(check('cpu-bucket', 'PASS', 'CPU and bucket remained inside safety thresholds.', { samples: cpu.length }));

  const roomEvents = events.map(e => ({ e, room: roomFromEvent(e, roomName) })).filter(x => x.room);
  const mining = roomEvents.map(x => ({ tick: x.e.tick, dedicated: finite(x.room?.economyModel?.dedicatedHarvestCapacityPerTick, null), theoretical: finite(x.room?.economyModel?.theoreticalIncomePerTick, null) })).filter(x => x.dedicated !== null);
  if (!mining.length) checks.push(check('mining-active', complete ? 'FAIL' : 'WATCH', complete ? `No mining-capacity evidence was found for ${roomName} in the complete window.` : `No mining-capacity sample has arrived yet for ${roomName} in the incomplete window.`));
  else if (Math.max(...mining.map(x => x.dedicated)) <= 0) checks.push(check('mining-active', 'FAIL', 'Dedicated mining capacity is zero.', { mining }));
  else checks.push(check('mining-active', 'PASS', 'Dedicated mining is active.', { latest: mining[mining.length - 1] }));

  const hardStall = events.filter(e => /(?:ECONOMY|SPAWN).*(?:HARD_?STALL|STALL)|(?:HARD_?STALL).*(?:ECONOMY|SPAWN)/i.test(String(e?.code || '')) && String(e?.level || '').toUpperCase() !== 'INFO');
  const healthFailures = roomEvents.filter(x => ['CRITICAL', 'FAILED', 'DEAD'].includes(String(x.room?.health?.status || '').toUpperCase()));
  checks.push(!hardStall.length && !healthFailures.length
    ? check('hard-stall', 'PASS', 'No hard spawn/economy stall evidence was observed.')
    : check('hard-stall', 'FAIL', 'Hard spawn/economy stall evidence was observed.', { hardStall: hardStall.map(e => ({ tick: e.tick, code: e.code })), healthFailures: healthFailures.map(x => ({ tick: x.e.tick, status: x.room?.health?.status })) }));

  const retention = events.filter(e => e?.code === 'TELEMETRY_RETENTION_GAP').map(e => finite(e?.ctx?.droppedThroughSeq, 0));
  const continuity = detectJseqGaps(events, Math.max(droppedThroughSeq, ...retention, 0));
  const hardGaps = continuity.gaps.filter(g => !g.coveredByRetention);
  const retentionGaps = continuity.gaps.filter(g => g.coveredByRetention);
  if (hardGaps.length) checks.push(check('telemetry-continuity', 'FAIL', 'Durable telemetry has an unexplained internal jseq gap.', { hardGaps, droppedThroughSeq: continuity.droppedThroughSeq }));
  else if (retentionGaps.length || retention.length) checks.push(check('telemetry-continuity', 'WATCH', 'Telemetry continuity is valid for current data, but a retention gap was reported.', { retentionGaps, droppedThroughSeq: continuity.droppedThroughSeq }));
  else if (continuity.seqs.length) checks.push(check('telemetry-continuity', 'PASS', 'Durable telemetry jseq values are contiguous.', { first: continuity.seqs[0], last: continuity.seqs.at(-1), count: continuity.seqs.length }));
  else checks.push(check('telemetry-continuity', 'WATCH', 'No durable jseq samples occurred inside this short window.'));

  return checks;
}

export function evaluateSmoke(input) {
  const tickCount = 25;
  const selected = selectTickWindow(input.events, { startTick: input.startTick, tickCount, version: null });
  const checks = baseChecks({ ...input, ...selected, endTick: selected.endTick, botVersion: input.botVersion || EXPECTED_BOT_VERSION, roomName: input.roomName || 'E8N1' });
  return { mode: 'smoke', ...selected, ...summarize(checks) };
}

export function evaluateLive(input) {
  const tickCount = 100;
  const selected = selectTickWindow(input.events, { startTick: input.startTick, tickCount, version: null });
  const roomName = input.roomName || 'E8N1';
  const checks = baseChecks({ ...input, ...selected, endTick: selected.endTick, botVersion: input.botVersion || EXPECTED_BOT_VERSION, roomName });
  const roomEvents = selected.events.map(e => ({ e, room: roomFromEvent(e, roomName) })).filter(x => x.room);
  const snapshots = roomEvents.filter(x => x.e.code === 'STATUS_SNAPSHOT');
  const latest = snapshots.at(-1)?.room || roomEvents.at(-1)?.room || null;
  const model = latest?.economyModel || {};
  const eco = latest?.economy || {};
  const eff = latest?.efficiency || {};
  const last100 = eco?.last100 || {};
  const last100StartTick = finite(last100?.startTick, null);
  const last100EndTick = finite(last100?.endTick, null);
  const last100Ticks = finite(last100?.ticks, null);
  const last100MatchesWindow =
    last100StartTick === selected.startTick &&
    last100EndTick === selected.endTick &&
    last100Ticks !== null &&
    last100Ticks >= 100;
  const windowLast100 = last100MatchesWindow ? last100 : null;
  const attribution = windowLast100?.productiveFlow || null;
  const observedCompletedWindow =
    last100StartTick !== null &&
    last100EndTick !== null &&
    last100Ticks !== null &&
    last100Ticks >= 100;
  const attributionFields = {
    consumerTicks: finite(attribution?.consumerTicks, null),
    waitingConsumerTicks: finite(attribution?.waitingConsumerTicks, null),
    criticalConsumerTicks: finite(attribution?.criticalConsumerTicks, null),
    fallbackConsumerTicks: finite(attribution?.fallbackConsumerTicks, null),
    averageConstructionCapacityPerTick: finite(attribution?.averageConstructionCapacityPerTick, null),
    averageDedicatedControllerCapacityPerTick: finite(attribution?.averageDedicatedControllerCapacityPerTick, null),
    actualProductiveThroughputPerTick: finite(attribution?.actualProductiveThroughputPerTick, null)
  };
  const missingAttribution = Object.entries(attributionFields).filter(([, value]) => value === null).map(([key]) => key);

  if (!last100MatchesWindow && observedCompletedWindow) {
    checks.push(check(
      'productive-attribution',
      'WATCH',
      'A complete productive-flow window exists, but its fixed runtime cadence does not align exactly with the requested live-verification window.',
      {
        requestedWindow: { startTick: selected.startTick, endTick: selected.endTick },
        observedLast100: { startTick: last100StartTick, endTick: last100EndTick, ticks: last100Ticks }
      }
    ));
  } else if (!attribution || missingAttribution.length) {
    checks.push(check(
      'productive-attribution',
      selected.complete ? 'FAIL' : 'WATCH',
      selected.complete
        ? `Productive-flow attribution is missing or incomplete: ${missingAttribution.join(', ') || 'payload'}.`
        : 'Productive-flow attribution is not complete yet.',
      {
        missing: missingAttribution,
        attribution,
        requestedWindow: { startTick: selected.startTick, endTick: selected.endTick },
        observedLast100: { startTick: last100StartTick, endTick: last100EndTick, ticks: last100Ticks }
      }
    ));
  } else {
    checks.push(check('productive-attribution', 'PASS', 'Productive-flow attribution is complete for the 100-tick window.', attributionFields));
  }

  const haulerDeficit = finite(model.haulerCarryDeficit, null);
  if (haulerDeficit === null) checks.push(check('hauler-capacity', 'WATCH', 'No haulerCarryDeficit value was available.'));
  else if (haulerDeficit > 0) checks.push(check('hauler-capacity', 'WATCH', 'Hauler capacity remains below modeled requirement.', { haulerCarryDeficit: haulerDeficit }));
  else checks.push(check('hauler-capacity', 'PASS', 'Hauler capacity meets modeled requirement.', { haulerCarryDeficit: haulerDeficit }));

  const fallback = finite(model.consumerFallbackCount, null);
  const critical = finite(model.consumerCriticalCount, null);
  const waiting = finite(model.consumerWaitingCount, null);
  if ([fallback, critical, waiting].every(v => v === null)) checks.push(check('consumer-supply', 'WATCH', 'No consumer-supply counters were available.'));
  else if ((fallback || 0) > 0) checks.push(check('consumer-supply', 'WATCH', 'Consumer self-supply fallback occurred; optimization may still be needed.', { fallback, critical, waiting }));
  else if ((critical || 0) > 0 || (waiting || 0) > 0) checks.push(check('consumer-supply', 'WATCH', 'Consumers were waiting/critical, but fallback remained zero.', { fallback, critical, waiting }));
  else checks.push(check('consumer-supply', 'PASS', 'No consumer fallback/waiting/critical pressure was observed in the latest snapshot.', { fallback, critical, waiting }));

  const controllerProgress = finite(windowLast100?.controllerProgress, null);
  const constructionProgress = finite(windowLast100?.constructionProgress, null);
  const sites = finite(latest?.constructionSites, 0);
  if (controllerProgress === null) checks.push(check('controller-progress', 'WATCH', 'No 100-tick controller progress metric was available.'));
  else if (controllerProgress <= 0) checks.push(check('controller-progress', 'FAIL', 'Controller made no progress during the 100-tick window.', { controllerProgress }));
  else checks.push(check('controller-progress', 'PASS', 'Controller progressed during the 100-tick window.', { controllerProgress }));

  if (sites > 0 && constructionProgress !== null && constructionProgress <= 0) checks.push(check('construction-progress', 'WATCH', 'Construction sites exist but no construction progress was recorded.', { sites, constructionProgress }));
  else if (constructionProgress !== null) checks.push(check('construction-progress', 'PASS', 'Construction progress is acceptable for the current workload.', { sites, constructionProgress }));
  else checks.push(check('construction-progress', 'WATCH', 'No 100-tick construction progress metric was available.'));

  const throughput = last100MatchesWindow ? finite(eff?.metrics?.productiveThroughputPerTick, null) : null;
  const mining = finite(eff?.metrics?.dedicatedHarvestCapacityPerTick, finite(model.dedicatedHarvestCapacityPerTick, null));
  if (throughput === null) checks.push(check('productive-throughput', 'WATCH', 'No productive throughput metric was available.'));
  else if (throughput <= 0) checks.push(check('productive-throughput', 'FAIL', 'Productive throughput is zero.', { throughput, mining }));
  else if (mining !== null && throughput < mining * 0.85) checks.push(check('productive-throughput', 'WATCH', 'Productive throughput trails mining capacity; this is an optimization signal, not a safety failure.', { throughput, mining, utilization: throughput / mining }));
  else checks.push(check('productive-throughput', 'PASS', 'Productive throughput is healthy relative to mining capacity.', { throughput, mining }));

  const effStatus = String(eff?.status || '').toUpperCase();
  if (effStatus === 'UNDERUTILIZED' || effStatus === 'INEFFICIENT' || effStatus === 'WATCH') checks.push(check('efficiency-status', 'WATCH', `Efficiency is ${effStatus}; optimization finding only.`, { reasons: eff?.reasons || [] }));
  else if (effStatus) checks.push(check('efficiency-status', 'PASS', `Efficiency status is ${effStatus}.`));
  else checks.push(check('efficiency-status', 'WATCH', 'No efficiency status was available.'));

  const statusCtx = snapshots.at(-1)?.e?.ctx || null;
  const platformMissing = [];
  if (!statusCtx?.capabilities) platformMissing.push('capabilities');
  if (!statusCtx?.serverProfile) platformMissing.push('serverProfile');
  if (!statusCtx?.scheduler) platformMissing.push('scheduler');
  if (!statusCtx?.worldIntel) platformMissing.push('worldIntel');
  checks.push(platformMissing.length
    ? check('vnext-platform-shadow', selected.complete ? 'FAIL' : 'WATCH', 'VNext platform telemetry is incomplete.', { missing: platformMissing })
    : check('vnext-platform-shadow', 'PASS', 'K0/K1/I0 platform telemetry is present.'));

  const colony = latest?.colonyState || null;
  const shadowFailures = [];
  if (!colony) shadowFailures.push('colonyState');
  else {
    if (colony.authority !== 'SHADOW') shadowFailures.push('colonyState.authority');
    if (!colony.requests?.available || colony.requests?.authority !== 'SHADOW') shadowFailures.push('requests');
    if (!colony.assignments?.available || colony.assignments?.authority !== 'SHADOW') shadowFailures.push('assignments');
    if (!colony.capacity?.projected?.available || colony.capacity?.projected?.authority !== 'SHADOW') shadowFailures.push('capacity.projected');
    if (!colony.spawnPlan?.available || colony.spawnPlan?.authority !== 'SHADOW') shadowFailures.push('spawnPlan');
    if (!colony.assignmentEvidence?.available || colony.assignmentEvidence?.authority !== 'SHADOW_EVIDENCE') shadowFailures.push('assignmentEvidence');
  }
  checks.push(shadowFailures.length
    ? check('vnext-shadow-authority', selected.complete ? 'FAIL' : 'WATCH', 'VNext shadow authority contract is incomplete or violated.', { failures: shadowFailures })
    : check('vnext-shadow-authority', 'PASS', 'O1/E0/E1/E2/O2 remain shadow/evidence-only in live telemetry.'));

  return {
    mode: 'live',
    ...selected,
    attributionWindow: {
      matches: last100MatchesWindow,
      requestedStartTick: selected.startTick,
      requestedEndTick: selected.endTick,
      observedStartTick: last100StartTick,
      observedEndTick: last100EndTick,
      observedTicks: last100Ticks
    },
    ...summarize(checks)
  };
}
