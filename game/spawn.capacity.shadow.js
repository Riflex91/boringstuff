'use strict';

const bodyBuilder = require('body.builder');
const bodyOptimizer = require('body.optimizer');
const capacityVector = require('capacity.vector');

const SCHEMA_VERSION = 1;
const MAX_PROPOSALS_PER_REQUIREMENT = 12;

function now(game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  return game && Number.isFinite(game.time) ? game.time : 0;
}

function roleForRequest(request) {
  if (!request) return null;
  if (request.kind === 'HARVEST_CAPACITY') return 'harvester';
  if (request.kind === 'HAUL_CAPACITY') return 'hauler';
  if (request.kind === 'RECOVERY_CAPACITY') return 'worker';
  return null;
}

function requestIsCapacity(request) {
  return !!roleForRequest(request) && request.status !== 'SATISFIED' && request.status !== 'EXPIRED' && request.status !== 'CANCELLED';
}

function bodyCost(body) {
  const costs = typeof BODYPART_COST !== 'undefined' ? BODYPART_COST : {};
  let total = 0;
  for (const p of body || []) total += Number(costs[p]) || 0;
  return total;
}

function emergencyFallbackBody(role, energy) {
  if (role !== 'worker') return [];
  return bodyBuilder.worker(energy, true);
}

function routeContext(state, request) {
  if (!state || !state.economyModel || !Array.isArray(state.economyModel.sourceRoutes)) {
    return { distance: 0, terrainProfile: null };
  }
  if (request.kind !== 'HARVEST_CAPACITY' && request.kind !== 'HAUL_CAPACITY') {
    return { distance: 0, terrainProfile: null };
  }
  let selected = null;
  for (const route of state.economyModel.sourceRoutes) {
    if (!Number.isFinite(route.spawnDistance)) continue;
    if (!selected || route.spawnDistance > selected.spawnDistance) selected = route;
  }
  return {
    distance: selected ? Math.max(0, selected.spawnDistance) : 0,
    terrainProfile: selected && selected.terrainProfile ? selected.terrainProfile : null
  };
}

function optimizeBody(role, request, requestedCapacity, energyBudget, state) {
  const route = routeContext(state, request);
  return bodyOptimizer.optimize({
    role,
    capability: request && request.demand ? request.demand.capability : null,
    requestedCapacity,
    energyBudget,
    currentEnergy: state ? state.energyAvailable : null,
    routeDistance: route.distance,
    terrainProfile: route.terrainProfile,
    expectedLifetime: typeof CREEP_LIFE_TIME !== 'undefined' ? CREEP_LIFE_TIME : 1500,
    boosts: request && request.boosts ? request.boosts : null,
    maxParts: 50
  });
}

function capacityForRequestFromVector(vector, request, role) {
  if (!vector || !request) return 0;
  if (request.kind === 'HARVEST_CAPACITY') return role === 'harvester' ? capacityVector.capability(vector, 'workHarvest') : 0;
  if (request.kind === 'HAUL_CAPACITY') return role === 'hauler' ? capacityVector.capability(vector, 'carry') : 0;
  if (request.kind === 'RECOVERY_CAPACITY') {
    if (role !== 'worker' && role !== 'harvester') return 0;
    return capacityVector.deliveredForRequest(vector, request);
  }
  return 0;
}

function capacityForCreep(creep, request) {
  if (!creep || !request) return 0;
  const role = creep.memory && creep.memory.role ? creep.memory.role : null;
  return capacityForRequestFromVector(capacityVector.fromCreep(creep), request, role);
}

function capacityForBody(body, role, request) {
  return capacityForRequestFromVector(capacityVector.fromBody(body, role), request, role);
}

function sourceTravelTicks(state, request) {
  return routeContext(state, request).distance;
}

function safetyMarginTicks(queueDelay, spawnTicks, travelTicks) {
  const horizon = Math.max(0, queueDelay) + Math.max(0, spawnTicks) + Math.max(0, travelTicks);
  return Math.max(1, Math.ceil(horizon / 20));
}

function spawnSlots(state) {
  let spawns = [];
  if (state && state.room && typeof state.room.find === 'function' && typeof FIND_MY_SPAWNS !== 'undefined') {
    try { spawns = state.room.find(FIND_MY_SPAWNS) || []; } catch (err) {}
  }
  if (!spawns.length && state && state.spawn) spawns = [state.spawn];
  if (!spawns.length) return [];
  return spawns.map((spawn, index) => ({
    id: spawn.id || spawn.name || ('spawn-' + index),
    spawn,
    availableIn: spawn.spawning && Number.isFinite(spawn.spawning.remainingTime) ? Math.max(0, spawn.spawning.remainingTime) : 0
  }));
}

