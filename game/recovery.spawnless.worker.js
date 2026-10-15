'use strict';

// R2: real rescue worker dispatch for an already-owned, spawnless colony.
// Requires R1's previously observed actual Spawn witness. The destination
// can rebuild after the worker arrives even if its old workforce is gone.
// At most one field rescuer; donor keeps its core workforce and garrison.
const config=require('config');
const ROOM=/^[WE][0-9]+[NS][0-9]+$/;
const MISSION_TICKS=900;
const LEDGER_SCHEMA=1;
const HISTORY_MAX=6;
// Every receipt is backed by current Game observations, not by intentions
// being interpreted as a completed Spawn or an achieved route.
function ledger(memory) {
  if(!memory?.bot || typeof memory.bot!=='object')return null;
  let data=memory.bot.spawnlessWorkerRescueLedger;
  if(!data || data.schemaVersion!==LEDGER_SCHEMA ||
     !Array.isArray(data.history) || data.history.length>HISTORY_MAX) {
    data={schemaVersion:LEDGER_SCHEMA,active:null,history:[]};
    memory.bot.spawnlessWorkerRescueLedger=data;
  }
  return data;
}
function advance(memory,game,creep,status,reason=null) {
  const data=ledger(memory),mission=data?.active;
  const tick=game?.time;
  if(!mission || !creep || mission.worker!==creep.name ||
     !Number.isSafeInteger(tick) || tick<mission.assignedTick ||
     (creep.memory.spawnRescueHome!==mission.home ||
      creep.memory.spawnRescueTarget!==mission.target))return false;
  if(mission.status===status)return false;
  mission.status=status;
  mission.lastObservedTick=tick;
  if(reason)mission.reason=reason;
  if(status==='ARRIVED')mission.arrivedTick=tick;
  if(status==='COMPLETED')mission.completedTick=tick;
  if(['COMPLETED','RETURNED','ABORTED'].includes(status)) {
    data.history.push({...mission});
    if(data.history.length>HISTORY_MAX)
      data.history.splice(0,data.history.length-HISTORY_MAX);
    data.active=null;
  }
  return true;
}
function summary(memory) {
  const data=memory?.bot?.spawnlessWorkerRescueLedger;
  if(data?.schemaVersion!==LEDGER_SCHEMA ||
     !Array.isArray(data.history))return null;
  const event=data.history[data.history.length-1];
  const safe=x=>x?{
    id:x.id,home:x.home,target:x.target,worker:x.worker,
    oldSpawnId:x.oldSpawnId,status:x.status,
    assignedTick:x.assignedTick,
    arrivedTick:x.arrivedTick??null,
    completedTick:x.completedTick??null,
    lastObservedTick:x.lastObservedTick??null,
    reason:x.reason||null
  }:null;
  return {active:safe(data.active),last:safe(event),
    retainedReceipts:data.history.length};
}

