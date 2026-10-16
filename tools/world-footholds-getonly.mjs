import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';
import { parseBotMemory } from './ci-deployment-guard.mjs';

// World recovery O22. API GETs ONLY, no POST, no game code/console/memory
// mutations. Unknown or malformed API shapes MUST NOT be called "no rooms".
const ROOM=/^[EW](?:0|[1-9]\d{0,3})[NS](?:0|[1-9]\d{0,3})$/;
const SHARD=/^shard[0-9]{1,2}$/;
const MAX_ROOMS=30;
function parseRow(row,defaultShard='shard0') {
  if(typeof row==='string')return ROOM.test(row)?
    {room:row,shard:defaultShard}:null;
  if(!row||typeof row!=='object'||Array.isArray(row))return null;
  const room=row.room??row.name;
  const shard=row.shard??defaultShard;
  return typeof room==='string'&&ROOM.test(room)&&
    typeof shard==='string'&&SHARD.test(shard)?
    {room,shard}:null;
}
// Structural discovery ONLY. Does not emit user IDs, room names, player
// names, user-defined keys, raw response values or tokens.
export function summarizeRoomListingResponseShape(input) {
  const kind=x=>Array.isArray(x)?'array':
    x===null?'null':typeof x;
  if(!input||typeof input!=='object'||Array.isArray(input))
    return {responseType:kind(input),knownTopFields:[]};
  const allowed=['ok','rooms','shards','data','list','stats','ownedRooms'];
  const top=allowed.filter(k=>Object.hasOwn(input,k));
  const out={responseType:'object',knownTopFields:top};
  for(const k of ['rooms','shards','data','list','ownedRooms']) {
    if(!Object.hasOwn(input,k))continue;
    const value=input[k];
    const row={kind:kind(value)};
    if(Array.isArray(value)) {
      row.length=value.length;
      row.sampleItemKind=value.length?kind(value[0]):null;
      if(value[0]&&typeof value[0]==='object'&&!Array.isArray(value[0]))
        row.sampleKnownFields=['room','name','shard','rooms','level']
          .filter(field=>Object.hasOwn(value[0],field));
    } else if(value&&typeof value==='object') {
      row.shardKeys=Object.keys(value)
        .filter(key=>SHARD.test(key)).slice(0,15);
      row.simGroup=Object.hasOwn(value,'sim')?
        {kind:kind(value.sim),
          count:Array.isArray(value.sim)?value.sim.length:null,
          explicitEmpty:Array.isArray(value.sim)&&value.sim.length===0
        }:null;
      const otherKeys=Object.keys(value)
        .filter(key=>!SHARD.test(key)&&key!=='sim');
      row.otherGroupKeyCount=otherKeys.length;
      row.otherGroupShapes=otherKeys.slice(0,4).map(key=>{
        const item=value[key];
        const info={kind:kind(item)};
        if(Array.isArray(item)){
          info.length=item.length;
          info.sampleItemKind=item.length?kind(item[0]):null;
          info.sampleMatchesRoom=typeof item[0]==='string'?
            ROOM.test(item[0]):null;
        }else if(item&&typeof item==='object'){
          info.propertyCount=Object.keys(item).length;
        }
        // Never print the unknown key or its raw values: it may be a user ID.
        return info;
      });
      row.shardShapes=row.shardKeys.map(shard=>{
        const content=value[shard];
        const info={shard,kind:kind(content)};
        if(Array.isArray(content)) {
          info.length=content.length;
          info.sampleItemKind=content.length?kind(content[0]):null;
          if(typeof content[0]==='string'){
            // Shape only; preserve neither room names nor opaque tokens.
            info.sampleStringLength=content[0].length;
            info.sampleMatchesRoom=ROOM.test(content[0]);
            info.sampleTrimChanges=content[0].trim()!==content[0];
            info.sampleLooksHexId=/^[0-9a-f]{24}$/i.test(content[0]);
            info.sampleHasShardPrefix=content[0].startsWith('shard') && content[0].includes('/');
          }
          if(content[0]&&typeof content[0]==='object'&&
             !Array.isArray(content[0]))
            info.sampleKnownFields=['room','name','shard',
              'rooms','level','controller','_id','id']
              .filter(field=>Object.hasOwn(content[0],field));
        }
        return info;
      });
      const shardKey=row.shardKeys[0];
      if(shardKey) {
        const shardValue=value[shardKey];
        row.firstShardValueKind=kind(shardValue);
        if(shardValue && typeof shardValue==='object' &&
           !Array.isArray(shardValue))
          row.firstShardKnownFields=['rooms','owned','room','name','list']
            .filter(field=>Object.hasOwn(shardValue,field));
      }
      row.knownFields=['rooms','shards','list','room','name','shard']
        .filter(field=>Object.hasOwn(value,field));
    }
    out[k]=row;
  }
  return out;
}

