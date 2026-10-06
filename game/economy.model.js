'use strict';

// Phase-2 economy model. v0.2.10 activates measured bootstrap mining growth
// in addition to hauling. Recommendations remain bounded by spawn-manager
// safety caps until source containers and a stable RCL2 economy exist.

function partCount(creep, part) {
  return creep.getActiveBodyparts(part);
}

function ensureRouteCache(state) {
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[state.room.name]) Memory.rooms[state.room.name] = {};
  const mem = Memory.rooms[state.room.name];
  if (!mem.economyRouteCache || mem.economyRouteCache.spawnId !== (state.spawn && state.spawn.id)) {
    mem.economyRouteCache = { spawnId: state.spawn ? state.spawn.id : null, sources: {} };
  }
  return mem.economyRouteCache;
}

function sourceDistance(state, source, cache) {
  if (!state.spawn) return 0;
  const cached = cache.sources[source.id];
  if (cached && cached.spawnX === state.spawn.pos.x && cached.spawnY === state.spawn.pos.y) return cached.distance;
  const distance = state.room.findPath(source.pos, state.spawn.pos, {
    ignoreCreeps: true,
    swampCost: 5,
    plainCost: 2
  }).length;
  cache.sources[source.id] = {
    distance,
    spawnX: state.spawn.pos.x,
    spawnY: state.spawn.pos.y
  };
  return distance;
}

function sourceHasContainer(source) {
  return source.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  }).length > 0;
}

function plannedHarvesterWorkParts(energyCapacity) {
  if (energyCapacity < 300) return 1;
  let work = 2;
  let remaining = energyCapacity - 300;
  while (remaining >= 150 && work < 5) {
    work++;
    remaining -= 150;
  }
  return work;
}

function plannedHaulerCarryParts(energyCapacity) {
  // body.hauler() repeats [CARRY, CARRY, MOVE] at 150 energy per block.
  // Use the same sizing rule here so capacity planning matches the body that
  // spawn.manager will actually create at the room's current capacity.
  return Math.max(2, Math.floor(Math.max(150, energyCapacity) / 150) * 2);
}

