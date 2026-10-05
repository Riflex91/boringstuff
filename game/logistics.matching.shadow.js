'use strict';

const registry = require('request.registry');

const SCHEMA_VERSION = 1;
const LOGISTICS_KINDS = Object.freeze({
  PICKUP: true,
  DELIVER: true,
  BALANCE: true,
  RESERVE: true,
  EMERGENCY_DELIVER: true
});
const TERMINAL = Object.freeze({
  SATISFIED: true,
  EXPIRED: true,
  CANCELLED: true,
  BLOCKED: true
});

function tick(game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  return game && Number.isFinite(game.time) ? game.time : 0;
}

function ensure(memoryRoot) {
  memoryRoot = memoryRoot || (typeof Memory !== 'undefined' ? Memory : null);
  if (!memoryRoot) return { schemaVersion: SCHEMA_VERSION, rooms: {} };
  if (!memoryRoot.bot) memoryRoot.bot = {};
  if (!memoryRoot.bot.logisticsMatching || memoryRoot.bot.logisticsMatching.schemaVersion !== SCHEMA_VERSION) {
    memoryRoot.bot.logisticsMatching = { schemaVersion: SCHEMA_VERSION, rooms: {} };
  }
  if (!memoryRoot.bot.logisticsMatching.rooms) memoryRoot.bot.logisticsMatching.rooms = {};
  return memoryRoot.bot.logisticsMatching;
}

function ensureRoom(roomName, memoryRoot) {
  const root = ensure(memoryRoot);
  if (!root.rooms[roomName]) {
    root.rooms[roomName] = {
      previousByHauler: {},
      lastPlanTick: null,
      lastSummary: null
    };
  }
  if (!root.rooms[roomName].previousByHauler) root.rooms[roomName].previousByHauler = {};
  return root.rooms[roomName];
}

function role(creep) {
  return creep && creep.memory && creep.memory.role ? creep.memory.role : null;
}

function resourceKey() {
  return typeof RESOURCE_ENERGY !== 'undefined' ? RESOURCE_ENERGY : 'energy';
}

function carried(creep) {
  if (!creep || !creep.store) return 0;
  return Math.max(0, Number(creep.store[resourceKey()]) || 0);
}

function freeCapacity(creep) {
  if (!creep || !creep.store) return 0;
  if (typeof creep.store.getFreeCapacity === 'function') {
    return Math.max(0, Number(creep.store.getFreeCapacity(resourceKey())) || 0);
  }
  if (typeof creep.store.getCapacity === 'function') {
    return Math.max(0, (Number(creep.store.getCapacity(resourceKey())) || 0) - carried(creep));
  }
  return 0;
}

function posOf(value) {
  return value && value.pos ? value.pos : value;
}

function range(a, b) {
  const ap = posOf(a);
  const bp = posOf(b);
  if (!ap || !bp) return 50;
  const ar = ap.roomName || (a && a.room && a.room.name);
  const br = bp.roomName || (b && b.room && b.room.name);
  if (ar && br && ar !== br) return 50;
  if (typeof ap.getRangeTo === 'function') {
    try { return Math.max(0, Number(ap.getRangeTo(bp)) || 0); } catch (err) {}
  }
  if (!Number.isFinite(ap.x) || !Number.isFinite(ap.y) || !Number.isFinite(bp.x) || !Number.isFinite(bp.y)) return 50;
  return Math.max(Math.abs(ap.x - bp.x), Math.abs(ap.y - bp.y));
}

function endpointRange(creep, endpoint) {
  if (!endpoint) return 50;
  return range(creep, endpoint.pos || endpoint);
}

function endpointToEndpointRange(a, b) {
  if (!a || !b) return 50;
  return range(a.pos || a, b.pos || b);
}

function logisticsRequest(request) {
  return !!request &&
    request.domain === 'logistics' &&
    !!LOGISTICS_KINDS[request.kind] &&
    !TERMINAL[request.status];
}