function earliestSlot(slots) {
  if (!slots.length) return null;
  let best = slots[0];
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].availableIn < best.availableIn ||
        (slots[i].availableIn === best.availableIn && String(slots[i].id) < String(best.id))) best = slots[i];
  }
  return best;
}

function currentAndSpawning(state, request) {
  let active = 0;
  let spawning = 0;
  const activeCreeps = [];
  const spawningCreeps = [];
  const spawnRemainingByName = {};
  if (state && state.room && typeof state.room.find === 'function' && typeof FIND_MY_SPAWNS !== 'undefined') {
    let spawns = [];
    try { spawns = state.room.find(FIND_MY_SPAWNS) || []; } catch (err) {}
    for (const spawn of spawns) {
      if (spawn && spawn.spawning && spawn.spawning.name) {
        spawnRemainingByName[spawn.spawning.name] = Number.isFinite(spawn.spawning.remainingTime)
          ? Math.max(0, spawn.spawning.remainingTime)
          : 0;
      }
    }
  }
  for (const creep of state.creeps || []) {
    const capacity = capacityForCreep(creep, request);
    if (capacity <= 0) continue;
    if (creep.spawning) {
      spawning += capacity;
      spawningCreeps.push({
        creep,
        capacity,
        remainingTime: Number.isFinite(spawnRemainingByName[creep.name]) ? spawnRemainingByName[creep.name] : 0
      });
    } else {
      active += capacity;
      activeCreeps.push({ creep, capacity });
    }
  }
  return { active, spawning, activeCreeps, spawningCreeps };
}

function projectedSurviving(entries, horizon) {
  let total = 0;
  for (const entry of entries || []) {
    const ttl = Number(entry.creep && entry.creep.ticksToLive);
    if (!Number.isFinite(ttl) || ttl > horizon) total += entry.capacity;
  }
  return total;
}

function spawningAvailableBy(entries, horizon, travelTicks) {
  let total = 0;
  for (const entry of entries || []) {
    const remaining = Number.isFinite(entry.remainingTime) ? Math.max(0, entry.remainingTime) : 0;
    if (remaining + travelTicks <= horizon) total += entry.capacity;
  }
  return total;
}

function priorityScore(request) {
  const p = request && request.priority || {};
  const strategic = p.strategicClass === 'RECOVERY' ? 1000 : p.strategicClass === 'CORE_ECONOMY' ? 500 : 0;
  return strategic + (Number(p.base) || 0) * 10 + (Number(p.urgency) || 0);
}

function sortedRequirements(requests) {
  return (requests || []).filter(requestIsCapacity).slice().sort((a, b) => {
    const delta = priorityScore(b) - priorityScore(a);
    if (delta) return delta;
    return String(a.id || a.dedupeKey).localeCompare(String(b.id || b.dedupeKey));
  });
}

