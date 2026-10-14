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
     check.route.at(-1)!==check.candidateRoom)
    return reject('SPAWN_OR_MISSION_UNVERIFIED');

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
  const rc=spawn.spawnCreep(body,name,{memory:{
    role:'claimer',home:check.parentRoom,
    targetRoom:check.candidateRoom,
    claimMissionId:id,born:game.time
  }});
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
module.exports={start};
