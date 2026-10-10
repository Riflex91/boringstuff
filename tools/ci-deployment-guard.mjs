import { gunzipSync } from 'node:zlib';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { pathToFileURL } from 'node:url';
import { readDeploymentReceipt, DEFAULT_VERIFICATION_LOG_DIR } from './deployment-receipt.mjs';

const server = process.env.SCREEPS_SERVER || 'newbieland';
const branch = process.env.SCREEPS_BRANCH || 'chatgpt';
const room = process.env.SCREEPS_ROOM || 'E8N1';
const mode = process.argv[2];

export function parseBotMemory(reply) {
  let value = reply;
  for (let n = 0; n < 6; n++) {
    if (typeof value === 'string') {
      try {
        // Screeps /api/user/memory sends gz: + base64(gzip(JSON)) on
        // official and compatible private servers, not always raw JSON.
        // Bound inflation so malformed/untrusted responses fail closed.
        value = value.startsWith('gz:')
          ? JSON.parse(gunzipSync(Buffer.from(value.slice(3), 'base64'),
              { maxOutputLength: 4_000_000 }).toString('utf8'))
          : JSON.parse(value);
      } catch { return null; }
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (typeof value.deploymentId === 'string') return value;
    if (Object.prototype.hasOwnProperty.call(value, 'data')) {
      value = value.data;
      continue;
    }
    return null;
  }
  return value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.deploymentId === 'string' ? value : null;
}

export function inspectDeployment(bot, deploymentId, minTicks = 25) {
  if (!bot || typeof bot !== 'object') return { status: 'WAIT', reason: 'NO_MEMORY' };
  if (bot.deploymentId !== deploymentId) {
    return { status: 'WAIT', reason: 'DEPLOYMENT_NOT_ACTIVE' };
  }
  const tick = Number(bot.deploymentTick);
  if (!Number.isInteger(tick) || tick <= 0) {
    return { status: 'FAIL', reason: 'INVALID_DEPLOYMENT_TICK' };
  }
  const journal = bot.telemetryJournal || {};
  const events = Array.isArray(journal.events) ? journal.events : [];
  const marker = events.find(e => e && e.c === 'DEPLOYMENT_MARKER' &&
    e.x && e.x.deploymentId === deploymentId && e.t === tick);
  if (!marker) return { status: 'FAIL', reason: 'MISSING_DEPLOYMENT_MARKER', tick };

  const fatal = events.filter(e => e && Number(e.t) >= tick &&
    (e.l === 'FATAL' || e.c === 'MAIN_FATAL' || e.c === 'CPU_BUCKET_CRITICAL'));
  if (fatal.length) {
    return { status: 'FAIL', reason: 'RUNTIME_FATAL_OR_CRITICAL_CPU', tick,
      codes: fatal.slice(0, 10).map(e => e.c) };
  }
  const snapshots = Array.isArray(journal.snapshots) ? journal.snapshots : [];
  // A newer journal event can prove elapsed ticks but cannot prove room state
  // at the end of that window. Require the status snapshot itself to be fresh.
  const minimumSnapshotTick = tick + minTicks;
  const last = snapshots.filter(s => s && s.c === 'STATUS_SNAPSHOT' &&
    Number.isFinite(Number(s.t)) && Number(s.t) >= minimumSnapshotTick)
    .sort((a, b) => Number(b.t) - Number(a.t))[0] || null;
  const currentTick = Math.max(tick,
    ...snapshots.map(s => Number(s?.t) || 0),
    ...events.map(e => Number(e?.t) || 0));
  if (currentTick - tick < minTicks) {
    return { status: 'WAIT', reason: 'OBSERVATION_WINDOW_INCOMPLETE',
      tick, observedTicks: currentTick - tick };
  }
  if (!last) {
    // Snapshots are on a fixed 100-tick cadence; do not turn normal
    // post-window cadence lag into a false pass or a premature failure.
    return { status: 'WAIT', reason: 'POST_WINDOW_STATUS_SNAPSHOT_PENDING',
      tick, observedTicks: currentTick - tick, minimumSnapshotTick };
  }
  if (!last.x || !last.x.rooms || !last.x.rooms[room]) {
    return { status: 'FAIL', reason: 'NO_ROOM_STATUS_AFTER_DEPLOYMENT', tick,
      observedTicks: currentTick - tick };
  }
  const roomStatus = last.x.rooms[room];
  const cpu = Number(last.x.cpu);
  const bucket = Number(last.x.bucket);
  if (!Number.isFinite(cpu) || !Number.isFinite(bucket) || bucket < 1000) {
    return { status: 'FAIL', reason: 'INVALID_CPU_OR_LOW_BUCKET', tick,
      observedTicks: currentTick - tick };
  }
  // The final healthy bucket cannot erase a critical dip at a prior
  // post-deployment STATUS_SNAPSHOT. This is snapshot evidence only:
  // events already cover logged CPU_BUCKET_CRITICAL between samples.
  const sampled = snapshots.filter(s => s && s.c === 'STATUS_SNAPSHOT' &&
    Number.isInteger(s.t) && s.t >= tick && s.t <= Number(last.t) &&
    s.x && typeof s.x.bucket === 'number' && Number.isFinite(s.x.bucket));
  const critical = sampled.filter(s => s.x.bucket < 1000);
  if (critical.length) {
    return { status: 'FAIL', reason: 'INTERMEDIATE_CPU_BUCKET_CRITICAL', tick,
      observedTicks: currentTick - tick,
      criticalSnapshotTicks: critical.slice(0, 8).map(s => s.t),
      minimumSnapshotBucket: Math.min(...sampled.map(s => s.x.bucket)) };
  }
  const cpuSamples = sampled.filter(s => typeof s.x.cpu === 'number' &&
    Number.isFinite(s.x.cpu));
  const minimumSnapshotBucket = Math.min(...sampled.map(s => s.x.bucket));
  const maximumSnapshotCpu = cpuSamples.length
    ? Math.max(...cpuSamples.map(s => s.x.cpu)) : cpu;
  // Evidence-only economy trend. Include only actual post-deploy room
  // snapshots through the verified window; absent telemetry is UNKNOWN,
  // never an inferred zero or a per-tick delivery measurement.
  const roomSamples = snapshots.filter(s => s && s.c === 'STATUS_SNAPSHOT' &&
    Number.isInteger(s.t) && s.t >= tick && s.t <= Number(last.t) &&
    s.x?.rooms?.[room] && typeof s.x.rooms[room] === 'object');
  const energySamples = roomSamples.map(s => ({
    tick: s.t, value: s.x.rooms[room].energyAvailable,
    capacity: s.x.rooms[room].energyCapacity
  })).filter(s => Number.isFinite(s.value) && Number.isFinite(s.capacity) &&
    s.capacity > 0 && s.value >= 0 && s.value <= s.capacity);
  const consumerSamples = roomSamples.map(s => ({
    tick: s.t, count: Array.isArray(s.x.rooms[room].consumerSupply?.criticalConsumers)
      ? s.x.rooms[room].consumerSupply.criticalConsumers.length : null
  })).filter(s => s.count !== null);
  // The existing STATUS_SNAPSHOT already contains bounded consumer wait and
  // hauler reservation details. Analyze them here, not in the game loop:
  // these are sampled pre-resolution states, never settled deliveries.
  const detailSamples = roomSamples.map(s =>
    s.x.rooms[room].consumerSupply?.criticalConsumers).filter(Array.isArray);
  const validDetails = detailSamples.filter(items => items.every(item =>
    item && typeof item === 'object' &&
    typeof item.waiting === 'number' && Number.isFinite(item.waiting) && item.waiting >= 0 &&
    typeof item.fallback === 'boolean'));
  const reservationSamples = roomSamples.map(s =>
    s.x.rooms[room].consumerSupply?.consumerReservations).filter(Array.isArray);
  const validReservations = reservationSamples.filter(items => items.every(item =>
    item && typeof item === 'object' &&
    typeof item.targetId === 'string' && item.targetId.length > 0 &&
    typeof item.carried === 'number' && Number.isFinite(item.carried) && item.carried >= 0));
  const reservationMetrics = validReservations.map(items => {
    const seen = new Set();
    let duplicates = 0, empty = 0;
    for (const item of items) {
      if (seen.has(item.targetId)) duplicates++;
      else seen.add(item.targetId);
      if (item.carried === 0) empty++;
    }
    return { count: items.length, duplicates, empty };
  });
  const maxObserved = (items) => items.length ? Math.max(...items) : null;
  // Join only the two bounded arrays from the SAME room snapshot. Consumer
  // identifiers are needed to test sticky-reservation overlap, but neither
  // names nor target IDs leave this function. A sticky target is an intent,
  // not proof of live guard assignment or delivered energy.
  const linkSamples = roomSamples.map(s => {
    const consumerSupply = s.x.rooms[room].consumerSupply;
    const consumers = consumerSupply?.criticalConsumers;
    const reservations = consumerSupply?.consumerReservations;
    if (!Array.isArray(consumers) || !Array.isArray(reservations) ||
        !consumers.every(c => c && typeof c === 'object' &&
          typeof c.id === 'string' && c.id.length > 0) ||
        !reservations.every(r => r && typeof r === 'object' &&
          typeof r.targetId === 'string' && r.targetId.length > 0 &&
          typeof r.carried === 'number' && Number.isFinite(r.carried) && r.carried >= 0)) {
      return null;
    }
    const ids = new Set(consumers.map(c => c.id));
    if (ids.size !== consumers.length) return null;
    const stickyTargets = new Set(reservations.map(r => r.targetId));
    const loadedTargets = new Set(reservations.filter(r => r.carried > 0).map(r => r.targetId));
    return {
      critical: ids.size,
      withoutSticky: consumers.filter(c => !stickyTargets.has(c.id)).length,
      withSticky: consumers.filter(c => stickyTargets.has(c.id)).length,
      withLoadedSticky: consumers.filter(c => loadedTargets.has(c.id)).length,
      possiblyTruncated: consumers.length === 8 || reservations.length === 8
    };
  });
  const validLinks = linkSamples.filter(s => s !== null);
  // Read existing *complete* 100-tick runtime economy blocks. A snapshot
  // after deploy may still carry a pre-deployment block; exclude those.
  // Multiple snapshots can repeat the same immutable last100 block, so do not
  // count it twice or add distinct non-overlapping windows by mistake.
  const economyWindows = new Map();
  let invalidPostDeployEconomyWindows = 0;
  for (const sample of roomSamples) {
    const w = sample.x.rooms[room].economy?.last100;
    if (!w || typeof w !== 'object') continue;
    if (!Number.isInteger(w.startTick) || w.startTick < tick) continue;
    if (!Number.isInteger(w.endTick) || w.endTick > sample.t ||
        w.endTick > Number(last.t) || w.endTick - w.startTick !== 99 ||
        w.ticks !== 100 || sample.t > w.endTick + 100) {
      invalidPostDeployEconomyWindows++;
      continue;
    }
    const flow = w.productiveFlow;
    const counters = ['consumerTicks', 'waitingConsumerTicks',
      'criticalConsumerTicks', 'fallbackConsumerTicks'];
    if (!flow || counters.some(k => !Number.isSafeInteger(flow[k]) ||
        flow[k] < 0 || (k !== 'consumerTicks' && flow[k] > flow.consumerTicks))) {
      invalidPostDeployEconomyWindows++;
      continue;
    }
    const key = w.startTick + ':' + w.endTick;
    const values = counters.map(k => flow[k]);
    const prior = economyWindows.get(key);
    if (prior && prior.some((v, i) => v !== values[i])) {
      // Conflicting copies cannot be used as exact economy evidence.
      economyWindows.set(key, null);
      invalidPostDeployEconomyWindows++;
    } else if (prior === undefined) {
      economyWindows.set(key, values);
    }
  }
  const completeEconomyWindows = [...economyWindows.values()].filter(Boolean);
  const economyTotals = completeEconomyWindows.length
    ? completeEconomyWindows.reduce((sum, values) =>
      sum.map((v, i) => v + values[i]), [0, 0, 0, 0]) : null;
  const roomEvidence = {
    sampledRoomSnapshots: roomSamples.length,
    sampledEnergySnapshots: energySamples.length,
    minimumEnergyAvailable: energySamples.length
      ? Math.min(...energySamples.map(s => s.value)) : null,
    maximumEnergyAvailable: energySamples.length
      ? Math.max(...energySamples.map(s => s.value)) : null,
    sampledCriticalConsumerSnapshots: consumerSamples.length,
    snapshotsWithCriticalConsumers: consumerSamples.filter(s => s.count > 0).length,
    maximumObservedCriticalConsumers: consumerSamples.length
      ? Math.max(...consumerSamples.map(s => s.count)) : null,
    // Game telemetry caps this list at eight consumers per snapshot.
    criticalConsumerCountMayBeCapped: consumerSamples.some(s => s.count === 8),
    // Each array is capped to eight by the existing in-game snapshot.
    // Missing/invalid entries remain UNKNOWN and never imply no demand.
    sampledConsumerDetailSnapshots: validDetails.length,
    invalidConsumerDetailSnapshots: detailSamples.length - validDetails.length,
    snapshotsWithWaitingConsumers: validDetails.filter(items =>
      items.some(c => c.waiting > 0)).length,
    snapshotsWithFallbackConsumers: validDetails.filter(items =>
      items.some(c => c.fallback)).length,
    maximumObservedWaitingConsumers: maxObserved(validDetails.map(items =>
      items.filter(c => c.waiting > 0).length)),
    maximumObservedFallbackConsumers: maxObserved(validDetails.map(items =>
      items.filter(c => c.fallback).length)),
    sampledReservationSnapshots: validReservations.length,
    invalidReservationSnapshots: reservationSamples.length - validReservations.length,
    maximumObservedReservedHaulers: maxObserved(reservationMetrics.map(x => x.count)),
    snapshotsWithDuplicateReservations: reservationMetrics.filter(x =>
      x.duplicates > 0).length,
    maximumObservedDuplicateReservations: maxObserved(reservationMetrics.map(x =>
      x.duplicates)),
    snapshotsWithEmptyReservedHaulers: reservationMetrics.filter(x =>
      x.empty > 0).length,
    reservationListMayBeCapped: reservationSamples.some(items => items.length === 8),
    // These are counts of sticky target IDs among listed critical consumers,
    // not settled transfers or guarantees of actual consumer service.
    sampledCriticalReservationLinkSnapshots: validLinks.length,
    invalidOrMissingCriticalReservationLinkSnapshots: linkSamples.length - validLinks.length,
    maximumObservedCriticalWithoutStickyReservation:
      maxObserved(validLinks.map(x => x.withoutSticky)),
    maximumObservedCriticalWithStickyReservation:
      maxObserved(validLinks.map(x => x.withSticky)),
    maximumObservedCriticalWithLoadedStickyReservation:
      maxObserved(validLinks.map(x => x.withLoadedSticky)),
    snapshotsWithCriticalWithoutStickyReservation:
      validLinks.filter(x => x.withoutSticky > 0).length,
    criticalReservationLinkMayBePartial:
      validLinks.some(x => x.possiblyTruncated),
    // Exactly completed, distinct, fully post-deploy economy windows only.
    // Count *consumer-creep-ticks*, not ticks with at least one consumer.
    // Null means no complete trustworthy window was observed.
    sampledCompleteEconomyWindows: completeEconomyWindows.length,
    invalidPostDeployEconomyWindows,
    observedCompleteEconomyTicks: completeEconomyWindows.length * 100,
    observedEconomyConsumerTicks: economyTotals?.[0] ?? null,
    observedEconomyWaitingConsumerTicks: economyTotals?.[1] ?? null,
    observedEconomyCriticalConsumerTicks: economyTotals?.[2] ?? null,
    observedEconomyFallbackConsumerTicks: economyTotals?.[3] ?? null
  };
  if (!Number.isFinite(Number(roomStatus.rcl)) ||
      Number(roomStatus.rcl) <= 0 ||
      !roomStatus.creeps || typeof roomStatus.creeps !== 'object') {
    return { status: 'FAIL', reason: 'INVALID_ROOM_STATE', tick };
  }
  return { status: 'PASS', deploymentTick: tick, observedTicks: currentTick - tick,
    snapshotTick: last.t, rcl: roomStatus.rcl, cpu, bucket,
    checkedCpuSnapshots: sampled.length, minimumSnapshotBucket, maximumSnapshotCpu,
    roomEvidence,
    roles: roomStatus.creeps,
    constructionSites: roomStatus.constructionSites,
    energyAvailable: roomStatus.energyAvailable,
    energyCapacity: roomStatus.energyCapacity,
    criticalConsumers: Array.isArray(roomStatus.consumerSupply?.criticalConsumers)
      ? roomStatus.consumerSupply.criticalConsumers.length : null };
}

async function preflight(api) {
  const data = await api.userBranches();
  const entries = Array.isArray(data?.list) ? data.list : [];
  const exact = entries.find(e => e && e.branch === branch);
  const active = typeof exact?.activeWorld === 'boolean'
    ? exact.activeWorld : typeof data?.activeWorld === 'string'
      ? data.activeWorld === branch : null;
  if (active !== true) {
    throw new Error('FAIL CLOSED: target branch is not confirmed activeWorld. No upload performed.');
  }
  const me = await api.authMe();
  if (!me || !(me._id || me.id || me.username)) {
    throw new Error('FAIL CLOSED: Screeps authentication is not confirmed.');
  }
  const before = await api._request('GET', '/api/user/code', { branch });
  if (!before || !before.modules || typeof before.modules !== 'object') {
    throw new Error('FAIL CLOSED: previous live modules cannot be backed up.');
  }
  console.log('PASS: authenticated target branch, activeWorld and backup read verified');
}

async function verify(api) {
  const receipt = readDeploymentReceipt({
    logDir: process.env.SCREEPS_LOG_DIR || DEFAULT_VERIFICATION_LOG_DIR,
    server, branch
  });
  const id = receipt?.receipt?.deploymentId;
  if (!id) throw new Error('FAIL CLOSED: exact deployment receipt missing');
  const timeLimit = Date.now() + 15 * 60 * 1000;
  let last = null;
  while (Date.now() < timeLimit) {
    const response = await api.userMemory('bot');
    const bot = parseBotMemory(response);
    last = inspectDeployment(bot, id, 100);
    if (last.status === 'PASS') {
      console.log('LIVE_100T_PASS ' + JSON.stringify(last));
      return;
    }
    if (last.status === 'FAIL') {
      throw new Error('LIVE_100T_FAIL ' + JSON.stringify(last));
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error('LIVE_100T_INCOMPLETE ' + JSON.stringify(last));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (mode !== 'preflight' && mode !== 'verify') {
    throw new Error('Usage: node ci-deployment-guard.mjs preflight|verify');
  }
  const api = await ScreepsHttpClient.fromConfig(server);
  if (mode === 'preflight') await preflight(api);
  else await verify(api);
}
