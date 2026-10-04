'use strict';

const SCHEMA_VERSION = 1;
const TERMINAL_REQUESTS = { SATISFIED: true, EXPIRED: true, CANCELLED: true, BLOCKED: true };

function tick(game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  return game && Number.isFinite(game.time) ? game.time : 0;
}

function ensure(memoryRoot) {
  memoryRoot = memoryRoot || (typeof Memory !== 'undefined' ? Memory : null);
  if (!memoryRoot) return { schemaVersion: SCHEMA_VERSION, rooms: {} };
  if (!memoryRoot.bot) memoryRoot.bot = {};
  if (!memoryRoot.bot.assignmentShadow || memoryRoot.bot.assignmentShadow.schemaVersion !== SCHEMA_VERSION) {
    memoryRoot.bot.assignmentShadow = { schemaVersion: SCHEMA_VERSION, rooms: {} };
  }
  if (!memoryRoot.bot.assignmentShadow.rooms) memoryRoot.bot.assignmentShadow.rooms = {};
  return memoryRoot.bot.assignmentShadow;
}

function ensureRoom(roomName, memoryRoot) {
  const root = ensure(memoryRoot);
  if (!root.rooms[roomName]) {
    root.rooms[roomName] = {
      previousByExecutor: {},
      failures: {},
      lastPlanTick: null,
      lastSummary: null
    };
  }
  return root.rooms[roomName];
}

function bodyParts(creep, globalName) {
  if (!creep) return 0;
  let part = globalName.toLowerCase();
  if (typeof globalThis !== 'undefined' && typeof globalThis[globalName] !== 'undefined') part = globalThis[globalName];
  if (typeof creep.getActiveBodyparts === 'function') return Math.max(0, Number(creep.getActiveBodyparts(part)) || 0);
  if (!Array.isArray(creep.body)) return 0;
  let count = 0;
  for (const item of creep.body) {
    const type = typeof item === 'string' ? item : item && item.type;
    const hits = typeof item === 'object' && item ? item.hits : 100;
    if (type === part && hits > 0) count += 1;
  }
  return count;
}

function role(creep) {
  return creep && creep.memory && creep.memory.role ? creep.memory.role : 'worker';
}

function carriedEnergy(creep) {
  if (!creep || !creep.store) return 0;
  const key = typeof RESOURCE_ENERGY !== 'undefined' ? RESOURCE_ENERGY : 'energy';
  return Math.max(0, Number(creep.store[key]) || 0);
}

function capabilityFor(creep, request) {
  if (!creep || creep.spawning || !request || !request.demand) return 0;
  const r = role(creep);
  const capability = request.demand.capability;
  const kind = request.kind;
  const work = bodyParts(creep, 'WORK');
  const carry = bodyParts(creep, 'CARRY');
  const move = bodyParts(creep, 'MOVE');
  const carryCapacity = typeof CARRY_CAPACITY !== 'undefined' ? CARRY_CAPACITY : 50;

  // Capacity-deficit requests already subtract currently active capacity.
  // They are inputs to E2/spawn planning, not executable work for existing creeps.
  if (kind === 'HARVEST_CAPACITY' || kind === 'HAUL_CAPACITY' || kind === 'RECOVERY_CAPACITY') return 0;

  if (kind === 'ENERGY_DELIVERY') {
    if (r !== 'hauler' || carry <= 0) return 0;
    return carry * carryCapacity;
  }

  const hasWorkEnergy = carriedEnergy(creep) > 0;
  if (capability === 'workBuild') return hasWorkEnergy && (r === 'worker' || r === 'builder' || r === 'repairer') ? work : 0;
  if (capability === 'workRepair') return hasWorkEnergy && (r === 'worker' || r === 'builder' || r === 'repairer') ? work : 0;
  if (capability === 'workUpgrade') return hasWorkEnergy && (r === 'worker' || r === 'builder' || r === 'repairer' || r === 'upgrader') ? work : 0;
  return 0;
}

