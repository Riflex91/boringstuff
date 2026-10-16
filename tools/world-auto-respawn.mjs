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

export function checkApprovedWorldHoldings(reply) {
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
  const ownCreeps=Array.isArray(roomObjects?.objects)?
    roomObjects.objects.filter(o=>o?.type==='creep'&&
      String(o?.user||'')===accountId).length:null;
  return {status:world?.status??null,holdings,engine,
    currentGameTick:Number.isSafeInteger(tick)?tick:null,
    noOwnedRoomObjectCreeps:ownCreeps===0};
}
export async function performApprovedWorldAutoRecovery(api,{
  wait=ms=>pause(ms),now=()=>Math.floor(Date.now()/1000),
  waitForLossMs=420000,place=placeW37S79Only
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
  const start=now();
  const first=await readLossEvidence(api,id);
  if(first.status!=='lost'||!first.holdings.scopeVerified||
     !first.engine.verified||!first.noOwnedRoomObjectCreeps)
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
    otherRecoverableFootholdAbsentVerified:distinct&&
      first.holdings.scopeVerified&&second.holdings.scopeVerified&&
      second.noOwnedRoomObjectCreeps,
    accountResetScopeVerified:first.holdings.scopeVerified&&
      second.holdings.scopeVerified,
    documentedRespawnTransportVerified:true,
    nonRetryingRespawnExecutorAvailable:true,
    preWriteFreshWorldStatus:immediate?.status??null
  });
  if(verdict.verdict!=='ELIGIBLE_FOR_SEPARATELY_VERIFIED_EXECUTOR')
    return {status:'HOLD_RESPAWN_GATE',blockers:verdict.blockers,
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
      respawnPosts:1,placementPosts:placement.placementApiCalls};
  }catch{
    return {status:'RESPAWN_VERIFIED_EMPTY_PLACEMENT_HOLD',
      respawnPosts:1,placementPosts:null};
  }
}
async function main(){
  if(!process.env.RUNNER_TEMP)throw Error('RUNNER_TEMP_REQUIRED');
  const config=path.join(process.env.RUNNER_TEMP,
    'world-auto-respawn-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),
    {mode:0o600,flag:'wx'});
  try{
    const api=await ScreepsHttpClient.fromConfig('world',{file:config,shard:SHARD});
    const r=await performApprovedWorldAutoRecovery(api);
    console.log('WORLD_AUTO_RESPAWN '+JSON.stringify(r));
    if(!['NO_ACTION_WORLD_NORMAL','RESPAWN_AND_SPAWN1_VERIFIED',
      'HOLD_WORLD_NOT_LOST'].includes(r.status))process.exitCode=2;
  }finally{fs.rmSync(config,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{console.error('WORLD_AUTO_RESPAWN_FAIL_CLOSED');
    process.exitCode=1;});
