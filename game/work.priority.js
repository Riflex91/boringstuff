'use strict';

// Owned infrastructure loss can eliminate spawning and defensive capability.
// This independent priority policy is shared between spawn planning and
// active productive roles; walls, ramparts, and ordinary roads are excluded.
const EMERGENCY_HEALTH_RATIO = 0.35;

function emergencyPriority(structure) {
  if (!structure || structure.my !== true) return -1;
  if (structure.structureType === STRUCTURE_SPAWN) return 0;
  if (structure.structureType === STRUCTURE_TOWER) return 1;
  if (structure.structureType === STRUCTURE_STORAGE) return 2;
  return -1;
}

function isEmergencyRepair(structure) {
  if (emergencyPriority(structure) < 0) return false;
  if (!Number.isFinite(structure.hits) ||
      !Number.isFinite(structure.hitsMax) ||
      structure.hitsMax <= 0 || structure.hits <= 0) return false;
  return structure.hits < structure.hitsMax * EMERGENCY_HEALTH_RATIO;
}

function emergencyRepairTargets(structures) {
  if (!Array.isArray(structures)) return [];
  const candidates = structures.filter(isEmergencyRepair);
  if (!candidates.length) return [];
  let bestPriority = Infinity;
  for (const structure of candidates) {
    bestPriority = Math.min(bestPriority, emergencyPriority(structure));
  }
  // Prefer the most damaged object within the highest infrastructure tier.
  // Distance is a tiebreaker in the active role, not a reason to skip a spawn.
  return candidates.filter(s => emergencyPriority(s) === bestPriority)
    .sort((a, b) => a.hits / a.hitsMax - b.hits / b.hitsMax ||
      String(a.id || '').localeCompare(String(b.id || '')));
}

function hasEmergencyRepair(structures) {
  return Array.isArray(structures) && structures.some(isEmergencyRepair);
}

module.exports = {
  isEmergencyRepair,
  emergencyRepairTargets,
  hasEmergencyRepair,
  _test: { emergencyPriority }
};
