'use strict';

const CONSUMER_ROLES = ['builder', 'worker', 'repairer', 'upgrader'];

function round(value, digits) {
  const scale = Math.pow(10, digits === undefined ? 3 : digits);
  return Math.round((Number(value) || 0) * scale) / scale;
}

function roleTotals() {
  return {
    builder: { count: 0, workParts: 0, energy: 0, capacity: 0 },
    worker: { count: 0, workParts: 0, energy: 0, capacity: 0 },
    repairer: { count: 0, workParts: 0, energy: 0, capacity: 0 },
    upgrader: { count: 0, workParts: 0, energy: 0, capacity: 0 }
  };
}

function activeWorkParts(creep) {
  return creep && creep.getActiveBodyparts ? creep.getActiveBodyparts(WORK) : 0;
}

function storedEnergy(creep) {
  return creep && creep.store ? (creep.store[RESOURCE_ENERGY] || 0) : 0;
}

function energyCapacity(creep) {
  if (!creep || !creep.store || !creep.store.getCapacity) return storedEnergy(creep);
  return creep.store.getCapacity(RESOURCE_ENERGY) || storedEnergy(creep);
}

function constructionSnapshot(state) {
  const byType = {};
  let remainingProgress = 0;
  for (const site of state.sites || []) {
    const type = String(site.structureType || 'unknown');
    const remaining = Math.max(0, (Number(site.progressTotal) || 0) - (Number(site.progress) || 0));
    if (!byType[type]) byType[type] = { count: 0, remainingProgress: 0 };
    byType[type].count += 1;
    byType[type].remainingProgress += remaining;
    remainingProgress += remaining;
  }

  const ordered = {};
  Object.keys(byType).sort().forEach(type => { ordered[type] = byType[type]; });
  return {
    siteCount: (state.sites || []).length,
    remainingProgress,
    byType: ordered
  };
}

function controllerSnapshot(state) {
  const controller = state.room && state.room.controller;
  if (!controller) {
    return {
      level: state.rcl || 0,
      demandActive: false,
      progress: null,
      progressTotal: null,
      remainingProgress: null,
      ticksToDowngrade: null
    };
  }

  const progress = typeof controller.progress === 'number' ? controller.progress : null;
  const total = typeof controller.progressTotal === 'number' ? controller.progressTotal : null;
  const demandActive = !!controller.my && (state.rcl || controller.level || 0) < 8;
  return {
    level: controller.level || state.rcl || 0,
    demandActive,
    progress,
    progressTotal: total,
    remainingProgress: demandActive && progress !== null && total !== null ? Math.max(0, total - progress) : null,
    ticksToDowngrade: typeof controller.ticksToDowngrade === 'number' ? controller.ticksToDowngrade : null
  };
}

function observe(state) {
  const roles = roleTotals();
  const consumers = (state.creeps || []).filter(c => c && c.memory && CONSUMER_ROLES.includes(c.memory.role));
  let waitingCount = 0;
  let criticalCount = 0;
  let fallbackCount = 0;
  let emptyCount = 0;
  let waitingAgeTotal = 0;
  let maxWaitingEnergyTicks = 0;
  let totalEnergy = 0;
  let totalCapacity = 0;

  for (const creep of consumers) {
    const role = creep.memory.role;
    const wait = Math.max(0, Number(creep.memory.waitingEnergyTicks) || 0);
    const fallback = !!creep.memory.logisticsFallback;
    const energy = storedEnergy(creep);
    const capacity = energyCapacity(creep);
    const workParts = activeWorkParts(creep);

    roles[role].count += 1;
    roles[role].workParts += workParts;
    roles[role].energy += energy;
    roles[role].capacity += capacity;

    if (wait > 0) {
      waitingCount += 1;
      waitingAgeTotal += wait;
      maxWaitingEnergyTicks = Math.max(maxWaitingEnergyTicks, wait);
    }
    if (fallback) fallbackCount += 1;
    if (fallback || wait > 0) criticalCount += 1;
    if (energy <= 0) emptyCount += 1;
    totalEnergy += energy;
    totalCapacity += capacity;
  }

  const construction = constructionSnapshot(state);
  const controller = controllerSnapshot(state);
  const buildPower = typeof BUILD_POWER !== 'undefined' ? BUILD_POWER : 5;
  const upgradePower = typeof UPGRADE_CONTROLLER_POWER !== 'undefined' ? UPGRADE_CONTROLLER_POWER : 1;
  const constructionCapableWorkParts = construction.siteCount > 0
    ? roles.builder.workParts + roles.worker.workParts + roles.repairer.workParts
    : 0;
  const dedicatedControllerWorkParts = controller.demandActive ? roles.upgrader.workParts : 0;
  const productiveWorkParts = CONSUMER_ROLES.reduce((sum, role) => sum + roles[role].workParts, 0);

  return {
    consumers: {
      count: consumers.length,
      waitingCount,
      criticalCount,
      fallbackCount,
      emptyCount,
      waitingAgeTotal,
      maxWaitingEnergyTicks,
      energy: totalEnergy,
      capacity: totalCapacity,
      byRole: roles
    },
    work: {
      productiveWorkParts,
      constructionCapableWorkParts,
      dedicatedControllerWorkParts,
      constructionCapacityPerTick: constructionCapableWorkParts * buildPower,
      dedicatedControllerCapacityPerTick: dedicatedControllerWorkParts * upgradePower
    },
    construction,
    controller
  };
}

