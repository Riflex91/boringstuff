'use strict';

// I4: only owned storage/terminal energy is a verified liquid reserve.
// Room-wide energyStored also counts tower/spawn/extension buffers and
// potentially foreign structures; none may finance a new colony.
const SCHEMA_VERSION = 1;
const MAX_STRUCTURES = 400;
function inspect(state) {
  const unknown = reason => ({
    schemaVersion: SCHEMA_VERSION, status: 'UNVERIFIED', reason,
    energy: null, ownedStores: 0,
    basis: 'OWNED_STORAGE_AND_TERMINAL_ENERGY_ONLY'
  });
  const room = state && state.room;
  if (!room || !room.controller || room.controller.my !== true ||
      typeof room.name !== 'string' || !room.name ||
      !Array.isArray(state.structures) ||
      state.structures.length > MAX_STRUCTURES)
    return unknown('OWNED_ROOM_OR_STRUCTURE_CENSUS_UNVERIFIED');

  const energyKey = typeof RESOURCE_ENERGY !== 'undefined'
    ? RESOURCE_ENERGY : 'energy';
  const seen = new Set();
  let energy = 0;
  let ownedStores = 0;
  for (const structure of state.structures) {
    if (!structure || typeof structure !== 'object')
      return unknown('STRUCTURE_CENSUS_INVALID');
    if (structure.structureType !== 'storage' &&
        structure.structureType !== 'terminal') continue;
    if (structure.my !== true) continue;
    if (typeof structure.id !== 'string' || !structure.id ||
        seen.has(structure.id) ||
        !structure.pos || structure.pos.roomName !== room.name ||
        !structure.store)
      return unknown('OWNED_RESERVE_STRUCTURE_UNVERIFIED');
    seen.add(structure.id);
    const amount = structure.store[energyKey] === undefined
      ? 0 : structure.store[energyKey];
    if (!Number.isSafeInteger(amount) || amount < 0 ||
        !Number.isSafeInteger(energy + amount))
      return unknown('OWNED_RESERVE_AMOUNT_UNVERIFIED');
    energy += amount;
    ownedStores++;
  }
  return {
    schemaVersion: SCHEMA_VERSION, status: 'VERIFIED', reason: null,
    energy, ownedStores,
    basis: 'OWNED_STORAGE_AND_TERMINAL_ENERGY_ONLY'
  };
}
module.exports = {SCHEMA_VERSION, inspect};