function analyze(state) {
  const harvestPower = typeof HARVEST_POWER !== 'undefined' ? HARVEST_POWER : 2;
  const carryCapacity = typeof CARRY_CAPACITY !== 'undefined' ? CARRY_CAPACITY : 50;
  const buildPower = typeof BUILD_POWER !== 'undefined' ? BUILD_POWER : 5;
  const upgradePower = typeof UPGRADE_CONTROLLER_POWER !== 'undefined' ? UPGRADE_CONTROLLER_POWER : 1;
  const sourceCapacity = typeof SOURCE_ENERGY_CAPACITY !== 'undefined' ? SOURCE_ENERGY_CAPACITY : 3000;
  const regenTime = typeof ENERGY_REGEN_TIME !== 'undefined' ? ENERGY_REGEN_TIME : 300;
  const incomePerSource = sourceCapacity / Math.max(1, regenTime);

  const harvesters = state.creeps.filter(c => c.memory.role === 'harvester');
  const haulers = state.creeps.filter(c => c.memory.role === 'hauler');
  const builders = state.creeps.filter(c => c.memory.role === 'builder' || c.memory.role === 'worker');
  const upgraders = state.creeps.filter(c => c.memory.role === 'upgrader');

  const harvesterWorkParts = harvesters.reduce((sum, c) => sum + partCount(c, WORK), 0);
  const harvesterCarryParts = harvesters.reduce((sum, c) => sum + partCount(c, CARRY), 0);
  const haulerCarryParts = haulers.reduce((sum, c) => sum + partCount(c, CARRY), 0);
  const constructionWorkParts = state.sites.length
    ? builders.reduce((sum, c) => sum + partCount(c, WORK), 0)
    : 0;
  const upgraderWorkParts = upgraders.reduce((sum, c) => sum + partCount(c, WORK), 0);

  const cache = ensureRouteCache(state);
  const assignedWork = {};
  let unassignedWork = 0;
  for (const creep of harvesters) {
    const work = partCount(creep, WORK);
    if (creep.memory.sourceId) assignedWork[creep.memory.sourceId] = (assignedWork[creep.memory.sourceId] || 0) + work;
    else unassignedWork += work;
  }

  const sourceRoutes = [];
  let transportWork = 0;
  let dedicatedHarvestCapacityPerTick = 0;
  let containersReady = 0;
  const fallbackPerSource = state.sources.length ? unassignedWork / state.sources.length : 0;
  for (const source of state.sources) {
    const distance = sourceDistance(state, source, cache);
    const workParts = (assignedWork[source.id] || 0) + fallbackPerSource;
    const sourceIncome = Math.min(incomePerSource, workParts * harvestPower);
    const hasContainer = sourceHasContainer(source);
    if (hasContainer) containersReady++;
    dedicatedHarvestCapacityPerTick += sourceIncome;
    transportWork += 2 * distance * sourceIncome;
    sourceRoutes.push({
      sourceId: source.id,
      spawnDistance: distance,
      assignedHarvesterWorkParts: Math.round(workParts * 100) / 100,
      dedicatedIncomePerTick: Math.round(sourceIncome * 100) / 100,
      containerReady: hasContainer
    });
  }

  const theoreticalIncomePerTick = Math.round(state.sources.length * incomePerSource * 100) / 100;
  const productiveDemandPerTick = Math.round((constructionWorkParts * buildPower + upgraderWorkParts * upgradePower) * 100) / 100;
  const recommendedHarvesterWorkParts = Math.ceil(
    Math.min(theoreticalIncomePerTick, Math.max(dedicatedHarvestCapacityPerTick, productiveDemandPerTick)) /
    Math.max(1, harvestPower)
  );

  const nextHarvesterWorkParts = plannedHarvesterWorkParts(state.energyCapacityAvailable);
  const harvesterWorkDeficit = Math.max(0, recommendedHarvesterWorkParts - harvesterWorkParts);
  const recommendedHarvesterCount = harvesters.length + Math.ceil(
    harvesterWorkDeficit / Math.max(1, nextHarvesterWorkParts)
  );
  const consumers = state.creeps.filter(c =>
    c.memory.role === 'builder' || c.memory.role === 'worker' ||
    c.memory.role === 'repairer' || c.memory.role === 'upgrader'
  );
  const consumerFallbackCount = consumers.filter(c => c.memory.logisticsFallback).length;
  const consumerWaitingCount = consumers.filter(c => (c.memory.waitingEnergyTicks || 0) > 0).length;
  const consumerCriticalCount = consumers.filter(c =>
    !!c.memory.logisticsFallback || (c.memory.waitingEnergyTicks || 0) > 0
  ).length;
  const consumerRequestCount = consumers.filter(c => {
    if (!c.store || !c.store.getFreeCapacity || c.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return false;
    const carried = c.store[RESOURCE_ENERGY] || 0;
    return carried === 0 || (c.memory.waitingEnergyTicks || 0) > 0 || !!c.memory.logisticsFallback;
  }).length;
  const consumerDeliveryReservations = haulers.filter(c => c.memory.consumerTargetId).length;

  // Hauling recommendation is deliberately based on current dedicated mining,
  // not theoretical maximum mining. This avoids spawning a fleet of haulers
  // before the source workforce exists.
  const recommendedHaulerCarryParts = Math.ceil(transportWork / Math.max(1, carryCapacity));
  const nextHaulerCarryParts = plannedHaulerCarryParts(state.energyCapacityAvailable);
  const haulerCarryDeficit = Math.max(0, recommendedHaulerCarryParts - haulerCarryParts);

  // v0.2.13 could report HAULING_DEFICIT while spawn planning still stopped at
  // the nominal hauler count. Example from live tick 3679900: 2 haulers were
  // present, but they carried only 10 CARRY parts against 12 required.
  // While a capacity deficit exists, temporarily grow the fleet by enough
  // current-sized bodies to cover that deficit. Once capacity is sufficient,
  // fall back to the minimum ideal count so oversized transition fleets age
  // out naturally instead of becoming permanent.
  const idealHaulerCount = recommendedHaulerCarryParts > 0
    ? Math.max(1, Math.ceil(recommendedHaulerCarryParts / Math.max(1, nextHaulerCarryParts)))
    : 0;
  const carryDrivenHaulerCount = haulerCarryDeficit > 0
    ? Math.max(idealHaulerCount, haulers.length + Math.ceil(haulerCarryDeficit / Math.max(1, nextHaulerCarryParts)))
    : idealHaulerCount;

  const allSourceContainersReady = state.sources.length > 0 && containersReady === state.sources.length;

  // The legacy execution policy keeps at least one hauler available for hard
  // infrastructure while redundant haulers may serve waiting consumers.
  // Aggregate source-route CARRY can therefore be sufficient while productive
  // consumers still wait/fallback. Keep the normal two-hauler service floor for
  // any real pressure; escalate to three only after two haulers are already live
  // and fallback coexists with multiple critical consumers. This uses legacy
  // runtime pressure only; E4 remains shadow/evidence-only.
  const consumerServiceHaulerFloor =
    allSourceContainersReady && consumers.length > 0 && haulers.length >= 2 &&
      consumerFallbackCount > 0 && consumerCriticalCount >= 2
      ? 3
      : allSourceContainersReady && consumers.length > 0 && consumerCriticalCount > 0
        ? 2
        : 0;
  const recommendedHaulerCount = Math.max(carryDrivenHaulerCount, consumerServiceHaulerFloor);
  let mode = 'bootstrap-mobile-harvest';
  if (haulers.length && !allSourceContainersReady) mode = 'bootstrap-hauler';
  if (allSourceContainersReady) mode = 'container-logistics';

  return {
    mode,
    sourceCount: state.sources.length,
    theoreticalIncomePerTick,
    dedicatedHarvestCapacityPerTick: Math.round(dedicatedHarvestCapacityPerTick * 100) / 100,
    productiveDemandPerTick,
    harvesterWorkParts,
    harvesterCarryParts,
    haulerCarryParts,
    recommendedHarvesterWorkParts,
    nextHarvesterWorkParts,
    recommendedHarvesterCount,
    harvesterWorkDeficit,
    consumerFallbackCount,
    consumerWaitingCount,
    consumerCriticalCount,
    consumerRequestCount,
    consumerDeliveryReservations,
    recommendedHaulerCarryParts,
    nextHaulerCarryParts,
    haulerCarryDeficit,
    consumerServiceHaulerFloor,
    recommendedHaulerCount,
    sourceContainersReady: containersReady,
    sourceRoutes
  };
}

module.exports = { analyze };
