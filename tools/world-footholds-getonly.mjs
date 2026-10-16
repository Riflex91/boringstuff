import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';

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
    for(const shard of shards)if(!add(source[shard],shard))return unknown;
    // Some servers include extra sections (e.g. sim). Do not silently
    // discard them and claim complete multi-shard account coverage.
    if(shards.length!==keys.length)return {
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
  return {status:'TWO_ROOM_OBJECT_GETS_OBSERVED',
    ownSpawnObservedBoth:a.verifiedOwnSpawn&&b.verifiedOwnSpawn,
    ownControllerObservedBoth:a.verifiedOwnController&&b.verifiedOwnController,
    sameSpawnIdVerified:Boolean(spawnA&&spawnB&&spawnA===spawnB),
    sameControllerIdVerified:Boolean(ctrlA&&ctrlB&&ctrlA===ctrlB),
    gameTickAlignedWithRoomObjects:false,
    liveOperationalSpawnVerified:false};
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
  let time1=null,time2=null;
  try{time1=numericGameTick(await api._request('GET',
    '/api/game/time',{shard:'shard0'}));}catch{/* current tick unknown */}
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