export function summarizeUserRoomListing(input) {
  const unknown={status:'UNVERIFIED',reason:'USER_ROOMS_SHAPE_UNVERIFIED',
    returnedRooms:[],listingComplete:false};
  if(!input||typeof input!=='object'||Array.isArray(input)||
     input.ok===false)return unknown;
  let source=input.rooms;
  // This endpoint has varied across Screeps server versions. Parse only
  // explicit room-list shapes. No list means UNKNOWN, not zero rooms.
  if(source===undefined)source=input.shards;
  if(source===undefined)return unknown;
  const rows=[];
  const add=(x,shard)=>{
    if(!Array.isArray(x)||x.length>MAX_ROOMS)return false;
    for(const item of x){
      const row=parseRow(item,shard);
      if(!row)return false;
      rows.push(row);
    }
    return true;
  };
  if(Array.isArray(source)){
    if(!add(source,'shard0'))return unknown;
  } else if(source&&typeof source==='object'&&!Array.isArray(source)){
    const keys=Object.keys(source);
    if(!keys.length)return unknown; // Empty object shape isn't authoritative.
    if(keys.length>15)return unknown;
    const shards=keys.filter(k=>SHARD.test(k));
    if(!shards.length)return unknown;
    // The API may add unrecognized non-shard group names. Their exact
    // names are private/untrusted; only a VERIFIED EMPTY array cannot
    // contain additional room locators. Every nonempty/other-shaped
    // group remains PARTIAL/UNKNOWN, never a no-foothold verdict.
    const extras=keys.filter(k=>!SHARD.test(k));
    const allOtherGroupsExplicitlyEmpty=extras.every(key=>
      Array.isArray(source[key]) && source[key].length===0);
    for(const shard of shards)if(!add(source[shard],shard))return unknown;
    // Enforce GLOBAL request bound and unique locators BEFORE either a
    // partial or complete listing is permitted to drive follow-up GETs.
    // A per-shard limit alone could otherwise trigger hundreds of reads.
    if(rows.length>MAX_ROOMS)return {
      ...unknown,reason:'USER_ROOMS_LIMIT_EXCEEDED'
    };
    const shardUnique=new Set(rows.map(x=>x.shard+':'+x.room));
    if(shardUnique.size!==rows.length)return {
      ...unknown,reason:'USER_ROOMS_DUPLICATES'
    };
    // Some servers include extra sections (e.g. sim). Do not silently
    // discard them and claim complete multi-shard account coverage.
    if(!allOtherGroupsExplicitlyEmpty)return {
      status:'PARTIAL_USER_ROOMS_LIST',
      reason:'OTHER_ROOM_GROUPS_NOT_VERIFIED',
      returnedRooms:rows,listingComplete:false
    };
  } else return unknown;
  if(rows.length>MAX_ROOMS)return { ...unknown,reason:'USER_ROOMS_LIMIT_EXCEEDED' };
  const uniq=new Set(rows.map(x=>x.shard+':'+x.room));
  if(uniq.size!==rows.length)return { ...unknown,reason:'USER_ROOMS_DUPLICATES' };
  return {status:'EXPLICIT_USER_ROOMS_LIST',reason:null,
    returnedRooms:rows,listingComplete:true};
}

