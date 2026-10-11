'use strict';

// U7/D1 -> E0 preview only. The E0 registry runs against disposable,
// function-local memory; authoritative Memory, reservations and executors
// must never observe or consume these projected records.
const registry = require('request.registry');
const SCHEMA_VERSION = 1;
const MAX_SPECS = 6;
const MAX_AMOUNT = 1000000;
const KINDS = Object.freeze({
  DEFENSE_DAMAGE: 'damagePerTick',
  DEFENSE_HEAL: 'healPerTick',
  DEFENSE_TANKING: 'effectiveHits',
  DEFENSE_REPAIR: 'repairHits',
  DEFENSE_TOWER_ENERGY: 'energy',
  DEFENSE_RAMPART_OCCUPANCY: 'rampartPositions'
});

function safeTick(tick) {
  return Number.isSafeInteger(tick) && tick >= 0;
}

function report(roomName, tick, status, reason, requests) {
  const byCapability = {};
  let totalDemand = 0;
  for (const item of requests) {
    const capability = item.demand.capability;
    byCapability[capability] = item.demand.amount;
    totalDemand += item.demand.amount;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    registrySchemaVersion: registry.SCHEMA_VERSION,
    authority: 'SHADOW',
    actionAuthority: 'NONE',
    roomName, tick, status, reason,
    // Kept only on the in-tick room state; never persisted to Memory.
    projectedRequests: requests,
    summary: {
      schemaVersion: SCHEMA_VERSION,
      registrySchemaVersion: registry.SCHEMA_VERSION,
      authority: 'SHADOW',
      actionAuthority: 'NONE',
      roomName, tick, status, reason,
      requestCount: requests.length,
      totalDemand,
      byCapability,
      reservationCount: 0,
      writesToGameMemory: false,
      executable: false
    }
  };
}

function validSpec(spec, room, tick) {
  if (!spec || spec.domain !== 'defense' || spec.shadow !== true ||
      !Object.prototype.hasOwnProperty.call(KINDS, spec.kind) ||
      !spec.target || spec.target.roomName !== room ||
      spec.dedupeKey !== 'defense:' + spec.kind.slice('DEFENSE_'.length).toLowerCase().replace(/_/g, '-') + ':' + room ||
      !spec.demand || spec.demand.capability !== KINDS[spec.kind] ||
      !Number.isSafeInteger(spec.demand.amount) ||
      spec.demand.amount < 1 || spec.demand.amount > MAX_AMOUNT ||
      spec.demand.minimumUsefulAmount !== 1 ||
      spec.demand.maximumUsefulAmount !== spec.demand.amount ||
      !spec.priority || !Number.isFinite(spec.priority.base) ||
      spec.priority.base < 0 || spec.priority.base > 100 ||
      !Number.isFinite(spec.priority.urgency) ||
      spec.priority.urgency < 0 || spec.priority.urgency > 100 ||
      spec.priority.strategicClass !== 'DEFENSE' ||
      !spec.evidence || spec.evidence.source !== 'D0_BOUNDED_THREAT_SHADOW' ||
      (spec.deadlineTick !== null &&
       (!safeTick(spec.deadlineTick) || spec.deadlineTick < tick))) return false;
  return true;
}

function evaluate(d1, game) {
  const now = game && game.time;
  const room = d1 && d1.roomName;
  if (!safeTick(now) || typeof room !== 'string' || !/^[WE][0-9]+[NS][0-9]+$/.test(room) ||
      !d1 || d1.schemaVersion !== 1 || d1.authority !== 'SHADOW' ||
      d1.actionAuthority !== 'NONE' || d1.tick !== now ||
      d1.defenseActionEnabled !== false || d1.spawnActionEnabled !== false ||
      d1.safeModeActionEnabled !== false ||
      !d1.summary || d1.summary.tick !== now ||
      d1.summary.roomName !== room || d1.summary.authority !== 'SHADOW' ||
      d1.summary.actionAuthority !== 'NONE' ||
      d1.summary.status !== d1.status ||
      !Array.isArray(d1.specs) || d1.specs.length > MAX_SPECS ||
      d1.requestCount !== d1.specs.length ||
      d1.summary.requestCount !== d1.specs.length) {
    return report(room || null, safeTick(now) ? now : null,
      'UNVERIFIED', 'FRESH_D1_EVIDENCE_REQUIRED', []);
  }
  if (d1.status !== 'ADVISORY') {
    if (d1.specs.length !== 0)
      return report(room, now, 'UNVERIFIED', 'NON_ADVISORY_DEMAND_FORBIDDEN', []);
    return report(room, now,
      d1.status === 'CLEAR' || d1.status === 'WATCH' ? 'NO_DEMAND' : 'INCOMPLETE',
      'NO_VERIFIED_ARMED_DEFENSE_DEMAND', []);
  }
  if (d1.summary.hasUnknownPathEvidence !== false ||
      !Number.isSafeInteger(d1.summary.armedCount) ||
      d1.summary.armedCount < 1 || d1.specs.length === 0)
    return report(room, now, 'UNVERIFIED', 'ARMED_D0_EVIDENCE_REQUIRED', []);

  const dedupe = new Set();
  for (const spec of d1.specs) {
    if (!validSpec(spec, room, now) || dedupe.has(spec.dedupeKey))
      return report(room, now, 'UNVERIFIED', 'INVALID_OR_DUPLICATE_DEFENSE_SPEC', []);
    dedupe.add(spec.dedupeKey);
  }
  // Deliberately NOT Memory, state.memory, or an existing E0 registry.
  // This scratch registry is discarded after each evaluation.
  const scratch = {};
  const ephemeralGame = { time: now };
  for (const spec of d1.specs) registry.upsert(room, spec, scratch, ephemeralGame);
  const records = registry.list(room, scratch);
  if (records.length !== d1.specs.length ||
      records.some(item => item.domain !== 'defense' || item.shadow !== true ||
        item.status !== registry.STATUS.OPEN || item.reservations.length !== 0))
    return report(room, now, 'UNVERIFIED', 'E0_PROJECTION_INVARIANT_FAILED', []);
  return report(room, now, 'PROJECTED', 'ISOLATED_E0_SHADOW_REGISTRY', records);
}

function telemetrySummary(result) {
  return result && result.summary ? result.summary : null;
}

module.exports = { SCHEMA_VERSION, MAX_SPECS, evaluate, telemetrySummary,
  _test: { validSpec, safeTick } };