function hold(reason){return {status:'HOLD',reason,assigned:false};}
function adjacent(game,from,to) {
  if(!ROOM.test(from||'') || !ROOM.test(to||'') || from===to ||
     typeof game?.map?.describeExits!=='function')return false;
  let a,b;
  try {a=game.map.describeExits(from);b=game.map.describeExits(to);}
  catch(_){return false;}
  return !!a && !!b && Object.values(a).includes(to) &&
    Object.values(b).includes(from);
}
function labor(c,room) {
  if(!c || c.my!==true || c.spawning || c.room?.name!==room ||
     c.memory?.role!=='worker' || c.memory.home!==room ||
     c.memory.spawnRescueTarget ||
     !Number.isSafeInteger(c.ticksToLive) || c.ticksToLive<1000 ||
     typeof c.getActiveBodyparts!=='function' ||
     typeof WORK==='undefined' || typeof CARRY==='undefined' ||
     typeof MOVE==='undefined')return false;
  return c.getActiveBodyparts(WORK)>0 &&
    c.getActiveBodyparts(CARRY)>0 &&
    c.getActiveBodyparts(MOVE)>0;
}
function witness(record,room,tick) {
  return !!record && record.pos?.roomName===room &&
    Number.isInteger(record.pos.x) && record.pos.x>=3 &&
    record.pos.x<=46 && Number.isInteger(record.pos.y) &&
    record.pos.y>=3 && record.pos.y<=46 &&
    Number.isSafeInteger(record.observedTick) &&
    record.observedTick>=0 && record.observedTick<=tick &&
    tick-record.observedTick<=20000 &&
    typeof record.lastSpawnId==='string' &&
    record.lastSpawnId.length>0 && record.lastSpawnId.length<=64;
}
function dispatch(states,game,memory) {
  const tick=game?.time;
  if(config.AUTO_SPAWNLESS_WORKER_RESCUE!==true ||
     !Number.isSafeInteger(tick) || tick%25!==0 ||
     !Array.isArray(states) || states.length<2 || states.length>8 ||
     !game.rooms || !game.creeps || !game.cpu ||
     !Number.isFinite(game.cpu.bucket) || game.cpu.bucket<8500 ||
     !Number.isFinite(game.cpu.limit) ||
     typeof game.cpu.getUsed!=='function' ||
     game.cpu.limit-game.cpu.getUsed()<12)return hold('RESCUE_CADENCE_OR_CPU');
  if(Object.values(game.creeps).some(c=>c?.memory?.spawnRescueTarget))
    return hold('RESCUER_ALREADY_ASSIGNED');
  // No second field economy mission while a claim or hostile operation
  // could drain the same parent colony's last productive labor.
  if(['CLAIMING','CLAIMED'].includes(memory?.bot?.expansionClaim?.phase) ||
     ['ATTACKING','RETREAT'].includes(memory?.bot?.counterattackMission?.phase))
    return hold('ACTIVE_CAMPAIGN_PRIORITY');
  const registry=memory?.bot?.ownedSpawnRecovery;
  if(registry?.schemaVersion!==1 || !registry.rooms ||
     typeof registry.rooms!=='object')return hold('NO_OWN_SPAWN_WITNESS');
  const owned=states.filter(s=>s?.room?.controller?.my===true &&
    game.rooms[s.room.name]===s.room);
  for(const target of owned) {
    const to=target.room.name,record=registry.rooms[to];
    if(target.spawn || target.hostileCreeps?.length ||
       target.room.controller.safeMode ||
       !witness(record,to,tick) ||
       !Array.isArray(target.creeps) ||
       target.creeps.some(c=>c?.my===true && !c.spawning &&
         typeof c.getActiveBodyparts==='function' &&
         typeof WORK!=='undefined' && typeof CARRY!=='undefined' &&
         c.getActiveBodyparts(WORK)>0 && c.getActiveBodyparts(CARRY)>0))
      continue;
    // Confirm no replacement Spawn or foreign site already resolves this
    // from direct Game observations. R1 will place the actual site when
    // the dispatched worker reaches the room.
    if(typeof target.room.find!=='function' ||
       typeof FIND_MY_SPAWNS==='undefined' ||
       typeof FIND_HOSTILE_CREEPS==='undefined' ||
       typeof FIND_HOSTILE_STRUCTURES==='undefined' ||
       typeof FIND_MY_CONSTRUCTION_SITES==='undefined' ||
       typeof STRUCTURE_SPAWN==='undefined')continue;
    let spawns,hostiles,hostileBuildings,sites;
    try{
      spawns=target.room.find(FIND_MY_SPAWNS);
      hostiles=target.room.find(FIND_HOSTILE_CREEPS);
      hostileBuildings=target.room.find(FIND_HOSTILE_STRUCTURES);
      sites=target.room.find(FIND_MY_CONSTRUCTION_SITES);
    }catch(_){continue;}
    if(!Array.isArray(spawns) || spawns.length ||
       !Array.isArray(hostiles) || hostiles.length ||
       !Array.isArray(hostileBuildings) || hostileBuildings.length ||
       !Array.isArray(sites) ||
       sites.some(s=>s?.structureType===STRUCTURE_SPAWN &&
         (s.pos?.roomName!==to ||
          s.pos.x!==record.pos.x || s.pos.y!==record.pos.y)))continue;
    for(const donor of owned) {
      const from=donor.room.name;
      if(from===to || !adjacent(game,from,to) ||
         !donor.spawn || donor.spawn.spawning ||
         donor.emergency || donor.health?.status!=='HEALTHY' ||
         donor.room.controller.safeMode ||
         donor.room.controller.safeModeCooldown ||
         !Array.isArray(donor.hostileCreeps) ||
         donor.hostileCreeps.length ||
         !Number.isSafeInteger(donor.energyStored) ||
         donor.energyStored<15000 ||
         !Array.isArray(donor.creeps) ||
         (donor.byRole?.defender||0)<1 ||
         (donor.byRole?.harvester||0)<1 ||
         (donor.byRole?.hauler||0)<1)continue;
      const workers=donor.creeps.filter(c=>labor(c,from))
        .sort((a,b)=>b.ticksToLive-a.ticksToLive ||
          String(a.name).localeCompare(String(b.name)));
      if(workers.length<2)continue; // retain a real home worker
      const worker=workers[0];
      worker.memory.spawnRescueHome=from;
      worker.memory.spawnRescueTarget=to;
      worker.memory.spawnRescueAssignedTick=tick;
      const data=ledger(memory);
      if(data) {
        const id='r2-'+from+'-'+to+'-'+tick+'-'+worker.name;
        data.active={
          id,home:from,target:to,worker:worker.name,
          oldSpawnId:record.lastSpawnId,
          oldSite:{roomName:to,x:record.pos.x,y:record.pos.y},
          assignedTick:tick,lastObservedTick:tick,
          status:'ASSIGNED',reason:null
        };
      }
      return {status:'ASSIGNED',assigned:true,
        from,to,worker:worker.name};
    }
  }
  return hold('NO_SAFE_WORKER_OR_VERIFIED_TARGET');
}
function clear(c) {
  delete c.memory.spawnRescueHome;
  delete c.memory.spawnRescueTarget;
  delete c.memory.spawnRescueAssignedTick;
}
function run(creep,game,memory) {
  const to=creep?.memory?.spawnRescueTarget;
  if(!to)return false;
  const from=creep.memory.spawnRescueHome;
  const now=game?.time;
  if(creep.memory.role!=='worker' || creep.memory.home!==from ||
     !Number.isSafeInteger(now) ||
     !Number.isSafeInteger(creep.memory.spawnRescueAssignedTick) ||
     creep.memory.spawnRescueAssignedTick>now ||
     !adjacent(game,from,to) || !creep.room ||
     ![from,to].includes(creep.room.name) ||
     !game.rooms?.[from]?.controller?.my) {
    advance(memory,game,creep,'ABORTED','MISSION_BINDING_OR_HOME_UNVERIFIED');
    clear(creep);
    return true;
  }
  const target=game.rooms[to];
  if(!target?.controller?.my ||
     typeof target.find!=='function') {
    // Lack of exact ownership evidence is not permission to settle.
    if(creep.room.name===from) {
      advance(memory,game,creep,'RETURNED','TARGET_OWNERSHIP_UNVERIFIED');
      clear(creep);return false;
    }
    advance(memory,game,creep,'RETREAT','TARGET_OWNERSHIP_UNVERIFIED');
    return travel(creep,game,from);
  }
  const registry=memory?.bot?.ownedSpawnRecovery;
  const record=registry?.rooms?.[to];
  if(registry?.schemaVersion!==1 || !witness(record,to,now)) {
    if(creep.room.name===from) {
      advance(memory,game,creep,'RETURNED','OLD_SPAWN_WITNESS_MISSING');
      clear(creep);return false;
    }
    advance(memory,game,creep,'RETREAT','OLD_SPAWN_WITNESS_MISSING');
    return travel(creep,game,from);
  }
  if(typeof FIND_HOSTILE_CREEPS==='undefined' ||
     typeof FIND_HOSTILE_STRUCTURES==='undefined' ||
     typeof FIND_MY_SPAWNS==='undefined' ||
     typeof game.rooms[from]?.find!=='function')return true;
  let hostiles,spawns,targetBuildings,homeEnemies;
  try{
    hostiles=target.find(FIND_HOSTILE_CREEPS);
    spawns=target.find(FIND_MY_SPAWNS);
    targetBuildings=target.find(FIND_HOSTILE_STRUCTURES);
    homeEnemies=game.rooms[from].find(FIND_HOSTILE_CREEPS);
  }catch(_){return true;}
  if(!Array.isArray(hostiles) || !Array.isArray(spawns) ||
     !Array.isArray(targetBuildings) ||
     !Array.isArray(homeEnemies))return true;
  const verifiedSpawn=spawns.find(s=>s?.my===true &&
    s.pos?.roomName===to &&
    s.pos.x===record.pos.x && s.pos.y===record.pos.y);
  const mission=memory?.bot?.spawnlessWorkerRescueLedger?.active;
  // Require a NEW physical object. A stale original Spawn resurfacing in
  // incomplete room state must never be mislabelled as a completed rebuild.
  // The R1 witness may already have changed to the rebuilt ID earlier in
  // this tick. The stable mission's original ID is therefore decisive.
  const newSpawn=verifiedSpawn &&
    typeof verifiedSpawn.id==='string' && verifiedSpawn.id.length>0 &&
    mission?.worker===creep.name &&
    mission.home===from && mission.target===to &&
    typeof mission.oldSpawnId==='string' &&
    verifiedSpawn.id!==mission.oldSpawnId;
  if(newSpawn && creep.room.name===to) {
    advance(memory,game,creep,'COMPLETED','NEW_OWN_SPAWN_OBSERVED');
    creep.memory.home=to;
    clear(creep);
    delete creep.memory.working;
    return false; // physical new Spawn, not a proposed construction site
  }
  const home=game.rooms[from];
  const expired=config.AUTO_SPAWNLESS_WORKER_RESCUE!==true ||
    now-creep.memory.spawnRescueAssignedTick>MISSION_TICKS ||
    !Number.isSafeInteger(creep.ticksToLive) ||
    creep.ticksToLive<150 ||
    hostiles.length>0 || targetBuildings.length>0 ||
    homeEnemies.length>0 ||
    !!home?.controller?.safeMode ||
    !!home?.controller?.safeModeCooldown ||
    spawns.length>0; // different-position Spawn must not fake success
  if(expired && creep.room.name===from) {
    advance(memory,game,creep,'RETURNED',
      'DANGER_COOLDOWN_TIMEOUT_OR_UNVERIFIED_SPAWN');
    clear(creep);return false;
  }
  if(expired) {
    advance(memory,game,creep,'RETREAT',
      'DANGER_COOLDOWN_TIMEOUT_OR_UNVERIFIED_SPAWN');
    return travel(creep,game,from);
  }
  if(creep.room.name===to) {
    advance(memory,game,creep,'ARRIVED');
    return false; // observed onsite: ordinary worker energy/build
  }
  return travel(creep,game,to);
}
function travel(creep,game,destination) {
  const exit=game.map?.findExit?.(creep.room.name,destination);
  if(!Number.isInteger(exit) || exit<0 ||
     typeof creep.pos?.findClosestByRange!=='function' ||
     typeof creep.moveTo!=='function')return true;
  const pos=creep.pos.findClosestByRange(exit);
  if(pos)creep.moveTo(pos,{reusePath:3,maxRooms:1,
    maxOps:Math.min(300,config.PATH_MAX_OPS||300)});
  return true;
}
module.exports={dispatch,run,summary,_test:{labor,witness,adjacent,ledger,advance}};