function newWindow() {
  return {
    consumerTicks: 0,
    waitingConsumerTicks: 0,
    criticalConsumerTicks: 0,
    fallbackConsumerTicks: 0,
    emptyConsumerTicks: 0,
    waitingAgeTicks: 0,
    maxWaitingEnergyTicks: 0,
    workPartTicks: { builder: 0, worker: 0, repairer: 0, upgrader: 0 },
    constructionCapacityTicks: 0,
    controllerCapacityTicks: 0,
    constructionBacklogTicks: 0,
    controllerDemandTicks: 0
  };
}

function accumulate(window, flow) {
  if (!window || !flow) return window;
  window.consumerTicks += flow.consumers.count;
  window.waitingConsumerTicks += flow.consumers.waitingCount;
  window.criticalConsumerTicks += flow.consumers.criticalCount;
  window.fallbackConsumerTicks += flow.consumers.fallbackCount;
  window.emptyConsumerTicks += flow.consumers.emptyCount;
  window.waitingAgeTicks += flow.consumers.waitingAgeTotal;
  window.maxWaitingEnergyTicks = Math.max(window.maxWaitingEnergyTicks, flow.consumers.maxWaitingEnergyTicks);

  for (const role of CONSUMER_ROLES) {
    window.workPartTicks[role] += flow.consumers.byRole[role].workParts;
  }

  window.constructionCapacityTicks += flow.work.constructionCapacityPerTick;
  window.controllerCapacityTicks += flow.work.dedicatedControllerCapacityPerTick;
  if (flow.construction.remainingProgress > 0) window.constructionBacklogTicks += 1;
  if (flow.controller.demandActive && (flow.controller.remainingProgress === null || flow.controller.remainingProgress > 0)) {
    window.controllerDemandTicks += 1;
  }
  return window;
}

function summarize(window, ticks, endingFlow, actual) {
  ticks = Math.max(1, Number(ticks) || 0);
  actual = actual || {};
  const consumerTicks = Math.max(0, window.consumerTicks || 0);
  const waitingTicks = Math.max(0, window.waitingConsumerTicks || 0);
  const workPartsByRole = {};
  for (const role of CONSUMER_ROLES) {
    workPartsByRole[role] = round((window.workPartTicks[role] || 0) / ticks, 2);
  }

  const controllerProgress = Math.max(0, Number(actual.controllerProgress) || 0);
  const constructionProgress = Math.max(0, Number(actual.constructionProgress) || 0);

  return {
    consumerSupply: {
      consumerTicks,
      waitingConsumerTicks: waitingTicks,
      criticalConsumerTicks: Math.max(0, window.criticalConsumerTicks || 0),
      fallbackConsumerTicks: Math.max(0, window.fallbackConsumerTicks || 0),
      emptyConsumerTicks: Math.max(0, window.emptyConsumerTicks || 0),
      waitingRatio: round(waitingTicks / Math.max(1, consumerTicks)),
      criticalRatio: round((window.criticalConsumerTicks || 0) / Math.max(1, consumerTicks)),
      fallbackRatio: round((window.fallbackConsumerTicks || 0) / Math.max(1, consumerTicks)),
      emptyRatio: round((window.emptyConsumerTicks || 0) / Math.max(1, consumerTicks)),
      averageWaitingAgeWhenWaiting: round((window.waitingAgeTicks || 0) / Math.max(1, waitingTicks), 2),
      maxWaitingEnergyTicks: Math.max(0, window.maxWaitingEnergyTicks || 0)
    },
    workCapacity: {
      averageWorkPartsByRole: workPartsByRole,
      averageProductiveWorkParts: round(CONSUMER_ROLES.reduce((sum, role) => sum + workPartsByRole[role], 0), 2),
      averageConstructionCapacityPerTick: round((window.constructionCapacityTicks || 0) / ticks, 2),
      averageDedicatedControllerCapacityPerTick: round((window.controllerCapacityTicks || 0) / ticks, 2),
      constructionBacklogRatio: round((window.constructionBacklogTicks || 0) / ticks),
      controllerDemandRatio: round((window.controllerDemandTicks || 0) / ticks)
    },
    actualThroughput: {
      constructionPerTick: round(constructionProgress / ticks, 2),
      controllerPerTick: round(controllerProgress / ticks, 2),
      totalPerTick: round((constructionProgress + controllerProgress) / ticks, 2)
    },
    ending: endingFlow || null
  };
}

module.exports = {
  observe,
  newWindow,
  accumulate,
  summarize,
  _test: {
    activeWorkParts,
    storedEnergy,
    energyCapacity,
    constructionSnapshot,
    controllerSnapshot,
    CONSUMER_ROLES
  }
};
