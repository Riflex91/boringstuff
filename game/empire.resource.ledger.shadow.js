'use strict';

// M0 read-only inventory census. No market, terminal, spawn, reservation, or
// inter-colony transfer authority. Never infer spendable stock from gross stock.
const SCHEMA_VERSION = 1;
const MAX_ROOMS = 25;
const MAX_ENTITIES_PER_ROOM = 3000;

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
  if (!store || typeof store !== 'object') {
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
    totals: { structures: {}, carried: {} }
  };
  if (!Array.isArray(states) || !Number.isSafeInteger(tick) || tick < 0 ||
      states.length > MAX_ROOMS)
    return { ...base, reasonCodes: ['INPUT_UNVERIFIED'] };

  const errors = new Set();
  const names = new Set();
  const seenEntities = new Set();
  const structureTotals = empty();
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
    const carried = empty();
    for (const s of state.structures) {
      if (!structureEligible(s)) continue;
      // A legitimate rampart/road/etc. has no Store to inspect. Keep missing
      // store on storage/terminal/spawn or unknown types an explicit error.
      if (s.store == null && NON_STORING_STRUCTURES.has(s.structureType)) continue;
      add(s.store, held, errors, seenEntities, s.id);
    }
    for (const c of state.creeps) {
      if (!c || c.my === false) continue;
      add(c.store, carried, errors, seenEntities, c.id || c.name);
    }
    for (const [resource, amount] of Object.entries(held)) {
      const total = (structureTotals[resource] || 0) + amount;
      if (!Number.isSafeInteger(total)) errors.add('RESOURCE_OVERFLOW');
      else structureTotals[resource] = total;
    }
    for (const [resource, amount] of Object.entries(carried)) {
      const total = (carriedTotals[resource] || 0) + amount;
      if (!Number.isSafeInteger(total)) errors.add('RESOURCE_OVERFLOW');
      else carriedTotals[resource] = total;
    }
    base.rooms.push({
      roomName: name,
      resources: { structures: sortedTotals(held), carried: sortedTotals(carried) },
      // Reserves/commitments are NOT proven by this inventory-only census.
      availableToCommit: null
    });
  }
  base.rooms.sort((a,b) => a.roomName.localeCompare(b.roomName));
  base.totals = {
    structures: sortedTotals(structureTotals),
    carried: sortedTotals(carriedTotals)
  };
  if (!base.rooms.length) errors.add('NO_VERIFIED_OWNED_ROOM');
  base.reasonCodes = [...errors].sort();
  base.status = errors.size ? 'PARTIAL' : 'OBSERVED';
  // A PARTIAL census may expose observed amounts, never a usable reserve.
  return base;
}

module.exports = { SCHEMA_VERSION, snapshot };
