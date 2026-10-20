'use strict';

const logger = require('logger');
const siege = require('defense.siege.triage');

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
  let proximity = 0, directCoreDamage = 0;
  for (const structure of critical) {
    if (!structure.pos || typeof hostile.pos.getRangeTo !== 'function') continue;
    const range = hostile.pos.getRangeTo(structure);
    if (!Number.isSafeInteger(range) || range<0)continue;
    proximity = Math.max(proximity, Math.max(0, 8 - range));
    let damage=0;
    for(const p of parts) {
      if(!p || !(p.hits>0))continue;
      const boost=p.boost?4:1;
      if(range<=1 && p.type==='attack')damage+=30*boost;
      else if(range<=1 && p.type==='work')damage+=50*boost;
      else if(range<=3 && p.type==='ranged_attack')damage+=10*boost;
    }
    directCoreDamage=Math.max(directCoreDamage,damage);
  }
  // An enemy actively striking the Spawn outranks a distant healer.
  // Existing healer preference holds when no real core is under fire.
  return heal * 220 + ranged * 80 + attack * 65 + work * 12 +
    proximity * 18 + Math.min(2400,directCoreDamage * 12);
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
    if (next > score || (next === score && best &&
        String(hostile.id||'') < String(best.id||''))) {
      best = hostile; score = next;
    }
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
  // All externally logged D4 fields are aggregate-only. Attempts are not
  // claims of settled engine actions or target death.
  state.defenseSiege = siege.threatSummary(state.hostileCreeps);
  const result=(status,attackAttempts=0,healAttempts=0,repairAttempts=0)=>{
    state.defenseTowerAction={status,attackAttempts,healAttempts,
      repairAttempts,towerCount:state.towers.length};
  };
  if (!state.towers.length) {result('NO_TOWERS');return;}
  const hostile = selectHostile(state);
  if (hostile) {
    let friends=Array.isArray(state.creeps)?state.creeps:null;
    if(!friends && state.room && typeof state.room.find==='function' &&
       typeof FIND_MY_CREEPS!=='undefined') {
      try {friends=state.room.find(FIND_MY_CREEPS);}
      catch (_) {friends=null;}
    }
    const triage=siege.chooseEmergencyHeal(friends,state.hostileCreeps);
    if(triage.target && triage.imminent) {
      state.towers.forEach(t=>t.heal(triage.target));
      result('HEAL_IMMINENT',0,state.towers.length);
      return;
    }
    if(triage.target && state.towers.length>1) {
      const healer=state.towers[0];
      healer.heal(triage.target);
      for(const tower of state.towers.slice(1))tower.attack(hostile);
      result('HEAL_AND_FOCUS_FIRE',state.towers.length-1,1);
    } else {
      state.towers.forEach(t => t.attack(hostile));
      result('FOCUS_FIRE',state.towers.length);
    }
    logger.warn('TOWER_ENGAGE', 'Tower engaging hostile', { room: state.room.name, hostile: hostile.owner && hostile.owner.username, hostileId: hostile.id, count: state.hostileCreeps.length }, { dedupeTicks: 3 });
    return;
  }

  const hurt = state.room.find(FIND_MY_CREEPS, { filter: c => c.hits < c.hitsMax })[0];
  if (hurt) {
    state.towers.forEach(t => t.heal(hurt));
    result('HEAL_PEACE',0,state.towers.length);
    return;
  }

  const repair = state.structures
    .filter(s => s.hits !== undefined && s.hits < s.hitsMax * 0.35 && s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART)
    .sort((a, b) => (a.hits / a.hitsMax) - (b.hits / b.hitsMax))[0];
  if (repair) {
    const rich=state.towers.filter(t => (t.store?.[RESOURCE_ENERGY] || 0) > 500);
    rich.forEach(t => t.repair(repair));
    result('REPAIR_CORE',0,0,rich.length);
    return;
  }
  const rampart = coreRampartTarget(state);
  if (rampart) {
    const tower = state.towers.find(t =>
      typeof t.repair === 'function' &&
      (t.store?.[RESOURCE_ENERGY] || 0) >= 800);
    if (tower) {tower.repair(rampart);result('FORTIFY_CORE',0,0,1);}
    else result('RESERVE_ENERGY');
    return;
  }
  result('IDLE');
}

module.exports = { run, _test: { hostilePriority, selectHostile, activeThreat, coreRampartTarget } };