function reservedAmount(request) {
  return (request && Array.isArray(request.reservations) ? request.reservations : [])
    .reduce((sum, item) => sum + (Number.isFinite(item.amount) ? Math.max(0, item.amount) : 0), 0);
}

function remainingAmount(request) {
  if (!request || !request.demand) return 0;
  const demand = Math.max(0, Number(request.demand.amount) || 0);
  const progress = request.progress && Number.isFinite(request.progress.amount)
    ? Math.max(0, request.progress.amount)
    : 0;
  return Math.max(0, demand - progress - reservedAmount(request));
}

function priorityScore(request) {
  const p = request && request.priority || {};
  let strategic = 0;
  if (p.strategicClass === 'RECOVERY') strategic = 120;
  else if (p.strategicClass === 'CORE_ECONOMY') strategic = 60;
  else if (p.strategicClass === 'PRODUCTIVE_WORK') strategic = 20;
  return strategic + (Number(p.base) || 0) + (Number(p.urgency) || 0);
}

function deadlineScore(request, now) {
  if (!request || !Number.isFinite(request.deadlineTick)) return 0;
  const remaining = request.deadlineTick - now;
  if (remaining <= 0) return 100;
  if (remaining >= 100) return 0;
  return 100 - remaining;
}

function previousBonus(roomState, haulerId, supply, demand) {
  const previous = roomState.previousByHauler[haulerId];
  if (!previous) return 0;
  const supplyId = supply ? supply.id : null;
  const demandId = demand ? demand.id : null;
  if (supplyId && previous.supplyRequestId === supplyId && previous.demandRequestId === demandId) return 25;
  if (demandId && previous.demandRequestId === demandId) return 12;
  if (supplyId && previous.supplyRequestId === supplyId) return 6;
  return 0;
}

function conflictPenalty(request) {
  const reservations = request && Array.isArray(request.reservations) ? request.reservations.length : 0;
  return Math.min(30, reservations * 5);
}

function directCandidate(creep, demand, roomState, now) {
  const amountCarried = carried(creep);
  const remaining = remainingAmount(demand);
  if (amountCarried <= 0 || remaining <= 0 || !demand.target) return null;
  const amount = Math.min(amountCarried, remaining);
  const haulerId = creep.id || creep.name;
  const travel = endpointRange(creep, demand.target);
  const priority = priorityScore(demand);
  const deadline = deadlineScore(demand, now);
  const carriedBonus = Math.min(40, 15 + amount / 10);
  const routeReuse = previousBonus(roomState, haulerId, null, demand);
  const conflict = conflictPenalty(demand);
  const score = priority + deadline + carriedBonus + routeReuse - travel * 2 - conflict;
  return {
    mode: 'DIRECT_CARRIED',
    creep,
    haulerId,
    supply: null,
    demand,
    amount,
    score,
    components: {
      priority,
      deadline,
      carriedResourceBonus: carriedBonus,
      routeReuse,
      travelCost: travel * 2,
      detour: 0,
      conflict
    },
    pickupEta: 0,
    deliveryEta: travel
  };
}

function pairedCandidate(creep, supply, demand, roomState, now) {
  const free = freeCapacity(creep);
  const supplyRemaining = remainingAmount(supply);
  const demandRemaining = remainingAmount(demand);
  if (free <= 0 || supplyRemaining <= 0 || demandRemaining <= 0) return null;
  if (!supply.source || !demand.target) return null;

  const amount = Math.min(free, supplyRemaining, demandRemaining);
  if (amount <= 0) return null;

  const haulerId = creep.id || creep.name;
  const toSource = endpointRange(creep, supply.source);
  const sourceToTarget = endpointToEndpointRange(supply.source, demand.target);
  const directToTarget = endpointRange(creep, demand.target);
  const detourDistance = Math.max(0, toSource + sourceToTarget - directToTarget);
  const priority = priorityScore(demand);
  const deadline = deadlineScore(demand, now);
  const routeReuse = previousBonus(roomState, haulerId, supply, demand);
  const conflict = conflictPenalty(supply) + conflictPenalty(demand);
  const travelCost = toSource + sourceToTarget;
  const detour = detourDistance;
  const score = priority + deadline + routeReuse - travelCost - detour - conflict;

  return {
    mode: 'PICKUP_DELIVER',
    creep,
    haulerId,
    supply,
    demand,
    amount,
    score,
    components: {
      priority,
      deadline,
      carriedResourceBonus: 0,
      routeReuse,
      travelCost,
      detour,
      conflict
    },
    pickupEta: toSource,
    deliveryEta: toSource + sourceToTarget
  };
}

