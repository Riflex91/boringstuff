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
    state.towers.forEach(t => t.attack(hostile));
    logger.warn('TOWER_ENGAGE', 'Tower engaging hostile', { room: state.room.name, hostile: hostile.owner && hostile.owner.username, hostileId: hostile.id, count: state.hostileCreeps.length }, { dedupeTicks: 3 });
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
