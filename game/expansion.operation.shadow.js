'use strict';

// I4 preflight state machine. This never issues gameplay intents or authorizes
// a claim: a room-level route is NOT a creep path, and a candidate is NOT a
// validated spawn tile. State is tiny, restart-safe and server independent.
const candidates = require('expansion.candidates.shadow');
const siteEvidence = require('expansion.site.shadow');
const SCHEMA_VERSION = 1;
const INTEL_MAX_AGE = 150;
const MAX_ROUTE_HOPS = 3;
const BASE_BACKOFF = 100;
const MAX_BACKOFF = 1600;
const test = candidates._test;

function result(state, reason) {
  return {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW',
    claimActionEnabled: false,
    spawnActionEnabled: false,
    constructionActionEnabled: false,
    readyForClaim: false,
    routeLevel: state.routeHops !== null ? 'ROOM_LEVEL_ONLY' : 'UNVERIFIED',
    tilePathVerified: state.phase === 'SITE_VERIFIED_ADVISORY',
    spawnTileVerified: state.phase === 'SITE_VERIFIED_ADVISORY',
    spawnSite: state.phase === 'SITE_VERIFIED_ADVISORY' ? state.verifiedSite : null,
    pathCost: state.phase === 'SITE_VERIFIED_ADVISORY' ? state.pathCost : null,
    siteCandidatesChecked: Number.isSafeInteger(state.siteCursor) ? state.siteCursor : 0,
    phase: state.phase,
    candidateRoom: state.candidateRoom,
    parentRoom: state.parentRoom,
    routeHops: state.routeHops,
    failureCount: state.failureCount,
    blockedUntil: state.blockedUntil,
    reason: reason || state.reason || null
  };
}

function initial(candidateRoom, parentRoom) {
  return { schemaVersion: SCHEMA_VERSION, phase: 'RECON',
    candidateRoom, parentRoom, routeHops: null, routeRooms: [],
    verifiedSite: null, pathCost: null, siteCursor: 0,
    siteVerifiedTick: null,
    failureCount: 0, blockedUntil: null, reason: null };
}

function failure(state, now, reason) {
  state.failureCount = Math.min(16, state.failureCount + 1);
  state.phase = 'BACKOFF';
  state.routeHops = null;
  state.routeRooms = [];
  state.verifiedSite = null;
  state.pathCost = null;
  state.siteVerifiedTick = null;
  state.siteCursor = 0;
  state.blockedUntil = now + Math.min(MAX_BACKOFF,
    BASE_BACKOFF * Math.pow(2, Math.min(4, state.failureCount - 1)));
  state.reason = reason;
  return result(state, reason);
}

function intelSafe(record, name, tick) {
  return test.safeRecord(record, name, tick) &&
    tick - record.observation.lastSeenTick <= INTEL_MAX_AGE &&
    record.threat && record.threat.hostileCreeps === 0 &&
    (record.threat.lastHostileTick === null ||
      (Number.isSafeInteger(record.threat.lastHostileTick) &&
       record.threat.lastHostileTick <= tick - 1500));
}

function roomRecord(rooms, name, tick) {
  if (!Object.prototype.hasOwnProperty.call(rooms, name)) return null;
  const record = rooms[name];
  return intelSafe(record, name, tick) ? record : null;
}

function roomRoute(game, rooms, from, to, tick) {
  const map = game && game.map;
  if (!map || typeof map.findRoute !== 'function') return null;
  const origin = roomRecord(rooms, from, tick);
  const target = roomRecord(rooms, to, tick);
  if (!origin || !target || !test.safeTransit(origin, true) ||
      !test.safeClaimCandidate(target, tick)) return null;
  let route;
  try {
    route = map.findRoute(from, to, {
      routeCallback: function(name) {
        const r = roomRecord(rooms, name, tick);
        return r && (name === to
          ? test.safeClaimCandidate(r, tick)
          : test.safeTransit(r, false)) ? 1 : Infinity;
      }
    });
  } catch (_) {
    return null;
  }
  if (!Array.isArray(route) || route.length < 1 ||
      route.length > MAX_ROUTE_HOPS) return null;
  let previous = origin;
  const seen = new Set([from]);
  for (let i = 0; i < route.length; i++) {
    const name = route[i] && route[i].room;
    if (!test.validRoomName(name) || seen.has(name)) return null;
    const next = roomRecord(rooms, name, tick);
    if (!next || !Array.isArray(previous.topology?.exits) ||
        !previous.topology.exits.some(e => e && e.roomName === name) ||
        !Array.isArray(next.topology?.exits) ||
        !next.topology.exits.some(e => e && e.roomName === previous.roomName)) return null;
    if (i === route.length - 1
      ? name !== to || !test.safeClaimCandidate(next, tick)
      : name === to || !test.safeTransit(next, false)) return null;
    seen.add(name);
    previous = next;
  }
  return {hops:route.length,rooms:route.map(x=>x.room)};
}