function balanceCandidate(creep, request, roomState, now) {
  const free = freeCapacity(creep);
  const remaining = remainingAmount(request);
  if (free <= 0 || remaining <= 0 || !request.source || !request.target) return null;
  const amount = Math.min(free, remaining);
  const haulerId = creep.id || creep.name;
  const toSource = endpointRange(creep, request.source);
  const sourceToTarget = endpointToEndpointRange(request.source, request.target);
  const directToTarget = endpointRange(creep, request.target);
  const detourDistance = Math.max(0, toSource + sourceToTarget - directToTarget);
  const priority = priorityScore(request);
  const deadline = deadlineScore(request, now);
  const routeReuse = previousBonus(roomState, haulerId, request, request);
  const conflict = conflictPenalty(request);
  const travelCost = toSource + sourceToTarget;
  const detour = detourDistance;
  const score = priority + deadline + routeReuse - travelCost - detour - conflict;
  return {
    mode: 'BALANCE',
    creep,
    haulerId,
    supply: request,
    demand: request,
    amount,
    score,
    components: {
      priority,
      deadline,
      carriedResourceBonus: 0,
      routeReuse,
      travelCost,
      detour,
      conflict
    },
    pickupEta: toSource,
    deliveryEta: toSource + sourceToTarget
  };
}

function demandTier(candidate) {
  return candidate && candidate.demand && candidate.demand.kind === 'EMERGENCY_DELIVER' ? 1 : 0;
}

function candidateKey(candidate) {
  return [
    candidate.haulerId,
    candidate.supply ? candidate.supply.id : '',
    candidate.demand ? candidate.demand.id : '',
    candidate.mode
  ].join('|');
}

function better(a, b) {
  if (!b) return true;
  const aTier = demandTier(a);
  const bTier = demandTier(b);
  if (aTier !== bTier) return aTier > bTier;
  if (a.score !== b.score) return a.score > b.score;
  if (a.deliveryEta !== b.deliveryEta) return a.deliveryEta < b.deliveryEta;
  if (a.amount !== b.amount) return a.amount > b.amount;
  return candidateKey(a) < candidateKey(b);
}

function activeSets(requests) {
  const logistics = (requests || []).filter(logisticsRequest);
  return {
    pickup: logistics.filter(r => r.kind === 'PICKUP'),
    demand: logistics.filter(r => r.kind === 'DELIVER' || r.kind === 'EMERGENCY_DELIVER' || r.kind === 'RESERVE'),
    balance: logistics.filter(r => r.kind === 'BALANCE')
  };
}

function makeCandidates(creep, sets, roomState, now) {
  const result = [];
  if (carried(creep) > 0) {
    for (const demand of sets.demand) {
      const candidate = directCandidate(creep, demand, roomState, now);
      if (candidate && candidate.score > 0) result.push(candidate);
    }
  }
  if (freeCapacity(creep) > 0 && carried(creep) === 0) {
    for (const supply of sets.pickup) {
      for (const demand of sets.demand) {
        const candidate = pairedCandidate(creep, supply, demand, roomState, now);
        if (candidate && candidate.score > 0) result.push(candidate);
      }
    }
    for (const request of sets.balance) {
      const candidate = balanceCandidate(creep, request, roomState, now);
      if (candidate && candidate.score > 0) result.push(candidate);
    }
  }
  return result;
}

