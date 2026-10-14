'use strict';

// U8/I4: final read-only release preflight for a future autonomous claimer.
// This module has NO action authority: even a verified path may not spawn,
// move or claim. The actual mission launcher must be a separate gated change.
const stability = require('expansion.parent.stability.shadow');
const parentSupport = require('expansion.parent.support.shadow');

const ROOM = /^[WE][0-9]+[NS][0-9]+$/;
const MAX_ROOMS = 4;
const MAX_PATH_OPS = 2000;
const MIN_CPU_BUCKET = 8000;
const MAX_PATH_AGE = 25;

function hold(reason) {
  return {schemaVersion:1,authority:'SHADOW',
    actionAuthority:'NONE',spawnActionEnabled:false,
    claimActionEnabled:false,constructionActionEnabled:false,
    readyForAutonomousLaunch:false,status:'HOLD',reason,
    route:null,measuredPathSteps:null,remainingClaimerTicks:null};
}

function validRoom(name) {
  return typeof name==='string' && name.length<=16 && ROOM.test(name);
}

function armedOrUnverifiedRoom(room) {
  if(!room || typeof room.find!=='function' ||
     typeof FIND_HOSTILE_CREEPS==='undefined' ||
     typeof FIND_HOSTILE_STRUCTURES==='undefined') return true;
  const creeps=room.find(FIND_HOSTILE_CREEPS);
  const buildings=room.find(FIND_HOSTILE_STRUCTURES);
  return !Array.isArray(creeps) || creeps.length!==0 ||
    !Array.isArray(buildings) || buildings.length!==0;
}

