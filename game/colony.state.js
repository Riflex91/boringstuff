'use strict';

const SCHEMA_VERSION = 1;

const PART_KEYS = [
  ['work', 'WORK'],
  ['carry', 'CARRY'],
  ['move', 'MOVE'],
  ['claim', 'CLAIM'],
  ['attack', 'ATTACK'],
  ['ranged', 'RANGED_ATTACK'],
  ['heal', 'HEAL'],
  ['tough', 'TOUGH']
];

function globalPart(name) {
  if (typeof globalThis === 'undefined') return name.toLowerCase();
  return typeof globalThis[name] !== 'undefined' ? globalThis[name] : name.toLowerCase();
}

function emptyParts() {
  return { work: 0, carry: 0, move: 0, claim: 0, attack: 0, ranged: 0, heal: 0, tough: 0 };
}

function addParts(target, creep) {
  if (!creep || typeof creep.getActiveBodyparts !== 'function') return target;
  for (const item of PART_KEYS) {
    target[item[0]] += Math.max(0, Number(creep.getActiveBodyparts(globalPart(item[1]))) || 0);
  }
  return target;
}

function spawningParts(spawns) {
  const parts = emptyParts();
  let count = 0;
  let remainingTicks = 0;
  for (const spawn of spawns || []) {
    if (!spawn || !spawn.spawning) continue;
    count += 1;
    remainingTicks += Math.max(0, Number(spawn.spawning.remainingTime) || 0);
    const name = spawn.spawning.name;
    const live = typeof Game !== 'undefined' && Game.creeps ? Game.creeps[name] : null;
    const memory = typeof Memory !== 'undefined' && Memory.creeps ? Memory.creeps[name] : null;
    const body = live && Array.isArray(live.body)
      ? live.body
      : (memory && Array.isArray(memory.body) ? memory.body : null);
    if (!body) continue;
    for (const part of body) {
      const type = typeof part === 'string' ? part : part && part.type;
      for (const item of PART_KEYS) {
        if (type === globalPart(item[1])) parts[item[0]] += 1;
      }
    }
  }
  return { count, remainingTicks, parts };
}

function activeCapacity(creeps) {
  const parts = emptyParts();
  const ttl = { count: 0, min: null, max: null, total: 0, unknown: 0 };
  for (const creep of creeps || []) {
    addParts(parts, creep);
    const value = Number(creep && creep.ticksToLive);
    if (!Number.isFinite(value)) {
      ttl.unknown += 1;
      continue;
    }
    ttl.count += 1;
    ttl.total += value;
    ttl.min = ttl.min === null ? value : Math.min(ttl.min, value);
    ttl.max = ttl.max === null ? value : Math.max(ttl.max, value);
  }
  return {
    parts,
    ttl: {
      count: ttl.count,
      min: ttl.min,
      max: ttl.max,
      average: ttl.count ? Math.round(ttl.total / ttl.count * 100) / 100 : null,
      unknown: ttl.unknown
    }
  };
}

function controllerSnapshot(state) {
  const c = state && state.room ? state.room.controller : null;
  return {
    exists: !!c,
    my: !!(c && c.my),
    level: c ? Number(c.level) || 0 : 0,
    progress: c && Number.isFinite(c.progress) ? c.progress : null,
    progressTotal: c && Number.isFinite(c.progressTotal) ? c.progressTotal : null,
    ticksToDowngrade: c && Number.isFinite(c.ticksToDowngrade) ? c.ticksToDowngrade : null,
    safeMode: c && Number.isFinite(c.safeMode) ? c.safeMode : null,
    safeModeAvailable: c && Number.isFinite(c.safeModeAvailable) ? c.safeModeAvailable : null
  };
}

function constructionSnapshot(state) {
  let remainingProgress = 0;
  for (const site of state.sites || []) {
    remainingProgress += Math.max(0, (Number(site.progressTotal) || 0) - (Number(site.progress) || 0));
  }
  return {
    siteCount: (state.sites || []).length,
    remainingProgress
  };
}

function storeSnapshot(state) {
  return {
    energyStored: Math.max(0, Number(state.energyStored) || 0),
    energyAvailable: Math.max(0, Number(state.energyAvailable) || 0),
    energyCapacity: Math.max(0, Number(state.energyCapacityAvailable) || 0)
  };
}

function structureSnapshot(state) {
  const byType = {};
  const ownedByType = {};
  for (const structure of state.structures || []) {
    const type = String(structure.structureType || 'unknown');
    byType[type] = (byType[type] || 0) + 1;
    if (structure.my) ownedByType[type] = (ownedByType[type] || 0) + 1;
  }
  return {
    count: (state.structures || []).length,
    byType,
    ownedByType
  };
}