function planRequirement(state, request, slots, planned, game) {
  const tick = now(game);
  const role = roleForRequest(request);
  const required = request.demand && Number.isFinite(request.demand.amount) ? Math.max(0, request.demand.amount) : 0;
  const current = currentAndSpawning(state, request);
  const energyCapacity = Math.max(0, Number(state.energyCapacityAvailable) || 0);
  const energyAvailable = Math.max(0, Number(state.energyAvailable) || 0);
  const primary = optimizeBody(role, request, Math.max(1, required), energyCapacity, state);
  const primaryBody = primary ? primary.body : [];
  const primaryCost = primary ? primary.cost : 0;
  const delivered = primary ? primary.capacityDelivered : 0;
  const spawnTicks = primary ? primary.spawnTicks : 0;
  const travelTicks = primary ? primary.travelTicks : sourceTravelTicks(state, request);

  const firstSlot = earliestSlot(slots);
  const firstQueue = firstSlot ? firstSlot.availableIn : 0;
  const firstSafety = safetyMarginTicks(firstQueue, spawnTicks, travelTicks);
  const firstHorizon = firstQueue + spawnTicks + travelTicks + firstSafety;
  const firstProjected = projectedSurviving(current.activeCreeps, firstHorizon);
  const firstSpawning = spawningAvailableBy(current.spawningCreeps, firstHorizon, travelTicks);
  const initialDeficit = Math.max(0, required - firstProjected - firstSpawning);

  const deficit = {
    id: 'deficit|' + String(request.id || request.dedupeKey),
    requestGroup: request.dedupeKey || request.id,
    target: request.target || { roomName: state.room && state.room.name || null },
    capability: request.demand ? request.demand.capability || null : null,
    role,
    required,
    active: current.active,
    projectedSurviving: firstProjected,
    queued: 0,
    spawning: firstSpawning,
    externallyCommitted: 0,
    deficit: initialDeficit,
    productiveStartHorizon: firstHorizon,
    deadlineTick: Number.isFinite(request.deadlineTick) ? request.deadlineTick : null,
    priority: request.priority || null,
    proposedCapacity: 0,
    uncoveredAfterPlan: initialDeficit,
    preSpawn: initialDeficit > 0 && current.active >= required
  };

  if (required <= 0 || initialDeficit <= 0) return { deficit, proposals: [] };
  if (!slots.length || !primaryBody.length || delivered <= 0 || primaryCost > energyCapacity) {
    deficit.unresolvedReason = !slots.length ? 'NO_SPAWN' : primaryCost > energyCapacity ? 'BODY_EXCEEDS_CAPACITY' : 'NO_DELIVERED_CAPACITY';
    return { deficit, proposals: [] };
  }

  const proposals = [];
  let lastRemaining = initialDeficit;
  let guard = 0;
  while (guard++ < MAX_PROPOSALS_PER_REQUIREMENT) {
    const slot = earliestSlot(slots);
    if (!slot) break;
    const queueDelay = slot.availableIn;
    const safety = safetyMarginTicks(queueDelay, spawnTicks, travelTicks);
    const horizon = queueDelay + spawnTicks + travelTicks + safety;
    const surviving = projectedSurviving(current.activeCreeps, horizon);
    const arrivingSpawning = spawningAvailableBy(current.spawningCreeps, horizon, travelTicks);
    let priorPlanned = 0;
    for (const item of planned) {
      if (item.sourceDeficitId === deficit.id && item.predicted.productiveStartTick <= tick + horizon) priorPlanned += item.capacityDelivered;
    }
    const remaining = Math.max(0, required - surviving - arrivingSpawning - priorPlanned);
    if (remaining <= 0) { lastRemaining = 0; break; }

    const optimized = optimizeBody(role, request, remaining, energyCapacity, state);
    if (!optimized || !optimized.body.length || optimized.capacityDelivered <= 0) {
      deficit.unresolvedReason = 'NO_OPTIMIZED_BODY';
      break;
    }
    const optimizedSpawnTicks = optimized.spawnTicks;
    const optimizedTravelTicks = optimized.travelTicks;
    const optimizedSafety = safetyMarginTicks(queueDelay, optimizedSpawnTicks, optimizedTravelTicks);
    const optimizedHorizon = queueDelay + optimizedSpawnTicks + optimizedTravelTicks + optimizedSafety;
    const optimizedSurviving = projectedSurviving(current.activeCreeps, optimizedHorizon);
    const optimizedSpawning = spawningAvailableBy(current.spawningCreeps, optimizedHorizon, optimizedTravelTicks);
    let optimizedPriorPlanned = 0;
    for (const item of planned) {
      if (item.sourceDeficitId === deficit.id && item.predicted.productiveStartTick <= tick + optimizedHorizon) optimizedPriorPlanned += item.capacityDelivered;
    }
    const optimizedRemaining = Math.max(0, required - optimizedSurviving - optimizedSpawning - optimizedPriorPlanned);
    if (optimizedRemaining <= 0) { lastRemaining = 0; break; }

    const fallback = optimizeBody(role, request, optimizedRemaining, energyAvailable, state);
    let fallbackBody = fallback && fallback.body.length ? fallback.body.slice() : null;
    if (!fallbackBody && request.kind === 'RECOVERY_CAPACITY') {
      const emergencyBody = emergencyFallbackBody(role, energyAvailable);
      if (emergencyBody.length && bodyCost(emergencyBody) <= energyAvailable) fallbackBody = emergencyBody;
    }

    const index = proposals.length;
    const proposal = {
      schemaVersion: SCHEMA_VERSION,
      id: 'spawn|' + String(state.room && state.room.name || 'room') + '|' + String(request.dedupeKey || request.id) + '|' + index,
      sourceDeficitId: deficit.id,
      sourceRequestId: request.id || null,
      role,
      priority: request.priority || null,
      deadlineTick: Number.isFinite(request.deadlineTick) ? request.deadlineTick : null,
      targetRoom: state.room && state.room.name || null,
      dutyTarget: request.target || null,
      body: optimized.body.slice(),
      bodySource: 'OPTIMIZER_V1',
      optimizer: {
        expectedRoi: optimized.expectedRoi,
        lifecycleCost: optimized.lifecycleCost,
        terrainProfile: optimized.terrainProfile,
        boostMultiplier: optimized.boostMultiplier
      },
      cost: optimized.cost,
      spawnTicks: optimizedSpawnTicks,
      capacityDelivered: optimized.capacityDelivered,
      capacityApplied: Math.min(optimized.capacityDelivered, optimizedRemaining),
      predicted: {
        spawnId: slot.id,
        queueDelay,
        travelTicks: optimizedTravelTicks,
        safetyMarginTicks: optimizedSafety,
        productiveStartTick: tick + optimizedHorizon,
        productiveLifetime: optimized.productiveLifetime,
        expectedUtility: optimized.expectedValue
      },
      fallbackBody
    };
    proposals.push(proposal);
    planned.push(proposal);
    deficit.proposedCapacity += proposal.capacityDelivered;
    lastRemaining = Math.max(0, optimizedRemaining - proposal.capacityDelivered);
    slot.availableIn += optimizedSpawnTicks;
  }

  deficit.queued = 0;
  deficit.uncoveredAfterPlan = lastRemaining;
  if (guard > MAX_PROPOSALS_PER_REQUIREMENT && deficit.uncoveredAfterPlan > 0) deficit.unresolvedReason = 'PROPOSAL_LIMIT';
  return { deficit, proposals };
}

