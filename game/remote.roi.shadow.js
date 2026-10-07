'use strict';

const config = require('config');
const worldIntel = require('world.intel');
const routeCache = require('path.route.cache');

const SCHEMA_VERSION = 1;
const AUTHORITY = 'SHADOW';
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_CANDIDATES = 12;
const DEFAULT_INTEL_MAX_AGE = 1500;
const DEFAULT_MAX_ROUTE_HOPS = 3;
const DEFAULT_MEMORY_RETENTION = 5000;
const DEFAULT_TICKS_PER_ROOM = 50;
const DEFAULT_LOCAL_ENDPOINT_TICKS = 25;
const DEFAULT_INFRASTRUCTURE_HORIZON = 100000;

function numberOption(options, key, fallback, min, max) {
  const value = options && Number.isFinite(options[key]) ? options[key] : fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function round(value, digits) {
  const scale = Math.pow(10, Number.isFinite(digits) ? digits : 3);
  return Math.round((Number(value) || 0) * scale) / scale;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ensure(memoryRoot) {
  memoryRoot = memoryRoot || (typeof Memory !== 'undefined' ? Memory : null);
  if (!memoryRoot) return { schemaVersion: SCHEMA_VERSION, rooms: {} };
  if (!memoryRoot.bot) memoryRoot.bot = {};
  if (!memoryRoot.bot.remoteRoiShadow || memoryRoot.bot.remoteRoiShadow.schemaVersion !== SCHEMA_VERSION) {
    memoryRoot.bot.remoteRoiShadow = { schemaVersion: SCHEMA_VERSION, rooms: {} };
  }
  if (!memoryRoot.bot.remoteRoiShadow.rooms) memoryRoot.bot.remoteRoiShadow.rooms = {};
  return memoryRoot.bot.remoteRoiShadow;
}

function homeRoom(state) {
  return state && state.room && state.room.name ? state.room.name : null;
}

function homeUsername(state) {
  const controller = state && state.room && state.room.controller;
  if (controller && controller.owner && controller.owner.username) return String(controller.owner.username);
  const spawn = state && state.spawn;
  if (spawn && spawn.owner && spawn.owner.username) return String(spawn.owner.username);
  return null;
}

function intelStore(memoryRoot) {
  return worldIntel.ensure(memoryRoot).rooms || {};
}

function discoverCandidates(state, memoryRoot, options) {
  const home = homeRoom(state);
  if (!home) return [];
  const records = intelStore(memoryRoot);
  const maxDepth = numberOption(options, 'maxDepth', DEFAULT_MAX_DEPTH, 1, 6);
  const queue = [{ roomName: home, depth: 0 }];
  const seen = { [home]: true };
  const result = [];

  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= maxDepth) continue;
    const record = records[current.roomName];
    if (!record || !record.topology || !Array.isArray(record.topology.exits)) continue;

    const exits = record.topology.exits
      .map(exit => exit && exit.roomName)
      .filter(Boolean)
      .sort();

    for (const roomName of exits) {
      if (seen[roomName]) continue;
      seen[roomName] = true;
      const depth = current.depth + 1;
      if (records[roomName]) {
        result.push({ roomName, depth, record: records[roomName] });
        if (depth < maxDepth) queue.push({ roomName, depth });
      }
    }
  }

  return result
    .sort((a, b) => a.depth - b.depth || a.roomName.localeCompare(b.roomName))
    .slice(0, numberOption(options, 'maxCandidates', DEFAULT_MAX_CANDIDATES, 1, 50));
}

function bodyPartCost(name) {
  const key = String(name || '').toLowerCase();
  if (typeof BODYPART_COST !== 'undefined' && BODYPART_COST && Number.isFinite(BODYPART_COST[key])) {
    return BODYPART_COST[key];
  }
  if (key === 'work') return 100;
  if (key === 'carry') return 50;
  if (key === 'move') return 50;
  if (key === 'claim') return 600;
  return 0;
}

function runtimeConstants() {
  return {
    sourceCapacity: typeof SOURCE_ENERGY_CAPACITY !== 'undefined' ? SOURCE_ENERGY_CAPACITY : 3000,
    regenTime: typeof ENERGY_REGEN_TIME !== 'undefined' ? ENERGY_REGEN_TIME : 300,
    harvestPower: typeof HARVEST_POWER !== 'undefined' ? HARVEST_POWER : 2,
    carryCapacity: typeof CARRY_CAPACITY !== 'undefined' ? CARRY_CAPACITY : 50,
    creepLife: typeof CREEP_LIFE_TIME !== 'undefined' ? CREEP_LIFE_TIME : 1500
  };
}

