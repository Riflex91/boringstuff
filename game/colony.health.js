'use strict';

const config = require('config');

// Phase 3A: observational colony health model. This module must not make
// strategy or spawn decisions. It only turns already-observed colony state
// into compact, comparable diagnostic scores.

const WEIGHTS = {
  economy: 25,
  logistics: 20,
  infrastructure: 15,
  controller: 15,
  defense: 10,
  recovery: 10,
  cpu: 5
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pct(numerator, denominator) {
  if (!denominator || denominator <= 0) return 100;
  return clamp(Math.round((numerator / denominator) * 100), 0, 100);
}

function statusFor(score) {
  if (score >= 85) return 'HEALTHY';
  if (score >= 70) return 'WATCH';
  if (score >= 50) return 'DEGRADED';
  return 'CRITICAL';
}

function economyScore(state, reasons) {
  const model = state.economyModel;
  if (!model) {
    reasons.push('ECONOMY_MODEL_MISSING');
    return 50;
  }

  const theoretical = Math.max(0, model.theoreticalIncomePerTick || 0);
  const demand = Math.max(0, model.productiveDemandPerTick || 0);
  const target = Math.min(theoretical || demand, Math.max(theoretical ? 1 : 0, demand));
  const score = target > 0 ? pct(model.dedicatedHarvestCapacityPerTick || 0, target) : 100;
  if ((model.harvesterWorkDeficit || 0) > 0) reasons.push('MINING_DEFICIT');
  return score;
}

function logisticsScore(state, reasons) {
  const model = state.economyModel;
  if (!model) {
    reasons.push('LOGISTICS_MODEL_MISSING');
    return 50;
  }

  const need = Math.max(0, model.recommendedHaulerCarryParts || 0);
  let score = need > 0 ? pct(model.haulerCarryParts || 0, need) : 100;
  const fallback = Math.max(0, model.consumerFallbackCount || 0);
  if (need > 0 && (model.haulerCarryParts || 0) < need) reasons.push('HAULING_DEFICIT');
  if (fallback > 0) {
    reasons.push('CONSUMER_FALLBACK_ACTIVE');
    score -= Math.min(30, fallback * 10);
  }
  return clamp(score, 0, 100);
}

function infrastructureScore(state, reasons) {
  if (!state.sites || state.sites.length === 0) return 100;
  const last = state.economyMetrics && state.economyMetrics.last100;
  if (!last) {
    reasons.push('CONSTRUCTION_WINDOW_PENDING');
    return 70;
  }
  if ((last.sitesCompleted || 0) > 0) return 100;
  if ((last.constructionProgress || 0) > 0) {
    reasons.push('CONSTRUCTION_SLOW');
    return 70;
  }
  reasons.push('CONSTRUCTION_STALLED');
  return 30;
}

function controllerScore(state, reasons) {
  const controller = state.room && state.room.controller;
  if (!controller || !controller.my) return 100;
  if (state.rcl >= 8) return 100;

  const upgraders = state.byRole && (state.byRole.upgrader || 0);
  const idle = state.economyMetrics ? (state.economyMetrics.controllerIdleTicks || 0) : 0;
  const last = state.economyMetrics && state.economyMetrics.last100;

  if (!upgraders) {
    reasons.push('UPGRADER_MISSING');
    return 35;
  }
  if (idle >= config.UPGRADER_STALL_TICKS) {
    reasons.push('CONTROLLER_STALLED');
    return 25;
  }
  if (last && (last.controllerProgress || 0) > 0) return 100;
  if (last) {
    reasons.push('CONTROLLER_NO_PROGRESS_WINDOW');
    return 55;
  }
  return 75;
}

function defenseScore(state, reasons) {
  const hostiles = state.hostileCreeps ? state.hostileCreeps.length : 0;
  if (!hostiles) return 100;

  reasons.push('HOSTILES_PRESENT');
  const defenders = state.byRole ? (state.byRole.defender || 0) : 0;
  const towers = state.towers ? state.towers.length : 0;
  if (!defenders && !towers) {
    reasons.push('DEFENSE_CAPACITY_LOW');
    return 10;
  }
  return clamp(40 + Math.min(60, (defenders + towers * 2) * 20), 0, 100);
}

function recoveryScore(state, reasons) {
  if (!state.spawn) {
    reasons.push('SPAWN_MISSING');
    return 0;
  }
  if (state.emergency) {
    reasons.push('RECOVERY_EMERGENCY');
    return 25;
  }
  if (!state.byRole || !(state.byRole.harvester || 0)) {
    reasons.push('HARVESTER_MISSING');
    return 25;
  }
  if (state.rcl <= 2 && !(state.byRole.worker || 0)) {
    reasons.push('WORKER_MISSING');
    return 60;
  }
  return 100;
}

function cpuScore(reasons) {
  const bucket = Game.cpu.bucket;
  if (bucket >= config.CPU_BUCKET_HEALTHY) return 100;
  if (bucket >= config.CPU_BUCKET_LOW) {
    reasons.push('CPU_BUCKET_BELOW_HEALTHY');
    const span = Math.max(1, config.CPU_BUCKET_HEALTHY - config.CPU_BUCKET_LOW);
    return 70 + Math.round(((bucket - config.CPU_BUCKET_LOW) / span) * 30);
  }
  if (bucket >= config.CPU_BUCKET_CRITICAL) {
    reasons.push('CPU_BUCKET_LOW');
    const span = Math.max(1, config.CPU_BUCKET_LOW - config.CPU_BUCKET_CRITICAL);
    return 30 + Math.round(((bucket - config.CPU_BUCKET_CRITICAL) / span) * 40);
  }
  reasons.push('CPU_BUCKET_CRITICAL');
  return clamp(Math.round((bucket / Math.max(1, config.CPU_BUCKET_CRITICAL)) * 30), 0, 30);
}

function evaluate(state) {
  const reasons = [];
  const scores = {
    economy: economyScore(state, reasons),
    logistics: logisticsScore(state, reasons),
    infrastructure: infrastructureScore(state, reasons),
    controller: controllerScore(state, reasons),
    defense: defenseScore(state, reasons),
    recovery: recoveryScore(state, reasons),
    cpu: cpuScore(reasons)
  };

  let weighted = 0;
  let totalWeight = 0;
  for (const key in WEIGHTS) {
    weighted += scores[key] * WEIGHTS[key];
    totalWeight += WEIGHTS[key];
  }
  const overallScore = Math.round(weighted / Math.max(1, totalWeight));

  return {
    modelVersion: 1,
    overallScore,
    status: statusFor(overallScore),
    scores,
    reasons: reasons.slice(0, 12)
  };
}

module.exports = { evaluate, statusFor, WEIGHTS };