export function summarizeCandidateRoom(reply,accountId,location) {
  const base={room:location.room,shard:location.shard,
    status:'UNVERIFIED',verifiedOwnController:false,
    verifiedOwnSpawn:false,ownCreepsObserved:null};
  if(!accountId||typeof accountId!=='string'||!Array.isArray(reply?.objects)||
     reply.objects.length>2500)return base;
  const objects=reply.objects;
  const ownController=objects.some(o=>o?.type==='controller'&&
    o.user===accountId&&Number.isInteger(o.level)&&o.level>=1&&o.level<=8);
  const ownSpawn=objects.some(o=>
    (o?.type==='spawn'||o?.structureType==='spawn')&&
    o.user===accountId);
  const ownCreeps=objects.filter(o=>o?.type==='creep'&&
    o.user===accountId).length;
  return {...base,status:'ROOM_OBJECTS_OBSERVED',
    verifiedOwnController:ownController,
    verifiedOwnSpawn:ownSpawn,ownCreepsObserved:ownCreeps};
}

// The /api/game/time endpoint is an independent read. Its advance does
// NOT make separate room-object replies same-tick or prove a functional spawn.
function numericGameTick(reply) {
  const n=reply?.time;
  return Number.isSafeInteger(n)&&n>=0&&n<=2000000000?n:null;
}
export function compareWorldRoomGetPairs(first,second,accountId,location) {
  const a=summarizeCandidateRoom(first,accountId,location);
  const b=summarizeCandidateRoom(second,accountId,location);
  if(a.status!=='ROOM_OBJECTS_OBSERVED'||
     b.status!=='ROOM_OBJECTS_OBSERVED')
    return {status:'UNVERIFIED',sameSpawnIdVerified:false,
      sameControllerIdVerified:false};
  const id=o=>typeof o?.id==='string'&&o.id?o.id:
    typeof o?._id==='string'&&o._id?o._id:null;
  const own=(reply,type)=>reply.objects.filter(o=>
    (o?.type===type||o?.structureType===type)&&
    o.user===accountId);
  const getUniqueId=(reply,type)=>{
    const items=own(reply,type);
    return items.length===1?id(items[0]):null;
  };
  const spawnA=getUniqueId(first,'spawn');
  const spawnB=getUniqueId(second,'spawn');
  const ctrlA=getUniqueId(first,'controller');
  const ctrlB=getUniqueId(second,'controller');
  // Numeric controller decay / spawn energy and hits can provide additional
  // freshness clues. Every field is optional; no unchanged value is proof
  // that the game engine stopped, and room-GETs aren't same-tick Game reads.
  const unique=(reply,type)=>{
    const list=own(reply,type);
    return list.length===1?list[0]:null;
  };
  const ctrl1=unique(first,'controller'),ctrl2=unique(second,'controller');
  const spawn1=unique(first,'spawn'),spawn2=unique(second,'spawn');
  const num=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max?v:null;
  const change=(a,b)=>a!==null&&b!==null?b-a:null;
  const ticks1=num(ctrl1?.ticksToDowngrade,20_000_000);
  const ticks2=num(ctrl2?.ticksToDowngrade,20_000_000);
  const energy1=num(spawn1?.store?.energy??spawn1?.energy,1000);
  const energy2=num(spawn2?.store?.energy??spawn2?.energy,1000);
  const hits1=num(spawn1?.hits,5_000_000);
  const hits2=num(spawn2?.hits,5_000_000);
  const sameSpawn=Boolean(spawnA&&spawnB&&spawnA===spawnB);
  const sameController=Boolean(ctrlA&&ctrlB&&ctrlA===ctrlB);
  return {status:'TWO_ROOM_OBJECT_GETS_OBSERVED',
    ownSpawnObservedBoth:a.verifiedOwnSpawn&&b.verifiedOwnSpawn,
    ownControllerObservedBoth:a.verifiedOwnController&&b.verifiedOwnController,
    sameSpawnIdVerified:sameSpawn,
    sameControllerIdVerified:sameController,
    controllerDowngradeTicksFirst:sameController?ticks1:null,
    controllerDowngradeTicksSecond:sameController?ticks2:null,
    controllerDowngradeTicksDelta:sameController?change(ticks1,ticks2):null,
    spawnEnergyFirst:sameSpawn?energy1:null,
    spawnEnergySecond:sameSpawn?energy2:null,
    spawnEnergyDelta:sameSpawn?change(energy1,energy2):null,
    spawnHitsFirst:sameSpawn?hits1:null,
    spawnHitsSecond:sameSpawn?hits2:null,
    spawnHitsDelta:sameSpawn?change(hits1,hits2):null,
    gameTickAlignedWithRoomObjects:false,
    liveOperationalSpawnVerified:false};
}

