'use strict';

const config=require('config');
const ROOM=/^[WE][0-9]+[NS][0-9]+$/;
const PLAYER=/^[A-Za-z0-9_-]{1,40}$/;

// U11: executor ONLY for a later reviewed, exact-ID combat operation.
// Neither this role nor the defense/intel advisory creates ATTACKING
// missions, provisions troops or grants authority to target neutral rooms.
function missionFor(creep,memory,game) {
  const m=memory?.bot?.counterattackMission;
  const tick=game?.time;
  if(!creep?.memory || creep.memory.role!=='raider' || !m ||
     m.schemaVersion!==1 ||
     !['ATTACKING','RETREAT'].includes(m.phase) ||
     typeof m.id!=='string' || m.id.length>100 ||
     !/^raid-[WE][0-9]+[NS][0-9]+-[WE][0-9]+[NS][0-9]+-[0-9]+$/.test(m.id) ||
     m.id!==('raid-'+m.parent+'-'+m.target+'-'+m.createdTick) ||
     m.id!==creep.memory.combatMissionId ||
     !ROOM.test(m.parent||'') || !ROOM.test(m.target||'') ||
     m.parent===m.target ||
     !PLAYER.test(m.aggressor||'') ||
     ['Invader','Source Keeper'].includes(m.aggressor) ||
     !Number.isSafeInteger(m.createdTick) || m.createdTick<0 ||
     !Number.isSafeInteger(tick) || tick<m.createdTick ||
     tick-m.createdTick>(m.phase==='RETREAT'?1700:1500) ||
     !Array.isArray(m.route) || m.route.length<2 ||
     m.route.length>4 || m.route[0]!==m.parent ||
     m.route.at(-1)!==m.target ||
     new Set(m.route).size!==m.route.length ||
     m.route.some(x=>!ROOM.test(x)))
    return null;
  return m;
}

function retreat(creep,m) {
  const index=m.route.indexOf(creep.room?.name);
  if(index<=0) return;
  const prev=m.route[index-1];
  const exit=Game.map?.findExit?.(creep.room.name,prev);
  if(!Number.isInteger(exit) || exit<0) return;
  const position=creep.pos.findClosestByRange(exit);
  if(position) creep.moveTo(position,{maxRooms:1,maxOps:config.PATH_MAX_OPS,
    reusePath:4});
}

function recall(m,reason) {
  m.phase='RETREAT';
  m.reason=reason;
  m.retreatTick=Game.time;
}

function hostileCreeps(room) {
  if(!room || typeof room.find!=='function' ||
     typeof FIND_HOSTILE_CREEPS==='undefined')return null;
  const enemies=room.find(FIND_HOSTILE_CREEPS);
  return Array.isArray(enemies)?enemies:null;
}

function selectEnemy(creep,enemies,player) {
  const candidates=enemies.filter(h=>h?.owner?.username===player &&
    h.pos && Array.isArray(h.body) &&
    h.body.some(p=>p && p.hits>0 &&
      ['attack','ranged_attack','work','heal'].includes(p.type)));
  const weight=h=>{
    let heal=0,ranged=0,melee=0;
    for(const p of h.body) {
      if(!p || p.hits<=0)continue;
      if(p.type==='heal')heal++;
      else if(p.type==='ranged_attack')ranged++;
      else if(p.type==='attack')melee++;
    }
    return heal*200+ranged*100+melee*90;
  };
  candidates.sort((a,b)=>weight(b)-weight(a) ||
    creep.pos.getRangeTo(a)-creep.pos.getRangeTo(b) ||
    String(a.id||'').localeCompare(String(b.id||'')));
  return candidates[0]||null;
}

// The original launch advantage cannot be trusted after defenders respawn,
// receive boosts or destroy our combat parts while the raider is in transit.
// Re-evaluate the actually observed opponent bodies immediately before every
// attack, with the same conservative 5:1 damage and heal margin as launch.
function unsafeEngagement(creep,enemies,owner) {
  if(!Array.isArray(enemies) || enemies.length>2 ||
     typeof creep?.getActiveBodyparts!=='function' ||
     typeof ATTACK==='undefined')return true;
  const ourDps=30*creep.getActiveBodyparts(ATTACK);
  if(!Number.isFinite(ourDps) || ourDps<150)return true;
  let damage=0,heal=0,hits=0;
  for(const enemy of enemies) {
    if(enemy?.owner?.username!==owner ||
       !Array.isArray(enemy.body) || enemy.body.length>50 ||
       enemy.body.length===0)return true;
    for(const part of enemy.body) {
      if(!part || !Number.isInteger(part.hits) ||
         part.hits<0 || part.hits>100 || part.boost)return true;
      if(!part.hits)continue;
      hits+=part.hits;
      if(part.type==='attack' || part.type==='work')damage+=30;
      if(part.type==='ranged_attack')damage+=10;
      if(part.type==='heal')heal+=12;
    }
  }
  return damage>ourDps/5 || heal>ourDps/5 ||
    hits>ourDps*8 || ourDps-heal<4*damage;
}