function plan(state, requests, game) {
  const requirements = sortedRequirements(requests);
  const slots = spawnSlots(state);
  const planned = [];
  const deficits = [];
  for (const request of requirements) {
    const result = planRequirement(state, request, slots, planned, game);
    deficits.push(result.deficit);
  }

  let proposedCapacity = 0;
  let uncovered = 0;
  let preSpawnCount = 0;
  const proposedByRole = {};
  for (const deficit of deficits) {
    proposedCapacity += deficit.proposedCapacity || 0;
    uncovered += deficit.uncoveredAfterPlan || 0;
    if (deficit.preSpawn && deficit.proposedCapacity > 0) preSpawnCount += 1;
  }
  for (const request of planned) proposedByRole[request.role] = (proposedByRole[request.role] || 0) + 1;

  return {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW',
    deficits,
    spawnRequests: planned,
    summary: {
      schemaVersion: SCHEMA_VERSION,
      authority: 'SHADOW',
      deferred: false,
      requirementCount: requirements.length,
      deficitCount: deficits.filter(d => d.deficit > 0).length,
      spawnRequestCount: planned.length,
      preSpawnCount,
      proposedCapacity: Math.round(proposedCapacity * 100) / 100,
      uncoveredAfterPlan: Math.round(uncovered * 100) / 100,
      proposedByRole,
      bodySource: 'OPTIMIZER_V1'
    }
  };
}

function deferredSnapshot(reason) {
  return {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW',
    deficits: [],
    spawnRequests: [],
    summary: {
      schemaVersion: SCHEMA_VERSION,
      authority: 'SHADOW',
      deferred: true,
      deferReason: reason || 'DEFERRED',
      requirementCount: 0,
      deficitCount: 0,
      spawnRequestCount: 0,
      preSpawnCount: 0,
      proposedCapacity: 0,
      uncoveredAfterPlan: 0,
      proposedByRole: {},
      bodySource: 'OPTIMIZER_V1'
    }
  };
}

module.exports = {
  SCHEMA_VERSION,
  plan,
  deferredSnapshot,
  _test: {
    roleForRequest,
    requestIsCapacity,
    bodyCost,
    emergencyFallbackBody,
    routeContext,
    optimizeBody,
    capacityForRequestFromVector,
    capacityForCreep,
    capacityForBody,
    sourceTravelTicks,
    safetyMarginTicks,
    spawnSlots,
    earliestSlot,
    currentAndSpawning,
    projectedSurviving,
    spawningAvailableBy,
    priorityScore,
    sortedRequirements,
    planRequirement
  }
};