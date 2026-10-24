'use strict';

// M0 read-only inventory census. No market, terminal, spawn, reservation, or
// inter-colony transfer authority. Never infer spendable stock from gross stock.
const SCHEMA_VERSION = 1;
const MAX_ROOMS = 25;
const MAX_ENTITIES_PER_ROOM = 3000;

const PRODUCTION_TYPES = Object.freeze({
  lab: 'labs',
  factory: 'factories',
  terminal: 'terminals',
  powerSpawn: 'powerSpawns'
});

function emptyProduction() {
  return { labs: 0, factories: 0, terminals: 0, powerSpawns: 0 };
}

// M0 strategic needs are observational refill pressure / memory-reported
// consumer starvation; never verified surplus, spendable stock or authority.
const CONSUMER_ROLES = Object.freeze({
  builder: true, worker: true, repairer: true, upgrader: true
});

function observeStrategicNeeds(state) {
  const reasons = [];
  const available = state.energyAvailable;
  const capacity = state.energyCapacityAvailable;
  const capacityVerified = Number.isSafeInteger(available) &&
    Number.isSafeInteger(capacity) && capacity > 0 &&
    available >= 0 && available <= capacity;
  if (!capacityVerified) reasons.push('INFRASTRUCTURE_ENERGY_UNVERIFIED');

  let waiting = 0, fallback = 0;
  for (const creep of state.creeps) {
    if (creep && creep.my === false) continue;
    if (!creep || !creep.memory || typeof creep.memory !== 'object') {
      reasons.push('CONSUMER_MEMORY_UNVERIFIED');
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(CONSUMER_ROLES, creep.memory.role))
      continue;
    const ticks = creep.memory.waitingEnergyTicks == null
      ? 0 : creep.memory.waitingEnergyTicks;
    const flag = creep.memory.logisticsFallback == null
      ? false : creep.memory.logisticsFallback;
    if (!Number.isSafeInteger(ticks) || ticks < 0 ||
        typeof flag !== 'boolean') {
      reasons.push('CONSUMER_PRESSURE_UNVERIFIED');
      continue;
    }
    if (ticks > 0) waiting++;
    if (flag) fallback++;
  }
  const pressureVerified = !reasons.includes('CONSUMER_MEMORY_UNVERIFIED') &&
    !reasons.includes('CONSUMER_PRESSURE_UNVERIFIED');
  return {
    status: reasons.length ? 'PARTIAL' : 'OBSERVED',
    reasonCodes: [...new Set(reasons)].sort(),
    spawnExtensionRefillDeficit: capacityVerified ? capacity - available : null,
    reportedWaitingConsumers: pressureVerified ? waiting : null,
    reportedFallbackConsumers: pressureVerified ? fallback : null,
    verifiedStrategicReserve: null,
    verifiedSupportCapacity: null,
    availableForExternalAllocation: null
  };
}

// Owned defensive/utility structures are visible in FIND_STRUCTURES but have
// no resource Store in Screeps. Their absence must not invalidate an otherwise
// complete resource census. Unknown/new store-bearing structures remain
// eligible; unknown objects WITHOUT a store still fail closed.
const NON_STORING_STRUCTURES = new Set([
  'rampart', 'constructedWall', 'road', 'observer', 'extractor', 'controller'
]);

function empty() {
  return Object.create(null);
}

function add(store, totals, errors, seen, entityId) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    errors.add('STORE_MISSING');
    return;
  }
  if (typeof entityId !== 'string' || !entityId || seen.has(entityId)) {
    errors.add('ENTITY_ID_MISSING_OR_DUPLICATE');
    return;
  }
  seen.add(entityId);
  for (const resource of Object.keys(store)) {
    const amount = store[resource];
    if (typeof amount === 'function') continue;
    if (!resource || !Number.isSafeInteger(amount) || amount < 0) {
      errors.add('INVALID_RESOURCE_AMOUNT');
      continue;
    }
    if (!Number.isSafeInteger((totals[resource] || 0) + amount)) {
      errors.add('RESOURCE_OVERFLOW');
      continue;
    }
    totals[resource] = (totals[resource] || 0) + amount;
  }
}

function sortedTotals(totals) {
  return Object.fromEntries(Object.keys(totals).sort().map(k => [k, totals[k]]));
}

function structureEligible(s) {
  if (!s) return false;
  if (s.my === true) return true;
  // Neutral source containers can report my=false even within our room.
  // Count only ownerless, publicly withdrawable containers; never include a
  // foreign-owned structure merely because it is visible in the room.
  return s.structureType === 'container' && !s.owner;
}

