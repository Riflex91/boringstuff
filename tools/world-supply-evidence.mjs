// Read-only, post-deployment diagnostic. Never claims settled deliveries.
import fs from 'node:fs';
import path from 'node:path';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { parseBotMemory } from './ci-deployment-guard.mjs';
import { readDeploymentReceipt, DEFAULT_VERIFICATION_LOG_DIR } from './deployment-receipt.mjs';
import { triageSupplySample, repeatedSupplyObservations } from './consumer-supply-triage.mjs';

const PRESWPAN_BLOCKER_CODES = new Set([
  'RCL_BELOW_2', 'COLONY_EMERGENCY', 'NO_SOURCES',
  'SOURCE_CONTAINER_COVERAGE_MISMATCH',
  'MODELED_HAULER_DEMAND_BELOW_TWO'
]);

export function summarizeSupplyJournal(bot, deploymentId, room = 'W37S79') {
  const markerTick = bot?.deploymentId === deploymentId ? bot.deploymentTick : null;
  const entries = bot?.telemetryJournal?.events;
  if (!Number.isSafeInteger(markerTick) || !Array.isArray(entries))
    return { state: 'UNKNOWN', reason: 'DEPLOYMENT_OR_JOURNAL_UNAVAILABLE', sampleCount: 0, patterns: [] };
  const samples = [];
  const patternEligibleSamples = [];
  const ticks = new Set();
  const haulerLoadStates = [];
  const haulerLifetimeStates = [];
  const haulerActionStates = [];
  const roomEnergyStates = [];
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
    let pendingLoad = null, pendingLifetime = null, pendingRoomEnergy = null;
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
        pendingLoad = { tick: e.t, live: h.live,
          readyByGuardRule: h.readyByGuardRule,
          collectingEmpty: h.collectingEmpty,
          collectingPartialBelowThreshold: h.collectingPartialBelowThreshold };
      }
    }
    // Optional lifetime evidence is descriptive, not proof of the reason
    // for a later disappearance. Require complete, internally valid counters.
    const ttlKeys = ['knownTtl', 'unknownTtl', 'withinSpawnHorizon',
      'minimumKnownTtl', 'spawnHorizonTicks'];
    const hasAnyTtl = h && ttlKeys.some(k => Object.hasOwn(h, k));
    const policyKeys = ['prespawnPolicyEligible', 'eligibleExpiringHaulers'];
    const hasAnyPolicy = h && policyKeys.some(k => Object.hasOwn(h, k));
    const hasBlockers = h && Object.hasOwn(h, 'prespawnPolicyBlockers');
    if ((hasAnyPolicy || hasBlockers) && !hasAnyTtl ||
        (hasBlockers && !hasAnyPolicy)) malformedLoadState = true;
    if (hasAnyTtl) {
      const validCount = v => Number.isSafeInteger(v) && v >= 0;
      const min = h.minimumKnownTtl, horizon = h.spawnHorizonTicks;
      const eligible = h.prespawnPolicyEligible;
      const expiring = h.eligibleExpiringHaulers;
      const expectedUnknown = eligible === null ||
        (eligible === true && h.live > 0 && horizon === null);
      const blockers = h.prespawnPolicyBlockers;
      const blockersValid = !hasBlockers || (
        (eligible === null && blockers === null) ||
        (Array.isArray(blockers) &&
          blockers.length <= PRESWPAN_BLOCKER_CODES.size &&
          blockers.every(code => PRESWPAN_BLOCKER_CODES.has(code)) &&
          new Set(blockers).size === blockers.length &&
          (eligible === true ? blockers.length === 0 :
            eligible === false && blockers.length > 0))
      );
      const policyValid = blockersValid && (!hasAnyPolicy || (
        policyKeys.every(k => Object.hasOwn(h, k)) &&
        (eligible === true || eligible === false || eligible === null) &&
        (expectedUnknown ? expiring === null : validCount(expiring)) &&
        (eligible !== false || expiring === 0) &&
        (eligible !== true || horizon === null || expiring === h.withinSpawnHorizon) &&
        (eligible !== true || horizon !== null || h.live > 0 || expiring === 0)
      ));
      if (!policyValid ||
          !ttlKeys.every(k => Object.hasOwn(h, k)) ||
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
      } else pendingLifetime = {
        tick: e.t, live: h.live, knownTtl: h.knownTtl,
        unknownTtl: h.unknownTtl, withinSpawnHorizon: h.withinSpawnHorizon,
        minimumKnownTtl: min, spawnHorizonTicks: horizon,
        ...(hasAnyPolicy ? {
          prespawnPolicyEligible: eligible,
          eligibleExpiringHaulers: expiring,
          ...(hasBlockers ? { prespawnPolicyBlockers: blockers } : {})
        } : {})
      };
    }
    // The live observer already records attempts/return codes and guard
    // selections. Preserve them as post-intent observations only, never
    // infer end-of-tick receipts, transfers or missing decisions. Older
    // releases lacking all three groups remain UNKNOWN, not zero attempts.
    const actionKeys = ['decisions', 'consumerTransfers',
      'infrastructureTransfers', 'haulerAcquisitions', 'consumerTravel', 'acquisitionTravel'];
    const hasActions = actionKeys.some(key => Object.hasOwn(x, key));
    let pendingActions = null;
    if (hasActions) {
      const goodInt = value => Number.isSafeInteger(value) && value >= 0;
      const decisions = x.decisions;
      const rescueKeys = ['rescueChecks', 'rescueSelected',
        'uniqueRescueHaulers'];
      const hasRescue = decisions && rescueKeys.some(key =>
        Object.hasOwn(decisions, key));
      const validRescue = !hasRescue || (
        rescueKeys.every(key => goodInt(decisions[key])) &&
        decisions.rescueSelected <= decisions.rescueChecks &&
        decisions.uniqueRescueHaulers <= decisions.rescueSelected &&
        decisions.uniqueRescueHaulers <= h?.live);
      const transferKinds = ['consumerTransfers',
        'infrastructureTransfers', 'haulerAcquisitions'];
      const validTransfer = row => row && ['attempted', 'accepted',
        'notInRange', 'other'].every(key => goodInt(row[key])) &&
        row.attempted === row.accepted + row.notInRange + row.other;
      const travel = x.consumerTravel;
      const hasTravel = Object.hasOwn(x,'consumerTravel');
      const acquisitionTravel = x.acquisitionTravel;
      const hasAcquisitionTravel = Object.hasOwn(x,'acquisitionTravel');
      const travelKeys = ['moveAttempts','rangeAtMost5','range6to10',
        'rangeOver10','rangeUnknown','moveAccepted','moveNoPath',
        'moveInvalidTarget','moveTemporarilyBlocked','moveOther'];
      const validTravel = !hasTravel || (
        travel && typeof travel === 'object' && !Array.isArray(travel) &&
        Object.keys(travel).length === travelKeys.length &&
        travelKeys.every(key => Object.hasOwn(travel,key) &&
          goodInt(travel[key])) &&
        travel.moveAttempts === x.consumerTransfers?.notInRange &&
        travel.rangeAtMost5 + travel.range6to10 + travel.rangeOver10 +
          travel.rangeUnknown === travel.moveAttempts &&
        travel.moveAccepted + travel.moveNoPath + travel.moveInvalidTarget +
          travel.moveTemporarilyBlocked + travel.moveOther ===
          travel.moveAttempts
      );
      // Old source-kind counters are usable but do not reveal which kind
      // caused a long journey. New samples require a complete joint breakdown.
      const longKindKeys = ['longDrop','longContainer','longTomb'];
      const acquisitionBaseKeys = travelKeys.concat(['drop','container','tomb']);
      const hasLongKinds = hasAcquisitionTravel &&
        longKindKeys.some(key => Object.hasOwn(acquisitionTravel || {},key));
      const validAcquisitionTravel = !hasAcquisitionTravel || (
        acquisitionTravel && typeof acquisitionTravel === 'object' &&
        !Array.isArray(acquisitionTravel) &&
        Object.keys(acquisitionTravel).length === acquisitionBaseKeys.length +
          (hasLongKinds ? longKindKeys.length : 0) &&
        acquisitionBaseKeys.concat(hasLongKinds ? longKindKeys : []).every(key =>
          Object.hasOwn(acquisitionTravel,key) && goodInt(acquisitionTravel[key])) &&
        (!hasLongKinds || (
          acquisitionTravel.longDrop + acquisitionTravel.longContainer +
            acquisitionTravel.longTomb === acquisitionTravel.rangeOver10 &&
          acquisitionTravel.longDrop <= acquisitionTravel.drop &&
          acquisitionTravel.longContainer <= acquisitionTravel.container &&
          acquisitionTravel.longTomb <= acquisitionTravel.tomb
        )) &&
        acquisitionTravel.drop + acquisitionTravel.container + acquisitionTravel.tomb === acquisitionTravel.moveAttempts &&
        acquisitionTravel.moveAttempts <= x.haulerAcquisitions?.notInRange &&
        acquisitionTravel.rangeAtMost5 + acquisitionTravel.range6to10 +
          acquisitionTravel.rangeOver10 + acquisitionTravel.rangeUnknown ===
          acquisitionTravel.moveAttempts &&
        acquisitionTravel.moveAccepted + acquisitionTravel.moveNoPath +
          acquisitionTravel.moveInvalidTarget +
          acquisitionTravel.moveTemporarilyBlocked +
          acquisitionTravel.moveOther === acquisitionTravel.moveAttempts
      );
      if (!decisions || !goodInt(h?.live) ||
          !['guardChecks', 'guardSelected', 'uniqueGuardHaulers']
            .every(key => goodInt(decisions[key])) ||
          decisions.guardSelected > decisions.guardChecks ||
          decisions.uniqueGuardHaulers > decisions.guardSelected ||
          decisions.uniqueGuardHaulers > h.live ||
          !validRescue || !validTravel || !validAcquisitionTravel ||
          !transferKinds.every(key => validTransfer(x[key]))) {
        malformedLoadState = true;
      } else {
        pendingActions = {
          tick:e.t, live:h.live,
          guardChecks:decisions.guardChecks,
          guardSelected:decisions.guardSelected,
          uniqueGuardHaulers:decisions.uniqueGuardHaulers,
          ...(hasRescue ? {
            rescueChecks:decisions.rescueChecks,
            rescueSelected:decisions.rescueSelected,
            uniqueRescueHaulers:decisions.uniqueRescueHaulers
          } : {}),
          consumerTransferIntents:{...x.consumerTransfers},
          infrastructureTransferIntents:{...x.infrastructureTransfers},
          haulerAcquisitionIntents:{...x.haulerAcquisitions},
          ...(hasTravel ? {consumerTravel:{...travel}} : {}),
          ...(hasAcquisitionTravel ? {acquisitionTravel:{...acquisitionTravel}} : {}),
          settledDeliveryProof:false
        };
      }
    }
    // Room infrastructure supply is a same-tick snapshot, but not evidence
    // that a rescue decision passed every tower or consumer safety gate.
    // Older releases lacking this field must remain UNKNOWN, not "empty".
    if (Object.hasOwn(x,'roomEnergy')) {
      const roomEnergy = x.roomEnergy;
      const good = value => Number.isSafeInteger(value) && value >= 0;
      const schemaValid = roomEnergy &&
        typeof roomEnergy === 'object' && !Array.isArray(roomEnergy) &&
        Object.keys(roomEnergy).length === 4 &&
        ['observed','available','capacity','full']
          .every(key => Object.hasOwn(roomEnergy,key));
      const known = schemaValid && roomEnergy.observed === true &&
        good(roomEnergy.available) &&
        good(roomEnergy.capacity) && roomEnergy.capacity > 0 &&
        roomEnergy.available <= roomEnergy.capacity &&
        roomEnergy.full === (roomEnergy.available === roomEnergy.capacity);
      const unknownEnergy = schemaValid && roomEnergy.observed === false &&
        roomEnergy.available === null && roomEnergy.capacity === null &&
        roomEnergy.full === null;
      if (!known && !unknownEnergy) malformedLoadState = true;
      else pendingRoomEnergy = {
        tick:e.t, observed:roomEnergy.observed,
        available:roomEnergy.available, capacity:roomEnergy.capacity,
        full:roomEnergy.full
      };
    }
    const sample = {tick: e.t, consumers: x.consumers, haulers: x.haulers,
      reservationCoverage: x.reservationCoverage};
    sample.triage = triageSupplySample(sample);
    if (malformedLoadState || sample.triage.classification === 'UNKNOWN') {
      // Reject ALL derived evidence for this tick atomically. A valid-looking
      // subset of a malformed sample must not drive a same-tick correlation.
      invalid++;
    } else {
      if (pendingLoad) haulerLoadStates.push(pendingLoad);
      if (pendingLifetime) haulerLifetimeStates.push(pendingLifetime);
      if (pendingActions) haulerActionStates.push(pendingActions);
      if (pendingRoomEnergy) roomEnergyStates.push(pendingRoomEnergy);
      patternEligibleSamples.push(sample);
    }
    samples.push(sample);
  }
  samples.sort((a,b) => a.tick-b.tick);
  haulerLoadStates.sort((a,b) => a.tick-b.tick);
  haulerLifetimeStates.sort((a,b) => a.tick-b.tick);
  haulerActionStates.sort((a,b) => a.tick-b.tick);
  roomEnergyStates.sort((a,b) => a.tick-b.tick);
  // A journal is a bounded rolling buffer. Never interpret a missing tick as
  // healthy supply, and never call an incomplete series continuous evidence.
  const missingSampleTicks = [];
  for (let i = 1; i < samples.length; i++) {
    for (let tick = samples[i-1].tick + 25; tick < samples[i].tick; tick += 25)
      missingSampleTicks.push(tick);
  }
  const observedCadenceComplete = missingSampleTicks.length === 0;
  // Invalid cross-field telemetry cannot constitute a consecutive pattern.
  const patterns = repeatedSupplyObservations(patternEligibleSamples);
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
  const actionByTick = new Map(haulerActionStates.map(s => [s.tick, s]));
  const criticalGapActionStates = samples
    .filter(s => s.triage.classification === 'CRITICAL_COVERAGE_GAP_OBSERVED' &&
      actionByTick.has(s.tick))
    .map(s => ({
      ...actionByTick.get(s.tick),
      uncoveredCriticalCount: s.triage.uncoveredCriticalCount,
      reasonCodes: s.triage.reasonCodes
    }));
  const energyByTick = new Map(roomEnergyStates.map(s => [s.tick, s]));
  const criticalGapRoomEnergyStates = samples
    .filter(s => s.triage.classification === 'CRITICAL_COVERAGE_GAP_OBSERVED' &&
      energyByTick.has(s.tick))
    .map(s => ({
      ...energyByTick.get(s.tick),
      uncoveredCriticalCount:s.triage.uncoveredCriticalCount,
      reasonCodes:s.triage.reasonCodes
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
    observedHaulerActionSamples: haulerActionStates.length,
    haulerActionStates,
    criticalGapActionStates,
    observedRoomEnergySamples:roomEnergyStates.length,
    roomEnergyStates,
    criticalGapRoomEnergyStates,
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
    observedHaulerActionSamples:report.observedHaulerActionSamples,
    haulerActionStates:report.haulerActionStates,
    criticalGapActionStates:report.criticalGapActionStates,
    observedRoomEnergySamples:report.observedRoomEnergySamples,
    roomEnergyStates:report.roomEnergyStates,
    criticalGapRoomEnergyStates:report.criticalGapRoomEnergyStates,
    observedHaulerLifetimeSamples:report.observedHaulerLifetimeSamples,
    haulerLifetimeStates:report.haulerLifetimeStates,
    criticalGapLifetimeStates:report.criticalGapLifetimeStates,
    classifications:report.classifications,
    settledDeliveryProof:false}));
}
