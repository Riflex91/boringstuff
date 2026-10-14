'use strict';

// DIAGNOSTIC ONLY. No creep intents, target decisions, Memory mutations or
// gameplay authority. Event counters describe return codes from attempted
// intents, never verified end-of-tick energy transfer volumes.
const config = require('config');
const bodyBuilder = require('body.builder');

const SAMPLE_INTERVAL = 25;
const MAX_CREEPS_SCANNED = 120;
const MAX_ROOMS = 3;
let activeTick = null;
let perRoom = Object.create(null);

function sampled(game) {
  const g = game || (typeof Game !== 'undefined' ? Game : null);
  return !!(g && Number.isInteger(g.time) && g.time % SAMPLE_INTERVAL === 0);
}
function reset(tick) {
  if (activeTick !== tick) {
    activeTick = tick;
    perRoom = Object.create(null);
  }
}
function bucket(game) {
  return game && game.cpu && Number.isFinite(game.cpu.bucket) ? game.cpu.bucket : null;
}
function eligible(game) {
  if (!sampled(game) || !game || !game.cpu || typeof game.cpu.getUsed !== 'function' ||
      !Number.isFinite(game.cpu.limit)) return false;
  const b = bucket(game);
  if (b === null || b < config.CPU_BUCKET_LOW) return false;
  const reserve = Number.isFinite(config.SHADOW_CPU_RESERVE)
    ? Math.max(0, config.SHADOW_CPU_RESERVE) : 2;
  return game.cpu.limit - game.cpu.getUsed() > reserve + 1;
}
function roomName(creep) {
  const n = creep && creep.room && creep.room.name;
  return typeof n === 'string' && n.length && n.length <= 20 ? n : null;
}
function getRoomCounters(room, game) {
  const g = game || (typeof Game !== 'undefined' ? Game : null);
  if (!sampled(g) || !room) return null;
  reset(g.time);
  if (!perRoom[room]) {
    perRoom[room] = {
      guardChecks: 0, guardSelected: 0,
      selectedHaulers: Object.create(null),
      rescueChecks: 0, rescueSelected: 0,
      selectedRescueHaulers: Object.create(null),
      consumer: { attempted: 0, accepted: 0, notInRange: 0, other: 0 },
      infrastructure: { attempted: 0, accepted: 0, notInRange: 0, other: 0 },
      haulerAcquisition: { attempted: 0, accepted: 0, notInRange: 0, other: 0 },
      consumerTravel: { moveAttempts:0, rangeAtMost5:0, range6to10:0,
        rangeOver10:0, rangeUnknown:0, moveAccepted:0,
        moveNoPath:0, moveInvalidTarget:0, moveTemporarilyBlocked:0,
        moveOther:0 },
      acquisitionTravel: { moveAttempts:0, rangeAtMost5:0, range6to10:0,
        rangeOver10:0, rangeUnknown:0, moveAccepted:0,
        moveNoPath:0, moveInvalidTarget:0, moveTemporarilyBlocked:0,
        moveOther:0 }
    };
  }
  return perRoom[room];
}
function recordGuard(creep, selected) {
  const c = getRoomCounters(roomName(creep));
  if (!c) return;
  c.guardChecks++;
  if (selected) {
    c.guardSelected++;
    const id = creep && (creep.id || creep.name);
    if (typeof id === 'string' && id) c.selectedHaulers[id] = true;
  }
}
function recordRescue(creep, selected) {
  const c = getRoomCounters(roomName(creep));
  if (!c) return;
  c.rescueChecks++;
  if (selected) {
    c.rescueSelected++;
    const id = creep && (creep.id || creep.name);
    if (typeof id === 'string' && id) c.selectedRescueHaulers[id] = true;
  }
}