function snapshot(states, tick) {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW',
    actionEnabled: false,
    availableToCommit: null,
    tick: Number.isSafeInteger(tick) && tick >= 0 ? tick : null,
    status: 'HOLD',
    reasonCodes: [],
    rooms: [],
    totals: { structures: {}, carried: {}, terminal: {} },
    productionInfrastructure: emptyProduction(),
    productionReadyToUse: null
  };
  if (!Array.isArray(states) || !Number.isSafeInteger(tick) || tick < 0 ||
      states.length > MAX_ROOMS)
    return { ...base, reasonCodes: ['INPUT_UNVERIFIED'] };

  const errors = new Set();
  const names = new Set();
  const seenEntities = new Set();
  const seenTerminalIds = new Set();
  const observedProductionIds = new Set();
  const structureTotals = empty();
  const terminalTotals = empty();
  const carriedTotals = empty();
  for (const state of states) {
    const room = state && state.room;
    if (!room || !room.controller || room.controller.my !== true) {
      errors.add('ROOM_OWNERSHIP_UNVERIFIED');
      continue;
    }
    const name = room.name;
    if (typeof name !== 'string' || !name || names.has(name)) {
      errors.add('ROOM_NAME_MISSING_OR_DUPLICATE');
      continue;
    }
    names.add(name);
    if (!Array.isArray(state.structures) || !Array.isArray(state.creeps) ||
        state.structures.length + state.creeps.length > MAX_ENTITIES_PER_ROOM) {
      errors.add('ROOM_INVENTORY_INCOMPLETE');
      continue;
    }
    const held = empty();
    const heldInTerminal = empty();
    const carried = empty();
    const productionInfrastructure = emptyProduction();
    for (const s of state.structures) {
      // A malformed GET census member cannot be silently treated as foreign
      // or as an empty inventory; keep the entire gross snapshot PARTIAL.
      if (!s || typeof s !== 'object' || Array.isArray(s)) {
        errors.add('ROOM_INVENTORY_INCOMPLETE');
        continue;
      }
      if (!structureEligible(s)) continue;
      // Hardware presence is a verified fact, not permission to produce.
      // Ignore unowned/neutral installations and deduplicate by object ID;
      // readiness, reagent stocks, cooldowns and reservations are unknown.
      const kind = s.my === true &&
        Object.prototype.hasOwnProperty.call(PRODUCTION_TYPES, s.structureType)
        ? PRODUCTION_TYPES[s.structureType] : null;
      if (kind && typeof s.id === 'string' && s.id &&
          !observedProductionIds.has(s.id)) {
        productionInfrastructure[kind] += 1;
        observedProductionIds.add(s.id);
      }
      // A legitimate rampart/road/etc. has no Store to inspect. Keep missing
      // store on storage/terminal/spawn or unknown types an explicit error.
      if (s.store == null && NON_STORING_STRUCTURES.has(s.structureType)) continue;
      add(s.store, held, errors, seenEntities, s.id);
      // A room-wide gross total is NOT terminal-accessible inventory.
      // Only explicitly owned terminals count toward terminal-local stock.
      // Duplicate IDs across rooms are excluded by the bounded global set.
      if (s.my === true && s.structureType === 'terminal')
        add(s.store, heldInTerminal, errors, seenTerminalIds, s.id);
    }
    for (const c of state.creeps) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        errors.add('ROOM_INVENTORY_INCOMPLETE');
        continue;
      }
      if (c.my === false) continue;
      add(c.store, carried, errors, seenEntities, c.id || c.name);
    }
    for (const [resource, amount] of Object.entries(held)) {
      const total = (structureTotals[resource] || 0) + amount;
      if (!Number.isSafeInteger(total)) errors.add('RESOURCE_OVERFLOW');
      else structureTotals[resource] = total;
    }
    for (const [resource, amount] of Object.entries(heldInTerminal)) {
      const total = (terminalTotals[resource] || 0) + amount;
      if (!Number.isSafeInteger(total)) errors.add('RESOURCE_OVERFLOW');
      else terminalTotals[resource] = total;
    }
    for (const [resource, amount] of Object.entries(carried)) {
      const total = (carriedTotals[resource] || 0) + amount;
      if (!Number.isSafeInteger(total)) errors.add('RESOURCE_OVERFLOW');
      else carriedTotals[resource] = total;
    }
    for (const kind of Object.keys(productionInfrastructure))
      base.productionInfrastructure[kind] += productionInfrastructure[kind];
    base.rooms.push({
      roomName: name,
      resources: { structures: sortedTotals(held), carried: sortedTotals(carried),
        terminal: sortedTotals(heldInTerminal) },
      productionInfrastructure,
      strategicNeeds: observeStrategicNeeds(state),
      // Presence is not operational readiness; never authorize recipes here.
      productionReadyToUse: null,
      // Reserves/commitments are NOT proven by this inventory-only census.
      availableToCommit: null
    });
  }
  base.rooms.sort((a,b) => a.roomName.localeCompare(b.roomName));
  base.totals = {
    structures: sortedTotals(structureTotals),
    carried: sortedTotals(carriedTotals),
    terminal: sortedTotals(terminalTotals)
  };
  if (!base.rooms.length) errors.add('NO_VERIFIED_OWNED_ROOM');
  base.reasonCodes = [...errors].sort();
  base.status = errors.size ? 'PARTIAL' : 'OBSERVED';
  // A PARTIAL census may expose observed amounts, never a usable reserve.
  return base;
}

module.exports = { SCHEMA_VERSION, snapshot };