function supportBudget(states, parent) {
  const state = (Array.isArray(states) ? states : [])
    .find(s => s && s.room && s.room.name === parent);
  if (!test.safeParent(state)) return 'PARENT_NOT_STABLE';
  const capacity = state.energyCapacityAvailable;
  if (!Number.isFinite(capacity) || capacity < 650)
    return 'CLAIMER_ENERGY_CAPACITY_INSUFFICIENT';
  const reserve = state.energyStored;
  if (!Number.isFinite(reserve) ||
      reserve < Math.max(3000, capacity * 3))
    return 'PARENT_SUPPORT_RESERVE_INSUFFICIENT';
  return null;
}

function evaluate(readiness, advisory, roomStates, game, memoryRoot) {
  const tick = game && game.time;
  const unavailable = initial(null, null);
  unavailable.phase = 'HOLD';
  if (!Number.isSafeInteger(tick) || tick < 0 ||
      !memoryRoot || typeof memoryRoot !== 'object')
    return result(unavailable, 'RUNTIME_UNVERIFIED');

  // Status assessment itself is passive. Only the room-route probe needs
  // significant CPU headroom and is explicitly deferred under pressure.
  const ready = readiness && readiness.authority === 'SHADOW' &&
    readiness.status === 'PLANNING_CANDIDATE' &&
    readiness.claimActionEnabled === false &&
    Number.isSafeInteger(readiness.availableClaimSlots) &&
    readiness.availableClaimSlots > 0;
  const choices = advisory && advisory.authority === 'SHADOW' &&
    advisory.claimActionEnabled === false &&
    advisory.placementEnabled === false &&
    advisory.status === 'ADVISORY_ONLY' &&
    Array.isArray(advisory.topCandidates) ? advisory.topCandidates : [];
  if (!ready || choices.length === 0) {
    const old = memoryRoot.bot && memoryRoot.bot.expansionOperationShadow;
    if (old && old.schemaVersion === SCHEMA_VERSION) {
      old.phase = 'HOLD';
      old.reason = !ready ? 'EXPANSION_BUDGET_HOLD' : 'NO_VERIFIED_CANDIDATE';
      old.routeHops = null;
    }
    return result(unavailable, !ready ? 'EXPANSION_BUDGET_HOLD' : 'NO_VERIFIED_CANDIDATE');
  }

  const choice = choices[0];
  if (!choice || !test.validRoomName(choice.roomName) ||
      !test.validRoomName(choice.parentRoom) ||
      choice.roomName === choice.parentRoom ||
      !Number.isSafeInteger(choice.hops) ||
      choice.hops < 1 || choice.hops > MAX_ROUTE_HOPS)
    return result(unavailable, 'CANDIDATE_UNVERIFIED');
  const rooms = memoryRoot.bot?.worldIntel?.rooms;
  if (!rooms || typeof rooms !== 'object')
    return result(unavailable, 'INTEL_UNAVAILABLE');
  if (!memoryRoot.bot) memoryRoot.bot = {};
  let state = memoryRoot.bot.expansionOperationShadow;
  if (!state || state.schemaVersion !== SCHEMA_VERSION ||
      state.candidateRoom !== choice.roomName ||
      state.parentRoom !== choice.parentRoom ||
      !Number.isSafeInteger(state.failureCount) ||
      !['RECON', 'ROUTE_CHECK', 'SUPPORT_CHECK', 'AWAITING_TILE_VALIDATION',
        'SITE_VERIFIED_ADVISORY', 'BACKOFF', 'HOLD'].includes(state.phase) ||
      !Array.isArray(state.routeRooms) ||
      !Number.isSafeInteger(state.siteCursor) ||
      state.siteCursor < 0 || state.siteCursor > siteEvidence.MAX_CANDIDATES) {
    state = initial(choice.roomName, choice.parentRoom);
    memoryRoot.bot.expansionOperationShadow = state;
  }
  if (state.phase === 'HOLD') state.phase = 'RECON';
  if (state.phase === 'BACKOFF') {
    if (!Number.isSafeInteger(state.blockedUntil) || tick < state.blockedUntil)
      return result(state, 'BACKOFF_ACTIVE');
    state.phase = 'RECON';
    state.blockedUntil = null;
    state.reason = null;
  }

  const parentRecord = roomRecord(rooms, choice.parentRoom, tick);
  const targetRecord = roomRecord(rooms, choice.roomName, tick);
  if (!parentRecord || !targetRecord ||
      !test.safeTransit(parentRecord, true) ||
      !test.safeClaimCandidate(targetRecord, tick) ||
      !(Array.isArray(roomStates) && roomStates.some(s =>
        s && s.room && s.room.name === choice.parentRoom && test.safeParent(s))))
    return failure(state, tick, 'FRESH_SAFE_INTEL_OR_PARENT_MISSING');

  if (state.phase === 'RECON') {
    state.phase = 'ROUTE_CHECK';
    state.reason = 'ROOM_ROUTE_PENDING';
    return result(state);
  }

  if (state.phase === 'ROUTE_CHECK') {
    const cpu = game.cpu;
    const available = cpu && Number.isFinite(cpu.limit) &&
      typeof cpu.getUsed === 'function'
      ? cpu.limit - cpu.getUsed() : -Infinity;
    const reserved = cpu && Number.isFinite(cpu.limit)
      ? Math.max(8, Math.ceil(cpu.limit * 0.35)) : Infinity;
    if (!Number.isFinite(available) || available < reserved ||
        !Number.isFinite(cpu?.bucket) || cpu.bucket < 7000) {
      state.reason = 'CPU_HEADROOM_DEFERRED';
      return result(state);
    }
    const route = roomRoute(game, rooms, choice.parentRoom, choice.roomName, tick);
    if (route === null)
      return failure(state, tick, 'SAFE_ROOM_ROUTE_UNVERIFIED');
    state.routeHops = route.hops;
    state.routeRooms = route.rooms;
    state.phase = 'SUPPORT_CHECK';
    state.reason = 'PARENT_SUPPORT_PENDING';
    return result(state);
  }

  if (state.phase === 'SUPPORT_CHECK') {
    const reason = supportBudget(roomStates, choice.parentRoom);
    if (reason) {
      state.reason = reason;
      return result(state);
    }
    state.phase = 'AWAITING_TILE_VALIDATION';
    state.reason = 'TILE_PATH_AND_SPAWN_SITE_NOT_VERIFIED';
    return result(state);
  }
  if (state.phase === 'SITE_VERIFIED_ADVISORY' &&
      (!Number.isSafeInteger(state.siteVerifiedTick) ||
       tick - state.siteVerifiedTick > 150 ||
       state.siteVerifiedTick > tick)) {
    state.phase = 'ROUTE_CHECK';
    state.routeHops = null;
    state.routeRooms = [];
    state.siteCursor = 0;
    state.verifiedSite = null;
    state.pathCost = null;
    state.siteVerifiedTick = null;
    state.reason = 'SITE_EVIDENCE_EXPIRED_RECHECK';
    return result(state);
  }
  if (state.phase === 'AWAITING_TILE_VALIDATION') {
    // The prior stage only proves a room-level route; this stage also requires
    // actual simultaneous room vision, PathFinder and buildable tile geometry.
    const cpu = game.cpu;
    const left = cpu && Number.isFinite(cpu.limit) &&
      typeof cpu.getUsed === 'function' ? cpu.limit - cpu.getUsed() : -Infinity;
    const reserved = cpu && Number.isFinite(cpu.limit)
      ? Math.max(8, Math.ceil(cpu.limit * 0.35)) + 4 : Infinity;
    if (!Number.isFinite(left) || left < reserved ||
        !Number.isFinite(cpu?.bucket) || cpu.bucket < 7000) {
      state.reason = 'SITE_CPU_HEADROOM_DEFERRED';
      return result(state);
    }
    const parent = roomStates.find(s => s && s.room &&
      s.room.name === state.parentRoom);
    const checked = siteEvidence.assess(game,parent,targetRecord,
      state.routeRooms,state.siteCursor);
    if (checked.status === 'DEFERRED') {
      state.reason = checked.reason;
      return result(state);
    }
    if (checked.status === 'REJECTED') {
      state.siteCursor++;
      state.reason = checked.reason;
      if (state.siteCursor >= siteEvidence.MAX_CANDIDATES)
        return failure(state,tick,'NO_VERIFIED_SPAWN_SITE');
      return result(state);
    }
    if (checked.status !== 'PASS')
      return failure(state,tick,'SPAWN_SITE_SEARCH_EXHAUSTED');
    state.phase = 'SITE_VERIFIED_ADVISORY';
    state.verifiedSite = checked.site;
    state.siteVerifiedTick = tick;
    state.pathCost = checked.pathCost;
    state.reason = 'READY_FOR_FURTHER_CLAIM_SAFETY_GATES_ONLY';
  }
  // No transition to CLAIMING. Geometric/path evidence does not establish
  // claim permission, economic run-rate or safety of a real expansion order.
  return result(state);
}

module.exports = { SCHEMA_VERSION, evaluate,
  _test: { initial, failure, intelSafe, roomRoute, supportBudget } };