function hostileProbability(record, now) {
  const threat = record && record.threat || {};
  const current = Math.max(0, Number(threat.hostileCreeps) || 0);
  if (current > 0) return 0.5;
  const last = Number(threat.lastHostileTick);
  if (!Number.isFinite(last)) return 0;
  const age = Math.max(0, now - last);
  if (age <= 250) return 0.25;
  if (age <= 1000) return 0.1;
  return 0;
}

function candidateEligibility(candidate, state, memoryRoot, game, options) {
  const record = candidate.record || {};
  const now = game && Number.isFinite(game.time) ? game.time : 0;
  const maxAge = numberOption(options, 'intelMaxAge', DEFAULT_INTEL_MAX_AGE, 1, 10000);
  const fresh = worldIntel.freshness(candidate.roomName, now, maxAge, memoryRoot);
  const controller = record.controller || {};
  const resources = record.resources || {};
  const classification = record.classification || {};
  const username = homeUsername(state);

  if (!fresh.known) return { ok: false, reason: 'INTEL_UNKNOWN', fresh };
  if (!fresh.fresh) return { ok: false, reason: 'INTEL_STALE', fresh };
  if (classification.roomStatus && classification.roomStatus !== 'normal') {
    return { ok: false, reason: 'ROOM_STATUS_' + String(classification.roomStatus).toUpperCase(), fresh };
  }
  if (controller.my) return { ok: false, reason: 'OWNED_ROOM', fresh };
  if (controller.owner) return { ok: false, reason: 'OCCUPIED_ROOM', fresh };
  if ((Number(resources.sourceCount) || 0) <= 0) return { ok: false, reason: 'NO_SOURCES', fresh };
  if (controller.reservationOwner && username && controller.reservationOwner !== username) {
    return { ok: false, reason: 'FOREIGN_RESERVATION', fresh };
  }
  return { ok: true, reason: null, fresh };
}

function hostileRooms(memoryRoot, home, target) {
  const records = intelStore(memoryRoot);
  const result = {};
  for (const roomName of Object.keys(records)) {
    if (roomName === home || roomName === target) continue;
    const record = records[roomName];
    if (record && record.threat && Number(record.threat.hostileCreeps) > 0) result[roomName] = true;
    if (record && record.controller && record.controller.owner && !record.controller.my) result[roomName] = true;
  }
  return result;
}

function routeFor(home, target, memoryRoot, game, options) {
  if (options && typeof options.routeProvider === 'function') {
    return options.routeProvider(home, target);
  }
  return routeCache.getWorldRoute(home, target, {
    tick: game && game.time,
    map: game && game.map,
    hostileRooms: hostileRooms(memoryRoot, home, target),
    routeClass: 'remote-roi-shadow',
    intelProvider(roomName) {
      return worldIntel.get(roomName, memoryRoot);
    }
  }, memoryRoot);
}

function capacityBudgetEligible(state, game) {
  if (state && state.emergency) return false;
  const bucket = game && game.cpu ? Number(game.cpu.bucket) : NaN;
  if (Number.isFinite(bucket) && bucket < config.CPU_BUCKET_HEALTHY) return false;
  return true;
}

