'use strict';

// U8/I4: a single guarded claim mission launch. NOT wired into the active
// scheduler until the prior preflight, release, bootstrap and rollback gates
// pass. Explicit authorization is required even for direct callers.
const preflight=require('expansion.claim.launch.preflight');
const config=require('config');

function start(readiness,operation,budget,continuity,states,game,memory) {
  const reject=reason=>({status:'HOLD',reason,
    spawnIntentAccepted:false,missionId:null});
  if(config.AUTO_EXPANSION_CLAIM!==true)
    return reject('AUTO_EXPANSION_CLAIM_DISABLED');
  // Never spend an irreversible GCL slot on a claimed but unbootstrapped
  // colony. The paired pioneer/supply executor must be enabled *before* a
  // claimer order is possible, not merely toggled on after ownership.
  if(config.AUTO_EXPANSION_BOOTSTRAP!==true)
    return reject('BOOTSTRAP_SUPPORT_NOT_AUTHORIZED');

  // Only a CURRENT runtime audit may permit a spawn; no cached Memory flag
  // or apparently positive shadow value can authorize the operation.
  const check=preflight.audit(readiness,operation,budget,continuity,
    states,game,memory);
  if(check?.status!=='REVIEW_CANDIDATE' ||
     check.actionAuthority!=='NONE' ||
     check.readyForAutonomousLaunch!==false ||
     check.claimActionEnabled!==false ||
     check.spawnActionEnabled!==false)
    return reject(check?.reason||'LIVE_LAUNCH_EVIDENCE_MISSING');
  const parent=states.find(s=>s?.room?.name===check.parentRoom);
  const spawn=parent?.spawn;
  if(!spawn || typeof spawn.spawnCreep!=='function' || spawn.spawning ||
     !memory?.bot || !Number.isSafeInteger(game?.time) ||
     !Array.isArray(check.route) || check.route.length<2 ||
     check.route.length>4 ||
     check.route[0]!==check.parentRoom ||
     check.route.at(-1)!==check.candidateRoom ||
     !operation?.spawnSite ||
     operation.spawnSite.roomName!==check.candidateRoom ||
     !Number.isSafeInteger(operation.spawnSite.x) ||
     !Number.isSafeInteger(operation.spawnSite.y) ||
     operation.spawnSite.x<5 || operation.spawnSite.x>44 ||
     operation.spawnSite.y<5 || operation.spawnSite.y>44)
    return reject('SPAWN_OR_MISSION_UNVERIFIED');

  // Never issue a second spawn into an already committed mission. A
  // previous CLAIMED room also requires explicit follow-up settlement.
  if(['CLAIMING','CLAIMED'].includes(memory.bot.expansionClaim?.phase))
    return reject('ACTIVE_EXPANSION_COMMITMENT');

  // Real engine constants, no guessed body pricing.
  if(typeof MOVE==='undefined' || typeof CLAIM==='undefined' ||
     typeof BODYPART_COST==='undefined' ||
     !Number.isSafeInteger(BODYPART_COST[MOVE]) ||
     !Number.isSafeInteger(BODYPART_COST[CLAIM]))
    return reject('CLAIMER_BODY_COST_UNVERIFIED');
  const body=[MOVE,CLAIM];
  const cost=BODYPART_COST[MOVE]+BODYPART_COST[CLAIM];
  if(cost<=0 || cost>parent.energyAvailable ||
     cost>parent.energyCapacityAvailable ||
     !Number.isSafeInteger(cost) ||
     !Number.isSafeInteger(parent.energyStored) ||
     !Number.isSafeInteger(budget?.parentReserveFloor) ||
     !Number.isSafeInteger(budget?.totalCrewEnergy) ||
     parent.energyStored-budget.totalCrewEnergy<budget.parentReserveFloor)
    return reject('CLAIMER_WOULD_EXHAUST_PARENT_RESERVE');

  // A single id both tags the spawn's creep Memory and binds its entire
  // itinerary to the post-spawn mission. No mission may be written before OK.
  const id='claim-'+check.parentRoom+'-'+check.candidateRoom+'-'+game.time;
  const name='clm-'+check.parentRoom+'-'+game.time;
  let rc;
  try {
    rc=spawn.spawnCreep(body,name,{memory:{
      role:'claimer',home:check.parentRoom,
      targetRoom:check.candidateRoom,
      claimMissionId:id,born:game.time
    }});
  } catch (_) {
    return reject('CLAIMER_SPAWN_EXCEPTION');
  }
  if(rc!==OK)
    return {status:'SPAWN_REJECTED',reason:'CLAIMER_SPAWN_RC_'+String(rc),
      spawnIntentAccepted:false,missionId:null};
  memory.bot.expansionClaim={
    schemaVersion:1,id,phase:'CLAIMING',
    parent:check.parentRoom,target:check.candidateRoom,
    route:check.route.slice(),createdTick:game.time,
    verifiedSpawnSite:{...operation.spawnSite},
    estimatedClaimTravelTicks:check.measuredPathSteps,
    claimerName:name,reason:null
  };
  return {status:'SPAWN_INTENT_ACCEPTED',reason:null,
    spawnIntentAccepted:true,missionId:id};
  // A successful spawnCreep RETURN CODE is not confirmed birth/arrival,
  // and the claimer itself confirms ownership only from controller.my.
}

