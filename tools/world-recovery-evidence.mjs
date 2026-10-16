// World production recovery evidence from the exact Screeps userMemory GET.
// This is a bounded, READ-ONLY view of game-maintained evidence. Silence
// means "not observed in retained memory", NOT "recovery never occurred".
import {parseBotMemory} from './ci-deployment-guard.mjs';
const CODES=new Set([
  'R1_OWNED_SPAWN_REBUILD_SITE_INTENT',
  'R1_OWNED_SPAWN_REBUILD_CONFIRMED',
  'R2_SPAWNLESS_WORKER_DISPATCH'
]);
const VALID_STATES=new Set([
  'ASSIGNED','ARRIVED','RETREAT','RETURNED','ABORTED','LOST','COMPLETED'
]);
const ROOM=/^[WE]\d+[NS]\d+$/;
const goodTick=t=>Number.isSafeInteger(t)&&t>=0;
function receiptStatus(v) {
  if(!v||typeof v!=='object'||!VALID_STATES.has(v.status)||
     !goodTick(v.assignedTick)||!goodTick(v.lastObservedTick)||
     v.lastObservedTick<v.assignedTick ||
     !ROOM.test(v.home||'') || !ROOM.test(v.target||''))
    return null;
  if(v.status==='COMPLETED'&&(!goodTick(v.completedTick)||
      v.completedTick<v.assignedTick ||
      typeof v.oldSpawnId!=='string'||!v.oldSpawnId.length))
    return null;
  return {status:v.status,home:v.home,target:v.target,
    assignedTick:v.assignedTick,lastObservedTick:v.lastObservedTick,
    completedTick:goodTick(v.completedTick)?v.completedTick:null};
}
// Expansion fields are observations in one actual STATUS_SNAPSHOT, not
// permission to claim. Filter untrusted text and keep only bounded reasons.
// "NO_CLAIM_INTENT" and "GCL_AT_CAPACITY" are distinct operational states.
const code=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,70}$/.test(v)?v:null;
const nint=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000?v:null;
const progress=v=>Number.isSafeInteger(v)&&v>=0&&v<=100000000000000?v:null;
const healthStatuses=new Set(['HEALTHY','WATCH','DEGRADED','CRITICAL']);
const nonNegativeRate=v=>typeof v==='number'&&Number.isFinite(v)&&
  v>=0&&v<=10000?Math.round(v*1000)/1000:null;