function estimateCosts(candidate, route, state, game, options) {
  const record = candidate.record;
  const now = game && Number.isFinite(game.time) ? game.time : 0;
  const constants = runtimeConstants();
  const sourceCount = Math.max(0, Number(record.resources && record.resources.sourceCount) || 0);
  const incomePerSource = constants.sourceCapacity / Math.max(1, constants.regenTime);
  const grossIncomePerTick = sourceCount * incomePerSource;
  const routeRooms = Array.isArray(route.rooms) ? route.rooms : [];
  const routeHops = Math.max(0, routeRooms.length - 1);
  const ticksPerRoom = numberOption(options, 'ticksPerRoom', DEFAULT_TICKS_PER_ROOM, 1, 200);
  const endpointTicks = numberOption(options, 'localEndpointTicks', DEFAULT_LOCAL_ENDPOINT_TICKS, 0, 100);
  const oneWayTicks = routeHops * ticksPerRoom + endpointTicks;
  const roundTripTicks = oneWayTicks * 2;

  const minerWorkPartsPerSource = Math.ceil(incomePerSource / Math.max(1, constants.harvestPower));
  const minerCarryPartsPerSource = 1;
  const minerMovePartsPerSource = Math.ceil((minerWorkPartsPerSource + minerCarryPartsPerSource) / 2);
  const minerBodyCostPerSource =
    minerWorkPartsPerSource * bodyPartCost('work') +
    minerCarryPartsPerSource * bodyPartCost('carry') +
    minerMovePartsPerSource * bodyPartCost('move');
  const minerAmortized = sourceCount * minerBodyCostPerSource / Math.max(1, constants.creepLife);

  const requiredCarryParts = Math.ceil(grossIncomePerTick * roundTripTicks / Math.max(1, constants.carryCapacity));
  const haulerMoveParts = Math.ceil(requiredCarryParts / 2);
  const haulerBodyCost =
    requiredCarryParts * bodyPartCost('carry') +
    haulerMoveParts * bodyPartCost('move');
  const haulingAmortized = haulerBodyCost / Math.max(1, constants.creepLife);

  const controllerExists = !!(record.controller && record.controller.exists);
  const reserveBodyCost = bodyPartCost('claim') + bodyPartCost('move');
  const reservationCycle = Math.max(1000, 5000 - oneWayTicks);
  const reservationCost = controllerExists ? reserveBodyCost / reservationCycle : 0;

  const infrastructureHorizon = numberOption(
    options,
    'infrastructureHorizon',
    DEFAULT_INFRASTRUCTURE_HORIZON,
    10000,
    1000000
  );
  const estimatedRoadTiles = oneWayTicks;
  const infrastructureCost =
    estimatedRoadTiles * 300 / infrastructureHorizon +
    sourceCount * 5000 / infrastructureHorizon;

  const repairCost = estimatedRoadTiles * 0.001 + sourceCount * 0.05;
  const travelLoss = grossIncomePerTick * Math.min(0.25, oneWayTicks / Math.max(1, constants.creepLife));
  const hostileRisk = hostileProbability(record, now);
  const expectedHostileLoss = grossIncomePerTick * hostileRisk;
  const cpuOpportunityCost = 0.02 * (routeHops + sourceCount);

  const costs = {
    minerAmortized,
    haulingAmortized,
    reservationCost,
    infrastructureCost,
    repairCost,
    travelLoss,
    expectedHostileLoss,
    cpuOpportunityCost
  };
  const totalCostPerTick = Object.values(costs).reduce((sum, value) => sum + value, 0);
  const netEnergyPerTick = grossIncomePerTick - totalCostPerTick;
  const routeConfidence = Number.isFinite(route.confidence) ? clamp(route.confidence, 0, 1) : 1;
  const intelConfidence = candidate.eligibility && candidate.eligibility.fresh
    ? clamp(Number(candidate.eligibility.fresh.confidence) || 0, 0, 1)
    : 0;
  const confidence = Math.min(routeConfidence, intelConfidence || routeConfidence);
  const confidenceAdjustedNet = netEnergyPerTick * confidence;

  return {
    sourceCount,
    grossIncomePerTick: round(grossIncomePerTick, 3),
    routeHops,
    routeRooms,
    oneWayTicks,
    roundTripTicks,
    requiredCarryParts,
    hostileRisk: round(hostileRisk, 3),
    costs: Object.fromEntries(Object.entries(costs).map(([key, value]) => [key, round(value, 3)])),
    totalCostPerTick: round(totalCostPerTick, 3),
    netEnergyPerTick: round(netEnergyPerTick, 3),
    confidence: round(confidence, 3),
    confidenceAdjustedNet: round(confidenceAdjustedNet, 3),
    score: round(clamp(grossIncomePerTick > 0 ? confidenceAdjustedNet / grossIncomePerTick * 100 : 0, 0, 100), 2)
  };
}