// A mission cannot remain CLAIMING forever if a claimer dies, spawning
// fails to materialize, ownership was confirmed, or home defense collapses.
// This is only a ledger observer: never calls spawn/claim/move and never
// treats an accepted intent as a confirmed new colony.
function supervise(game,memory) {
  const m=memory?.bot?.expansionClaim;
  if(!m || m.schemaVersion!==1 || m.phase!=='CLAIMING')
    return {status:'NO_ACTIVE_CLAIM',changed:false};
  const tick=game?.time;
  if(!Number.isSafeInteger(tick) || tick<0 ||
     !Number.isSafeInteger(m.createdTick) ||
     m.createdTick>tick || !game?.rooms || !game?.creeps)
    return {status:'RUNTIME_UNVERIFIED',changed:false};
  const abort=reason=>{
    m.phase='ABORTED';
    m.reason=reason;
    m.abortTick=tick;
    return {status:'ABORTED',reason,changed:true};
  };
  const objective=game.rooms[m.target];
  if(objective?.controller?.my===true) {
    m.phase='CLAIMED';
    m.confirmedTick=tick;
    m.reason=null;
    return {status:'CLAIMED',changed:true};
  }
  const parent=game.rooms[m.parent];
  if(!parent?.controller?.my ||
     (Number(parent.controller.safeMode)||0)>0 ||
     (Number(parent.controller.safeModeCooldown)||0)>0)
    return abort('PARENT_DEFENSE_OR_VISION_UNSAFE');
  if(typeof FIND_HOSTILE_CREEPS!=='undefined' &&
     typeof parent.find==='function') {
    const enemies=parent.find(FIND_HOSTILE_CREEPS);
    if(!Array.isArray(enemies) || enemies.length)
      return abort('PARENT_UNDER_ATTACK');
  }
  if(tick-m.createdTick>900)
    return abort('CLAIMER_MISSION_EXPIRED');
  if(tick-m.createdTick>20 &&
     !Object.values(game.creeps).some(c=>c?.memory?.role==='claimer' &&
       c.memory.claimMissionId===m.id))
    return abort('CLAIMER_MISSING_AFTER_SPAWN_GRACE');
  return {status:'CLAIMING',changed:false};
}
// Act on observed post-claim state, not on a construction-site intent.
// A confirmed owned spawn ends the bootstrap mission; the existing room and
// spawn managers then take over normal local economy and creep production.
// Missing visibility cannot be interpreted as a lost colony.
function superviseBootstrap(game,memory) {
  const m=memory?.bot?.expansionClaim;
  if(!m || m.schemaVersion!==1 || m.phase!=='CLAIMED')
    return {status:'NO_ACTIVE_BOOTSTRAP',changed:false};
  const tick=game?.time;
  if(!Number.isSafeInteger(tick) ||
     !Number.isSafeInteger(m.confirmedTick) ||
     m.confirmedTick>tick || !game?.rooms)
    return {status:'BOOTSTRAP_RUNTIME_UNVERIFIED',changed:false};
  const room=game.rooms[m.target];
  if(!room || room.name!==m.target || !room.controller)
    return {status:'TARGET_VISION_UNAVAILABLE',changed:false};
  if(room.controller.my!==true) {
    m.phase='LOST';
    m.reason='CLAIMED_ROOM_OWNERSHIP_LOST';
    m.abortTick=tick;
    return {status:'LOST',reason:m.reason,changed:true};
  }
  if(typeof FIND_MY_SPAWNS==='undefined' || typeof room.find!=='function')
    return {status:'SPAWN_OBSERVATION_UNAVAILABLE',changed:false};
  let spawns;
  try { spawns=room.find(FIND_MY_SPAWNS); }
  catch (_) { return {status:'SPAWN_OBSERVATION_FAILED',changed:false}; }
  if(!Array.isArray(spawns))
    return {status:'SPAWN_OBSERVATION_FAILED',changed:false};
  if(spawns.length) {
    const site=m.verifiedSpawnSite;
    const built=spawns.find(s=>s?.my!==false &&
      s?.pos?.roomName===m.target &&
      s.pos.x===site?.x && s.pos.y===site?.y);
    if(!built)
      return {status:'SPAWN_LOCATION_UNVERIFIED',changed:false};
    m.phase='ESTABLISHED';
    m.establishedTick=tick;
    m.firstSpawnId=built.id||null;
    m.reason=null;
    return {status:'ESTABLISHED',reason:null,changed:true,
      firstSpawnId:m.firstSpawnId};
  }
  if(tick-m.confirmedTick>2000) {
    m.phase='BOOTSTRAP_BLOCKED';
    m.reason='FIRST_SPAWN_NOT_OBSERVED_BY_DEADLINE';
    m.blockedTick=tick;
    return {status:'BOOTSTRAP_BLOCKED',reason:m.reason,changed:true};
  }
  return {status:'BOOTSTRAPPING',changed:false};
}

module.exports={start,supervise,superviseBootstrap};