function revalidatedAmount(candidate) {
  if (!candidate || !candidate.creep || !candidate.demand) return 0;
  if (candidate.mode === 'DIRECT_CARRIED') {
    return Math.min(carried(candidate.creep), remainingAmount(candidate.demand));
  }
  if (candidate.mode === 'PICKUP_DELIVER') {
    if (!candidate.supply || carried(candidate.creep) > 0) return 0;
    return Math.min(
      freeCapacity(candidate.creep),
      remainingAmount(candidate.supply),
      remainingAmount(candidate.demand)
    );
  }
  if (candidate.mode === 'BALANCE') {
    if (carried(candidate.creep) > 0) return 0;
    return Math.min(freeCapacity(candidate.creep), remainingAmount(candidate.demand));
  }
  return 0;
}

function reserveMatch(roomName, candidate, memoryRoot, game) {
  const validUntilTick = tick(game);
  const reservations = [];
  if (candidate.supply && candidate.supply !== candidate.demand) {
    const supplyReservation = registry.reserve(roomName, candidate.supply.dedupeKey, {
      ownerType: 'hauler-shadow',
      ownerId: candidate.haulerId,
      amount: candidate.amount,
      validUntilTick,
      revalidateOn: 'E4_NEXT_TICK'
    }, memoryRoot, game);
    if (supplyReservation) reservations.push(supplyReservation);
  }
  if (candidate.demand) {
    const demandReservation = registry.reserve(roomName, candidate.demand.dedupeKey, {
      ownerType: 'hauler-shadow',
      ownerId: candidate.haulerId,
      amount: candidate.amount,
      validUntilTick,
      revalidateOn: 'E4_NEXT_TICK'
    }, memoryRoot, game);
    if (demandReservation) reservations.push(demandReservation);
  }
  return reservations;
}

