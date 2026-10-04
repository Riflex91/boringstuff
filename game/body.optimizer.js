'use strict';

const SCHEMA_VERSION = 1;
const MAX_PARTS = 50;

function part(name) {
  if (typeof globalThis !== 'undefined' && typeof globalThis[name] !== 'undefined') return globalThis[name];
  return name.toLowerCase();
}

function partCost(type) {
  const costs = typeof BODYPART_COST !== 'undefined' ? BODYPART_COST : {};
  return Math.max(0, Number(costs[type]) || 0);
}

function spawnTimePerPart() {
  return typeof CREEP_SPAWN_TIME !== 'undefined' && Number.isFinite(CREEP_SPAWN_TIME) ? CREEP_SPAWN_TIME : 3;
}

function lifeTime() {
  return typeof CREEP_LIFE_TIME !== 'undefined' && Number.isFinite(CREEP_LIFE_TIME) ? CREEP_LIFE_TIME : 1500;
}

function normalizeTerrain(profile) {
  profile = profile || {};
  let road = Math.max(0, Number(profile.road) || Number(profile.roads) || 0);
  let plain = Math.max(0, Number(profile.plain) || Number(profile.plains) || 0);
  let swamp = Math.max(0, Number(profile.swamp) || Number(profile.swamps) || 0);
  const total = road + plain + swamp;
  if (total <= 0) return { road: 0, plain: 1, swamp: 0, source: 'DEFAULT_PLAIN' };
  road /= total;
  plain /= total;
  swamp /= total;
  return { road, plain, swamp, source: 'OBSERVED' };
}

function averageFatiguePerNonMove(profile) {
  const p = normalizeTerrain(profile);
  return p.road * 1 + p.plain * 2 + p.swamp * 10;
}

function estimatedTravelTicks(distance, nonMoveParts, moveParts, terrainProfile) {
  distance = Math.max(0, Number(distance) || 0);
  if (distance <= 0) return 0;
  nonMoveParts = Math.max(0, Number(nonMoveParts) || 0);
  moveParts = Math.max(0, Number(moveParts) || 0);
  if (nonMoveParts <= 0) return Math.ceil(distance);
  if (moveParts <= 0) return Infinity;
  const fatigue = nonMoveParts * averageFatiguePerNonMove(terrainProfile);
  const recovery = moveParts * 2;
  const ticksPerTile = Math.max(1, fatigue / Math.max(1, recovery));
  return Math.ceil(distance * ticksPerTile);
}

function bodyCost(body) {
  let total = 0;
  for (const type of body || []) total += partCost(type);
  return total;
}

function countParts(body) {
  const counts = {};
  for (const type of body || []) counts[type] = (counts[type] || 0) + 1;
  return counts;
}

function boostMultiplier(input) {
  const boosts = input && input.boosts;
  if (!boosts) return 1;
  const capability = input.capability;
  if (Number.isFinite(boosts[capability])) return Math.max(0, boosts[capability]);
  if (Number.isFinite(boosts.multiplier)) return Math.max(0, boosts.multiplier);
  return 1;
}

function specFor(input) {
  const capability = input.capability;
  const role = input.role;
  if (capability === 'workHarvest' || role === 'harvester') {
    return { role: 'harvester', capability: 'workHarvest', primary: part('WORK'), support: { carryMinimum: 1 }, mode: 'PRIMARY' };
  }
  if (capability === 'carry' || role === 'hauler') {
    return { role: 'hauler', capability: 'carry', primary: part('CARRY'), support: { carryMinimum: 0 }, mode: 'PRIMARY' };
  }
  if (capability === 'bootstrap' || role === 'worker') {
    return { role: 'worker', capability: 'bootstrap', primary: null, support: {}, mode: 'BALANCED_WORK_CARRY' };
  }
  return null;
}

function composeBody(spec, primaryCount, moveCount) {
  const body = [];
  if (spec.mode === 'BALANCED_WORK_CARRY') {
    for (let i = 0; i < primaryCount; i++) body.push(part('WORK'));
    for (let i = 0; i < primaryCount; i++) body.push(part('CARRY'));
  } else {
    for (let i = 0; i < primaryCount; i++) body.push(spec.primary);
    for (let i = 0; i < (spec.support.carryMinimum || 0); i++) body.push(part('CARRY'));
  }
  for (let i = 0; i < moveCount; i++) body.push(part('MOVE'));
  return body;
}

function deliveredCapacity(spec, primaryCount, moveCount, multiplier) {
  if (spec.mode === 'BALANCED_WORK_CARRY') return Math.min(primaryCount, moveCount) * multiplier;
  return primaryCount * multiplier;
}