function observedRate(current,previous,currentTick,previousTick,currentLevel,previousLevel) {
  // A level-up resets controller/GCL progress. Never infer progress across it.
  const a=progress(current),b=progress(previous);
  if(a===null||b===null||a<b || !goodTick(currentTick)||
     !goodTick(previousTick)||currentTick<=previousTick||
     currentLevel===null||currentLevel!==previousLevel)return null;
  return nonNegativeRate((a-b)/(currentTick-previousTick));
}
// Read-only source-level economics from an already persisted STATUS_SNAPSHOT.
// Every figure is modeled WORK capacity, not a confirmed harvest/withdrawal.
// Never print source IDs, infer nonexistent sources, or trust truncated
// logger.slim snapshots as complete evidence.
function modelSourceCoverage(model) {
  const count=model?.sourceCount, routes=model?.sourceRoutes;
  if(!Number.isSafeInteger(count)||count<1||count>5||
     !Array.isArray(routes)||routes.length!==count)return null;
  const seen=new Set(),clean=[];
  for(const route of routes) {
    if(!route||typeof route!=='object'||Array.isArray(route)||
       typeof route.sourceId!=='string'||route.sourceId.length<1||
       route.sourceId.length>80||seen.has(route.sourceId)||
       !Number.isSafeInteger(route.spawnDistance)||
       route.spawnDistance<0||route.spawnDistance>100||
       typeof route.containerReady!=='boolean'||
       route.assignedHarvesterWorkParts===null||
       typeof route.assignedHarvesterWorkParts!=='number'||
       !Number.isFinite(route.assignedHarvesterWorkParts)||
       route.assignedHarvesterWorkParts<0||
       route.assignedHarvesterWorkParts>50||
       route.dedicatedIncomePerTick===null||
       typeof route.dedicatedIncomePerTick!=='number'||
       !Number.isFinite(route.dedicatedIncomePerTick)||
       route.dedicatedIncomePerTick<0||
       route.dedicatedIncomePerTick>100)return null;
    seen.add(route.sourceId);
    clean.push({
      index:clean.length,
      modeledHarvesterWorkParts:Math.round(route.assignedHarvesterWorkParts*100)/100,
      modeledIncomePerTick:Math.round(route.dedicatedIncomePerTick*1000)/1000,
      containerReady:route.containerReady,
      spawnDistance:route.spawnDistance
    });
  }
  return {
    evidenceType:'MODEL_ONLY_NOT_SETTLED_HARVEST',
    sourceCount:count,
    unassignedSources:clean.filter(r=>r.modeledHarvesterWorkParts===0).length,
    sourcesBelowFiveWork:clean.filter(r=>r.modeledHarvesterWorkParts<5).length,
    modeledCombinedIncomePerTick:Math.round(
      clean.reduce((sum,r)=>sum+r.modeledIncomePerTick,0)*1000)/1000,
    routes:clean
  };
}
function homeEvidence(x,previous,currentTick,previousTick) {
  // Exact operational World home. The diagnostic never guesses an unsafe
  // parent from stale scout/SHADOW candidate room records.
  const room=x?.rooms?.W37S79;
  if(!room || typeof room!=='object' || Array.isArray(room))
    return null;
  const health=room.health;
  const status=code(health?.status);
  const validatedStatus=healthStatuses.has(status)?status:null;
  const reasons=Array.isArray(health?.reasons)?
    health.reasons.slice(0,12).map(code).filter(Boolean):null;
  const model=room.economyModel;
  const signed=v=>Number.isSafeInteger(v)&&v>=-10000&&v<=10000?v:null;
  const priorRoom=previous?.rooms?.W37S79;
  const continuity=Array.isArray(x.expansionParentStability?.rooms)?
    x.expansionParentStability.rooms.slice(0,20).find(row=>
      row?.room==='W37S79'):null;
  return {
    room:'W37S79',rcl:nint(room.rcl),
    controllerProgress:progress(room.controllerProgress),
    controllerProgressTotal:progress(room.controllerProgressTotal),
    safeModeRemainingTicks:nint(room.safeModeRemainingTicks),
    safeModeCooldownRemainingTicks:nint(room.safeModeCooldownRemainingTicks),
    // Preserve the distinction between a current Safe Mode and its cooldown.
    // A missing historical field must NOT be treated as proof of no protection.
    parentDefenseGate:
      nint(room.safeModeRemainingTicks)>0?'SAFE_MODE_ACTIVE':
      nint(room.safeModeCooldownRemainingTicks)>0?'SAFE_MODE_COOLDOWN_ACTIVE':
      nint(room.safeModeRemainingTicks)===0 &&
      nint(room.safeModeCooldownRemainingTicks)===0?'NO_ACTIVE_PROTECTION':
      'UNVERIFIED',
    observedControllerProgressPerTick:observedRate(
      room.controllerProgress,priorRoom?.controllerProgress,currentTick,
      previousTick,nint(room.rcl),nint(priorRoom?.rcl)),
    energyAvailable:nint(room.energyAvailable),
    energyCapacity:nint(room.energyCapacity),
    energyStored:progress(room.energyStored),
    healthStatus:validatedStatus,
    healthScore:Number.isSafeInteger(health?.overallScore)&&
      health.overallScore>=0&&health.overallScore<=100?
      health.overallScore:null,
    healthReasons:reasons,
    healthEconomyScore:nint(health?.scores?.economy),
    healthLogisticsScore:nint(health?.scores?.logistics),
    healthControllerScore:nint(health?.scores?.controller),
    parentContinuityStatus:code(continuity?.status),
    parentContinuityReason:code(continuity?.reason),
    parentContinuityTicks:nint(continuity?.consecutiveSupportTicks),
    constructionSites:nint(room.constructionSites),
    economyWindowControllerProgress:progress(room.economy?.last100?.controllerProgress),
    theoreticalIncomePerTick:nonNegativeRate(model?.theoreticalIncomePerTick),
    harvestedCapacityPerTick:nonNegativeRate(model?.dedicatedHarvestCapacityPerTick),
    modeledSourceCoverage:modelSourceCoverage(model),
    productiveDemandPerTick:nonNegativeRate(model?.productiveDemandPerTick),
    haulerCarryParts:nint(model?.haulerCarryParts),
    requiredHaulerCarryParts:nint(model?.recommendedHaulerCarryParts),
    sourceContainersReady:nint(model?.sourceContainersReady),
    sourceCount:nint(model?.sourceCount),
    consumerWaitingCount:nint(model?.consumerWaitingCount),
    consumerFallbackCount:nint(model?.consumerFallbackCount),
    consumerCriticalCount:nint(model?.consumerCriticalCount),
    haulingDeficit:signed(model?.haulerCarryDeficit),
    miningDeficit:signed(model?.harvesterWorkDeficit),
    haulerCount:nint(room.creeps?.hauler),
    harvesterCount:nint(room.creeps?.harvester),
    upgraderCount:nint(room.creeps?.upgrader),
    source:'LATEST_LIVE_OWNED_ROOM_SNAPSHOT'
  };
}
function expansionAt(snapshot,previousSnapshot) {
  const x=snapshot?.x;
  if(!x || typeof x!=='object')return null;
  const readiness=x.expansionReadiness;
  const candidates=x.expansionCandidates;
  const launch=x.expansionClaimLaunch;
  const operation=x.expansionOperation;
  const recovery=x.expansionBootstrapRecoveryResult;
  // Snapshot missing expansion content is UNKNOWN, not "no available slot".
  if(!readiness || typeof readiness!=='object')
    return null;
  const reasons=Array.isArray(readiness.reasons)?
    readiness.reasons.slice(0,8).map(code).filter(Boolean):null;
  return {
    source:'LIVE_STATUS_SNAPSHOT_NOT_CLAIM_AUTHORITY',
    tick:snapshot.t,
    gclLevel:nint(x.gcl?.level),
    gclProgress:progress(x.gcl?.progress),
    gclProgressTotal:progress(x.gcl?.progressTotal),
    observedGclProgressPerTick:observedRate(x.gcl?.progress,
      previousSnapshot?.x?.gcl?.progress,snapshot.t,previousSnapshot?.t,
      nint(x.gcl?.level),nint(previousSnapshot?.x?.gcl?.level)),
    home:homeEvidence(x,previousSnapshot?.x,snapshot.t,previousSnapshot?.t),
    suitableParent:typeof readiness.suitableParent==='boolean'?
      readiness.suitableParent:null,
    ownedRooms:nint(readiness.ownedRooms),
    availableClaimSlots:nint(readiness.availableClaimSlots),
    readinessStatus:code(readiness.status),
    readinessReasons:reasons,
    candidatesStatus:code(candidates?.status),
    candidatesReason:code(candidates?.reason),
    candidateCount:nint(candidates?.candidateCount),
    operationPhase:code(operation?.phase),
    launchStatus:code(launch?.status),
    launchReason:code(launch?.reason),
    bootstrapRecoveryStatus:code(recovery?.status),
    bootstrapRecoveryReason:code(recovery?.reason)
  };
}
// O18: retention-bounded historical W37S79 collapse witnesses. These are
// in-game journal snapshots, NOT simultaneous observations with current API
// room objects or the authoritative current server tick. No IDs or raw memory.
const COLLAPSE_TIMELINE_LIMIT = 12;
function collapseTimeline(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length > 512)
    return {status:'UNVERIFIED',reason:'SNAPSHOT_JOURNAL_UNAVAILABLE'};
  const ordered=snapshots.filter(s=>s?.c==='STATUS_SNAPSHOT')
    .map(s=>({t:s.t,x:s.x})).sort((a,b)=>a.t-b.t);
  if (ordered.some(s=>!goodTick(s.t)) ||
      ordered.some((s,i)=>i>0&&s.t===ordered[i-1].t))
    return {status:'UNVERIFIED',reason:'SNAPSHOT_TICKS_INVALID'};
  if (!ordered.length)
    return {status:'UNVERIFIED',reason:'NO_RETAINED_STATUS_SNAPSHOTS'};
  const recent=ordered.slice(-COLLAPSE_TIMELINE_LIMIT);
  const rows=recent.map(s=>{
    const room=s.x?.rooms?.W37S79;
    const health=room?.health;
    const hReasons=Array.isArray(health?.reasons) &&
      health.reasons.length<=12 &&
      health.reasons.every(value=>code(value)!==null)
      ?health.reasons:null;
    const roles=room?.creeps;
    const names=roles&&typeof roles==='object'&&!Array.isArray(roles)?
      Object.keys(roles):null;
    const creepTotal=names&&names.length<=30 &&
      names.every(name=>/^[a-z][a-z0-9_]{0,39}$/.test(name) &&
        Number.isSafeInteger(roles[name]) &&
        roles[name]>=0&&roles[name]<=150)
      ?names.reduce((total,name)=>total+roles[name],0):null;
    return {
      tick:s.t,
      homePresent:!!room&&typeof room==='object'&&!Array.isArray(room),
      rcl:nint(room?.rcl),
      healthStatus:healthStatuses.has(code(health?.status))?
        health.status:null,
      healthScore:Number.isSafeInteger(health?.overallScore)&&
        health.overallScore>=0&&health.overallScore<=100?
        health.overallScore:null,
      healthReasons:hReasons,
      spawnMissingHealthFlag:hReasons?hReasons.includes('SPAWN_MISSING'):null,
      observedHomeCreeps:creepTotal,
      infrastructureEnergyAvailable:nint(room?.energyAvailable),
      infrastructureEnergyCapacity:nint(room?.energyCapacity),
      modeledHarvestCapacityPerTick:
        nonNegativeRate(room?.economyModel?.dedicatedHarvestCapacityPerTick)
    };
  });
  return {
    status:'RETAINED_SNAPSHOTS_ONLY',
    currentGameTickVerified:false,
    fullCollapseHistoryVerified:false,
    firstRetainedTick:rows[0].tick,
    latestRetainedTick:rows.at(-1).tick,
    reportedSnapshotCount:rows.length,
    olderSnapshotsNotDisplayed:ordered.length>COLLAPSE_TIMELINE_LIMIT,
    snapshots:rows
  };
}