function sourceSnapshot(state) {
  const routes = state.economyModel && Array.isArray(state.economyModel.sourceRoutes)
    ? state.economyModel.sourceRoutes
    : [];
  const byId = {};
  for (const route of routes) byId[route.sourceId] = route;
  return (state.sources || []).map(source => {
    const route = byId[source.id] || null;
    return {
      id: source.id,
      energy: Number.isFinite(source.energy) ? source.energy : null,
      ticksToRegeneration: Number.isFinite(source.ticksToRegeneration) ? source.ticksToRegeneration : null,
      spawnDistance: route && Number.isFinite(route.spawnDistance) ? route.spawnDistance : null,
      containerReady: route ? !!route.containerReady : null,
      dedicatedIncomePerTick: route && Number.isFinite(route.dedicatedIncomePerTick) ? route.dedicatedIncomePerTick : null
    };
  });
}

function logisticsSnapshot(state) {
  const model = state.economyModel || {};
  return {
    mode: model.mode || null,
    miningCapacityPerTick: Number.isFinite(model.dedicatedHarvestCapacityPerTick) ? model.dedicatedHarvestCapacityPerTick : null,
    productiveDemandPerTick: Number.isFinite(model.productiveDemandPerTick) ? model.productiveDemandPerTick : null,
    haulerCarryParts: Number.isFinite(model.haulerCarryParts) ? model.haulerCarryParts : null,
    requiredHaulerCarryParts: Number.isFinite(model.recommendedHaulerCarryParts) ? model.recommendedHaulerCarryParts : null,
    haulerCarryDeficit: Number.isFinite(model.haulerCarryDeficit) ? model.haulerCarryDeficit : null,
    consumerRequests: Number.isFinite(model.consumerRequestCount) ? model.consumerRequestCount : 0,
    consumerWaiting: Number.isFinite(model.consumerWaitingCount) ? model.consumerWaitingCount : 0,
    consumerFallback: Number.isFinite(model.consumerFallbackCount) ? model.consumerFallbackCount : 0,
    deliveryReservations: Number.isFinite(model.consumerDeliveryReservations) ? model.consumerDeliveryReservations : 0
  };
}

function threatSnapshot(state) {
  const hostiles = state.hostileCreeps || [];
  const parts = emptyParts();
  for (const creep of hostiles) addParts(parts, creep);
  return {
    hostileCount: hostiles.length,
    hostileActiveParts: parts,
    state: hostiles.length ? 'WATCH' : 'NORMAL'
  };
}

function spawnSnapshot(state) {
  const spawns = state.room && typeof state.room.find === 'function'
    ? state.room.find(FIND_MY_SPAWNS)
    : (state.spawn ? [state.spawn] : []);
  const spawning = spawningParts(spawns);
  return {
    count: spawns.length,
    busyCount: spawning.count,
    busyTicksProjected: spawning.remainingTicks,
    spawningParts: spawning.parts
  };
}

function deriveMode(state) {
  if (state.emergency) return 'RECOVERY';
  if (state.hostileCreeps && state.hostileCreeps.length) return 'DEFENSE';
  if ((state.rcl || 0) <= 1) return 'BOOTSTRAP';
  return 'STABLE';
}