function run(creep) {
  const m=missionFor(creep,Memory,Game);
  if(!m || !creep?.room || !creep.pos) return;
  // Once the attack authorization expires, force withdrawal. RETREAT
  // remains executable without fresh enemy intel: lost reconnaissance must
  // never strand surviving troops behind enemy lines.
  if(m.phase==='RETREAT') {retreat(creep,m);return;}
  const journal=Memory.bot?.combatAggressionEvidence;
  const stillWitnessed=journal?.schemaVersion===1 &&
    Array.isArray(journal.records) &&
    journal.records.some(row=>row?.player===m.aggressor &&
      row.room===m.parent && Number.isSafeInteger(row.tick) &&
      Number.isSafeInteger(row.armedParts) && row.armedParts>0 &&
      row.tick<=Game.time && Game.time-row.tick<=2000);
  if(Game.time-m.createdTick>900 ||
     !Number.isSafeInteger(m.targetOwnerSeenTick) ||
     m.targetOwnerSeenTick>Game.time ||
     Game.time-m.targetOwnerSeenTick>150 || !stillWitnessed) {
    recall(m,'RAID_AUTHORIZATION_EXPIRED');
    retreat(creep,m);return;
  }
  const parent=Game.rooms?.[m.parent];
  const homeHostiles=hostileCreeps(parent);
  if(!parent?.controller?.my ||
     (Number(parent.controller.safeMode)||0)>0 ||
     (Number(parent.controller.safeModeCooldown)||0)>0 ||
     !homeHostiles || homeHostiles.length) {
    recall(m,'HOME_DEFENSE_RECALLED');
    retreat(creep,m);return;
  }
  if(!Number.isFinite(creep.hits) || !Number.isFinite(creep.hitsMax) ||
     creep.hitsMax<=0 || creep.hits/creep.hitsMax<0.75 ||
     !Number.isSafeInteger(creep.ticksToLive) ||
     creep.ticksToLive<150) {
    recall(m,'CASUALTY_OR_TTL_ABORT');
    retreat(creep,m);return;
  }
  if(typeof ATTACK==='undefined' ||
     typeof creep.getActiveBodyparts!=='function' ||
     creep.getActiveBodyparts(ATTACK)<1) {
    recall(m,'NO_ACTIVE_ATTACK_CAPABILITY');
    retreat(creep,m);return;
  }
  const index=m.route.indexOf(creep.room.name);
  if(index<0) {
    recall(m,'OFF_APPROVED_ROUTE');return;
  }
  const here=hostileCreeps(creep.room);
  if(!here) {recall(m,'HOSTILE_VISION_UNVERIFIED');retreat(creep,m);return;}
  if(index<m.route.length-1) {
    // No fighting in neutral transit rooms; a stranger blocks the route.
    if(here.length && creep.room.name!==m.parent) {
      recall(m,'TRANSIT_ROOM_UNSAFE');
      retreat(creep,m);return;
    }
    const next=m.route[index+1];
    const exits=Game.map?.describeExits?.(creep.room.name);
    if(!exits || !Object.values(exits).includes(next)) {
      recall(m,'ROUTE_ADJACENCY_INVALID');retreat(creep,m);return;
    }
    const direction=Game.map?.findExit?.(creep.room.name,next);
    if(!Number.isInteger(direction) || direction<0) {
      recall(m,'ROUTE_EXIT_UNAVAILABLE');retreat(creep,m);return;
    }
    const exit=creep.pos.findClosestByRange(direction);
    if(!exit) {recall(m,'ROUTE_BLOCKED');retreat(creep,m);return;}
    creep.moveTo(exit,{maxRooms:1,maxOps:config.PATH_MAX_OPS,reusePath:6});
    return;
  }
  const ctrl=creep.room.controller;
  if(!ctrl || ctrl.my!==false ||
     ctrl.owner?.username!==m.aggressor ||
     (Number(ctrl.safeMode)||0)>0) {
    recall(m,'TARGET_OWNERSHIP_OR_SAFE_MODE_CHANGED');
    retreat(creep,m);return;
  }
  if(typeof FIND_HOSTILE_STRUCTURES==='undefined') {
    recall(m,'STRUCTURE_THREAT_UNVERIFIED');retreat(creep,m);return;
  }
  const structures=creep.room.find(FIND_HOSTILE_STRUCTURES);
  if(!Array.isArray(structures) || structures.some(s=>
      s?.structureType===STRUCTURE_TOWER)) {
    recall(m,'ENEMY_TOWER_OR_UNVERIFIED_DEFENSE');
    retreat(creep,m);return;
  }
  if(here.some(h=>h?.owner?.username!==m.aggressor)) {
    recall(m,'UNEXPECTED_THIRD_PARTY');
    retreat(creep,m);return;
  }
  if(unsafeEngagement(creep,here,m.aggressor)) {
    recall(m,'LIVE_COMBAT_MARGIN_LOST');
    retreat(creep,m);return;
  }
  const enemy=selectEnemy(creep,here,m.aggressor);
  if(!enemy) {
    creep.memory.noRaidTargetTicks=(creep.memory.noRaidTargetTicks||0)+1;
    if(creep.memory.noRaidTargetTicks>=10) {
      recall(m,'NO_VERIFIED_AGGRESSOR_TARGET');
      retreat(creep,m);
    }
    return;
  }
  creep.memory.noRaidTargetTicks=0;
  const rc=creep.attack(enemy);
  if(rc===ERR_NOT_IN_RANGE)
    creep.moveTo(enemy,{maxRooms:1,maxOps:config.PATH_MAX_OPS,reusePath:3});
  else if(rc!==OK && rc!==ERR_BUSY) {
    recall(m,'ATTACK_INTENT_REJECTED');
    retreat(creep,m);
  }
}
module.exports={run,_test:{missionFor,selectEnemy,unsafeEngagement}};