export function inspectWorldRecoveryEvidence(reply) {
  const bot=parseBotMemory(reply);
  if(!bot)return {availability:'UNKNOWN',reason:'BOT_MEMORY_NOT_VERIFIABLE',
    observedEventCount:null,events:null,rescue:null,
    witnessedSpawnRoomCount:null,latestSnapshotTick:null,expansion:null,
    collapseTimeline:{status:'UNVERIFIED',reason:'BOT_MEMORY_NOT_VERIFIABLE'}};
  const journal=bot.telemetryJournal;
  const rawEvents=Array.isArray(journal?.events)?journal.events:null;
  const events=rawEvents===null?null:[];
  if(events)for(const event of rawEvents.slice(-200)) {
    if(!event||!CODES.has(event.c)||!goodTick(event.t))continue;
    const x=event.x;
    if(!x||typeof x!=='object'||Array.isArray(x))continue;
    if(event.c==='R1_OWNED_SPAWN_REBUILD_CONFIRMED'&&
       (!ROOM.test(x.room||'') ||
        typeof x.oldSpawnId!=='string'||!x.oldSpawnId.length||
        typeof x.newSpawnId!=='string'||!x.newSpawnId.length||
        x.oldSpawnId===x.newSpawnId||!goodTick(x.confirmedTick)||
        x.confirmedTick!==event.t))continue;
    if(event.c==='R1_OWNED_SPAWN_REBUILD_SITE_INTENT'&&
       (!ROOM.test(x.room||'')||x.siteIntentAccepted!==true))continue;
    if(event.c==='R2_SPAWNLESS_WORKER_DISPATCH'&&
       (!ROOM.test(x.from||'')||!ROOM.test(x.to||'')||
        x.from===x.to||x.assigned!==true))continue;
    events.push({code:event.c,tick:event.t,
      room:event.c==='R2_SPAWNLESS_WORKER_DISPATCH'?x.to:x.room});
  }
  if(events)events.splice(0,Math.max(0,events.length-8));
  const ledger=bot.spawnlessWorkerRescueLedger;
  const history=ledger?.schemaVersion===1 &&
    Array.isArray(ledger.history)&&ledger.history.length<=6
    ?ledger.history:null;
  const active=ledger?.schemaVersion===1?receiptStatus(ledger.active):null;
  const last=history&&history.length?receiptStatus(history.at(-1)):null;
  const recovery=bot.ownedSpawnRecovery;
  const witnessed= recovery?.schemaVersion===1&&
    recovery.rooms&&typeof recovery.rooms==='object'&&
    !Array.isArray(recovery.rooms)&&
    Object.keys(recovery.rooms).length<=20
    ?Object.entries(recovery.rooms).filter(([room,record])=>
      ROOM.test(room)&&record&&
      typeof record.lastSpawnId==='string'&&
      record.lastSpawnId.length>0&&
      record.pos?.roomName===room).length:null;
  const snapshots=Array.isArray(journal?.snapshots)?
    journal.snapshots.filter(s=>s?.c==='STATUS_SNAPSHOT'&&goodTick(s.t)):null;
  const latestSnapshot=snapshots?.length?
    snapshots.reduce((best,row)=>!best||row.t>best.t?row:best,null):null;
  const latestSnapshotTick=latestSnapshot?.t??null;
  const previousSnapshot=snapshots?.length?
    snapshots.reduce((best,row)=>row.t<latestSnapshotTick &&
      (!best||row.t>best.t)?row:best,null):null;
  const expansion=expansionAt(latestSnapshot,previousSnapshot);
  return {availability:'OBSERVED_IN_BOT_MEMORY',
    observationScope:'RETAINED_EVENTS_AND_BOUNDED_MISSION_HISTORY_ONLY',
    observedEventCount:events?.length??null,events,
    rescue: ledger?.schemaVersion===1?{
      active,last,retainedReceiptCount:history?.length??null
    }:null,
    witnessedSpawnRoomCount:witnessed,
    latestSnapshotTick,expansion,
    collapseTimeline:collapseTimeline(journal?.snapshots)};
}
