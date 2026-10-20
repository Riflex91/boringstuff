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

// D6: a preexisting, actually owned critical core-overlaid Rampart under
// active enemy weapon pressure is a priority repair, not a wall-hits race.
// Ignore distant enemy scouts, non-owned shields and speculative perimeter
// walls. Upper-bound all scans to avoid a siege causing a CPU spiral.
function criticalCoreShieldTargets(structures,hostiles) {
  if(!Array.isArray(structures) || structures.length>600 ||
     !Array.isArray(hostiles) || hostiles.length>40)return [];
  const core=structures.filter(s=>s && s.my===true && s.pos &&
    ['spawn','tower','storage'].includes(s.structureType));
  if(!core.length)return [];
  const threatened=[];
  for(const shield of structures) {
    if(!shield || shield.my!==true ||
       shield.structureType!=='rampart' || !shield.pos ||
       !Number.isFinite(shield.hits) || shield.hits<=0)continue;
    const overlay=core.find(s=>s.pos.x===shield.pos.x &&
      s.pos.y===shield.pos.y);
    if(!overlay)continue;
    let nextDamage=0;
    for(const enemy of hostiles) {
      if(!enemy?.pos || typeof enemy.pos.getRangeTo!=='function' ||
         !Array.isArray(enemy.body) || enemy.body.length>50)continue;
      let d;
      try{d=enemy.pos.getRangeTo(shield);}catch(_){continue;}
      if(!Number.isSafeInteger(d) || d<0 || d>3)continue;
      for(const part of enemy.body) {
        if(!part || !(part.hits>0))continue;
        const boost=part.boost?4:1;
        if(d<=1 && part.type==='attack')nextDamage+=30*boost;
        else if(d<=1 && part.type==='work')nextDamage+=50*boost;
        else if(d<=3 && part.type==='ranged_attack')
          nextDamage+=10*boost;
      }
    }
    if(nextDamage<=0 || shield.hits>Math.max(30000,nextDamage*12))
      continue;
    threatened.push({shield,priority:overlay.structureType==='spawn'?0:
      overlay.structureType==='tower'?1:2,
      turns:shield.hits/nextDamage});
  }
  threatened.sort((a,b)=>a.turns-b.turns ||
    a.priority-b.priority ||
    String(a.shield.id||'').localeCompare(String(b.shield.id||'')));
  return threatened.slice(0,5).map(x=>x.shield);
}
function hasCriticalCoreShieldThreat(structures,hostiles) {
  return criticalCoreShieldTargets(structures,hostiles).length>0;
}

module.exports = {
  isEmergencyRepair,
  emergencyRepairTargets,
  hasEmergencyRepair,
  criticalCoreShieldTargets,
  hasCriticalCoreShieldThreat,
  _test: { emergencyPriority }
};
