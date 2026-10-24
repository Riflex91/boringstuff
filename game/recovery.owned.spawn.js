'use strict';

// R1: actual rebuilding of a destroyed Spawn inside a still-owned colony.
// Record only spawn coordinates that were really observed on our own Spawn;
// never guess a new base anchor from arbitrary Memory or a SHADOW planner.
// Active local WORK+CARRY+MOVE creeps complete the actual construction site
// through the pre-existing worker emergency build priority.
const config=require('config');
const SCHEMA_VERSION=1;
const ROOM=/^[WE][0-9]+[NS][0-9]+$/;
const MAX_ROOMS=20;
const MAX_WITNESS_AGE=20000;
function hold(reason){return {status:'HOLD',reason,siteIntentAccepted:false};}
function coords(s,name) {
  return !!s && s.roomName===name &&
    Number.isInteger(s.x) && Number.isInteger(s.y) &&
    s.x>=3 && s.x<=46 && s.y>=3 && s.y<=46;
}
function store(memory) {
  if(!memory?.bot || typeof memory.bot!=='object')return null;
  let raw=memory.bot.ownedSpawnRecovery;
  if(!raw || raw.schemaVersion!==SCHEMA_VERSION ||
     !raw.rooms || typeof raw.rooms!=='object' ||
     Array.isArray(raw.rooms) ||
     Object.keys(raw.rooms).length>MAX_ROOMS) {
    raw={schemaVersion:SCHEMA_VERSION,rooms:{}};
    memory.bot.ownedSpawnRecovery=raw;
  }
  return raw;
}
function productive(creep) {
  // A WORK/CARRY/MOVE body is not sufficient evidence of executable build
  // work: the dedicated upgrader returns after upgradeController(), and
  // harvesters/haulers/scouts never take the builder branch. Otherwise R1
  // can place an irreversible Spawn site and strand the colony forever
  // instead of permitting R2's independently guarded donor worker.
  const role=creep?.memory?.role;
  if(!['worker','builder','repairer'].includes(role) ||
     !creep || creep.my!==true || creep.spawning ||
     typeof creep.getActiveBodyparts!=='function' ||
     typeof WORK==='undefined' || typeof CARRY==='undefined' ||
     typeof MOVE==='undefined')return false;
  return creep.getActiveBodyparts(WORK)>0 &&
    creep.getActiveBodyparts(CARRY)>0 &&
    creep.getActiveBodyparts(MOVE)>0;
}
function observeAndRebuild(states,game,memory) {
  const tick=game?.time;
  if(!Number.isSafeInteger(tick) || tick<0 ||
     !Array.isArray(states) || states.length>MAX_ROOMS || !game?.cpu)
    return hold('RECOVERY_RUNTIME_OR_ROOMS_UNVERIFIED');
  const registry=store(memory);
  if(!registry)return hold('RECOVERY_MEMORY_UNAVAILABLE');
  // A successful historical construction intent is not rebuild completion.
  // Verify a physically NEW owned Spawn ID at the originally witnessed tile.
  let confirmed=null;
  // Persist actual owned Spawn positions continuously, at constant low CPU.
  // When a former room is no longer owned, do NOT use the old witness to
  // issue construction intents there.
  for(const state of states) {
    const name=state?.room?.name;
    if(!ROOM.test(name||'') || !state?.room?.controller?.my)continue;
    const spawn=state.spawn;
    if(spawn?.my===true && coords(spawn.pos,name) &&
       typeof spawn.id==='string' && spawn.id.length>0 &&
       spawn.id.length<=64) {
      const old=registry.rooms[name];
      if(old && old.lastSpawnId!==spawn.id &&
         coords(old.pos,name) &&
         old.pos.x===spawn.pos.x && old.pos.y===spawn.pos.y &&
         Number.isSafeInteger(old.lastRebuildIntentTick) &&
         Number.isSafeInteger(old.observedTick) &&
         old.lastRebuildIntentTick>=old.observedTick &&
         old.lastRebuildIntentTick<=tick &&
         tick-old.lastRebuildIntentTick<=MAX_WITNESS_AGE) {
        confirmed={status:'REBUILD_CONFIRMED',
          confirmed:true,siteIntentAccepted:false,
          room:name,oldSpawnId:old.lastSpawnId,
          newSpawnId:spawn.id,confirmedTick:tick};
      }
      registry.rooms[name]={observedTick:tick,
        lastSpawnId:spawn.id,
        pos:{roomName:name,x:spawn.pos.x,y:spawn.pos.y}};
    }
  }
  if(confirmed)return confirmed;
  if(tick%25!==0 ||
     !Number.isFinite(game.cpu.bucket) || game.cpu.bucket<5000 ||
     !Number.isFinite(game.cpu.limit) ||
     typeof game.cpu.getUsed!=='function' ||
     game.cpu.limit-game.cpu.getUsed()<8)
    return hold('RECOVERY_CADENCE_OR_CPU_DEFERRED');
  if(typeof FIND_MY_CONSTRUCTION_SITES==='undefined' ||
     typeof STRUCTURE_SPAWN==='undefined' ||
     typeof FIND_HOSTILE_CREEPS==='undefined' ||
     typeof FIND_HOSTILE_STRUCTURES==='undefined' ||
     typeof LOOK_STRUCTURES==='undefined' ||
     typeof LOOK_CONSTRUCTION_SITES==='undefined' ||
     typeof TERRAIN_MASK_WALL==='undefined' ||
     typeof CONTROLLER_STRUCTURES==='undefined')
    return hold('RECOVERY_ENGINE_CONSTANTS_MISSING');
  for(const state of states) {
    const room=state?.room,name=room?.name;
    if(!ROOM.test(name||'') || !room.controller?.my ||
       state.spawn || !Array.isArray(state.creeps) ||
       !Array.isArray(state.hostileCreeps))continue;
    const record=registry.rooms[name];
    if(!record || !Number.isSafeInteger(record.observedTick) ||
       record.observedTick<0 || record.observedTick>tick ||
       tick-record.observedTick>MAX_WITNESS_AGE ||
       typeof record.lastSpawnId!=='string' ||
       !record.lastSpawnId.length || record.lastSpawnId.length>64 ||
       !coords(record.pos,name))
      continue; // unverified anchor => no irreversible placement
    if(state.hostileCreeps.length ||
       !state.creeps.some(c=>c?.room?.name===name && productive(c)) ||
       !Number.isSafeInteger(room.controller.level) ||
       (CONTROLLER_STRUCTURES[STRUCTURE_SPAWN]?.[room.controller.level]||0)<1)
      return hold('LOCAL_WORKER_OR_ROOM_DEFENSE_UNSAFE');
    if(typeof room.find!=='function' ||
       typeof room.lookForAt!=='function' ||
       typeof room.getTerrain!=='function' ||
       typeof room.createConstructionSite!=='function')
      return hold('RECOVERY_ROOM_API_UNAVAILABLE');
    let hostileCreeps,hostileBuildings,sites,blocking,occupied,terrain;
    try{
      hostileCreeps=room.find(FIND_HOSTILE_CREEPS);
      hostileBuildings=room.find(FIND_HOSTILE_STRUCTURES);
      sites=room.find(FIND_MY_CONSTRUCTION_SITES);
      blocking=room.lookForAt(LOOK_STRUCTURES,
        record.pos.x,record.pos.y);
      occupied=room.lookForAt(LOOK_CONSTRUCTION_SITES,
        record.pos.x,record.pos.y);
      terrain=room.getTerrain();
    }catch(_){return hold('RECOVERY_ACTUAL_TILE_OBSERVATION_FAILED');}
    if(!Array.isArray(hostileCreeps) || hostileCreeps.length ||
       !Array.isArray(hostileBuildings) || hostileBuildings.length ||
       !Array.isArray(sites) ||
       !Array.isArray(blocking) || blocking.length ||
       !Array.isArray(occupied) ||
       !terrain || typeof terrain.get!=='function' ||
       (terrain.get(record.pos.x,record.pos.y)&TERRAIN_MASK_WALL))
      return hold('RECOVERY_SITE_OR_THREAT_BLOCKED');
    if(sites.some(s=>s.structureType===STRUCTURE_SPAWN))
      return hold('SPAWN_REBUILD_SITE_ALREADY_EXISTS');
    if(occupied.length)return hold('FORMER_SPAWN_TILE_OCCUPIED');
    if(sites.length>=20 ||
       game.constructionSites && Object.keys(game.constructionSites).length>=95)
      return hold('SITE_LIMIT_RESERVE_EXHAUSTED');
    let rc;
    try {rc=room.createConstructionSite(
      record.pos.x,record.pos.y,STRUCTURE_SPAWN);}
    catch(_){return hold('SPAWN_REBUILD_EXCEPTION');}
    if(rc!==OK)return {status:'SITE_REJECTED',
      reason:'SPAWN_REBUILD_RC_'+String(rc),siteIntentAccepted:false};
    record.lastRebuildIntentTick=tick;
    return {status:'SITE_INTENT_ACCEPTED',reason:null,
      siteIntentAccepted:true,room:name,x:record.pos.x,
      y:record.pos.y,previousSpawnId:record.lastSpawnId};
  }
  return hold('NO_VERIFIED_SPAWNLESS_OWNED_COLONY');
}
module.exports={observeAndRebuild,_test:{coords,productive,store}};