function candidateMetrics(input, spec, body, delivered) {
  const counts = countParts(body);
  const moveCount = counts[part('MOVE')] || 0;
  const nonMove = Math.max(0, body.length - moveCount);
  const travelTicks = estimatedTravelTicks(input.routeDistance, nonMove, moveCount, input.terrainProfile);
  if (!Number.isFinite(travelTicks)) return null;
  const cost = bodyCost(body);
  const spawnTicks = body.length * spawnTimePerPart();
  const desired = Math.max(0, Number(input.requestedCapacity) || 0);
  const applied = Math.min(desired, delivered);
  const expectedLife = Number.isFinite(input.expectedLifetime) ? Math.max(0, input.expectedLifetime) : lifeTime();
  const productiveLifetime = Math.max(0, expectedLife - travelTicks);
  const travelLoss = applied * travelTicks;
  const spawnOpportunityCost = applied * spawnTicks * 0.25;
  const overCapacity = Math.max(0, delivered - desired);
  const overCapacityPenalty = overCapacity * Math.max(1, expectedLife * 0.02);
  const lifecycleCost = cost + travelLoss + spawnOpportunityCost + overCapacityPenalty;
  const expectedValue = applied * productiveLifetime;
  const expectedRoi = lifecycleCost > 0 ? expectedValue / lifecycleCost : expectedValue;
  return {
    body,
    cost,
    parts: body.length,
    spawnTicks,
    deliveredCapacity: delivered,
    appliedCapacity: applied,
    overCapacity,
    travelTicks,
    productiveLifetime,
    expectedValue,
    expectedRoi,
    lifecycleCost
  };
}

function better(a, b, desired) {
  if (!b) return true;
  const aCovered = Math.min(desired, a.appliedCapacity);
  const bCovered = Math.min(desired, b.appliedCapacity);
  if (aCovered !== bCovered) return aCovered > bCovered;
  const aMeets = a.deliveredCapacity >= desired;
  const bMeets = b.deliveredCapacity >= desired;
  if (aMeets !== bMeets) return aMeets;
  if (Math.abs(a.expectedRoi - b.expectedRoi) > 1e-9) return a.expectedRoi > b.expectedRoi;
  if (a.lifecycleCost !== b.lifecycleCost) return a.lifecycleCost < b.lifecycleCost;
  if (a.spawnTicks !== b.spawnTicks) return a.spawnTicks < b.spawnTicks;
  if (a.cost !== b.cost) return a.cost < b.cost;
  if (a.parts !== b.parts) return a.parts < b.parts;
  return a.body.join(',') < b.body.join(',');
}

function optimize(input) {
  input = input || {};
  const desired = Math.max(0, Number(input.requestedCapacity) || 0);
  const budget = Math.max(0, Number(input.energyBudget) || 0);
  const maxParts = Math.min(MAX_PARTS, Math.max(1, Number(input.maxParts) || MAX_PARTS));
  const spec = specFor(input);
  if (!spec || desired <= 0 || budget <= 0) return null;
  const multiplier = boostMultiplier(input);
  if (multiplier <= 0) return null;

  let best = null;
  const targetPrimary = Math.max(1, Math.ceil(desired / multiplier));
  const maxPrimary = Math.min(maxParts, Math.max(targetPrimary + 4, 8));

  for (let primaryCount = 1; primaryCount <= maxPrimary; primaryCount++) {
    const baseParts = spec.mode === 'BALANCED_WORK_CARRY'
      ? primaryCount * 2
      : primaryCount + (spec.support.carryMinimum || 0);
    if (baseParts >= maxParts) break;
    const maxMove = maxParts - baseParts;
    for (let moveCount = 1; moveCount <= maxMove; moveCount++) {
      const body = composeBody(spec, primaryCount, moveCount);
      const cost = bodyCost(body);
      if (cost > budget) continue;
      const delivered = deliveredCapacity(spec, primaryCount, moveCount, multiplier);
      if (delivered <= 0) continue;
      const candidate = candidateMetrics(input, spec, body, delivered);
      if (!candidate) continue;
      if (better(candidate, best, desired)) best = candidate;
    }
  }

  if (!best) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    role: spec.role,
    capability: spec.capability,
    requestedCapacity: desired,
    energyBudget: budget,
    terrainProfile: normalizeTerrain(input.terrainProfile),
    boostMultiplier: multiplier,
    body: best.body,
    cost: best.cost,
    parts: best.parts,
    spawnTicks: best.spawnTicks,
    capacityDelivered: best.deliveredCapacity,
    capacityApplied: best.appliedCapacity,
    travelTicks: best.travelTicks,
    productiveLifetime: best.productiveLifetime,
    expectedValue: Math.round(best.expectedValue * 100) / 100,
    expectedRoi: Math.round(best.expectedRoi * 10000) / 10000,
    lifecycleCost: Math.round(best.lifecycleCost * 100) / 100
  };
}

module.exports = {
  SCHEMA_VERSION,
  MAX_PARTS,
  optimize,
  _test: {
    part,
    partCost,
    normalizeTerrain,
    averageFatiguePerNonMove,
    estimatedTravelTicks,
    bodyCost,
    countParts,
    boostMultiplier,
    specFor,
    composeBody,
    deliveredCapacity,
    candidateMetrics,
    better
  }
};