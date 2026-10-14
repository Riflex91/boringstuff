'use strict';

const config = require('config');

// Bounded defensive targeting: a lone harmless scout cannot lure the only
// melee defender away from home. Only active combat, dismantle or healer
// support parts qualify. Use one legacy-bounded path search at most.
function threatScore(hostile, core) {
  if (!hostile || !hostile.pos || !Array.isArray(hostile.body)) return -Infinity;
  let melee = 0, ranged = 0, dismantle = 0, heal = 0;
  for (const part of hostile.body) {
    if (!part || !(part.hits > 0)) continue;
    if (part.type === 'attack') melee++;
    if (part.type === 'ranged_attack') ranged++;
    if (part.type === 'work') dismantle++;
    if (part.type === 'heal') heal++;
  }
  if (!melee && !ranged && !dismantle && !heal) return -Infinity;
  let proximity = 0;
  for (const building of core) {
    if (!building || !building.pos ||
        typeof hostile.pos.getRangeTo !== 'function') continue;
    const d = hostile.pos.getRangeTo(building);
    if (!Number.isFinite(d) || d < 0) continue;
    // A striker at the spawn outranks a healer at the exit.
    if (d <= 3 && (melee || ranged || dismantle)) proximity = Math.max(proximity, 1200);
    else if (d <= 6) proximity = Math.max(proximity, 200);
  }
  return proximity + heal * 200 + ranged * 100 +
    melee * 90 + dismantle * 80;
}

function selectTarget(creep) {
  if (!creep || !creep.room || typeof creep.room.find !== 'function' ||
      !creep.pos || typeof creep.pos.findClosestByPath !== 'function') return null;
  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  if (!Array.isArray(hostiles) || !hostiles.length) return null;
  const structures = typeof FIND_MY_STRUCTURES !== 'undefined'
    ? creep.room.find(FIND_MY_STRUCTURES) : [];
  const core = Array.isArray(structures) ? structures.filter(s =>
    s && (s.structureType === STRUCTURE_SPAWN ||
      s.structureType === STRUCTURE_TOWER ||
      s.structureType === STRUCTURE_STORAGE)) : [];
  const ranked = hostiles.map(h => ({target:h,score:threatScore(h,core)}))
    .filter(x => Number.isFinite(x.score))
    .sort((a,b) => b.score - a.score ||
      String(a.target.id || '').localeCompare(String(b.target.id || '')));
  if (!ranked.length) return null;
  // One cost-capped path query. Prefer reachable candidates among the
  // three most urgent hostiles; all choices remain in our visible room.
  return creep.pos.findClosestByPath(
    ranked.slice(0,3).map(x => x.target),
    {maxOps:config.PATH_MAX_OPS}) || null;
}

function run(creep) {
  const target = selectTarget(creep);
  if (target) {
    const rc = creep.attack(target);
    if (rc === ERR_NOT_IN_RANGE)
      creep.moveTo(target,{reusePath:3,maxRooms:1,maxOps:config.PATH_MAX_OPS});
    return;
  }
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && creep.pos.getRangeTo(spawn) > 3)
    creep.moveTo(spawn,{reusePath:10,maxRooms:1,maxOps:config.PATH_MAX_OPS});
}

module.exports = { run, _test: { threatScore, selectTarget } };
