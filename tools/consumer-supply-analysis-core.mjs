// Read-only correlation of optional post-handler supply observations with
// pre-handler room heartbeats and exact 100-tick economy windows.
// Correlation is not causality; accepted transfer intents are not deliveries.
const nonnegative = x => Number.isInteger(x) && x >= 0;
const finite = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
const count = (x, key) => nonnegative(x?.[key]) ? x[key] : null;
const roomOf = e => typeof e?.ctx?.room === 'string' ? e.ctx.room.toUpperCase() : null;

function validateDiagnostic(e) {
  const c = e.ctx;
  if (!c || c.phase !== 'AFTER_CREEP_INTENTS_BEFORE_RESOLUTION' ||
      c.acceptedIsIntentNotSettled !== true || !nonnegative(c.sampledCreepCount))
    return false;
  const h = c.haulers, consumers = c.consumers, d = c.decisions;
  if (!h || !consumers || !d) return false;
  for (const field of ['live', 'energyPositive', 'zeroEnergy',
    'deliveringFlag', 'readyByGuardRule', 'capacityUnknown', 'totalCarriedEnergy']) {
    if (count(h, field) === null) return false;
  }
  if (h.energyPositive + h.zeroEnergy !== h.live ||
      h.readyByGuardRule > h.live || h.capacityUnknown > h.live ||
      h.live > c.sampledCreepCount) return false;
  for (const field of ['live', 'waiting', 'fallback', 'critical', 'empty']) {
    if (count(consumers, field) === null) return false;
  }
  if (['waiting', 'fallback', 'critical', 'empty'].some(k => consumers[k] > consumers.live) ||
      consumers.live + h.live > c.sampledCreepCount) return false;
  for (const field of ['guardChecks', 'guardSelected', 'uniqueGuardHaulers']) {
    if (count(d, field) === null) return false;
  }
  if (d.guardSelected > d.guardChecks || d.uniqueGuardHaulers > d.guardSelected) return false;
  for (const group of ['consumerTransfers', 'infrastructureTransfers', 'haulerAcquisitions']) {
    const x = c[group];
    if (!x || ['attempted', 'accepted', 'notInRange', 'other']
      .some(k => count(x, k) === null)) return false;
    if (x.accepted + x.notInRange + x.other !== x.attempted) return false;
  }
  return true;
}

function heartbeatHint(e) {
  if (!e) return null;
  const parts = typeof e.ctx?.energy === 'string' ? e.ctx.energy.split('/') : [];
  const energy = parts.length === 2 && parts.every(x => /^\d+$/.test(x))
    ? parts.map(Number) : [null, null];
  return {
    tick: e.tick,
    phase: 'BEFORE_CREEP_INTENTS',
    roomEnergy: energy[0],
    roomCapacity: energy[1],
    fallbackConsumers: count(e.ctx?.economyModel, 'consumerFallbackCount'),
    waitingConsumers: count(e.ctx?.economyModel, 'consumerWaitingCount'),
    haulers: count(e.ctx?.creeps, 'hauler')
  };
}

function fullWindow(e, room, markerTick) {
  if (e.code !== 'STATUS_SNAPSHOT' || !e.ctx?.rooms?.[room]) return null;
  const v = e.ctx.rooms[room].economy?.last100;
  if (!nonnegative(v?.startTick) || !nonnegative(v?.endTick) ||
      v.ticks !== 100 || v.endTick - v.startTick !== 99 ||
      v.startTick < markerTick || e.tick < v.endTick) return null;
  const flow = v.productiveFlow;
  const fallbackConsumerTicks = count(flow, 'fallbackConsumerTicks');
  return {
    startTick: v.startTick, endTick: v.endTick, carrierTick: e.tick,
    fallbackConsumerTicks,
    waitingConsumerTicks: count(flow, 'waitingConsumerTicks'),
    consumerTicks: count(flow, 'consumerTicks')
  };
}