function evaluateCandidate(candidate, state, memoryRoot, game, options) {
  const home = homeRoom(state);
  const eligibility = candidateEligibility(candidate, state, memoryRoot, game, options);
  candidate.eligibility = eligibility;
  const base = {
    roomName: candidate.roomName,
    homeRoom: home,
    depth: candidate.depth,
    authority: AUTHORITY,
    activationAuthority: 'NONE',
    evaluatedTick: game && Number.isFinite(game.time) ? game.time : 0,
    intelAge: eligibility.fresh ? eligibility.fresh.age : null,
    intelConfidence: eligibility.fresh ? eligibility.fresh.confidence : 0
  };

  if (!eligibility.ok) {
    return Object.assign(base, {
      status: 'UNAVAILABLE',
      reason: eligibility.reason,
      economicallyViable: false,
      capacityBudgetEligible: capacityBudgetEligible(state, game),
      recommendedState: 'SUSPENDED',
      score: 0,
      netEnergyPerTick: null,
      route: null,
      economics: null
    });
  }

  const route = routeFor(home, candidate.roomName, memoryRoot, game, options);
  if (!route || !route.ok) {
    return Object.assign(base, {
      status: 'UNAVAILABLE',
      reason: route && route.reason || 'ROUTE_UNAVAILABLE',
      economicallyViable: false,
      capacityBudgetEligible: capacityBudgetEligible(state, game),
      recommendedState: 'SUSPENDED',
      score: 0,
      netEnergyPerTick: null,
      route: route || null,
      economics: null
    });
  }

  const routeHops = Math.max(0, (route.rooms || []).length - 1);
  const maxRouteHops = numberOption(options, 'maxRouteHops', DEFAULT_MAX_ROUTE_HOPS, 1, 10);
  if (routeHops > maxRouteHops) {
    return Object.assign(base, {
      status: 'UNAVAILABLE',
      reason: 'ROUTE_TOO_LONG',
      economicallyViable: false,
      capacityBudgetEligible: capacityBudgetEligible(state, game),
      recommendedState: 'SUSPENDED',
      score: 0,
      netEnergyPerTick: null,
      route: {
        rooms: (route.rooms || []).slice(),
        hops: routeHops,
        confidence: route.confidence,
        cached: !!route.cached
      },
      economics: null
    });
  }

  const economics = estimateCosts(candidate, route, state, game, options);
  const budgetEligible = capacityBudgetEligible(state, game);
  const currentHostiles = Math.max(0, Number(candidate.record.threat && candidate.record.threat.hostileCreeps) || 0);
  const economicallyViable = economics.confidenceAdjustedNet > 0;
  const recommendedState = currentHostiles > 0
    ? 'THREATENED'
    : economicallyViable && budgetEligible
      ? 'CANDIDATE'
      : 'SUSPENDED';

  return Object.assign(base, {
    status: 'READY',
    reason: null,
    economicallyViable,
    capacityBudgetEligible: budgetEligible,
    recommendedState,
    score: economics.score,
    netEnergyPerTick: economics.netEnergyPerTick,
    route: {
      rooms: (route.rooms || []).slice(),
      hops: routeHops,
      confidence: Number.isFinite(route.confidence) ? route.confidence : null,
      cached: !!route.cached
    },
    economics
  });
}

function publishIntelScores(home, results, memoryRoot, now) {
  const records = intelStore(memoryRoot);
  for (const result of results) {
    const record = records[result.roomName];
    if (!record) continue;
    if (!record.economics) record.economics = {};
    let remoteScore = record.economics.remoteScore;
    if (!remoteScore || remoteScore.schemaVersion !== SCHEMA_VERSION || !remoteScore.byHome) {
      remoteScore = { schemaVersion: SCHEMA_VERSION, byHome: {} };
    }
    remoteScore.byHome[home] = {
      evaluatedTick: now,
      authority: AUTHORITY,
      activationAuthority: 'NONE',
      status: result.status,
      reason: result.reason,
      score: result.score,
      netEnergyPerTick: result.netEnergyPerTick,
      economicallyViable: result.economicallyViable,
      capacityBudgetEligible: result.capacityBudgetEligible,
      recommendedState: result.recommendedState
    };
    record.economics.remoteScore = remoteScore;
    record.economics.dynamicScoreTick = now;
  }
}

