import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';
import { parseBotMemory } from './ci-deployment-guard.mjs';
import { placeW37S79Only, PLACEMENT_APPROVAL }
  from './world-next-place-spawn.mjs';
import { assessWorldRespawnReadiness } from './world-respawn-recovery-policy.mjs';

const EXPECTED_USERNAME='riflex91';
const ROOM='W37S79',SHARD='shard0';
const READ_LIMIT=2000;
const WORLD_SHARDS=Object.freeze(['shard0','shard1','shard2','shard3']);

// No existing API in this client proves zero global living creeps.
// Production has no census provider; fail closed until one is reviewed.
export function validateGlobalCreepCensus(evidence,accountId) {
  return Boolean(accountId && evidence?.authenticated===true &&
    evidence?.accountId===accountId &&
    Number.isSafeInteger(evidence?.ownedCreepCount) &&
    evidence.ownedCreepCount===0 &&
    Array.isArray(evidence?.coveredShards) &&
    evidence.coveredShards.length===WORLD_SHARDS.length &&
    WORLD_SHARDS.every(name=>evidence.coveredShards.includes(name)) &&
    new Set(evidence.coveredShards).size===WORLD_SHARDS.length &&
    evidence?.independentCurrentCensus===true);
}

export function checkApprovedWorldHoldings(reply) {
  if(reply?.ok===false)return {complete:false,scopeVerified:false};
  const shards=reply?.shards;
  if(!shards||typeof shards!=='object'||Array.isArray(shards))
    return {complete:false,scopeVerified:false};
  const all=Object.keys(shards);
  if(!['shard0','shard1','shard2','shard3'].every(x=>
    Array.isArray(shards[x])&&shards[x].length<=30))
    return {complete:false,scopeVerified:false};
  if(!all.every(x=>Array.isArray(shards[x])&&
     shards[x].length<=30))return {complete:false,scopeVerified:false};
  const rooms=all.flatMap(k=>shards[k].map(name=>[k,name]));
  // The user approved rebuilding THIS colony, not deleting arbitrary
  // additional recoverable bases on other shards. Do not reset otherwise.
  const scopeVerified=rooms.length===1&&
    rooms[0][0]===SHARD&&rooms[0][1]===ROOM;
  const reservations=reply.reservations;
  const reservationsEmpty=reservations===undefined||
    (reservations&&typeof reservations==='object'&&
      !Array.isArray(reservations)&&Object.values(reservations).every(v=>
        Array.isArray(v)&&v.length===0));
  return {complete:reservationsEmpty===true,
    scopeVerified:scopeVerified&&reservationsEmpty===true};
}
export function checkSameTickWorldLoss(memoryReply,currentTick) {
  const unknown={verified:false,snapshotTick:null,
    engineSpawnCount:null,engineCreepCount:null};
  if(!Number.isSafeInteger(currentTick)||currentTick<1)return unknown;
  const bot=parseBotMemory(memoryReply),journal=bot?.telemetryJournal;
  const ss=journal?.snapshots,es=journal?.events;
  if(!Array.isArray(ss)||!Array.isArray(es)||
     ss.length>READ_LIMIT||es.length>READ_LIMIT)return unknown;
  const heartbeatTicks=new Set(es.filter(x=>x?.c==='BOT_HEARTBEAT'&&
    Number.isSafeInteger(x?.t)).map(x=>x.t));
  const eligible=ss.filter(x=>x?.c==='STATUS_SNAPSHOT'&&
    Number.isSafeInteger(x?.t)&&heartbeatTicks.has(x.t)&&
    x.t<=currentTick&&currentTick-x.t<=175&&
    x.x?.rooms?.[ROOM]&&x.x?.totalCreeps===0 &&
    Array.isArray(x.x.rooms[ROOM].health?.reasons)&&
    x.x.rooms[ROOM].health.reasons.includes('SPAWN_MISSING'));
  if(!eligible.length)return unknown;
  const best=eligible.reduce((a,x)=>!a||x.t>a.t?x:a,null);
  const heartbeats=es.filter(x=>x?.c==='BOT_HEARTBEAT'&&
    x.t===best.t&&x.x?.creeps===0&&x.x?.rooms>=1);
  if(heartbeats.length!==1)return unknown;
  return {verified:true,snapshotTick:best.t,
    engineSpawnCount:0,engineCreepCount:0};
}
async function readLossEvidence(api,accountId) {
  const [world,rooms,memory,clock,roomObjects]=await Promise.all([
    api.userWorldStatus(),api.userRooms(accountId),
    api.userMemory('bot',SHARD),
    api._request('GET','/api/game/time',{shard:SHARD}),
    api.gameRoomObjects(ROOM,SHARD)
  ]);
  const holdings=checkApprovedWorldHoldings(rooms);
  const tick=clock?.time;
  const engine=checkSameTickWorldLoss(memory,tick);
  const roomList=roomObjects?.ok!==false&&Array.isArray(roomObjects?.objects)?
    roomObjects.objects:null;
  const ownCreeps=roomList?.filter(o=>o?.type==='creep'&&
    String(o?.user||'')===accountId).length;
  // A surviving owned spawn from any authenticated GET is positive
  // recoverability evidence. Never erase it as a presumed stale ghost.
  const ownSpawns=roomList?.filter(o=>
    (o?.type==='spawn'||o?.structureType==='spawn')&&
    String(o?.user||'')===accountId).length;
  return {status:world?.status??null,holdings,engine,
    currentGameTick:Number.isSafeInteger(tick)?tick:null,
    noOwnedRoomObjectCreeps:ownCreeps===0,
    noOwnedRoomObjectSpawns:ownSpawns===0};
}
export async function performApprovedWorldAutoRecovery(api,{
  wait=ms=>pause(ms),now=()=>Math.floor(Date.now()/1000),
  waitForLossMs=420000,place=placeW37S79Only,reserveAttempt=null,
  verifyGlobalCreepAbsence=null
}={}){
  if(api?.defaultShard!==SHARD)throw Error('WORLD_SHARD_NOT_VERIFIED');
  const me=await api.authMe();
  if(me?.username!==EXPECTED_USERNAME||!(me?._id||me?.id))
    throw Error('WORLD_ACCOUNT_IDENTITY_MISMATCH');
  const id=me._id||me.id;
  const firstStatus=await api.userWorldStatus();
  if(firstStatus?.status==='normal')
    return {status:'NO_ACTION_WORLD_NORMAL',respawnPosts:0,
      placementPosts:0};
  if(firstStatus?.status!=='lost')
    return {status:'HOLD_WORLD_NOT_LOST',respawnPosts:0,
      placementPosts:0};
  // 'lost' only proves missing spawns, not absent remote creeps.
  if(typeof verifyGlobalCreepAbsence!=='function')
    return {status:'HOLD_GLOBAL_CREEP_CENSUS_UNAVAILABLE',
      respawnPosts:0,placementPosts:0};
  const start=now();
  const first=await readLossEvidence(api,id);
  if(first.status!=='lost'||!first.holdings.scopeVerified||
     !first.engine.verified||!first.noOwnedRoomObjectCreeps||
     !first.noOwnedRoomObjectSpawns)
    return {status:'HOLD_RECOVERABILITY_UNVERIFIED',
      respawnPosts:0,placementPosts:0};
  // Two independent real game-loop status snapshots MUST be separated
  // by at least 100 actual game ticks, not just elapsed wall time.
  await wait(waitForLossMs);
  const second=await readLossEvidence(api,id);
  const secondTime=now();
  const distinct=second.engine.verified&&
    second.engine.snapshotTick>=first.engine.snapshotTick+100;
  const immediate=await api.userWorldStatus();
  let globalCensus;
  try{
    globalCensus=await verifyGlobalCreepAbsence(api,{
      accountId:id,phase:'BEFORE_LOCK',requiredShards:WORLD_SHARDS
    });
  }catch {/* conservative unknown */ }
  const globalVerified=validateGlobalCreepCensus(globalCensus,id);
  const verdict=assessWorldRespawnReadiness({
    observations:[
      {status:first.status,unixSeconds:start},
      {status:second.status,unixSeconds:secondTime}
    ],
    worldAccountIdentityVerified:true,
    allShardAndSimHoldingsEnumerated:first.holdings.complete&&
      second.holdings.complete,
    sameTickEngineSpawnCount:distinct?second.engine.engineSpawnCount:null,
    sameTickEngineCreepCount:distinct?second.engine.engineCreepCount:null,
    globalAllShardCreepAbsenceVerified:globalVerified,
    otherRecoverableFootholdAbsentVerified:distinct&&
      first.holdings.scopeVerified&&second.holdings.scopeVerified&&
      second.noOwnedRoomObjectCreeps&&second.noOwnedRoomObjectSpawns,
    accountResetScopeVerified:first.holdings.scopeVerified&&
      second.holdings.scopeVerified,
    documentedRespawnTransportVerified:true,
    nonRetryingRespawnExecutorAvailable:true,
    preWriteFreshWorldStatus:immediate?.status??null
  });
  if(verdict.verdict!=='ELIGIBLE_FOR_SEPARATELY_VERIFIED_EXECUTOR')
    return {status:'HOLD_RESPAWN_GATE',blockers:verdict.blockers,
      respawnPosts:0,placementPosts:0};
  // A single process can prevent transport retries, but a scheduled
  // workflow may be started again after a lost acknowledgement. Require an
  // external, durable one-way attempt marker BEFORE a potentially committed
  // respawn. If that marker cannot be independently verified, do not reset.
  if(typeof reserveAttempt!=='function')
    return {status:'HOLD_DURABLE_ATTEMPT_LOCK_UNAVAILABLE',
      respawnPosts:0,placementPosts:0};
  let reserved=false;
  try {
    reserved=await reserveAttempt({
      account:EXPECTED_USERNAME,shard:SHARD,room:ROOM,
      gameTick:second.currentGameTick});
  } catch {/* account safety first; no reset without durable marker */ }
  if(reserved!==true)
    return {status:'HOLD_RESPAWN_ATTEMPT_ALREADY_RECORDED_OR_UNVERIFIED',
      respawnPosts:0,placementPosts:0};
  // The reservation may take time; ownership can change independently.
  // Reauthenticate, check ALL known holdings, and reject positive recovery
  // evidence again. These independent GETs are conservative, not atomic.
  let finalAccount,finalStatus,finalRooms,finalRoomObjects;
  try{
    [finalAccount,finalStatus,finalRooms,finalRoomObjects]=await Promise.all([
      api.authMe(),api.userWorldStatus(),api.userRooms(id),
      api.gameRoomObjects(ROOM,SHARD)
    ]);
  }catch{return {status:'HOLD_FINAL_EVIDENCE_GET_UNVERIFIED',
    respawnPosts:0,placementPosts:0};}
  if(finalAccount?.ok===false||
     finalAccount?.username!==EXPECTED_USERNAME||
     String(finalAccount?._id||finalAccount?.id||'')!==String(id))
    return {status:'HOLD_FINAL_ACCOUNT_IDENTITY_MISMATCH',
      respawnPosts:0,placementPosts:0};
  if(finalStatus?.ok===false||finalStatus?.status!=='lost')
    return {status:'HOLD_FINAL_STATUS_NO_LONGER_LOST',
      respawnPosts:0,placementPosts:0};
  if(!checkApprovedWorldHoldings(finalRooms).scopeVerified)
    return {status:'HOLD_FINAL_RECOVERABLE_HOLDINGS_OR_SCOPE_UNVERIFIED',
      respawnPosts:0,placementPosts:0};
  const finalObjects=finalRoomObjects?.objects;
  if(finalRoomObjects?.ok===false||!Array.isArray(finalObjects)||
     finalObjects.some(o=>String(o?.user||'')===String(id)&&
       (o?.type==='creep'||o?.type==='spawn'||
        o?.structureType==='spawn')))
    return {status:'HOLD_FINAL_OWNED_ASSETS_OR_ROOM_GET_UNVERIFIED',
      respawnPosts:0,placementPosts:0};
  // Require independent all-shard evidence again after recording the lock.
  // The production workflow intentionally supplies no provider today.
  let finalCensus;
  try{
    finalCensus=await verifyGlobalCreepAbsence(api,{
      accountId:id,phase:'AFTER_LOCK',requiredShards:WORLD_SHARDS
    });
  }catch {/* conservative unknown */ }
  if(!validateGlobalCreepCensus(finalCensus,id))
    return {status:'HOLD_FINAL_GLOBAL_CREEP_CENSUS_UNVERIFIED',
      respawnPosts:0,placementPosts:0};
  // A last independent status read limits, but cannot eliminate, the race.
  let lastStatus;
  try{lastStatus=await api.userWorldStatus();}
  catch{return {status:'HOLD_LAST_WORLD_STATUS_GET_UNVERIFIED',
    respawnPosts:0,placementPosts:0};}
  if(lastStatus?.ok===false||lastStatus?.status!=='lost')
    return {status:'HOLD_LAST_WORLD_STATUS_NO_LONGER_LOST',
      respawnPosts:0,placementPosts:0};
  // Verified in the maintained screepers/node-screeps-api library:
  // userRespawn(): POST /api/user/respawn with no payload.
  // Exactly one request. NO retries on network uncertainty or any HTTP error.
  let reset;
  try {
    reset=await api._request('POST','/api/user/respawn',{},
      {max429Retries:0,max5xxRetries:0,retryAuth:false});
  }catch{
    return {status:'RESPAWN_OUTCOME_UNCERTAIN_NO_RETRY',
      respawnPosts:1,placementPosts:0};
  }
  if(reset?.ok===false||reset?.error)
    return {status:'RESPAWN_RESPONSE_REJECTED_NO_RETRY',
      respawnPosts:1,placementPosts:0};
  let empty=false;
  for(let i=0;i<6;i++){
    const check=await api.userWorldStatus();
    if(check?.status==='empty'){empty=true;break}
    if(i<5)await wait(1500);
  }
  if(!empty)return {status:'RESPAWN_READBACK_UNVERIFIED_NO_RETRY',
    respawnPosts:1,placementPosts:0};
  // Reuse the existing guarded 24-room / precise site / exact code double
  // preflight. If code or the former site is unsafe, STOP with empty account.
  // Never automatically retry a possibly accepted placement POST.
  try{
    const placement=await place(api,id,PLACEMENT_APPROVAL);
    if(placement?.status!=='PASS'||placement.spawnVerified!==true)
      throw Error('PLACEMENT_NOT_VERIFIED');
    return {status:'RESPAWN_AND_SPAWN1_VERIFIED',
      respawnPosts:1,placementPosts:placement.placementApiCalls,
      runtimeOperationalVerified:false,codeUploadAttempted:false};
  }catch{
    return {status:'RESPAWN_VERIFIED_EMPTY_PLACEMENT_HOLD',
      respawnPosts:1,placementPosts:null};
  }
}
// Never print the GitHub token, issue response, or any credentials. Record
// the intent in the existing World recovery incident BEFORE invoking the
// destructive Screeps POST. The workflow serializes this across invocations.
// A recent marker blocks a new automatic reset for seven days, including
// when an earlier POST timed out after the server may have committed it.
const INTENT_MARKER='WORLD_AUTO_RESPAWN_ATTEMPT_LOCK_V1';
const COOLDOWN_SECONDS=7*24*60*60;
export async function githubDurableRespawnAttemptLock({
  account,shard,room
}={},env=process.env,fetcher=fetch){
  if(account!=='riflex91'||shard!=='shard0'||room!=='W37S79'||
     env.GITHUB_REPOSITORY!=='Riflex91/boringstuff'||
     env.GITHUB_REF!=='refs/heads/main'||
     typeof env.GITHUB_TOKEN!=='string'||!env.GITHUB_TOKEN)
    return false;
  const base='https://api.github.com/repos/Riflex91/boringstuff/issues/367/comments';
  const headers={Authorization:'Bearer '+env.GITHUB_TOKEN,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28'};
  const now=Math.floor(Date.now()/1000);
  // Validate a complete paged comment history, not just last 100.
  // If too many records to check exhaustively, HOLD rather than retry.
  for(let page=1;page<=25;page++){
    let result;
    try {result=await fetcher(base+'?per_page=100&page='+page,{
      method:'GET',headers
    });} catch{return false;}
    if(!result?.ok)return false;
    let items;
    try{items=await result.json();}catch{return false;}
    if(!Array.isArray(items)||items.length>100)return false;
    if(items.some(item=>{
      if(typeof item?.body!=='string'||!item.body.includes(INTENT_MARKER))
        return false;
      const age=(Date.parse(item.created_at||'')/1000);
      return !Number.isFinite(age)||now-age<COOLDOWN_SECONDS;
    }))return false;
    if(items.length<100){
      const body=INTENT_MARKER+'\\nOperator-approved World auto-recovery'
        +' intent; no Screeps mutation is implied by this entry.';
      let created;
      try{created=await fetcher(base,{method:'POST',headers:{
        ...headers,'Content-Type':'application/json'
      },body:JSON.stringify({body})});}
      catch{return false;}
      if(created?.status!==201)return false;
      try{
        const recorded=await created.json();
        if(!Number.isSafeInteger(recorded?.id)||
           typeof recorded?.body!=='string'||
           !recorded.body.includes(INTENT_MARKER))return false;
        // A successful POST response is not itself a durable readback.
        // Verify the same comment independently before any destructive write.
        const check=await fetcher(
          'https://api.github.com/repos/Riflex91/boringstuff/issues/comments/'+recorded.id,
          {method:'GET',headers});
        if(!check?.ok)return false;
        const persisted=await check.json();
        return persisted?.id===recorded.id &&
          persisted?.body===recorded.body &&
          persisted.body.includes(INTENT_MARKER);
      }catch{return false;}
    }
  }
  return false;
}

async function main(){
  if(!process.env.RUNNER_TEMP)throw Error('RUNNER_TEMP_REQUIRED');
  const config=path.join(process.env.RUNNER_TEMP,
    'world-auto-respawn-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),
    {mode:0o600,flag:'wx'});
  try{
    const api=await ScreepsHttpClient.fromConfig('world',{file:config,shard:SHARD});
    const r=await performApprovedWorldAutoRecovery(api,{
      reserveAttempt:githubDurableRespawnAttemptLock
    });
    console.log('WORLD_AUTO_RESPAWN '+JSON.stringify(r));
    // A placed Spawn1 is NOT an operationally recovered colony. A green
    // scheduled run must never imply live bot restart or release acceptance.
    if(r.status!=='NO_ACTION_WORLD_NORMAL')process.exitCode=2;
  }finally{fs.rmSync(config,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{console.error('WORLD_AUTO_RESPAWN_FAIL_CLOSED');
    process.exitCode=1;});
