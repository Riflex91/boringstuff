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
  let invalid = 0;
  for (const e of entries) {
    if (e?.c !== 'CONSUMER_SUPPLY_DIAG' || !Number.isSafeInteger(e.t) ||
        e.t < markerTick || e.t % 25 !== 0 || e.x?.room !== room) continue;
    if (ticks.has(e.t)) { invalid++; continue; }
    ticks.add(e.t);
    const x = e.x;
    if (x?.phase !== 'AFTER_CREEP_INTENTS_BEFORE_RESOLUTION' ||
        x?.acceptedIsIntentNotSettled !== true) { invalid++; continue; }
    const sample = {tick: e.t, consumers: x.consumers, haulers: x.haulers,
      reservationCoverage: x.reservationCoverage};
    sample.triage = triageSupplySample(sample);
    if (sample.triage.classification === 'UNKNOWN') invalid++;
    samples.push(sample);
  }
  samples.sort((a,b) => a.tick-b.tick);
  // A journal is a bounded rolling buffer. Never interpret a missing tick as
  // healthy supply, and never call an incomplete series continuous evidence.
  const missingSampleTicks = [];
  for (let i = 1; i < samples.length; i++) {
    for (let tick = samples[i-1].tick + 25; tick < samples[i].tick; tick += 25)
      missingSampleTicks.push(tick);
  }
  const observedCadenceComplete = missingSampleTicks.length === 0;
  const patterns = repeatedSupplyObservations(samples);
  return {state: invalid ? 'REVIEW_REQUIRED' : samples.length ? 'OBSERVATIONS_AVAILABLE' : 'UNKNOWN',
    reason: invalid ? 'INVALID_DIAGNOSTIC_SAMPLES' : samples.length ?
      'POST_INTENT_OBSERVATIONS_ONLY' : 'NO_POST_DEPLOYMENT_DIAGNOSTICS',
    markerTick, sampleCount: samples.length, invalidSamples: invalid,
    latestSampleTick: samples.at(-1)?.tick ?? null,
    firstSampleTick: samples[0]?.tick ?? null,
    missingSampleTicks, observedCadenceComplete,
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
    classifications:report.classifications,
    settledDeliveryProof:false}));
}
