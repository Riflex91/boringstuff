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

// Harmless scouts and enemies with only disabled combat parts must not drain
// the last tower energy reserved for a genuine siege.
function activeThreat(hostile) {
  return !!hostile && Array.isArray(hostile.body) &&
    hostile.body.some(p => p && p.hits > 0 &&
      (p.type === 'attack' || p.type === 'ranged_attack' ||
       p.type === 'work' || p.type === 'heal'));
}

function selectHostile(state) {
  const hostiles = state.hostileCreeps || [];
  let best = null;
  let score = -Infinity;
  for (const hostile of hostiles) {
    if (!activeThreat(hostile)) continue;
    const next = hostilePriority(hostile, state);
    if (next > score) { best = hostile; score = next; }
  }
  return best;
}

// During peace, one genuinely surplus-energy tower reinforces an EXISTING
// owned rampart directly covering the spawn/tower/storage. Generic walls and
// remote ramparts are never a reason to drain the last combat ammunition.
function coreRampartTarget(state) {
  if (!state || !Array.isArray(state.structures) ||
      !Number.isFinite(state.energyStored) || state.energyStored < 3000)
    return null;
  const core = state.structures.filter(s => s &&
    s.my === true && s.pos &&
    (s.structureType === STRUCTURE_SPAWN ||
     s.structureType === STRUCTURE_TOWER ||
     s.structureType === STRUCTURE_STORAGE));
  if (!core.length) return null;
  const rcl = state.room && state.room.controller &&
    state.room.controller.level;
  const targetHits = Math.min(150000, Math.max(25000,
    (Number.isSafeInteger(rcl) ? rcl : 3) * 20000));
  const ramps = state.structures.filter(s=>s &&
    s.structureType === STRUCTURE_RAMPART && s.my === true &&
    s.pos && Number.isFinite(s.hits) && Number.isFinite(s.hitsMax) &&
    s.hitsMax > 0 && s.hits >= 0 &&
    s.hits < Math.min(targetHits,s.hitsMax) &&
    core.some(c=>c.pos.x===s.pos.x && c.pos.y===s.pos.y));
  ramps.sort((a,b)=>a.hits-b.hits ||
    String(a.id||'').localeCompare(String(b.id||'')));
  return ramps[0] || null;
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
  if (repair) {
    state.towers.filter(t => (t.store?.[RESOURCE_ENERGY] || 0) > 500)
      .forEach(t => t.repair(repair));
    return;
  }
  const rampart = coreRampartTarget(state);
  if (rampart) {
    const tower = state.towers.find(t =>
      typeof t.repair === 'function' &&
      (t.store?.[RESOURCE_ENERGY] || 0) >= 800);
    if (tower) tower.repair(rampart);
  }
}

module.exports = { run, _test: { hostilePriority, selectHostile, activeThreat, coreRampartTarget } };
