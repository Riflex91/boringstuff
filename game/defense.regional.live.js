'use strict';

const config=require('config');
const ROOM=/^[WE][0-9]+[NS][0-9]+$/;
const MAX_ASSIGNMENT_TICKS=350;
function armed(c) {
  return !!c && Array.isArray(c.body) &&
    c.body.some(p=>p && p.hits>0 &&
      ['attack','ranged_attack','work'].includes(p.type));
}
function combatDefender(c,home) {
  return !!c && c.my===true && !c.spawning &&
    c.memory?.role==='defender' && c.memory.home===home &&
    c.room?.name===home &&
    Array.isArray(c.body) &&
    c.body.some(p=>p?.hits>0 && p.type==='move') &&
    c.body.some(p=>p?.hits>0 &&
      ['attack','ranged_attack'].includes(p.type)) &&
    Number.isSafeInteger(c.ticksToLive) && c.ticksToLive>250;
}
function strength(c) {
  return (c.body||[]).reduce((n,p)=>n+(p?.hits>0 ?
    p.type==='ranged_attack'?10:p.type==='attack'?30:0:0),0);
}
function adjacent(game,from,to) {
  if(!ROOM.test(from||'') || !ROOM.test(to||'') || from===to ||
     !game?.map || typeof game.map.describeExits!=='function')return false;
  const exits=game.map.describeExits(from);
  const reverse=game.map.describeExits(to);
  return !!exits && !!reverse &&
    Object.values(exits).includes(to) &&
    Object.values(reverse).includes(from);
}
function assign(states,game) {
  const now=game?.time;
  if(config.AUTO_REGIONAL_DEFENSE_SUPPORT!==true ||
     !Number.isSafeInteger(now) || now%25!==0 ||
     !Array.isArray(states) || states.length<2 || states.length>8 ||
     !game.creeps || !game.rooms || !game.cpu ||
     !Number.isFinite(game.cpu.bucket) || game.cpu.bucket<7000 ||
     !Number.isFinite(game.cpu.limit) ||
     typeof game.cpu.getUsed!=='function' ||
     game.cpu.limit-game.cpu.getUsed()<8)
    return {status:'HOLD',reason:'NO_SAFE_REGIONAL_SPAWN_CAPACITY'};
  // Only one live field assignment across the empire; this also produces
  // real transit evidence consumed by the existing D2 observer.
  if(Object.values(game.creeps).some(c=>c?.memory?.defenseSupportTarget))
    return {status:'HOLD',reason:'FIELD_REINFORCEMENT_ALREADY_ASSIGNED'};
  const owned=states.filter(s=>s?.room?.controller?.my===true &&
    game.rooms[s.room.name]===s.room);
  const targets=owned.filter(s=>!s.room.controller.safeMode &&
    Array.isArray(s.hostileCreeps) && s.hostileCreeps.some(armed))
    .sort((a,b)=>a.room.name.localeCompare(b.room.name));
  for(const target of targets) {
    for(const donor of owned) {
      const from=donor.room.name,to=target.room.name;
      if(from===to || !adjacent(game,from,to) ||
         !donor.spawn || donor.emergency ||
         donor.health?.status!=='HEALTHY' ||
         donor.room.controller.safeMode ||
         donor.room.controller.safeModeCooldown ||
         !Array.isArray(donor.hostileCreeps) ||
         donor.hostileCreeps.length ||
         !Number.isSafeInteger(donor.energyStored) ||
         donor.energyStored<5000 ||
         !Array.isArray(donor.creeps))continue;
      const home=donor.creeps
        .filter(c=>combatDefender(c,from) &&
          !c.memory.defenseSupportTarget)
        .sort((a,b)=>strength(b)-strength(a) ||
          String(a.id||a.name).localeCompare(String(b.id||b.name)));
      // Keep the strongest combat-capable defender in the donor colony.
      if(home.length<2)continue;
      const spare=home[1];
      spare.memory.defenseSupportHome=from;
      spare.memory.defenseSupportTarget=to;
      spare.memory.defenseSupportAssignedTick=now;
      return {status:'ASSIGNED',from,to,defender:spare.name};
    }
  }
  return {status:'HOLD',reason:'NO_ADJACENT_SAFE_SPARE_GARRISON'};
}
function clear(c) {
  delete c.memory.defenseSupportHome;
  delete c.memory.defenseSupportTarget;
  delete c.memory.defenseSupportAssignedTick;
}
function run(creep,game) {
  const to=creep?.memory?.defenseSupportTarget;
  if(!to)return false;
  const from=creep.memory.defenseSupportHome;
  const now=game?.time;
  // Reject forged long-distance assignments; never travel through neutral
  // corridors based only on a guessed route or stale shadow ETA.
  if(creep.memory.role!=='defender' ||
     creep.memory.home!==from ||
     !Number.isSafeInteger(now) ||
     !Number.isSafeInteger(creep.memory.defenseSupportAssignedTick) ||
     creep.memory.defenseSupportAssignedTick>now ||
     !adjacent(game,from,to) || !creep.room ||
     ![from,to].includes(creep.room.name)) {
    clear(creep);
    return true;
  }
  const home=game.rooms?.[from],target=game.rooms?.[to];
  if(!home?.controller?.my || !target?.controller?.my ||
     typeof home.find!=='function' ||
     typeof target.find!=='function' ||
     typeof FIND_HOSTILE_CREEPS==='undefined') {
    clear(creep);
    return true;
  }
  let homeHostiles,targetHostiles;
  try{
    homeHostiles=home.find(FIND_HOSTILE_CREEPS);
    targetHostiles=target.find(FIND_HOSTILE_CREEPS);
  }catch(_){return true;}
  if(!Array.isArray(homeHostiles) || !Array.isArray(targetHostiles))
    return true;
  const expired=config.AUTO_REGIONAL_DEFENSE_SUPPORT!==true ||
    now-creep.memory.defenseSupportAssignedTick>MAX_ASSIGNMENT_TICKS ||
    !Number.isSafeInteger(creep.ticksToLive) ||
    creep.ticksToLive<100 ||
    homeHostiles.some(armed) || home.controller.safeMode ||
    home.controller.safeModeCooldown || target.controller.safeMode ||
    !targetHostiles.some(armed);
  if(expired && creep.room.name===from) {
    clear(creep);
    return false; // restored to local garrison
  }
  if(!expired && creep.room.name===to)
    return false; // regular local defender attack handling
  const destination=expired?from:to;
  const direction=game.map?.findExit?.(creep.room.name,destination);
  if(!Number.isInteger(direction) || direction<0 ||
     !creep.pos || typeof creep.pos.findClosestByRange!=='function')
    return true;
  const exit=creep.pos.findClosestByRange(direction);
  if(exit && typeof creep.moveTo==='function') {
    creep.moveTo(exit,{reusePath:4,maxRooms:1,
      maxOps:config.PATH_MAX_OPS});
  }
  return true;
}
module.exports={assign,run,_test:{armed,combatDefender,adjacent}};
