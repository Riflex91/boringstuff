'use strict';

const SCHEMA_VERSION = 1;
const MAX_OBSERVATIONS = 12;

function now(game) {
  const value = game && Number.isFinite(game.time) ? game.time : null;
  return value;
}

function createDefault() {
  return {
    schemaVersion: SCHEMA_VERSION,
    claimPolicy: {
      discoveredClaimLimit: null,
      confidence: 0,
      lastFailure: null,
      observations: []
    }
  };
}

function ensure(memoryRoot) {
  memoryRoot = memoryRoot || (typeof Memory !== 'undefined' ? Memory : null);
  if (!memoryRoot) return createDefault();
  if (!memoryRoot.bot) memoryRoot.bot = {};

  const current = memoryRoot.bot.serverProfile;
  if (!current || current.schemaVersion !== SCHEMA_VERSION || !current.claimPolicy) {
    memoryRoot.bot.serverProfile = createDefault();
  }

  const profile = memoryRoot.bot.serverProfile;
  if (!Array.isArray(profile.claimPolicy.observations)) profile.claimPolicy.observations = [];
  if (!Number.isFinite(profile.claimPolicy.confidence)) profile.claimPolicy.confidence = 0;
  return profile;
}

function globalCode(name) {
  if (typeof globalThis === 'undefined') return null;
  const value = globalThis[name];
  return Number.isFinite(value) ? value : null;
}

function normalizeClaimResult(result) {
  if (!Number.isFinite(result)) return { kind: 'UNKNOWN', code: result };
  const ok = globalCode('OK');
  const gcl = globalCode('ERR_GCL_NOT_ENOUGH');
  const full = globalCode('ERR_FULL');
  const invalidTarget = globalCode('ERR_INVALID_TARGET');
  const notOwner = globalCode('ERR_NOT_OWNER');
  const busy = globalCode('ERR_BUSY');

  if (ok !== null && result === ok) return { kind: 'SUCCESS', code: result };
  if (gcl !== null && result === gcl) return { kind: 'GCL_CAPACITY', code: result };
  if (full !== null && result === full) return { kind: 'CONTEXT_CAPACITY', code: result };
  if (invalidTarget !== null && result === invalidTarget) return { kind: 'INVALID_TARGET', code: result };
  if (notOwner !== null && result === notOwner) return { kind: 'NOT_OWNER', code: result };
  if (busy !== null && result === busy) return { kind: 'BUSY', code: result };
  return { kind: 'OTHER', code: result };
}

function clampConfidence(value) {
  return Math.max(0, Math.min(1, value));
}

function pushObservation(profile, observation) {
  const list = profile.claimPolicy.observations;
  list.push(observation);
  if (list.length > MAX_OBSERVATIONS) list.splice(0, list.length - MAX_OBSERVATIONS);
}

function observeClaimResult(result, context, memoryRoot, game) {
  context = context || {};
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const profile = ensure(memoryRoot);
  const normalized = normalizeClaimResult(result);
  const ownedRooms = Number.isFinite(context.ownedRooms) ? context.ownedRooms : null;
  const gclLevel = Number.isFinite(context.gclLevel) ? context.gclLevel : null;

  const observation = {
    tick: now(game),
    result: normalized.kind,
    code: Number.isFinite(result) ? result : null,
    roomName: context.roomName || null,
    ownedRooms,
    gclLevel
  };

  pushObservation(profile, observation);

  if (normalized.kind === 'GCL_CAPACITY' || normalized.kind === 'CONTEXT_CAPACITY') {
    // Do not infer a persistent global room limit from a claim error alone.
    // GCL capacity can increase over time, while ERR_FULL may represent a
    // room/area-specific rule. Preserve the evidence for later policy logic.
    profile.claimPolicy.lastFailure = observation;
  } else if (normalized.kind === 'SUCCESS') {
    profile.claimPolicy.lastFailure = null;
  }

  return profile;
}

function observeGlobalClaimLimit(limit, evidence, memoryRoot, game) {
  if (!Number.isFinite(limit) || limit < 0) return ensure(memoryRoot);
  evidence = evidence || {};
  game = game || (typeof Game !== 'undefined' ? Game : null);

  const profile = ensure(memoryRoot);
  profile.claimPolicy.discoveredClaimLimit = Math.floor(limit);
  profile.claimPolicy.confidence = clampConfidence(
    Number.isFinite(evidence.confidence) ? evidence.confidence : 1
  );

  pushObservation(profile, {
    tick: now(game),
    result: 'GLOBAL_LIMIT',
    code: null,
    roomName: null,
    ownedRooms: Number.isFinite(evidence.ownedRooms) ? evidence.ownedRooms : null,
    gclLevel: Number.isFinite(evidence.gclLevel) ? evidence.gclLevel : null,
    source: evidence.source || 'explicit-server-evidence',
    limit: Math.floor(limit)
  });

  return profile;
}

function snapshot(memoryRoot) {
  const profile = ensure(memoryRoot);
  return {
    schemaVersion: profile.schemaVersion,
    claimPolicy: {
      discoveredClaimLimit: profile.claimPolicy.discoveredClaimLimit,
      confidence: profile.claimPolicy.confidence,
      lastFailure: profile.claimPolicy.lastFailure,
      observationCount: profile.claimPolicy.observations.length
    }
  };
}

module.exports = {
  SCHEMA_VERSION,
  ensure,
  snapshot,
  observeClaimResult,
  observeGlobalClaimLimit,
  normalizeClaimResult,
  _test: { createDefault, globalCode, clampConfidence }
};