export function analyzeSupplyEvidence({ events, receipt, roomName = 'E8N1' } = {}) {
  if (!Array.isArray(events) || !receipt?.version ||
      !receipt?.deploymentId || !receipt?.server || !receipt?.branch)
    throw new Error('Events and an exact deployment receipt are required');
  const room = String(roomName).toUpperCase();
  const ordered = events.filter(e => nonnegative(e?.tick))
    .sort((a,b) => a.tick - b.tick || (a.jseq || 0) - (b.jseq || 0));
  const latestTick = ordered.at(-1)?.tick ?? null;
  const marker = ordered.findLast(e => e.code === 'DEPLOYMENT_MARKER' &&
    e.v === receipt.version && e.ctx?.version === receipt.version &&
    e.ctx?.deploymentId === receipt.deploymentId);
  if (!marker) return { state: 'WAIT', reason: 'MATCHING_DEPLOYMENT_MARKER_MISSING',
    room, markerTick: null, latestTick, samples: [], windows: [] };
  const later = ordered.find(e => e.tick > marker.tick && (
    (e.code === 'DEPLOYMENT_MARKER' &&
      (e.v !== receipt.version || e.ctx?.deploymentId !== receipt.deploymentId)) ||
    (e.code === 'CONSUMER_SUPPLY_DIAG' && e.v !== receipt.version)
  ));
  if (later) return { state: 'BLOCKED', reason: 'CONFLICTING_POST_MARKER_RELEASE',
    room, markerTick: marker.tick, latestTick, samples: [], windows: [] };
  const observed = ordered.filter(e => e.tick >= marker.tick &&
    (e.v === receipt.version || e.code === 'TELEMETRY_RETENTION_GAP'));
  // Collector replay and live console can both carry an identical jseq.
  // Conflicting payloads for one journal sequence must not be silently chosen.
  const seenSeq = new Map(), unique = [], conflicts = [];
  for (const e of observed) {
    const seq = nonnegative(e.jseq) && e.jseq > 0 ? e.jseq : null;
    if (seq !== null) {
      const signature = JSON.stringify([e.tick, e.v, e.code, e.ctx]);
      const previous = seenSeq.get(seq);
      if (previous !== undefined) {
        if (previous !== signature) conflicts.push(seq);
        continue;
      }
      seenSeq.set(seq, signature);
    }
    unique.push(e);
  }
  if (conflicts.length) return { state: 'BLOCKED', reason: 'CONFLICTING_JOURNAL_SEQUENCES',
    room, markerTick: marker.tick, latestTick, conflictingSequences: [...new Set(conflicts)],
    samples: [], windows: [] };

  const heartbeats = new Map();
  for (const e of unique) {
    if (e.code === 'ROOM_HEARTBEAT' && e.v === receipt.version &&
        roomOf(e) === room && !heartbeats.has(e.tick)) heartbeats.set(e.tick, e);
  }
  const samples = [], invalidTicks = [], seenSampleTicks = new Set();
  for (const e of unique) {
    if (e.code !== 'CONSUMER_SUPPLY_DIAG' || roomOf(e) !== room) continue;
    if (!nonnegative(e.jseq) || e.jseq === 0 ||
        e.tick % 25 !== 0 || !validateDiagnostic(e) ||
        seenSampleTicks.has(e.tick)) {
      invalidTicks.push(e.tick);
      continue;
    }
    seenSampleTicks.add(e.tick);
    const hint = heartbeatHint(heartbeats.get(e.tick));
    samples.push({
      tick: e.tick, jseq: e.jseq, haulers: e.ctx.haulers,
      consumers: e.ctx.consumers, decisions: e.ctx.decisions,
      consumerTransfers: e.ctx.consumerTransfers,
      infrastructureTransfers: e.ctx.infrastructureTransfers,
      haulerAcquisitions: e.ctx.haulerAcquisitions,
      heartbeat: hint,
      observationPhase: e.ctx.phase,
      acceptedIsIntentNotSettled: true
    });
  }
  const byWindow = new Map();
  for (const e of unique) {
    const w = fullWindow(e, room, marker.tick);
    if (!w) continue;
    const old = byWindow.get(w.startTick);
    if (!old || w.carrierTick < old.carrierTick) byWindow.set(w.startTick, w);
  }
  const windows = [...byWindow.values()].sort((a,b) => a.startTick - b.startTick)
    .map(w => ({
      ...w,
      diagnosticSampleTicks: samples
        .filter(s => s.tick >= w.startTick && s.tick <= w.endTick).map(s => s.tick),
      note: 'Full 100-tick fallback counter; optional samples do not supply a causal explanation.'
    }));
  // Collector-generated retention warnings may have no game tick at all.
  // Conservatively flag them rather than silently discard their provenance.
  const retentionGap = events.some(e => e?.code === 'TELEMETRY_RETENTION_GAP' &&
    (!nonnegative(e.tick) || e.tick >= marker.tick));
  return {
    state: invalidTicks.length ? 'REVIEW_REQUIRED' :
      samples.length ? 'OBSERVATIONS_AVAILABLE' : 'WAIT',
    reason: invalidTicks.length ? 'INVALID_OR_DUPLICATE_DIAGNOSTIC' :
      samples.length ? 'SAMPLED_EVIDENCE_NOT_DELIVERY_PROOF' : 'NO_DIAGNOSTIC_SAMPLES',
    room, markerTick: marker.tick, latestTick,
    samples, invalidTicks, windows,
    integrity: {
      retentionGap,
      journalEventCount: seenSeq.size,
      completeCadence: false,
      note: '25-tick snapshots are optional and CPU-gated; missing ticks mean UNKNOWN.'
    },
    notes: [
      'ROOM_HEARTBEAT is pre-handler; CONSUMER_SUPPLY_DIAG is post-handler but before intent resolution.',
      'accepted means transfer() returned OK, not a settled quantity or proven consumer delivery.',
      'Fallback/ready correlations and economic 100-tick totals are observational, never causal.'
    ]
  };
}