function recordResult(creep, kind, rc) {
  const c = getRoomCounters(roomName(creep));
  if (!c || !c[kind]) return;
  const target = c[kind];
  target.attempted++;
  if (rc === OK) target.accepted++;
  else if (rc === ERR_NOT_IN_RANGE) target.notInRange++;
  else target.other++;
}
// Called exactly after the existing ERR_NOT_IN_RANGE -> moveTo branch.
// Range is an inexpensive Chebyshev distance, NOT path length or ETA.
// Even moveTo() OK only accepts an intent; movement is not yet resolved.
function recordConsumerTravel(creep, target, moveRc) {
  const c = getRoomCounters(roomName(creep));
  if (!c) return;
  const t = c.consumerTravel;
  t.moveAttempts++;
  let range = null;
  try {
    if (creep && creep.pos && typeof creep.pos.getRangeTo === 'function') {
      const value = creep.pos.getRangeTo(target);
      if (Number.isSafeInteger(value) && value >= 0) range = value;
    }
  } catch (_) { /* Unknown distance is not a zero-distance observation. */ }
  if (range === null) t.rangeUnknown++;
  else if (range <= 5) t.rangeAtMost5++;
  else if (range <= 10) t.range6to10++;
  else t.rangeOver10++;
  if (moveRc === OK) t.moveAccepted++;
  else if (typeof ERR_NO_PATH !== 'undefined' && moveRc === ERR_NO_PATH)
    t.moveNoPath++;
  else if (typeof ERR_INVALID_TARGET !== 'undefined' &&
           moveRc === ERR_INVALID_TARGET) t.moveInvalidTarget++;
  else if ((typeof ERR_BUSY !== 'undefined' && moveRc === ERR_BUSY) ||
           (typeof ERR_TIRED !== 'undefined' && moveRc === ERR_TIRED))
    t.moveTemporarilyBlocked++;
  else t.moveOther++;
}

// Acquisition travel is diagnostic only. An accepted move is an intent,
// not a confirmed change of position or collected energy.
function recordAcquisitionTravel(creep, target, moveRc) {
  const c = getRoomCounters(roomName(creep));
  if (!c) return;
  const t = c.acquisitionTravel;
  t.moveAttempts++;
  let range = null;
  try {
    const value = creep?.pos?.getRangeTo?.(target);
    if (Number.isSafeInteger(value) && value >= 0) range = value;
  } catch (_) { /* Distances unavailable without altering gameplay. */ }
  if (range === null) t.rangeUnknown++;
  else if (range <= 5) t.rangeAtMost5++;
  else if (range <= 10) t.range6to10++;
  else t.rangeOver10++;
  if (moveRc === OK) t.moveAccepted++;
  else if (typeof ERR_NO_PATH !== 'undefined' && moveRc === ERR_NO_PATH)
    t.moveNoPath++;
  else if (typeof ERR_INVALID_TARGET !== 'undefined' &&
           moveRc === ERR_INVALID_TARGET) t.moveInvalidTarget++;
  else if ((typeof ERR_BUSY !== 'undefined' && moveRc === ERR_BUSY) ||
           (typeof ERR_TIRED !== 'undefined' && moveRc === ERR_TIRED))
    t.moveTemporarilyBlocked++;
  else t.moveOther++;
}