function build(state, context) {
  context = context || {};
  const active = activeCapacity(state.creeps || []);
  const spawn = spawnSnapshot(state);

  return {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW',
    tick: Number.isFinite(context.tick) ? context.tick : (typeof Game !== 'undefined' ? Game.time : null),
    roomName: state.room && state.room.name ? state.room.name : null,
    mode: deriveMode(state),
    controller: controllerSnapshot(state),
    sources: sourceSnapshot(state),
    stores: storeSnapshot(state),
    structures: structureSnapshot(state),
    construction: constructionSnapshot(state),
    spawn,
    capacity: {
      active: active.parts,
      projected: state.capacitySpawnShadow
        ? {
            available: true,
            authority: 'SHADOW',
            deferred: !!state.capacitySpawnShadow.summary.deferred,
            deficits: state.capacitySpawnShadow.deficits
          }
        : { available: false, reason: 'E2_NOT_AVAILABLE' },
      queued: {
        available: false,
        authority: 'SHADOW',
        reason: 'SHADOW_PROPOSALS_ARE_NOT_REAL_QUEUE'
      },
      spawning: spawn.spawningParts,
      ttl: active.ttl
    },
    spawnPlan: state.capacitySpawnShadow
      ? {
          available: true,
          authority: 'SHADOW',
          summary: state.capacitySpawnShadow.summary,
          requests: state.capacitySpawnShadow.spawnRequests
        }
      : {
          available: false,
          authority: 'SHADOW',
          summary: null,
          requests: []
        },
    logistics: logisticsSnapshot(state),
    threat: threatSnapshot(state),
    cpu: {
      bucket: Number.isFinite(context.bucket) ? context.bucket : null,
      roomCpuLast: Number.isFinite(context.roomCpuLast) ? context.roomCpuLast : null,
      roomCpuEMA: Number.isFinite(context.roomCpuEMA) ? context.roomCpuEMA : null
    },
    health: state.health ? {
      status: state.health.status || null,
      score: Number.isFinite(state.health.overallScore) ? state.health.overallScore : null,
      reasons: Array.isArray(state.health.reasons) ? state.health.reasons.slice(0, 12) : []
    } : null,
    efficiency: state.efficiency ? {
      status: state.efficiency.status || null,
      score: Number.isFinite(state.efficiency.overallScore) ? state.efficiency.overallScore : null,
      reasons: Array.isArray(state.efficiency.reasons) ? state.efficiency.reasons.slice(0, 12) : []
    } : null,
    requests: state.requestShadow && state.requestShadow.summary
      ? {
          available: true,
          authority: 'SHADOW',
          open: state.requestShadow.summary.open,
          blocked: state.requestShadow.summary.blocked,
          total: state.requestShadow.summary.total,
          stored: state.requestShadow.summary.stored,
          terminal: state.requestShadow.summary.terminal,
          reservationCount: state.requestShadow.summary.reservationCount,
          byStatus: state.requestShadow.summary.byStatus,
          byDomain: state.requestShadow.summary.byDomain
        }
      : {
          available: false,
          authority: 'SHADOW',
          open: null,
          blocked: null,
          total: null,
          stored: null,
          terminal: null,
          reservationCount: null,
          byStatus: {},
          byDomain: {}
        },
    logisticsRequests: state.requestShadow && state.requestShadow.logisticsGraph
      ? {
          available: true,
          authority: 'SHADOW',
          total: state.requestShadow.logisticsGraph.total,
          totalAmount: state.requestShadow.logisticsGraph.totalAmount,
          byKind: state.requestShadow.logisticsGraph.byKind,
          amountByKind: state.requestShadow.logisticsGraph.amountByKind
        }
      : {
          available: false,
          authority: 'SHADOW',
          total: 0,
          totalAmount: 0,
          byKind: {},
          amountByKind: {}
        },
    logisticsMatching: state.logisticsMatchingShadow && state.logisticsMatchingShadow.summary
      ? {
          available: true,
          authority: 'SHADOW',
          planTick: state.logisticsMatchingShadow.summary.planTick,
          deferred: !!state.logisticsMatchingShadow.summary.deferred,
          deferReason: state.logisticsMatchingShadow.summary.deferReason || null,
          haulerCount: state.logisticsMatchingShadow.summary.haulerCount,
          candidateCount: state.logisticsMatchingShadow.summary.candidateCount,
          jobCount: state.logisticsMatchingShadow.summary.jobCount,
          matchedHaulerCount: state.logisticsMatchingShadow.summary.matchedHaulerCount,
          haulerUtilization: state.logisticsMatchingShadow.summary.haulerUtilization,
          pairedJobCount: state.logisticsMatchingShadow.summary.pairedJobCount,
          directCarriedJobCount: state.logisticsMatchingShadow.summary.directCarriedJobCount,
          criticalRequestCount: state.logisticsMatchingShadow.summary.criticalRequestCount,
          criticalMatchedCount: state.logisticsMatchingShadow.summary.criticalMatchedCount,
          unmatchedCriticalCount: state.logisticsMatchingShadow.summary.unmatchedCriticalCount,
          reservedAmount: state.logisticsMatchingShadow.summary.reservedAmount,
          averageTransportTicks: state.logisticsMatchingShadow.summary.averageTransportTicks,
          jobs: (state.logisticsMatchingShadow.jobs || []).slice(0, 12),
          evidence: state.logisticsMatchingEvidence
            ? {
                authority: 'SHADOW_EVIDENCE',
                current: state.logisticsMatchingEvidence.current || null,
                lastWindow: state.logisticsMatchingEvidence.lastWindow || null
              }
            : null
        }
      : {
          available: false,
          authority: 'SHADOW',
          planTick: null,
          deferred: false,
          deferReason: null,
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
          averageTransportTicks: 0,
          jobs: [],
          evidence: null
        },
    assignments: state.assignmentShadow && state.assignmentShadow.summary
      ? {
          available: true,
          authority: 'SHADOW',
          planTick: state.assignmentShadow.summary.planTick,
          deferred: !!state.assignmentShadow.summary.deferred,
          deferReason: state.assignmentShadow.summary.deferReason || null,
          requestCount: state.assignmentShadow.summary.requestCount,
          executorCount: state.assignmentShadow.summary.executorCount,
          assignmentCount: state.assignmentShadow.summary.assignmentCount,
          switchCount: state.assignmentShadow.summary.switchCount,
          unfilledCount: state.assignmentShadow.summary.unfilledCount,
          totalUnfilled: state.assignmentShadow.summary.totalUnfilled
        }
      : {
          available: false,
          authority: 'SHADOW',
          planTick: null,
          deferred: false,
          deferReason: null,
          requestCount: null,
          executorCount: null,
          assignmentCount: null,
          switchCount: null,
          unfilledCount: null,
          totalUnfilled: null
        },
    assignmentEvidence: state.assignmentEvidence
      ? {
          available: true,
          authority: 'SHADOW_EVIDENCE',
          current: state.assignmentEvidence.current || null,
          lastWindow: state.assignmentEvidence.lastWindow || null
        }
      : {
          available: false,
          authority: 'SHADOW_EVIDENCE',
          current: null,
          lastWindow: null
        }
  };
}

module.exports = {
  SCHEMA_VERSION,
  build,
  _test: {
    emptyParts,
    activeCapacity,
    controllerSnapshot,
    constructionSnapshot,
    structureSnapshot,
    logisticsSnapshot,
    threatSnapshot,
    deriveMode
  }
};