function audit(readiness,operation,budget,continuity,states,game,memory) {
  const blocked=hold('MISSING_CURRENT_RELEASE_EVIDENCE');
  const tick=game?.time;
  if(!Number.isSafeInteger(tick) || tick<0 ||
     !memory?.bot || !Array.isArray(states) ||
     !game?.map || !game?.rooms || !game?.creeps) return blocked;

  // Shadow observations may advise geometry and affordability, never grant
  // claim authority. Reevaluate actual runtime facts rather than trusting
  // stale status fields or a manually edited Memory proposal.
  if(readiness?.authority!=='SHADOW' ||
     readiness.claimActionEnabled!==false ||
     readiness.status!=='PLANNING_CANDIDATE' ||
     !Number.isSafeInteger(readiness.availableClaimSlots) ||
     readiness.availableClaimSlots<1 ||
     operation?.authority!=='SHADOW' ||
     operation.claimActionEnabled!==false ||
     operation.spawnActionEnabled!==false ||
     operation.readyForClaim!==false ||
     operation.phase!=='SITE_VERIFIED_ADVISORY' ||
     operation.routeLevel!=='ROOM_LEVEL_ONLY' ||
     operation.tilePathVerified!==true ||
     operation.spawnTileVerified!==true ||
     budget?.authority!=='SHADOW' ||
     budget.actionAuthority!=='NONE' ||
     budget.claimActionEnabled!==false ||
     budget.spawnActionEnabled!==false ||
     budget.readyForClaim!==false ||
     budget.status!=='COST_ESTIMATE_ONLY')
    return hold('SHADOW_OR_BUDGET_GATES_NOT_READY');

  const parent=operation.parentRoom,target=operation.candidateRoom;
  const memoryOp=memory.bot.expansionOperationShadow;
  if(!validRoom(parent) || !validRoom(target) || parent===target ||
     !memoryOp || memoryOp.schemaVersion!==1 ||
     memoryOp.phase!=='SITE_VERIFIED_ADVISORY' ||
     memoryOp.parentRoom!==parent || memoryOp.candidateRoom!==target ||
     !Number.isSafeInteger(memoryOp.siteVerifiedTick) ||
     memoryOp.siteVerifiedTick>tick ||
     tick-memoryOp.siteVerifiedTick>MAX_PATH_AGE ||
     !Array.isArray(memoryOp.routeRooms) ||
     memoryOp.routeRooms.length<1 ||
     memoryOp.routeRooms.length>=MAX_ROOMS ||
     memoryOp.routeRooms.at(-1)!==target)
    return hold('ROUTE_OR_SITE_WITNESS_STALE');

  const route=[parent,...memoryOp.routeRooms];
  if(route.some(x=>!validRoom(x)) ||
     new Set(route).size!==route.length ||
     route.length>MAX_ROOMS ||
     operation.routeHops!==route.length-1 ||
     operation.spawnSite?.roomName!==target ||
     operation.spawnSite?.x!==memoryOp.verifiedSite?.x ||
     operation.spawnSite?.y!==memoryOp.verifiedSite?.y ||
     budget.parentReserveFloor===null ||
     !Number.isSafeInteger(budget.totalCrewEnergy) ||
     budget.totalCrewEnergy<650)
    return hold('ROUTE_OR_CREW_BUDGET_INCONSISTENT');

  const state=states.find(x=>x?.room?.name===parent);
  const home=game.rooms[parent];
  const objective=game.rooms[target];
  if(!state || state.room!==home ||
     !home?.controller?.my || !state.spawn ||
     state.spawn.spawning ||
     state.emergency || state.health?.status!=='HEALTHY' ||
     (Number(home.controller.safeMode)||0)>0 ||
     (Number(home.controller.safeModeCooldown)||0)>0 ||
     parentSupport.assess(state).status!=='ADVISORY_OK' ||
     !stability.qualifies(continuity,parent,tick))
    return hold('PARENT_DEFENSE_OR_CONTINUITY_UNSAFE');

  const cpu=game.cpu;
  if(!cpu || !Number.isFinite(cpu.limit) ||
     !Number.isFinite(cpu.bucket) || cpu.bucket<MIN_CPU_BUCKET ||
     typeof cpu.getUsed!=='function' ||
     cpu.limit-cpu.getUsed()<Math.max(12,cpu.limit*0.4) ||
     tick%25!==0) return hold('CLAIM_PREFLIGHT_CPU_DEFERRED');

  if(!game.gcl || !Number.isSafeInteger(game.gcl.level) ||
     game.gcl.level<2 ||
     Object.values(game.rooms).filter(x=>x?.controller?.my===true).length>=
       game.gcl.level ||
     Object.values(game.creeps).some(c=>
       c?.memory?.role==='claimer'))
    return hold('GCL_OR_EXISTING_CLAIMER_COMMITMENT');

  const prior=memory.bot.expansionClaim;
  if(prior && (prior.phase==='CLAIMING' ||
     prior.phase==='CLAIMED' ||
     !Number.isSafeInteger(prior.abortTick) ||
     tick-prior.abortTick<500))
    return hold('CLAIM_MISSION_OR_ABORT_BACKOFF');

  if(!Number.isSafeInteger(state.energyCapacityAvailable) ||
     state.energyCapacityAvailable<650 ||
     state.energyAvailable!==state.energyCapacityAvailable ||
     !Number.isSafeInteger(state.energyStored) ||
     state.energyStored-budget.totalCrewEnergy<
       budget.parentReserveFloor)
    return hold('HOME_RESERVE_OR_SPAWN_ENERGY_LOW');

  if(!objective?.controller ||
     objective.controller.my!==false ||
     objective.controller.owner ||
     objective.controller.reservation ||
     objective.controller.level!==0 ||
     !objective.controller.pos ||
     !home?.controller?.my)
    return hold('NEUTRAL_TARGET_VISION_UNVERIFIED');

  for(let i=0;i<route.length;i++) {
    const name=route[i],room=game.rooms[name];
    if(!room || room.name!==name || armedOrUnverifiedRoom(room))
      return hold('ROUTE_VISION_OR_DEFENSE_UNSAFE');
    if(i>0 && i<route.length-1 &&
       (!room.controller || room.controller.owner ||
        room.controller.reservation || room.controller.my))
      return hold('INTERMEDIATE_ROOM_NOT_NEUTRAL');
    if(i>0) {
      const exits=game.map.describeExits?.(route[i-1]);
      if(!exits || !Object.values(exits).includes(name))
        return hold('ROOM_ROUTE_NOT_ADJACENT');
    }
  }

  const start=state.spawn.pos,finish=objective.controller.pos;
  if(!start || start.roomName!==parent ||
     !finish || finish.roomName!==target ||
     !Number.isSafeInteger(start.x) || !Number.isSafeInteger(start.y) ||
     !Number.isSafeInteger(finish.x) || !Number.isSafeInteger(finish.y) ||
     typeof PathFinder==='undefined' ||
     typeof PathFinder.search!=='function' ||
     typeof RoomPosition==='undefined' ||
     typeof CREEP_CLAIM_LIFE_TIME==='undefined' ||
     !Number.isSafeInteger(CREEP_CLAIM_LIFE_TIME))
    return hold('REAL_CLAIMER_PATH_OR_LIFETIME_UNVERIFIED');

  let path;
  const allowed=new Set(route);
  try {
    path=PathFinder.search(
      new RoomPosition(start.x,start.y,parent),
      {pos:new RoomPosition(finish.x,finish.y,target),range:1},
      {maxOps:MAX_PATH_OPS,maxRooms:route.length,
        roomCallback:name=>allowed.has(name)?undefined:false}
    );
  } catch(_){return hold('CLAIMER_PATH_SEARCH_FAILED');}
  if(!path || path.incomplete!==false ||
     !Array.isArray(path.path) || !path.path.length ||
     path.path.some(pos=>!pos || !allowed.has(pos.roomName)) ||
     path.path.at(-1).roomName!==target ||
     typeof path.path.at(-1).getRangeTo!=='function' ||
     path.path.at(-1).getRangeTo(finish)>1)
    return hold('CLAIMER_ROUTE_NOT_WALKABLE');

  // Claim-part creep life is short (usually 600 ticks). Reserve >150 ticks
  // after measured route length for traffic, controller contact and retries.
  const remaining=CREEP_CLAIM_LIFE_TIME-path.path.length-6;
  if(remaining<150 || path.path.length>300)
    return hold('CLAIMER_TTL_OR_PATH_TOO_LONG');

  return {...hold(null),status:'REVIEW_CANDIDATE',
    reason:null,route:route.slice(),measuredPathSteps:path.path.length,
    remainingClaimerTicks:remaining,
    candidateRoom:target,parentRoom:parent};
}

module.exports={audit,_test:{validRoom,armedOrUnverifiedRoom}};