function plan(state, requests, memoryRoot, game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const now = tick(game);
  const roomName = state && state.room && state.room.name;
  if (!roomName) return deferredSnapshot('NO_ROOM');
  const roomState = ensureRoom(roomName, memoryRoot);
  const sets = activeSets(requests);
  const initialCritical = sets.demand.filter(r => r.kind === 'EMERGENCY_DELIVER' && remainingAmount(r) > 0);
  const haulers = (state.creeps || []).filter(c => c && !c.spawning && role(c) === 'hauler' && (c.id || c.name));
  const candidates = [];
  for (const hauler of haulers) candidates.push(...makeCandidates(hauler, sets, roomState, now));
  candidates.sort((a, b) => better(a, b) ? -1 : (better(b, a) ? 1 : 0));

  const jobs = [];
  const usedHaulers = {};
  for (const candidate of candidates) {
    if (usedHaulers[candidate.haulerId]) continue;
    const amount = revalidatedAmount(candidate);
    if (amount <= 0) continue;
    candidate.amount = amount;

    const reservations = reserveMatch(roomName, candidate, memoryRoot, game);
    const job = {
      schemaVersion: SCHEMA_VERSION,
      authority: 'SHADOW',
      id: 'e4|' + roomName + '|' + candidate.haulerId + '|' + now,
      haulerId: candidate.haulerId,
      mode: candidate.mode,
      supplyRequestId: candidate.supply ? candidate.supply.id : null,
      demandRequestId: candidate.demand ? candidate.demand.id : null,
      supplyDedupeKey: candidate.supply ? candidate.supply.dedupeKey : null,
      demandDedupeKey: candidate.demand ? candidate.demand.dedupeKey : null,
      amount: candidate.amount,
      demandTier: demandTier(candidate),
      score: Math.round(candidate.score * 100) / 100,
      scoreComponents: candidate.components,
      predicted: {
        pickupTick: candidate.supply ? now + candidate.pickupEta : null,
        deliveryTick: now + candidate.deliveryEta,
        transportTicks: candidate.deliveryEta
      },
      reservationIds: reservations.map(r => r.id),
      requestKind: candidate.demand ? candidate.demand.kind : null,
      critical: !!(candidate.demand && candidate.demand.kind === 'EMERGENCY_DELIVER')
    };
    jobs.push(job);
    usedHaulers[candidate.haulerId] = true;
    if (jobs.length >= haulers.length) break;
  }

  const previousByHauler = {};
  for (const job of jobs) {
    previousByHauler[job.haulerId] = {
      supplyRequestId: job.supplyRequestId,
      demandRequestId: job.demandRequestId,
      tick: now
    };
  }
  roomState.previousByHauler = previousByHauler;
  roomState.lastPlanTick = now;

  const matchedCritical = {};
  for (const job of jobs) if (job.critical && job.demandRequestId) matchedCritical[job.demandRequestId] = true;
  const unmatchedCritical = initialCritical.filter(r => !matchedCritical[r.id]);

  const reservedAmountTotal = jobs.reduce((sum, job) => sum + job.amount, 0);
  const etaTotal = jobs.reduce((sum, job) => sum + (job.predicted.transportTicks || 0), 0);
  const summary = {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW',
    planTick: now,
    deferred: false,
    deferReason: null,
    haulerCount: haulers.length,
    candidateCount: candidates.length,
    jobCount: jobs.length,
    matchedHaulerCount: jobs.length,
    haulerUtilization: haulers.length ? Math.round((jobs.length / haulers.length) * 1000) / 1000 : 0,
    pairedJobCount: jobs.filter(j => j.mode === 'PICKUP_DELIVER' || j.mode === 'BALANCE').length,
    directCarriedJobCount: jobs.filter(j => j.mode === 'DIRECT_CARRIED').length,
    criticalRequestCount: initialCritical.length,
    criticalMatchedCount: Object.keys(matchedCritical).length,
    unmatchedCriticalCount: unmatchedCritical.length,
    reservedAmount: Math.round(reservedAmountTotal * 100) / 100,
    averageTransportTicks: jobs.length ? Math.round((etaTotal / jobs.length) * 100) / 100 : 0
  };
  roomState.lastSummary = summary;

  return {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW',
    jobs,
    unmatchedCritical: unmatchedCritical.map(r => ({
      requestId: r.id,
      dedupeKey: r.dedupeKey,
      amount: remainingAmount(r),
      target: r.target || null
    })),
    summary,
    requestSummary: registry.snapshot(roomName, memoryRoot)
  };
}

function deferredSnapshot(reason) {
  return {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW',
    jobs: [],
    unmatchedCritical: [],
    summary: {
      schemaVersion: SCHEMA_VERSION,
      authority: 'SHADOW',
      planTick: null,
      deferred: true,
      deferReason: reason || 'DEFERRED',
      haulerCount: 0,
      candidateCount: 0,
      jobCount: 0,
      matchedHaulerCount: 0,
      haulerUtilization: 0,
      pairedJobCount: 0,
      directCarriedJobCount: 0,
      criticalRequestCount: 0,
      criticalMatchedCount: 0,
      unmatchedCriticalCount: 0,
      reservedAmount: 0,
      averageTransportTicks: 0
    },
    requestSummary: null
  };
}

module.exports = {
  SCHEMA_VERSION,
  plan,
  deferredSnapshot,
  _test: {
    ensure,
    ensureRoom,
    role,
    carried,
    freeCapacity,
    range,
    logisticsRequest,
    reservedAmount,
    remainingAmount,
    priorityScore,
    demandTier,
    better,
    deadlineScore,
    previousBonus,
    conflictPenalty,
    directCandidate,
    pairedCandidate,
    balanceCandidate,
    activeSets,
    makeCandidates,
    revalidatedAmount,
    better
  }
};
