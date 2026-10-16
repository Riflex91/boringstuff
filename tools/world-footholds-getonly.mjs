import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
    if(keys.length>15||keys.some(k=>!SHARD.test(k)))return unknown;
    for(const shard of keys)if(!add(source[shard],shard))return unknown;
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

export async function inspectWorldFootholds(api) {
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
  const observed=[];
  for(const candidate of rooms.returnedRooms){
    let reply=null;
    try{reply=await api.gameRoomObjects(candidate.room,candidate.shard);}
    catch{/* Failed GET => unverified room, never no owned structure. */}
    observed.push(summarizeCandidateRoom(reply,id,candidate));
  }
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