function energyAmount(creep) {
  const value = creep && creep.store ? Number(creep.store[RESOURCE_ENERGY]) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
function haulerReadiness(creep) {
  const carried = energyAmount(creep);
  const hasCapacityReader = !!(creep && creep.store &&
    typeof creep.store.getCapacity === 'function');
  const capacity = hasCapacityReader
    ? Number(creep.store.getCapacity(RESOURCE_ENERGY)) : NaN;
  const knownCapacity = Number.isFinite(capacity) && capacity > 0;
  // Mirror energy.haulerReadyToDeliver exactly: a present capacity reader
  // returning undefined/0/NaN does NOT veto a delivering hauler. The legacy
  // selector uses (getCapacity(RESOURCE_ENERGY) || 0), then a 50-unit floor.
  // Capacity quality is a separate observation, not a change in authority.
  const threshold = Math.max(50, Math.floor((Number.isFinite(capacity) ? capacity : 0) * 0.5));
  const ready = carried > 0 && hasCapacityReader &&
    (!!(creep.memory && creep.memory.delivering) || carried >= threshold);
  return { carried, capacity: knownCapacity ? capacity : null, ready };
}
// Diagnostic-only identity reconciliation. An old sticky assignment is not
// proof of a deliverable load: distinguish any assignment, a ready hauler,
// duplicates, and a hauler carrying zero energy. These are point-in-time
// observations AFTER intents but BEFORE the game resolves transfers.
function snapshotReservationCoverage(criticalConsumers, haulers) {
  const ids = criticalConsumers.map(c => c && (c.id || c.name));
  if (ids.some(id => typeof id !== 'string' || !id) ||
      new Set(ids).size !== ids.length) return null;
  const byTarget = new Map(ids.map(id => [id, { sticky: 0, ready: 0 }]));
  let stickyAssignments = 0, stickyToNoncritical = 0;
  let stickyWithoutEnergy = 0, readyHaulersWithoutSticky = 0;
  for (const h of haulers) {
    const id = h && h.memory && h.memory.consumerTargetId;
    const status = haulerReadiness(h);
    if (typeof id !== 'string' || !id) {
      if (status.ready) readyHaulersWithoutSticky++;
      continue;
    }
    stickyAssignments++;
    if (status.carried === 0) stickyWithoutEnergy++;
    const consumer = byTarget.get(id);
    if (!consumer) {
      stickyToNoncritical++;
      continue;
    }
    consumer.sticky++;
    if (status.ready) consumer.ready++;
  }
  const counts = [...byTarget.values()];
  return {
    criticalWithSticky: counts.filter(x => x.sticky > 0).length,
    criticalWithReadySticky: counts.filter(x => x.ready > 0).length,
    criticalWithoutSticky: counts.filter(x => x.sticky === 0).length,
    criticalWithoutReadySticky: counts.filter(x => x.ready === 0).length,
    criticalWithDuplicateSticky: counts.filter(x => x.sticky > 1).length,
    stickyAssignments, stickyToNoncritical, stickyWithoutEnergy,
    readyHaulersWithoutSticky,
    acceptedDeliveryProof: false
  };
}

// Match the current spawn manager's normal replacement-body sizing without
// giving this optional observer any spawn or creep execution authority.
// Unknown room capacity / body constants mean UNKNOWN, not a zero-TTL risk.
function haulerReplacementHorizon(creep) {
  const capacity = creep && creep.room && creep.room.energyCapacityAvailable;
  if (!Number.isFinite(capacity) || capacity <= 0) return null;
  if (typeof CARRY === 'undefined' || typeof MOVE === 'undefined' ||
      typeof BODYPART_COST === 'undefined') return null;
  const parts = bodyBuilder.hauler(capacity);
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const spawnTime = typeof CREEP_SPAWN_TIME !== 'undefined' &&
    Number.isFinite(CREEP_SPAWN_TIME) ? CREEP_SPAWN_TIME : 3;
  return parts.length * spawnTime + 3;
}

// Observing a short TTL does not mean the live spawn policy permits
// prespawn. Mirror only its bounded eligibility gates, without selecting
// or requesting any creep action. Missing model fields remain UNKNOWN.
function haulerPrespawnPolicyBlockers(state) {
  const m = state && state.economyModel;
  if (!state || !Number.isSafeInteger(state.rcl) ||
      typeof state.emergency !== 'boolean' ||
      !Array.isArray(state.sources) || !m ||
      !Number.isSafeInteger(m.sourceContainersReady) ||
      !Number.isSafeInteger(m.recommendedHaulerCount)) return null;
  // Mirror the live spawn-manager gates without issuing or predicting a
  // spawn action. Multiple blockers may coexist; UNKNOWN is never a pass.
  const blockers = [];
  if (state.rcl < 2) blockers.push('RCL_BELOW_2');
  if (state.emergency) blockers.push('COLONY_EMERGENCY');
  if (!state.sources.length) blockers.push('NO_SOURCES');
  if (m.sourceContainersReady !== state.sources.length)
    blockers.push('SOURCE_CONTAINER_COVERAGE_MISMATCH');
  if (m.recommendedHaulerCount < 2)
    blockers.push('MODELED_HAULER_DEMAND_BELOW_TWO');
  return blockers;
}

function haulerPrespawnPolicyEligible(state) {
  const blockers = haulerPrespawnPolicyBlockers(state);
  return blockers === null ? null : blockers.length === 0;
}

// RoomManager observes spawn/extension energy in the same game tick before
// creep intents settle. Missing state or malformed capacity is UNKNOWN,
// never treated as a refilled spawn or as zero available energy.
function snapshotRoomEnergy(state) {
  const available = state && state.energyAvailable;
  const capacity = state && state.energyCapacityAvailable;
  if (!Number.isSafeInteger(available) || available < 0 ||
      !Number.isSafeInteger(capacity) || capacity <= 0 ||
      available > capacity)
    return {observed:false,available:null,capacity:null,full:null};
  return {observed:true,available,capacity,full:available === capacity};
}

function sampleRoomCreeps(game, room, state = null) {
  const items = Object.values(game.creeps || {});
  const summary = {
    phase: 'AFTER_CREEP_INTENTS_BEFORE_RESOLUTION',
    sampledCreepCount: 0, truncated: false,
    roomEnergy: snapshotRoomEnergy(state),
    haulers: { live: 0, energyPositive: 0, deliveringFlag: 0,
      readyByGuardRule: 0, zeroEnergy: 0, totalCarriedEnergy: 0,
      capacityUnknown: 0, collectingEmpty: 0, collectingPartialBelowThreshold: 0,
      knownTtl: 0, unknownTtl: 0, withinSpawnHorizon: 0,
      minimumKnownTtl: null, spawnHorizonTicks: null,
      prespawnPolicyEligible: haulerPrespawnPolicyEligible(state),
      prespawnPolicyBlockers: haulerPrespawnPolicyBlockers(state),
      eligibleExpiringHaulers: null },
    consumers: { live: 0, waiting: 0, fallback: 0, critical: 0, empty: 0 },
    reservationCoverage: null
  };
  if (items.length > MAX_CREEPS_SCANNED) {
    // Do not claim complete readiness evidence for an oversized collection.
    summary.truncated = true;
    return summary;
  }
  const criticalConsumers = [], liveHaulers = [];
  for (const creep of items) {
    if (!creep || creep.spawning || !creep.memory || !creep.room ||
        creep.room.name !== room) continue;
    summary.sampledCreepCount++;
    const role = creep.memory.role;
    if (role === 'hauler') {
      liveHaulers.push(creep);
      const h = summary.haulers;
      h.live++;
      const status = haulerReadiness(creep);
      h.totalCarriedEnergy += status.carried;
      if (status.carried > 0) h.energyPositive++;
      else h.zeroEnergy++;
      if (creep.memory.delivering) h.deliveringFlag++;
      if (status.ready) h.readyByGuardRule++;
      if (!creep.memory.delivering && !status.ready) {
        if (status.carried === 0) h.collectingEmpty++;
        else h.collectingPartialBelowThreshold++;
      }
      if (status.capacity === null) h.capacityUnknown++;
      const ttl = creep.ticksToLive;
      const horizon = haulerReplacementHorizon(creep);
      if (Number.isSafeInteger(horizon) && horizon > 0)
        h.spawnHorizonTicks = horizon;
      if (Number.isSafeInteger(ttl) && ttl >= 0) {
        h.knownTtl++;
        h.minimumKnownTtl = h.minimumKnownTtl === null
          ? ttl : Math.min(h.minimumKnownTtl, ttl);
        if (horizon !== null && ttl <= horizon) h.withinSpawnHorizon++;
      } else h.unknownTtl++;
    } else if (role === 'worker' || role === 'builder' ||
               role === 'repairer' || role === 'upgrader') {
      const c = summary.consumers;
      c.live++;
      const waiting = Number(creep.memory.waitingEnergyTicks) > 0;
      const fallback = !!creep.memory.logisticsFallback;
      if (waiting) c.waiting++;
      if (fallback) c.fallback++;
      if (waiting || fallback) {
        c.critical++;
        criticalConsumers.push(creep);
      }
      if (energyAmount(creep) <= 0) c.empty++;
    }
  }
  // Count only short-TTL haulers for which the current spawn-manager policy
  // actually allows early replacement. Null means policy state unavailable.
  const h = summary.haulers;
  h.eligibleExpiringHaulers = h.prespawnPolicyEligible === null ||
    (h.prespawnPolicyEligible && h.live > 0 && h.spawnHorizonTicks === null)
    ? null : h.prespawnPolicyEligible ? h.withinSpawnHorizon : 0;
  summary.reservationCoverage = snapshotReservationCoverage(criticalConsumers, liveHaulers);
  return summary;
}
function flush(states, logger, game) {
  const g = game || (typeof Game !== 'undefined' ? Game : null);
  if (!eligible(g) || !logger || typeof logger.info !== 'function') return 0;
  reset(g.time);
  if (!Array.isArray(states)) return 0;
  const rooms = [...new Set(states.filter(s => s && s.room && s.room.name)
    .map(s => s.room.name))].sort();
  // In a growing colony don't imply that the first three rooms form a
  // complete room census. Stop and surface no optional diagnostics.
  if (rooms.length > MAX_ROOMS) return 0;
  let emitted = 0;
  for (const room of rooms) {
    if (!eligible(g)) break;
    const state = states.find(s => s && s.room && s.room.name === room);
    const read = sampleRoomCreeps(g, room, state);
    if (read.truncated) continue;
    const records = perRoom[room] || {
      guardChecks: 0, guardSelected: 0, selectedHaulers: {},
      rescueChecks: 0, rescueSelected: 0, selectedRescueHaulers: {},
      consumer: { attempted: 0, accepted: 0, notInRange: 0, other: 0 },
      infrastructure: { attempted: 0, accepted: 0, notInRange: 0, other: 0 },
      haulerAcquisition: { attempted: 0, accepted: 0, notInRange: 0, other: 0 },
      consumerTravel: { moveAttempts:0, rangeAtMost5:0, range6to10:0,
        rangeOver10:0, rangeUnknown:0, moveAccepted:0,
        moveNoPath:0, moveInvalidTarget:0, moveTemporarilyBlocked:0,
        moveOther:0 },
      acquisitionTravel: { moveAttempts:0, rangeAtMost5:0, range6to10:0,
        rangeOver10:0, rangeUnknown:0, moveAccepted:0,
        moveNoPath:0, moveInvalidTarget:0, moveTemporarilyBlocked:0,
        moveOther:0 }
    };
    // The only output side effect is an ordinary, version-stamped,
    // journaled BOTLOG entry once per 25 ticks per owned room.
    logger.info('CONSUMER_SUPPLY_DIAG', 'Post-hauler-intent supply observations', {
      room, phase: read.phase, sampledCreepCount: read.sampledCreepCount,
      haulers: read.haulers, consumers: read.consumers,
      roomEnergy: read.roomEnergy,
      reservationCoverage: read.reservationCoverage,
      decisions: {
        guardChecks: records.guardChecks,
        guardSelected: records.guardSelected,
        uniqueGuardHaulers: Object.keys(records.selectedHaulers).length,
        rescueChecks: records.rescueChecks,
        rescueSelected: records.rescueSelected,
        uniqueRescueHaulers: Object.keys(records.selectedRescueHaulers).length
      },
      consumerTransfers: records.consumer,
      infrastructureTransfers: records.infrastructure,
      haulerAcquisitions: records.haulerAcquisition,
      consumerTravel: records.consumerTravel,
      acquisitionTravel: records.acquisitionTravel,
      acceptedIsIntentNotSettled: true
    }, { force: true, journal: true, dedupeTicks: 0 });
    emitted++;
  }
  return emitted;
}

module.exports = {
  recordGuard,
  recordRescue,
  recordResult,
  recordConsumerTravel,
  recordAcquisitionTravel,
  flush,
  _test: { sampled, eligible, sampleRoomCreeps, haulerReadiness,
    reset, getRoomCounters, snapshotReservationCoverage,
    haulerReplacementHorizon, haulerPrespawnPolicyEligible,
    haulerPrespawnPolicyBlockers, snapshotRoomEnergy }
};