function evaluate(state, memoryRoot, game, options) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const home = homeRoom(state);
  const now = game && Number.isFinite(game.time) ? game.time : 0;
  const base = {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    activationAuthority: 'NONE',
    remoteMiningEnabled: !!config.ENABLE_REMOTE_MINING,
    homeRoom: home,
    evaluatedTick: now
  };

  if (!home) return Object.assign(base, { status: 'UNAVAILABLE', reason: 'OWNED_ROOM_REQUIRED', candidates: [] });

  const discovered = discoverCandidates(state, memoryRoot, options);
  const results = discovered
    .map(candidate => evaluateCandidate(candidate, state, memoryRoot, game, options))
    .sort((a, b) =>
      Number(b.status === 'READY') - Number(a.status === 'READY') ||
      b.score - a.score ||
      (Number(b.netEnergyPerTick) || -Infinity) - (Number(a.netEnergyPerTick) || -Infinity) ||
      a.depth - b.depth ||
      a.roomName.localeCompare(b.roomName)
    );

  publishIntelScores(home, results, memoryRoot, now);

  const ready = results.filter(item => item.status === 'READY');
  const viable = ready.filter(item => item.economicallyViable);
  const candidates = ready.filter(item => item.recommendedState === 'CANDIDATE');

  const result = Object.assign(base, {
    status: 'READY',
    reason: null,
    candidateCount: results.length,
    readyCount: ready.length,
    viableCount: viable.length,
    recommendedCandidateCount: candidates.length,
    candidates: results,
    bestCandidate: candidates[0] || viable[0] || ready[0] || null,
    assumptions: {
      maxDepth: numberOption(options, 'maxDepth', DEFAULT_MAX_DEPTH, 1, 6),
      maxRouteHops: numberOption(options, 'maxRouteHops', DEFAULT_MAX_ROUTE_HOPS, 1, 10),
      intelMaxAge: numberOption(options, 'intelMaxAge', DEFAULT_INTEL_MAX_AGE, 1, 10000),
      ticksPerRoom: numberOption(options, 'ticksPerRoom', DEFAULT_TICKS_PER_ROOM, 1, 200),
      localEndpointTicks: numberOption(options, 'localEndpointTicks', DEFAULT_LOCAL_ENDPOINT_TICKS, 0, 100)
    }
  });

  const root = ensure(memoryRoot);
  root.rooms[home] = {
    evaluatedTick: now,
    expiresTick: now + DEFAULT_MEMORY_RETENTION,
    result
  };
  return result;
}

function snapshot(roomName, memoryRoot, game) {
  const root = ensure(memoryRoot);
  const entry = root.rooms[roomName];
  if (!entry) return null;
  const now = game && Number.isFinite(game.time)
    ? game.time
    : (typeof Game !== 'undefined' && Number.isFinite(Game.time) ? Game.time : entry.evaluatedTick);
  if (Number.isFinite(entry.expiresTick) && now > entry.expiresTick) {
    delete root.rooms[roomName];
    return null;
  }
  return entry.result || null;
}

function compactCandidate(item) {
  if (!item) return null;
  return {
    roomName: item.roomName,
    depth: item.depth,
    status: item.status,
    reason: item.reason,
    score: item.score,
    netEnergyPerTick: item.netEnergyPerTick,
    economicallyViable: item.economicallyViable,
    capacityBudgetEligible: item.capacityBudgetEligible,
    recommendedState: item.recommendedState,
    routeHops: item.route ? item.route.hops : null,
    sourceCount: item.economics ? item.economics.sourceCount : null,
    grossIncomePerTick: item.economics ? item.economics.grossIncomePerTick : null,
    totalCostPerTick: item.economics ? item.economics.totalCostPerTick : null,
    confidence: item.economics ? item.economics.confidence : item.intelConfidence
  };
}

function telemetrySummary(result) {
  if (!result) return null;
  return {
    schemaVersion: result.schemaVersion,
    authority: result.authority,
    activationAuthority: result.activationAuthority,
    remoteMiningEnabled: result.remoteMiningEnabled,
    homeRoom: result.homeRoom,
    evaluatedTick: result.evaluatedTick,
    status: result.status,
    reason: result.reason,
    candidateCount: result.candidateCount,
    readyCount: result.readyCount,
    viableCount: result.viableCount,
    recommendedCandidateCount: result.recommendedCandidateCount,
    bestCandidate: compactCandidate(result.bestCandidate),
    topCandidates: (result.candidates || []).slice(0, 8).map(compactCandidate),
    assumptions: result.assumptions || null
  };
}

module.exports = {
  SCHEMA_VERSION,
  AUTHORITY,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_CANDIDATES,
  DEFAULT_INTEL_MAX_AGE,
  DEFAULT_MAX_ROUTE_HOPS,
  ensure,
  discoverCandidates,
  candidateEligibility,
  estimateCosts,
  evaluateCandidate,
  evaluate,
  snapshot,
  telemetrySummary,
  _test: {
    homeRoom,
    homeUsername,
    bodyPartCost,
    runtimeConstants,
    hostileProbability,
    hostileRooms,
    routeFor,
    capacityBudgetEligible,
    publishIntelScores,
    compactCandidate
  }
};