function localRange(creep, request) {
  const target = request && request.target;
  if (!creep || !creep.pos || !target) return 0;
  const targetRoom = target.roomName || (target.pos && target.pos.roomName);
  const creepRoom = creep.pos.roomName || (creep.room && creep.room.name);
  if (targetRoom && creepRoom && targetRoom !== creepRoom) return 50;
  const pos = target.pos;
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return 0;
  if (typeof creep.pos.getRangeTo === 'function') {
    try { return Math.max(0, Number(creep.pos.getRangeTo(pos.x, pos.y)) || 0); } catch (err) {}
  }
  return Math.max(Math.abs((creep.pos.x || 0) - pos.x), Math.abs((creep.pos.y || 0) - pos.y));
}

function deadlineUrgency(request, now) {
  if (!request || !Number.isFinite(request.deadlineTick)) return 0;
  const remaining = request.deadlineTick - now;
  if (remaining <= 0) return 100;
  if (remaining >= 100) return 0;
  return Math.max(0, 100 - remaining);
}

function pairKey(executorId, requestId) {
  return String(executorId) + '|' + String(requestId);
}

function activeFailure(roomState, executorId, requestId, now) {
  const failure = roomState.failures[pairKey(executorId, requestId)];
  if (!failure) return null;
  if (Number.isFinite(failure.untilTick) && now >= failure.untilTick) {
    delete roomState.failures[pairKey(executorId, requestId)];
    return null;
  }
  return failure;
}

function score(creep, request, roomState, now) {
  const capacity = capabilityFor(creep, request);
  if (capacity <= 0) return null;
  const executorId = creep.id || creep.name;
  if (!executorId) return null;
  if (activeFailure(roomState, executorId, request.id, now)) return null;

  const range = localRange(creep, request);
  const previous = roomState.previousByExecutor[executorId] || null;
  const continuing = previous && previous.requestId === request.id;
  const emergency = request.priority && request.priority.strategicClass === 'RECOVERY';
  const base = request.priority && Number.isFinite(request.priority.base) ? request.priority.base : 0;
  const urgency = request.priority && Number.isFinite(request.priority.urgency) ? request.priority.urgency : 0;
  const marginal = request.utility && Number.isFinite(request.utility.current) ? Math.min(100, request.utility.current) : 0;
  const deadline = deadlineUrgency(request, now);
  const localityBonus = range <= 3 ? 15 : range <= 10 ? 8 : 0;
  const carriedBonus = request.kind === 'ENERGY_DELIVERY' ? Math.min(30, carriedEnergy(creep) / 10) : 0;
  let roleFitBonus = 0;
  if (r === 'builder' && request.kind === 'BUILD') roleFitBonus = 15;
  else if (r === 'repairer' && request.kind === 'REPAIR') roleFitBonus = 15;
  else if (r === 'upgrader' && request.kind === 'UPGRADE') roleFitBonus = 20;
  const continuationBonus = continuing && !emergency ? 20 : continuing ? 5 : 0;
  const switchCost = previous && !continuing && !emergency ? 15 : 0;
  const travelCost = Math.min(50, range * 2);
  const riskCost = Number.isFinite(request.risk) ? Math.max(0, request.risk) : 0;
  const opportunityCost = (role(creep) === 'upgrader' && request.kind !== 'UPGRADE') ? 8 : 0;
  const emergencyBonus = emergency ? 100 : 0;

  const total = base + urgency + marginal + deadline + localityBonus + carriedBonus + roleFitBonus + continuationBonus + emergencyBonus
    - travelCost - switchCost - riskCost - opportunityCost;

  return {
    total,
    capacity,
    components: {
      base, urgency, marginal, deadline, localityBonus, carriedBonus, roleFitBonus, continuationBonus, emergencyBonus,
      travelCost, switchCost, riskCost, opportunityCost, range
    }
  };
}

function requestActive(request) {
  return !!request && !TERMINAL_REQUESTS[request.status];
}

