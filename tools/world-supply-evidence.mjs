// Read-only, post-deployment diagnostic. Never claims settled deliveries.
import fs from 'node:fs';
import path from 'node:path';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { parseBotMemory } from './ci-deployment-guard.mjs';
import { readDeploymentReceipt, DEFAULT_VERIFICATION_LOG_DIR } from './deployment-receipt.mjs';
import { triageSupplySample, repeatedSupplyObservations } from './consumer-supply-triage.mjs';

export function summarizeSupplyJournal(bot, deploymentId, room = 'W37S79') {
  const markerTick = bot?.deploymentId === deploymentId ? bot.deploymentTick : null;
  const entries = bot?.telemetryJournal?.events;
  if (!Number.isSafeInteger(markerTick) || !Array.isArray(entries))
    return { state: 'UNKNOWN', reason: 'DEPLOYMENT_OR_JOURNAL_UNAVAILABLE', sampleCount: 0, patterns: [] };
  const samples = [];
  const ticks = new Set();
  const haulerLoadStates = [];
  const haulerLifetimeStates = [];
  let invalid = 0;
  for (const e of entries) {
    if (e?.c !== 'CONSUMER_SUPPLY_DIAG' || !Number.isSafeInteger(e.t) ||
        e.t < markerTick || e.t % 25 !== 0 || e.x?.room !== room) continue;
    if (ticks.has(e.t)) { invalid++; continue; }
    ticks.add(e.t);
    const x = e.x;
    if (x?.phase !== 'AFTER_CREEP_INTENTS_BEFORE_RESOLUTION' ||
        x?.acceptedIsIntentNotSettled !== true) { invalid++; continue; }
    // Newly added load counters are optional for older journal entries.
    // Distinguish absent evidence from malformed/inconsistent evidence; never
    // infer that unobserved collecting haulers were empty or ready.
    let malformedLoadState = false;
    const h = x.haulers;
    const hasEmpty = h && Object.hasOwn(h, 'collectingEmpty');
    const hasPartial = h && Object.hasOwn(h, 'collectingPartialBelowThreshold');
    if (hasEmpty || hasPartial) {
      const integer = value => Number.isSafeInteger(value) && value >= 0;
      if (!hasEmpty || !hasPartial ||
          !['live', 'zeroEnergy', 'energyPositive', 'readyByGuardRule']
            .every(key => integer(h[key])) ||
          !integer(h.collectingEmpty) ||
          !integer(h.collectingPartialBelowThreshold) ||
          h.collectingEmpty > h.zeroEnergy ||
          h.collectingPartialBelowThreshold > h.energyPositive ||
          h.collectingEmpty + h.collectingPartialBelowThreshold +
            h.readyByGuardRule > h.live) {
        malformedLoadState = true;
      } else {
        haulerLoadStates.push({ tick: e.t, live: h.live,
          readyByGuardRule: h.readyByGuardRule,
          collectingEmpty: h.collectingEmpty,
          collectingPartialBelowThreshold: h.collectingPartialBelowThreshold });
      }
    }
    // Optional lifetime evidence is descriptive, not proof of the reason
    // for a later disappearance. Require complete, internally valid counters.
    const ttlKeys = ['knownTtl', 'unknownTtl', 'withinSpawnHorizon',
      'minimumKnownTtl', 'spawnHorizonTicks'];
    const hasAnyTtl = h && ttlKeys.some(k => Object.hasOwn(h, k));
    if (hasAnyTtl) {
      const validCount = v => Number.isSafeInteger(v) && v >= 0;
      const min = h.minimumKnownTtl, horizon = h.spawnHorizonTicks;
      if (!ttlKeys.every(k => Object.hasOwn(h, k)) ||
          !validCount(h.live) || !validCount(h.knownTtl) ||
          !validCount(h.unknownTtl) ||
          !validCount(h.withinSpawnHorizon) ||
          h.knownTtl + h.unknownTtl !== h.live ||
          h.withinSpawnHorizon > h.knownTtl ||
          (h.knownTtl === 0 ? min !== null : !validCount(min)) ||
          (horizon !== null && (!validCount(horizon) || horizon === 0)) ||
          (h.withinSpawnHorizon > 0 && (horizon === null ||
            min > horizon))) {
        malformedLoadState = true;
      } else haulerLifetimeStates.push({
        tick: e.t, live: h.live, knownTtl: h.knownTtl,
        unknownTtl: h.unknownTtl, withinSpawnHorizon: h.withinSpawnHorizon,
        minimumKnownTtl: min, spawnHorizonTicks: horizon
      });
    }
    const sample = {tick: e.t, consumers: x.consumers, haulers: x.haulers,
      reservationCoverage: x.reservationCoverage};
    sample.triage = triageSupplySample(sample);
    if (malformedLoadState || sample.triage.classification === 'UNKNOWN') invalid++;
    samples.push(sample);
  }
  samples.sort((a,b) => a.tick-b.tick);
  haulerLoadStates.sort((a,b) => a.tick-b.tick);
  haulerLifetimeStates.sort((a,b) => a.tick-b.tick);
  // A journal is a bounded rolling buffer. Never interpret a missing tick as
  // healthy supply, and never call an incomplete series continuous evidence.
  const missingSampleTicks = [];
  for (let i = 1; i < samples.length; i++) {
    for (let tick = samples[i-1].tick + 25; tick < samples[i].tick; tick += 25)
      missingSampleTicks.push(tick);
  }
  const observedCadenceComplete = missingSampleTicks.length === 0;
  const patterns = repeatedSupplyObservations(samples);
  // Correlate only observations from the exact same tick. A waiting consumer
  // and an underfilled hauler at different ticks cannot be paired into an
  // invented causal narrative or delivery outcome.
  const loadByTick = new Map(haulerLoadStates.map(s => [s.tick, s]));
  const criticalGapLoadStates = samples
    .filter(s => s.triage.classification === 'CRITICAL_COVERAGE_GAP_OBSERVED' &&
      loadByTick.has(s.tick))
    .map(s => ({
      ...loadByTick.get(s.tick),
      uncoveredCriticalCount: s.triage.uncoveredCriticalCount,
      reasonCodes: s.triage.reasonCodes
    }));
  const lifetimeByTick = new Map(haulerLifetimeStates.map(s => [s.tick, s]));
  const criticalGapLifetimeStates = samples
    .filter(s => s.triage.classification === 'CRITICAL_COVERAGE_GAP_OBSERVED' &&
      lifetimeByTick.has(s.tick))
    .map(s => ({
      ...lifetimeByTick.get(s.tick),
      uncoveredCriticalCount: s.triage.uncoveredCriticalCount,
      reasonCodes: s.triage.reasonCodes
    }));
  return {state: invalid ? 'REVIEW_REQUIRED' : samples.length ? 'OBSERVATIONS_AVAILABLE' : 'UNKNOWN',
    reason: invalid ? 'INVALID_DIAGNOSTIC_SAMPLES' : samples.length ?
      'POST_INTENT_OBSERVATIONS_ONLY' : 'NO_POST_DEPLOYMENT_DIAGNOSTICS',
    markerTick, sampleCount: samples.length, invalidSamples: invalid,
    latestSampleTick: samples.at(-1)?.tick ?? null,
    firstSampleTick: samples[0]?.tick ?? null,
    missingSampleTicks, observedCadenceComplete,
    observedHaulerLoadStateSamples: haulerLoadStates.length,
    haulerLoadStates,
    criticalGapLoadStates,
    observedHaulerLifetimeSamples: haulerLifetimeStates.length,
    haulerLifetimeStates,
    criticalGapLifetimeStates,
    classifications: samples.map(s => ({tick:s.tick, classification:s.triage.classification,
      reasonCodes:s.triage.reasonCodes})), patterns,
    settledDeliveryProof:false, actionAuthority:'NONE'};
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const server = process.env.SCREEPS_SERVER;
  const branch = process.env.SCREEPS_BRANCH;
  const room = process.env.SCREEPS_ROOM;
  const logDir = process.env.SCREEPS_LOG_DIR || DEFAULT_VERIFICATION_LOG_DIR;
  if (server !== 'world' || branch !== 'chatgpt-w37s79-stage' ||
      room !== 'W37S79' || process.env.SCREEPS_SHARD !== 'shard0')
    throw new Error('EXACT_WORLD_TARGET_REQUIRED');
  const pinned = readDeploymentReceipt({logDir, server, branch});
  if (!pinned?.receipt?.deploymentId) throw new Error('EXACT_RECEIPT_REQUIRED');
  const api = await ScreepsHttpClient.fromConfig(server, {shard:'shard0'});
  const bot = parseBotMemory(await api.userMemory('bot'));
  const report = summarizeSupplyJournal(bot, pinned.receipt.deploymentId, room);
  fs.mkdirSync(logDir, {recursive:true});
  const output = path.join(logDir, 'consumer-supply-world-report.json');
  fs.writeFileSync(output, JSON.stringify({server,branch,room,
    deploymentId:pinned.receipt.deploymentId,...report},null,2));
  console.log('WORLD_SUPPLY_EVIDENCE ' + JSON.stringify({state:report.state,
    sampleCount:report.sampleCount,invalidSamples:report.invalidSamples,
    repeatedPatterns:report.patterns.length,
    patterns:report.patterns.map(p=>({reasonCode:p.reasonCode,startTick:p.startTick,
      endTick:p.endTick,sampleCount:p.sampleCount,maximumUncoveredCritical:p.maximumUncoveredCritical})),
    observedCadenceComplete:report.observedCadenceComplete,
    missingSampleTicks:report.missingSampleTicks,
    observedHaulerLoadStateSamples:report.observedHaulerLoadStateSamples,
    haulerLoadStates:report.haulerLoadStates,
    criticalGapLoadStates:report.criticalGapLoadStates,
    observedHaulerLifetimeSamples:report.observedHaulerLifetimeSamples,
    haulerLifetimeStates:report.haulerLifetimeStates,
    criticalGapLifetimeStates:report.criticalGapLifetimeStates,
    classifications:report.classifications,
    settledDeliveryProof:false}));
}
