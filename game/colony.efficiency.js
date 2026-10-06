'use strict';

// Phase 3B: observational utilization / pressure model.
// Health answers "is the colony stable?"; efficiency answers "is available
// capacity being converted into useful work?". This module is diagnostic only
// and must not make strategy, spawn, planner, or economy decisions.

const WEIGHTS = {
  productiveUse: 45,
  energyUse: 25,
  spawnUse: 15,
  flow: 15
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pct(numerator, denominator) {
  if (!denominator || denominator <= 0) return 100;
  return clamp(Math.round((numerator / denominator) * 100), 0, 100);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ownedControllerBelowRcl8(state) {
  const controller = state.room && state.room.controller;
  return !!(controller && controller.my && state.rcl < 8);
}

function hasProductiveBacklog(state) {
  return !!((state.sites && state.sites.length) || ownedControllerBelowRcl8(state));
}

function windowFor(state) {
  const last = state.economyMetrics && state.economyMetrics.last100;
  return last && last.ticks > 0 ? last : null;
}

function productiveThroughput(last) {
  if (!last || !last.ticks) return 0;
  const progress = Math.max(0, last.controllerProgress || 0) + Math.max(0, last.constructionProgress || 0);
  return progress / last.ticks;
}

function productiveCapacity(state, last) {
  const flow = last && last.productiveFlow;
  const builder = finiteNumber(flow && flow.averageBuilderWorkParts);
  const worker = finiteNumber(flow && flow.averageWorkerWorkParts);
  const upgrader = finiteNumber(flow && flow.averageUpgraderWorkParts);
  if (builder !== null && worker !== null && upgrader !== null) {
    const buildPower = typeof BUILD_POWER !== 'undefined' ? BUILD_POWER : 5;
    const upgradePower = typeof UPGRADE_CONTROLLER_POWER !== 'undefined' ? UPGRADE_CONTROLLER_POWER : 1;
    return Math.max(0, (builder + worker) * buildPower + upgrader * upgradePower);
  }
  return Math.max(0, finiteNumber(state.economyModel && state.economyModel.productiveDemandPerTick) || 0);
}

function productiveUseScore(state, last, reasons) {
  if (!last) return 50;
  if (!hasProductiveBacklog(state)) return 100;

  const capacity = productiveCapacity(state, last);
  const throughput = productiveThroughput(last);
  const score = capacity > 0 ? pct(throughput, capacity) : (throughput > 0 ? 100 : 0);
  if (score < 60) reasons.push('PRODUCTIVE_THROUGHPUT_LOW');
  return score;
}

function energyUseScore(state, last, reasons) {
  if (!last) return 50;
  if (!hasProductiveBacklog(state)) return 100;

  const capped = clamp(Number(last.energyCappedRatio) || 0, 0, 1);
  if (capped >= 0.5) reasons.push('ENERGY_SURPLUS_UNCONSUMED');
  return Math.round((1 - capped) * 100);
}

function spawnUseScore(state, last, reasons) {
  if (!last) return 50;
  if (!hasProductiveBacklog(state)) return 100;

  const capped = clamp(Number(last.energyCappedRatio) || 0, 0, 1);
  const utilization = clamp(Number(last.spawnUtilization) || 0, 0, 1);

  // An idle spawn is only treated as lost utilization when energy is already
  // accumulating. Otherwise preserving spawn availability is not a problem.
  if (capped < 0.25) return 100;
  if (capped >= 0.5 && utilization <= 0.1) reasons.push('SPAWN_IDLE_WITH_SURPLUS');

  // 25% spawn utilization is considered sufficient for this diagnostic while
  // surplus exists; the score is not trying to maximize spawn busyness itself.
  return pct(utilization, 0.25);
}

function flowScore(state, reasons) {
  const model = state.economyModel;
  if (!model) return 50;

  let score = 100;
  const fallback = Math.max(0, model.consumerFallbackCount || 0);
  const carry = Math.max(0, model.haulerCarryParts || 0);
  const carryNeed = Math.max(0, model.recommendedHaulerCarryParts || 0);

  if (fallback > 0) {
    reasons.push('CONSUMER_FALLBACK_ACTIVE');
    score -= Math.min(45, fallback * 15);
  }
  if (carryNeed > 0 && carry < carryNeed) {
    reasons.push('HAULING_PRESSURE');
    score -= Math.min(40, Math.round(((carryNeed - carry) / carryNeed) * 100));
  }
  return clamp(score, 0, 100);
}

function pressure(state, last, throughput, reasons) {
  if (!last) return { state: 'UNKNOWN', score: 0, surplus: 0, demand: 0 };

  const model = state.economyModel || {};
  const backlog = hasProductiveBacklog(state);
  const cappedPct = Math.round(clamp(Number(last.energyCappedRatio) || 0, 0, 1) * 100);
  const spawnIdlePct = Math.round((1 - clamp(Number(last.spawnUtilization) || 0, 0, 1)) * 100);
  const surplus = backlog ? Math.round(cappedPct * (0.7 + 0.3 * (spawnIdlePct / 100))) : 0;

  const recWork = Math.max(0, model.recommendedHarvesterWorkParts || 0);
  const workDeficit = Math.max(0, model.harvesterWorkDeficit || 0);
  const miningPressure = recWork > 0 ? pct(workDeficit, recWork) : 0;

  const carryNeed = Math.max(0, model.recommendedHaulerCarryParts || 0);
  const carry = Math.max(0, model.haulerCarryParts || 0);
  const haulingPressure = carryNeed > 0 && carry < carryNeed ? pct(carryNeed - carry, carryNeed) : 0;
  const fallbackPressure = Math.min(100, Math.max(0, model.consumerFallbackCount || 0) * 20);
  const demand = Math.max(miningPressure, haulingPressure, fallbackPressure);

  let pressureState = 'BALANCED';
  let score = Math.max(surplus, demand);
  if (surplus > demand + 10) pressureState = 'SURPLUS';
  else if (demand > surplus + 10) pressureState = 'DEMAND';

  const modeledDemand = productiveCapacity(state, last);
  if (pressureState === 'SURPLUS' && modeledDemand > 0 && throughput * 1.5 < modeledDemand) {
    reasons.push('MODELED_DEMAND_NOT_REALIZED');
  }

  return { state: pressureState, score, surplus, demand };
}

function statusFor(score, pressureState, hasWindow) {
  if (!hasWindow) return 'PENDING';
  if (pressureState === 'SURPLUS' && score < 70) return 'UNDERUTILIZED';
  if (score >= 80) return 'EFFICIENT';
  if (score >= 60) return 'WATCH';
  return 'INEFFICIENT';
}

function evaluate(state) {
  const reasons = [];
  const last = windowFor(state);
  if (!last) reasons.push('EFFICIENCY_WINDOW_PENDING');

  const throughput = productiveThroughput(last);
  const components = {
    productiveUse: productiveUseScore(state, last, reasons),
    energyUse: energyUseScore(state, last, reasons),
    spawnUse: spawnUseScore(state, last, reasons),
    flow: flowScore(state, reasons)
  };

  let weighted = 0;
  let totalWeight = 0;
  for (const key in WEIGHTS) {
    weighted += components[key] * WEIGHTS[key];
    totalWeight += WEIGHTS[key];
  }
  const overallScore = Math.round(weighted / Math.max(1, totalWeight));
  const pressureState = pressure(state, last, throughput, reasons);

  return {
    modelVersion: 2,
    overallScore,
    status: statusFor(overallScore, pressureState.state, !!last),
    components,
    pressure: pressureState,
    metrics: {
      productiveThroughputPerTick: Math.round(throughput * 100) / 100,
      productiveCapacityPerTick: Math.round(productiveCapacity(state, last) * 100) / 100,
      dedicatedHarvestCapacityPerTick: Math.max(0, state.economyModel && state.economyModel.dedicatedHarvestCapacityPerTick || 0),
      energyCappedRatio: last ? clamp(Number(last.energyCappedRatio) || 0, 0, 1) : null,
      spawnUtilization: last ? clamp(Number(last.spawnUtilization) || 0, 0, 1) : null,
      productiveBacklog: hasProductiveBacklog(state)
    },
    reasons: Array.from(new Set(reasons)).slice(0, 12)
  };
}

module.exports = { evaluate, statusFor, WEIGHTS, productiveThroughput, productiveCapacity, hasProductiveBacklog };