function plan(roomName, requests, creeps, memoryRoot, game) {
  const now = tick(game);
  const roomState = ensureRoom(roomName, memoryRoot);
  for (const key in roomState.failures) {
    const failure = roomState.failures[key];
    if (!failure || !Number.isFinite(failure.untilTick) || now >= failure.untilTick) delete roomState.failures[key];
  }
  const activeRequests = (requests || []).filter(requestActive);
  const executors = (creeps || []).filter(c => c && !c.spawning && (c.id || c.name));
  const remaining = {};
  for (const request of activeRequests) {
    const progressed = request.progress && Number.isFinite(request.progress.amount) ? request.progress.amount : 0;
    const reserved = Array.isArray(request.reservations)
      ? request.reservations.reduce((sum, r) => sum + (Number.isFinite(r.amount) ? Math.max(0, r.amount) : 0), 0)
      : 0;
    remaining[request.id] = Math.max(0, (request.demand && Number.isFinite(request.demand.amount) ? request.demand.amount : 0) - progressed - reserved);
  }

  const unused = executors.slice();
  const assignments = [];

  while (unused.length) {
    let best = null;
    for (let ci = 0; ci < unused.length; ci++) {
      const creep = unused[ci];
      for (const request of activeRequests) {
        if ((remaining[request.id] || 0) <= 0) continue;
        const scored = score(creep, request, roomState, now);
        if (!scored || scored.total <= 0) continue;
        const executorId = creep.id || creep.name;
        const candidate = { creep, request, scored, ci, executorId };
        if (!best || scored.total > best.scored.total ||
          (scored.total === best.scored.total && String(request.id) < String(best.request.id)) ||
          (scored.total === best.scored.total && String(request.id) === String(best.request.id) && String(executorId) < String(best.executorId))) {
          best = candidate;
        }
      }
    }
    if (!best) break;

    const reservedCapacity = Math.min(best.scored.capacity, remaining[best.request.id]);
    remaining[best.request.id] -= reservedCapacity;
    const assignment = {
      id: 'shadow|' + roomName + '|' + best.executorId + '|' + best.request.id,
      requestId: best.request.id,
      requestDedupeKey: best.request.dedupeKey,
      requestKind: best.request.kind,
      executorId: best.executorId,
      executorRole: role(best.creep),
      assignedTick: now,
      reservedCapacity,
      expectedTravel: best.scored.components.range,
      expectedUtility: Math.round(best.scored.total * 100) / 100,
      score: best.scored.components,
      status: 'PLANNED',
      authority: 'SHADOW',
      lastProgressTick: null,
      failureReason: null
    };
    assignments.push(assignment);
    unused.splice(best.ci, 1);
  }

  const nextPrevious = {};
  let switchCount = 0;
  for (const assignment of assignments) {
    const prior = roomState.previousByExecutor[assignment.executorId];
    if (prior && prior.requestId !== assignment.requestId) switchCount += 1;
    nextPrevious[assignment.executorId] = { requestId: assignment.requestId, tick: now };
  }
  roomState.previousByExecutor = nextPrevious;
  roomState.lastPlanTick = now;

  const unfilled = [];
  for (const request of activeRequests) {
    if ((remaining[request.id] || 0) > 0) {
      unfilled.push({ requestId: request.id, dedupeKey: request.dedupeKey, remaining: remaining[request.id] });
    }
  }

  const summary = {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW',
    requestCount: activeRequests.length,
    executorCount: executors.length,
    assignmentCount: assignments.length,
    switchCount,
    unfilledCount: unfilled.length,
    totalUnfilled: Math.round(unfilled.reduce((sum, x) => sum + x.remaining, 0) * 100) / 100
  };
  roomState.lastSummary = summary;

  return { assignments, unfilled, summary };
}

function recordFailure(roomName, executorId, requestId, reason, untilTick, memoryRoot, game) {
  const now = tick(game);
  const roomState = ensureRoom(roomName, memoryRoot);
  const key = pairKey(executorId, requestId);
  const prior = roomState.failures[key];
  roomState.failures[key] = {
    reason: reason || 'UNKNOWN',
    createdTick: prior ? prior.createdTick : now,
    lastFailureTick: now,
    failureCount: prior ? prior.failureCount + 1 : 1,
    untilTick: Number.isFinite(untilTick) ? untilTick : now + Math.min(100, 5 * (prior ? prior.failureCount + 1 : 1))
  };
  return roomState.failures[key];
}

function snapshot(roomName, memoryRoot) {
  const roomState = ensureRoom(roomName, memoryRoot);
  return roomState.lastSummary || {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW',
    requestCount: 0, executorCount: 0, assignmentCount: 0, switchCount: 0, unfilledCount: 0, totalUnfilled: 0
  };
}

module.exports = {
  SCHEMA_VERSION,
  ensure,
  ensureRoom,
  plan,
  score,
  recordFailure,
  snapshot,
  _test: { bodyParts, role, carriedEnergy, capabilityFor, localRange, deadlineUrgency, pairKey, activeFailure, requestActive }
};