// Memory is a third, independently timed GET source. A retained game-tick
// advance demonstrates a newer journal record, not that Game.spawns is alive
// nor that the room-objects and memory snapshots are from the same tick.
const TICK_LIMIT=2_000_000_000;
const validTick=n=>Number.isSafeInteger(n)&&n>=0&&n<=TICK_LIMIT;
export function summarizeWorldRetainedMemory(reply) {
  const unknown={status:'UNVERIFIED',latestStatusSnapshotTick:null,
    latestJournalEventTick:null,latestRetainedTick:null,
    storedDeploymentIdKnown:false};
  const bot=parseBotMemory(reply);
  if(!bot)return unknown;
  const journal=bot.telemetryJournal;
  const snapshots=journal?.snapshots,events=journal?.events;
  if(!Array.isArray(snapshots)||snapshots.length>512||
     !Array.isArray(events)||events.length>1500)
    return unknown;
  const valid=(rows,code)=>{
    const matches=rows.filter(row=>row?.c===code);
    if(matches.some(row=>!validTick(row?.t)))return null;
    return matches.length?Math.max(...matches.map(row=>row.t)):null;
  };
  const latestSnapshot=valid(snapshots,'STATUS_SNAPSHOT');
  const eventTicks=events.map(row=>row?.t);
  if(eventTicks.some(t=>!validTick(t)))return unknown;
  const latestEvent=eventTicks.length?Math.max(...eventTicks):null;
  // Export only allowlisted event code counts for a bounded near-latest
  // window; all event payloads, names and IDs remain private.
  const recent=latestEvent===null?[]:events.filter(row=>
    validTick(row?.t) && latestEvent-row.t<=25);
  const allowedEventCodes=new Set([
    'BOT_HEARTBEAT','DEPLOYMENT_MARKER','VERSION_CHANGE',
    'TOWER_ENGAGE','TOWER_ATTACK_RC','SPAWN_OK','SPAWN_RC',
    'SPAWN_BUSY','STATUS_SNAPSHOT','ROOM_HEALTH','HAULER_TRANSFER',
    'R1_OWNED_SPAWN_REBUILD_SITE_INTENT',
    'R1_OWNED_SPAWN_REBUILD_CONFIRMED',
    'R2_SPAWNLESS_WORKER_DISPATCH'
  ]);
  const types=Object.create(null);
  for(const row of recent){
    const code=typeof row.c==='string'&&allowedEventCodes.has(row.c)
      ?row.c:'OTHER_OR_UNVERIFIED';
    types[code]=(types[code]||0)+1;
  }
  return {
    status:'RETAINED_MEMORY_JOURNAL_OBSERVED',
    recentEventWindowTicks:25,
    recentRetainedEventCount:recent.length,
    recentRetainedEventTypes:types,
    // A matching 100-tick STATUS_SNAPSHOT and BOT_HEARTBEAT are produced
    // by the same game loop at the same Game.time, unlike API room GETs.
    // Health SPAWN_MISSING is diagnostic evidence, not a permission to reset.
    inGameSameTickHomeSnapshot:(()=>{
      const heartbeats=events.filter(row=>row?.c==='BOT_HEARTBEAT'&&
        validTick(row.t));
      if(!heartbeats.length)return null;
      const beat=heartbeats.reduce((a,b)=>a.t>b.t?a:b);
      const rows=snapshots.filter(row=>row?.c==='STATUS_SNAPSHOT'&&
        row?.t===beat.t && row.x &&
        typeof row.x==='object' && !Array.isArray(row.x));
      if(rows.length!==1)return null;
      const home=rows[0].x.rooms?.W37S79;
      if(!home||typeof home!=='object'||Array.isArray(home))return null;
      const reasons=home.health?.reasons;
      const reasonsVerified=Array.isArray(reasons)&&reasons.length<=20 &&
        reasons.every(v=>typeof v==='string'&&
          /^[A-Z][A-Z0-9_]{0,55}$/.test(v));
      const count=value=>Number.isSafeInteger(value)&&
        value>=0&&value<=5000?value:null;
      const status=typeof home.health?.status==='string'&&
        ['HEALTHY','WATCH','DEGRADED','CRITICAL']
        .includes(home.health.status)?home.health.status:null;
      return {
        tick:beat.t,room:'W37S79',
        healthStatus:status,
        spawnMissingReported:reasonsVerified?
          reasons.includes('SPAWN_MISSING'):null,
        energyAvailable:count(home.energyAvailable),
        energyCapacity:count(home.energyCapacity),
        constructionSiteCount:count(home.constructionSites),
        gameTotalCreeps:count(rows[0].x.totalCreeps),
        gameSpawnObjectDirectlyVerified:false,
        sameGameTickAsRetainedHeartbeat:true,
        originalGameTimeCurrentlyLiveVerified:false
      };
    })(),
    latestRetainedHeartbeat:(()=>{
      const heartbeats=events.filter(row=>row?.c==='BOT_HEARTBEAT'&&
        validTick(row?.t)&&row.x&&typeof row.x==='object'&&
        !Array.isArray(row.x));
      if(!heartbeats.length)return null;
      const row=heartbeats.reduce((best,row)=>!best||row.t>best.t?row:best,null);
      // Both roomCount/creepCount are sampled in the bot's own Game loop,
      // unlike /room-objects or /world-status GETs (different clocks).
      const count=value=>Number.isSafeInteger(value)&&
        value>=0&&value<=1000?value:null;
      const cpu=typeof row.x.cpu==='number'&&
        Number.isFinite(row.x.cpu)&&row.x.cpu>=0&&row.x.cpu<=1000
        ?Math.round(row.x.cpu*1000)/1000:null;
      return {tick:row.t,roomCount:count(row.x.rooms),
        creepCount:count(row.x.creeps),cpuUsed:cpu,
        bucket:count(row.x.bucket)??(
          Number.isSafeInteger(row.x.bucket)&&row.x.bucket<=10000&&
          row.x.bucket>1000?row.x.bucket:null),
        source:'RETAINED_BOT_HEARTBEAT',
        // Event could be historical; freshness checked against server clock
        // below, and it cannot show working spawns without room state.
        sameServerResponseTickVerified:false};
    })(),
    latestStatusSnapshotTick:latestSnapshot,
    latestJournalEventTick:latestEvent,
    latestRetainedTick:latestSnapshot===null?latestEvent:
      latestEvent===null?latestSnapshot:Math.max(latestSnapshot,latestEvent),
    storedDeploymentIdKnown:typeof bot.deploymentId==='string'&&
      bot.deploymentId.length>0
  };
}
export function compareWorldRetainedMemoryPairs(first,second,clockBefore,clockAfter) {
  const a=summarizeWorldRetainedMemory(first);
  const b=summarizeWorldRetainedMemory(second);
  const valid=a.status==='RETAINED_MEMORY_JOURNAL_OBSERVED'&&
    b.status==='RETAINED_MEMORY_JOURNAL_OBSERVED';
  const start=a.latestRetainedTick,end=b.latestRetainedTick;
  const delta=valid&&start!==null&&end!==null&&end>=start?
    end-start:null;
  const lagStart=validTick(clockBefore)&&validTick(start)&&
    clockBefore>=start?clockBefore-start:null;
  const lagEnd=validTick(clockAfter)&&validTick(end)&&
    clockAfter>=end?clockAfter-end:null;
  return {
    status:valid?'TWO_RETAINED_MEMORY_GETS_OBSERVED':'UNVERIFIED',
    firstSnapshotTick:a.latestStatusSnapshotTick,
    secondSnapshotTick:b.latestStatusSnapshotTick,
    firstRetainedJournalTick:start,
    secondRetainedJournalTick:end,
    retainedJournalTickDelta:delta,
    retainedJournalAdvanced:delta===null?null:delta>0,
    latestRetainedEventCount:b.status==='RETAINED_MEMORY_JOURNAL_OBSERVED'?
      b.recentRetainedEventCount:null,
    latestRetainedEventTypes:b.status==='RETAINED_MEMORY_JOURNAL_OBSERVED'?
      b.recentRetainedEventTypes:null,
    latestBotHeartbeat:b.status==='RETAINED_MEMORY_JOURNAL_OBSERVED'?
      b.latestRetainedHeartbeat:null,
    latestAlignedInGameHomeSnapshot:b.status==='RETAINED_MEMORY_JOURNAL_OBSERVED'?
      b.inGameSameTickHomeSnapshot:null,
    latestHeartbeatAgeFromServerClock:b.latestRetainedHeartbeat &&
      validTick(clockAfter)&&clockAfter>=b.latestRetainedHeartbeat.tick
      ?clockAfter-b.latestRetainedHeartbeat.tick:null,
    // A recent heartbeat evidences the bot main-loop's telemetry path;
    // it does NOT establish a usable StructureSpawn or normal account.
    executableBotHeartbeatRecentlyObserved:b.latestRetainedHeartbeat&&
      validTick(clockAfter)&&clockAfter>=b.latestRetainedHeartbeat.tick
      ?clockAfter-b.latestRetainedHeartbeat.tick<=25:null,
    approximateRetainedLagAtFirstGet:lagStart,
    approximateRetainedLagAtSecondGet:lagEnd,
    serverClockComparisonVerified:validTick(clockBefore)&&
      validTick(clockAfter)&&clockAfter>=clockBefore,
    getResponsesSameServerTickVerified:false,
    gameCodeExecutingNowVerified:false,
    ownSpawnOperationalVerified:false
  };
}

