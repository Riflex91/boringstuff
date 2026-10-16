'use strict';

const logger = require('logger');

function hostilePriority(hostile, state) {
  if (!hostile || !hostile.pos) return -Infinity;
  const parts = Array.isArray(hostile.body) ? hostile.body : [];
  const active = type => parts.reduce((n, p) =>
    n + (p.type === type && p.hits > 0 ? 1 : 0), 0);
  const heal = active('heal');
  const attack = active('attack');
  const ranged = active('ranged_attack');
  const work = active('work');
  const critical = (state.structures || []).filter(s =>
    s && (s.structureType === STRUCTURE_SPAWN ||
      s.structureType === STRUCTURE_TOWER ||
      s.structureType === STRUCTURE_STORAGE));
  let proximity = 0;
  for (const structure of critical) {
    if (!structure.pos || typeof hostile.pos.getRangeTo !== 'function') continue;
    const range = hostile.pos.getRangeTo(structure);
    if (Number.isFinite(range)) proximity = Math.max(proximity, Math.max(0, 8 - range));
  }
  // Pure deterministic ranking: prioritize active healers, immediate damage
  // capability and proximity to critical assets. No new attack authority.
  return heal * 220 + ranged * 80 + attack * 65 + work * 12 +
    proximity * 18;
}

function selectHostile(state) {
  const hostiles = state.hostileCreeps || [];
  let best = null;
  let score = -Infinity;
  for (const hostile of hostiles) {
    const next = hostilePriority(hostile, state);
    if (next > score) { best = hostile; score = next; }
  }
  return best;
}

function run(state) {
  if (!state.towers.length) return;
  const hostile = selectHostile(state);
  if (hostile) {
    // O19 evidence only: preserve the exact tower target and one attack intent
    // per tower. Historically TOWER_ENGAGE was logged even when every attack
    // returned an error (e.g. no energy). An accepted intent is NOT confirmed
    // damage: never use this telemetry as combat or expansion authority.
    const codeCounts = {};
    let unknownReturnCodes = 0;
    let towersWithVerifiedEnergy = 0;
    let towersReadyAtIntent = 0;
    for (const tower of state.towers) {
      const energy = tower?.store?.[RESOURCE_ENERGY];
      if (Number.isSafeInteger(energy) && energy >= 0) {
        towersWithVerifiedEnergy++;
        if (energy >= 10) towersReadyAtIntent++;
      }
      const rc = tower.attack(hostile);
      if (Number.isSafeInteger(rc) && rc >= -100 && rc <= 100) {
        const key = String(rc);
        codeCounts[key] = (codeCounts[key] || 0) + 1;
      } else {
        unknownReturnCodes++;
      }
    }
    logger.warn('TOWER_ENGAGE', 'Tower engaging hostile', {
      room: state.room.name,
      hostile: hostile.owner && hostile.owner.username,
      hostileId: hostile.id,
      count: state.hostileCreeps.length,
      attackIntentCount: state.towers.length,
      acceptedIntentCount: codeCounts['0'] || 0,
      attackReturnCodeCounts: codeCounts,
      unknownReturnCodes,
      towersWithVerifiedEnergy,
      towersReadyAtIntent: towersWithVerifiedEnergy === state.towers.length
        ? towersReadyAtIntent : null,
      hitOrKillVerified: false
    }, { dedupeTicks: 3 });
    return;
  }

  const hurt = state.room.find(FIND_MY_CREEPS, { filter: c => c.hits < c.hitsMax })[0];
  if (hurt) {
    state.towers.forEach(t => t.heal(hurt));
    return;
  }

  const repair = state.structures
    .filter(s => s.hits !== undefined && s.hits < s.hitsMax * 0.35 && s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART)
    .sort((a, b) => (a.hits / a.hitsMax) - (b.hits / b.hitsMax))[0];
  if (repair) state.towers.filter(t => (t.store[RESOURCE_ENERGY] || 0) > 500).forEach(t => t.repair(repair));
}

module.exports = { run, _test: { hostilePriority, selectHostile } };
