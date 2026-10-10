'use strict';

// DIAGNOSTIC ONLY. No creep intents, target decisions, Memory mutations or
// gameplay authority. Event counters describe return codes from attempted
// intents, never verified end-of-tick energy transfer volumes.
const config = require('config');

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
      consumer: { attempted: 0, accepted: 0, notInRange: 0, other: 0 },
      infrastructure: { attempted: 0, accepted: 0, notInRange: 0, other: 0 },
      haulerAcquisition: { attempted: 0, accepted: 0, notInRange: 0, other: 0 }
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
function recordResult(creep, kind, rc) {
  const c = getRoomCounters(roomName(creep));
  if (!c || !c[kind]) return;
  const target = c[kind];
  target.attempted++;
  if (rc === OK) target.accepted++;
  else if (rc === ERR_NOT_IN_RANGE) target.notInRange++;
  else target.other++;
}
function energyAmount(creep) {
  const value = creep && creep.store ? Number(creep.store[RESOURCE_ENERGY]) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
function haulerReadiness(creep) {
  const carried = energyAmount(creep);
  const capacity = creep && creep.store && typeof creep.store.getCapacity === 'function'
    ? Number(creep.store.getCapacity(RESOURCE_ENERGY)) : NaN;
  const knownCapacity = Number.isFinite(capacity) && capacity > 0;
  const ready = carried > 0 && knownCapacity &&
    (!!creep.memory.delivering || carried >= Math.max(50, Math.floor(capacity * 0.5)));
  return { carried, capacity: knownCapacity ? capacity : null, ready };
}
function sampleRoomCreeps(game, room) {
  const items = Object.values(game.creeps || {});
  const summary = {
    phase: 'AFTER_CREEP_INTENTS_BEFORE_RESOLUTION',
    sampledCreepCount: 0, truncated: false,
    haulers: { live: 0, energyPositive: 0, deliveringFlag: 0,
      readyByGuardRule: 0, zeroEnergy: 0, totalCarriedEnergy: 0,
      capacityUnknown: 0 },
    consumers: { live: 0, waiting: 0, fallback: 0, critical: 0, empty: 0 }
  };
  if (items.length > MAX_CREEPS_SCANNED) {
    // Do not claim complete readiness evidence for an oversized collection.
    summary.truncated = true;
    return summary;
  }
  for (const creep of items) {
    if (!creep || creep.spawning || !creep.memory || !creep.room ||
        creep.room.name !== room) continue;
    summary.sampledCreepCount++;
    const role = creep.memory.role;
    if (role === 'hauler') {
      const h = summary.haulers;
      h.live++;
      const status = haulerReadiness(creep);
      h.totalCarriedEnergy += status.carried;
      if (status.carried > 0) h.energyPositive++;
      else h.zeroEnergy++;
      if (creep.memory.delivering) h.deliveringFlag++;
      if (status.ready) h.readyByGuardRule++;
      if (status.capacity === null) h.capacityUnknown++;
    } else if (role === 'worker' || role === 'builder' ||
               role === 'repairer' || role === 'upgrader') {
      const c = summary.consumers;
      c.live++;
      const waiting = Number(creep.memory.waitingEnergyTicks) > 0;
      const fallback = !!creep.memory.logisticsFallback;
      if (waiting) c.waiting++;
      if (fallback) c.fallback++;
      if (waiting || fallback) c.critical++;
      if (energyAmount(creep) <= 0) c.empty++;
    }
  }
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
    const read = sampleRoomCreeps(g, room);
    if (read.truncated) continue;
    const records = perRoom[room] || {
      guardChecks: 0, guardSelected: 0, selectedHaulers: {},
      consumer: { attempted: 0, accepted: 0, notInRange: 0, other: 0 },
      infrastructure: { attempted: 0, accepted: 0, notInRange: 0, other: 0 },
      haulerAcquisition: { attempted: 0, accepted: 0, notInRange: 0, other: 0 }
    };
    // The only output side effect is an ordinary, version-stamped,
    // journaled BOTLOG entry once per 25 ticks per owned room.
    logger.info('CONSUMER_SUPPLY_DIAG', 'Post-hauler-intent supply observations', {
      room, phase: read.phase, sampledCreepCount: read.sampledCreepCount,
      haulers: read.haulers, consumers: read.consumers,
      decisions: {
        guardChecks: records.guardChecks,
        guardSelected: records.guardSelected,
        uniqueGuardHaulers: Object.keys(records.selectedHaulers).length
      },
      consumerTransfers: records.consumer,
      infrastructureTransfers: records.infrastructure,
      haulerAcquisitions: records.haulerAcquisition,
      acceptedIsIntentNotSettled: true
    }, { force: true, journal: true, dedupeTicks: 0 });
    emitted++;
  }
  return emitted;
}

module.exports = {
  recordGuard,
  recordResult,
  flush,
  _test: { sampled, eligible, sampleRoomCreeps, haulerReadiness,
    reset, getRoomCounters }
};