export async function inspectWorldFootholds(api,options={}) {
  if(!api||typeof api.authMe!=='function'||
     typeof api.userWorldStatus!=='function'||
     typeof api.userRooms!=='function'||
     typeof api.gameRoomObjects!=='function')throw Error('READ_API_UNVERIFIED');
  const [me,before]=await Promise.all([api.authMe(),api.userWorldStatus()]);
  const id=me?._id??me?.id;
  if(typeof id!=='string'||!id||me?.ok===false)
    throw Error('ACCOUNT_ID_UNVERIFIED');
  let listing,fetchFailed=false;
  try{listing=await api.userRooms(id);}
  catch{fetchFailed=true;listing=null;}
  const rooms=summarizeUserRoomListing(listing);
  let time1=null,time2=null,mem1=null,mem2=null;
  try{time1=numericGameTick(await api._request('GET',
    '/api/game/time',{shard:'shard0'}));}catch{/* current tick unknown */}
  try{mem1=await api.userMemory('bot','shard0');}
  catch{/* missing bot Memory cannot prove absence of code execution */}
  const observed=[],initialObjects=[];
  for(const candidate of rooms.returnedRooms){
    let reply=null;
    try{reply=await api.gameRoomObjects(candidate.room,candidate.shard);}
    catch{/* Failed GET => unverified room, never no owned structure. */}
    observed.push(summarizeCandidateRoom(reply,id,candidate));
    initialObjects.push(reply);
  }
  const delay=options?.observeDelayMs===0?0:15000;
  if(delay)await pause(delay);
  const comparison=[];
  for(let i=0;i<rooms.returnedRooms.length;i++){
    const candidate=rooms.returnedRooms[i];
    let later=null;
    try{later=await api.gameRoomObjects(candidate.room,candidate.shard);}
    catch{/* no equivalence proof */}
    comparison.push({...candidate,
      ...compareWorldRoomGetPairs(initialObjects[i],later,id,candidate)});
  }
  try{mem2=await api.userMemory('bot','shard0');}
  catch{/* missing bot Memory cannot prove absence of code execution */}
  try{time2=numericGameTick(await api._request('GET',
    '/api/game/time',{shard:'shard0'}));}catch{/* tick unknown */}
  const after=await api.userWorldStatus();
  const statusBefore=typeof before?.status==='string'?before.status:null;
  const statusAfter=typeof after?.status==='string'?after.status:null;
  const accountStatusStable=statusBefore!==null&&
    statusBefore===statusAfter&&before?.ok!==false&&after?.ok!==false;
  const allRoomsChecked=rooms.listingComplete &&
    observed.every(x=>x.status==='ROOM_OBJECTS_OBSERVED');
  const roomsWithController=observed.filter(x=>x.verifiedOwnController).length;
  const roomsWithSpawn=observed.filter(x=>x.verifiedOwnSpawn).length;
  return {
    status:accountStatusStable&&allRoomsChecked?
      'READONLY_LISTING_AND_ROOM_OBJECTS_VERIFIED':'UNVERIFIED',
    worldStatusBefore:statusBefore,worldStatusAfter:statusAfter,
    accountStatusStable,
    userRoomsStatus:rooms.status,
    userRoomsReason:fetchFailed?'USER_ROOMS_GET_FAILED':rooms.reason,
    // This verifies the room listing shape, NOT the operational World status.
    worldAccountOperational:false,
    // Only schema metadata; no raw data or even room IDs.
    userRoomsResponseShape:summarizeRoomListingResponseShape(listing),
    userRoomCount:rooms.listingComplete?rooms.returnedRooms.length:null,
    recognizedShardRoomCount:rooms.returnedRooms.length,
    allListedRoomsChecked:allRoomsChecked,
    roomsWithOwnController:allRoomsChecked?roomsWithController:null,
    roomsWithOwnSpawn:allRoomsChecked?roomsWithSpawn:null,
    // A zero-room listing cannot rule out stranded creeps / unavailable
    // shards, and a historical spawn is NOT evidence of an operable colony.
    operationalFootholdVerified:false,
    recoveryWithoutRespawnVerified:false,
    noRecoverableFootholdVerified:false,
    currentGameTickVerified:false,
    sampledRooms:observed,
    pairedRoomObjectObservations:comparison,
    serverGameTickBefore:time1,
    serverGameTickAfter:time2,
    serverGameTickAdvanced:time1!==null&&time2!==null?
      time2>time1:null,
    gameTimeAndRoomSnapshotsSameTickVerified:false,
    retainedBotMemoryProgress:compareWorldRetainedMemoryPairs(
      mem1,mem2,time1,time2),
    mode:'GET_ONLY',apiMutationsAttempted:0,
    respawnAuthorized:false,placementAuthorized:false,
    activationAuthorized:false,deployAuthorized:false
  };
}

async function main(){
  if(!process.env.RUNNER_TEMP)throw Error('RUNNER_TEMP_REQUIRED');
  const config=path.join(process.env.RUNNER_TEMP,
    'world-o22-readonly-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),
    {mode:0o600,flag:'wx'});
  try {
    const api=await ScreepsHttpClient.fromConfig('world',{file:config,
      shard:'shard0'});
    const result=await inspectWorldFootholds(api);
    console.log('WORLD_FOOTHOLDS_GET_ONLY '+JSON.stringify(result));
    if(result.status==='UNVERIFIED')process.exitCode=2;
  } finally { fs.rmSync(config,{force:true}); }
}
if(process.argv[1]&&path.resolve(process.argv[1])===
   fileURLToPath(import.meta.url))main().catch(e=>{
     console.error('WORLD_FOOTHOLDS_GET_ONLY_FAILED',e.message);
     process.exitCode=1;
   });
