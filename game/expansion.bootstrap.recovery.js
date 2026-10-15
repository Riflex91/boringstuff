'use strict';

// U8/I4 actual recovery of a *still-owned* first-spawn bootstrap after the
// original 2000-tick deadline. No new claims, no free memory unlock and no
// automatic infinite crew orders. This changes only a previously accepted,
// correctly bound, verified mission's phase; the ordinary bounded pioneer
// provisioner may then issue a fresh real spawnCreep on its normal cadence.
const config=require('config');
const stability=require('expansion.parent.stability.shadow');

const ROOM=/^[WE][0-9]+[NS][0-9]+$/;
const MAX_RESCUE_WAVES=2;
const RESCUE_COOLDOWN=500;
function hold(reason){return {status:'HOLD',reason,changed:false};}
function boundMission(m,tick) {
  return !!m && m.schemaVersion===1 && m.phase==='BOOTSTRAP_BLOCKED' &&
    m.reason==='FIRST_SPAWN_NOT_OBSERVED_BY_DEADLINE' &&
    typeof m.parent==='string' && ROOM.test(m.parent) &&
    typeof m.target==='string' && ROOM.test(m.target) &&
    m.parent!==m.target &&
    Number.isSafeInteger(m.createdTick) && m.createdTick>=0 &&
    Number.isSafeInteger(m.confirmedTick) &&
    m.confirmedTick>=m.createdTick &&
    Number.isSafeInteger(m.blockedTick) &&
    m.blockedTick>=m.confirmedTick+2000 &&
    m.blockedTick<=tick &&
    m.id===('claim-'+m.parent+'-'+m.target+'-'+m.createdTick) &&
    Array.isArray(m.route) && m.route.length>=2 && m.route.length<=4 &&
    m.route[0]===m.parent && m.route.at(-1)===m.target &&
    new Set(m.route).size===m.route.length &&
    m.route.every(n=>typeof n==='string' && ROOM.test(n)) &&
    m.verifiedSpawnSite?.roomName===m.target &&
    Number.isInteger(m.verifiedSpawnSite.x) &&
    Number.isInteger(m.verifiedSpawnSite.y) &&
    m.verifiedSpawnSite.x>=5 && m.verifiedSpawnSite.x<=44 &&
    m.verifiedSpawnSite.y>=5 && m.verifiedSpawnSite.y<=44;
}
function resume(states,game,memory,continuity) {
  const m=memory?.bot?.expansionClaim;
  const tick=game?.time;
  if(!Number.isSafeInteger(tick) || tick<0 ||
     !boundMission(m,tick) || !game?.rooms || !game?.creeps)
    return hold('NO_VERIFIED_BLOCKED_BOOTSTRAP');
  const target=game.rooms[m.target];
  if(!target || target.name!==m.target || !target.controller)
    return hold('OWNERSHIP_VISION_UNAVAILABLE');
  if(target.controller.my!==true)
    return hold('TARGET_NOT_OWNED_REQUIRES_NEW_CLAIM_MISSION');
  if(typeof FIND_MY_SPAWNS==='undefined' ||
     typeof target.find!=='function')
    return hold('SPAWN_OBSERVATION_MISSING');
  let spawns;
  try {spawns=target.find(FIND_MY_SPAWNS);}
  catch(_){return hold('SPAWN_OBSERVATION_FAILED');}
  if(!Array.isArray(spawns))return hold('SPAWN_OBSERVATION_FAILED');
  const site=m.verifiedSpawnSite;
  const built=spawns.find(s=>s?.my===true &&
    s.pos?.roomName===m.target && s.pos.x===site.x &&
    s.pos.y===site.y);
  if(built) {
    // An independently finished first Spawn is a genuine handoff, even
    // when its original parent has meanwhile disappeared or flags turned off.
    m.phase='ESTABLISHED';
    m.establishedTick=tick;
    m.firstSpawnId=built.id||null;
    m.reason=null;
    return {status:'ESTABLISHED',reason:null,changed:true,
      firstSpawnId:m.firstSpawnId};
  }
  if(spawns.length)return hold('UNVERIFIED_SPAWN_AT_DIFFERENT_LOCATION');
  if(config.AUTO_EXPANSION_CLAIM!==true ||
     config.AUTO_EXPANSION_BOOTSTRAP!==true)
    return hold('RECOVERY_FEATURE_DISABLED');
  const wave=m.recoveryWaves===undefined?0:m.recoveryWaves;
  if(!Number.isSafeInteger(wave) || wave<0 ||
     wave>=MAX_RESCUE_WAVES)
    return hold('RECOVERY_WAVE_LIMIT_REACHED');
  if(tick-m.blockedTick<RESCUE_COOLDOWN ||
     tick%100!==0)
    return hold('RECOVERY_COOLDOWN_OR_CADENCE');
  if(!Array.isArray(states) || !game.cpu ||
     !Number.isFinite(game.cpu.bucket) ||
     game.cpu.bucket<8500 ||
     !Number.isFinite(game.cpu.limit) ||
     typeof game.cpu.getUsed!=='function' ||
     game.cpu.limit-game.cpu.getUsed()<Math.max(12,game.cpu.limit*0.4))
    return hold('CPU_OR_CURRENT_PARENT_STATES_UNSAFE');
  const state=states.find(s=>s?.room?.name===m.parent);
  const home=game.rooms[m.parent];
  if(!state || state.room!==home || !home?.controller?.my ||
     state.emergency || state.health?.status!=='HEALTHY' ||
     !state.spawn || state.spawn.spawning ||
     (Number(home.controller.safeMode)||0)>0 ||
     (Number(home.controller.safeModeCooldown)||0)>0 ||
     !stability.qualifies(continuity,m.parent,tick))
    return hold('PARENT_DEFENSE_OR_CONTINUITY_UNVERIFIED');
  if(!Number.isSafeInteger(state.energyStored) ||
     state.energyStored<8000 ||
     !Number.isSafeInteger(state.energyCapacityAvailable) ||
     !Number.isSafeInteger(state.energyAvailable) ||
     state.energyAvailable!==state.energyCapacityAvailable ||
     state.energyCapacityAvailable<650 ||
     state.economyModel?.consumerCriticalCount>0 ||
     state.economyModel?.haulerCarryDeficit>0)
    return hold('PARENT_ECONOMY_OR_CREW_RESERVE_LOW');
  if(Object.values(game.creeps).some(c=>
      ['claimer','pioneer'].includes(c?.memory?.role) &&
      c.memory.claimMissionId===m.id))
    return hold('SURVIVING_CREW_MUST_RETURN_FIRST');
  if(typeof FIND_HOSTILE_CREEPS==='undefined' ||
     typeof FIND_HOSTILE_STRUCTURES==='undefined' ||
     typeof FIND_MY_CONSTRUCTION_SITES==='undefined' ||
     !game.map || typeof game.map.describeExits!=='function')
    return hold('ROUTE_OR_CONSTRUCTION_EVIDENCE_MISSING');
  for(let i=0;i<m.route.length;i++) {
    const name=m.route[i],room=game.rooms[name];
    if(!room || room.name!==name || typeof room.find!=='function')
      return hold('RECOVERY_ROUTE_VISION_MISSING');
    let hostiles,buildings;
    try {
      hostiles=room.find(FIND_HOSTILE_CREEPS);
      buildings=room.find(FIND_HOSTILE_STRUCTURES);
    } catch(_){return hold('RECOVERY_ROUTE_THREAT_OBSERVATION_FAILED');}
    if(!Array.isArray(hostiles) || hostiles.length ||
       !Array.isArray(buildings) || buildings.length)
      return hold('RECOVERY_ROUTE_NOT_SAFE');
    if(i>0 && i<m.route.length-1 &&
       (!room.controller || room.controller.owner ||
        room.controller.reservation || room.controller.my))
      return hold('RECOVERY_TRANSIT_NOT_NEUTRAL');
    if(i>0) {
      let forward,back;
      try{
        forward=game.map.describeExits(m.route[i-1]);
        back=game.map.describeExits(name);
      }catch(_){return hold('RECOVERY_ROUTE_ADJACENCY_FAILED');}
      if(!forward || !Object.values(forward).includes(name) ||
         !back || !Object.values(back).includes(m.route[i-1]))
        return hold('RECOVERY_ROUTE_ADJACENCY_FAILED');
    }
  }
  let sites;
  try {sites=target.find(FIND_MY_CONSTRUCTION_SITES);}
  catch(_){return hold('FIRST_SPAWN_SITE_OBSERVATION_FAILED');}
  if(!Array.isArray(sites) ||
     sites.some(s=>s?.structureType===STRUCTURE_SPAWN &&
       (s.pos?.roomName!==m.target ||
        s.pos?.x!==site.x || s.pos?.y!==site.y)))
    return hold('UNVERIFIED_OR_DUPLICATE_FIRST_SPAWN_SITE');
  // Real route and room safety verified: reset ONLY the bounded crew window.
  // Keep original immutable claim ID and parent/target, preserving the fact
  // that we never claim twice. Exactly two later rescue waves are possible.
  m.recoveryWaves=wave+1;
  if(m.firstConfirmedTick===undefined)
    m.firstConfirmedTick=m.confirmedTick;
  m.confirmedTick=tick;
  m.phase='CLAIMED';
  m.pioneerOrders=0;
  delete m.lastPioneerSpawnIntentTick;
  m.lastRecoveryTick=tick;
  m.reason=null;
  return {status:'RESUMED_BOOTSTRAP',changed:true,
    recoveryWaves:m.recoveryWaves,missionId:m.id};
}
module.exports={resume,_test:{boundMission,MAX_RESCUE_WAVES,RESCUE_COOLDOWN}};
