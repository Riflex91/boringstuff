import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {WORLD_TARGET} from './world-target-selection.mjs';
import {inspectThreatRing,threatRingRooms} from './world-threat-ring.mjs';

const EXPECTED={
  shard:'shard0',room:'W37N11',x:12,y:13,spawnName:'Spawn1',
  knownRcl8:'W35N11'
};
export function assessOperationalRivalRing({
  account,branches,roomObjects,ring
}={}) {
  const failures=[],alerts=[],warnings=[],missing=[];
  const id=account?._id||account?.id;
  if(!id||account?.ok===false)failures.push('ACCOUNT_UNVERIFIED');
  const list=Array.isArray(branches?.list)?branches.list:[];
  const active=list.filter(b=>b?.activeWorld===true);
  if(active.length!==1||active[0]?.branch!=='chatgpt')
    failures.push('WORLD_BOT_BRANCH_NOT_ACTIVE');
  const obj=Array.isArray(roomObjects?.objects)?roomObjects.objects:null;
  const spawn=Boolean(obj?.some(o=>
    (o?.type==='spawn'||o?.structureType==='spawn')&&
    o.name===EXPECTED.spawnName&&o.x===EXPECTED.x&&o.y===EXPECTED.y&&
    String(o.user||'')===String(id)));
  if(!spawn)failures.push('EXACT_OWNED_WORLD_SPAWN_MISSING');
  if(!ring||ring.mode!=='GET_ONLY'||ring.target?.shard!==EXPECTED.shard||
     ring.target?.room!==EXPECTED.room||ring.requestedRooms!==24||
     !Array.isArray(ring.observations)||ring.observations.length!==24||
     !Array.isArray(ring.unverifiedRooms))
    missing.push('UNTRUSTED_RING_PROVENANCE');
  else if(ring.coverageComplete!==true||ring.verifiedRooms!==24||
     ring.unverifiedRooms.length>0||ring.observations.some(o=>o?.verified!==true))
    missing.push('RIVAL_RING_GET_COVERAGE_INCOMPLETE');
  const observations=Array.isArray(ring?.observations)?ring.observations:[];
  const expectedNeighbors=new Map(threatRingRooms(WORLD_TARGET)
    .map(({room,distance})=>[room,distance]));
  const uniqueRooms=new Set(observations.map(o=>o?.room));
  if(uniqueRooms.size!==24||observations.some(o=>
    expectedNeighbors.get(o?.room)!==o?.distance))
    missing.push('RIVAL_RING_ROOMS_OR_DISTANCES_INVALID');
  const owned=observations.filter(x=>x?.verified&&x.foreignOwner===true);
  const reserved=observations.filter(x=>x?.verified&&x.foreignReservation===true);
  if(ring?.foreignOwnedRooms!==owned.length||
     ring?.foreignReservedRooms!==reserved.length)
    missing.push('RIVAL_RING_AGGREGATE_COUNTS_INCONSISTENT');
  const unknown=observations.filter(x=>x?.verified&&
    (x.foreignOwner==null||x.foreignReservation==null));
  if(unknown.length)missing.push('UNKNOWN_RIVAL_CONTROL');
  const expected=owned.filter(x=>x.room===EXPECTED.knownRcl8&&
    x.controllerLevel===8);
  if(expected.length!==1)
    warnings.push('KNOWN_RCL8_RIVAL_NOT_IDENTICAL_TO_BASELINE');
  const otherOwned=owned.filter(x=>x.room!==EXPECTED.knownRcl8);
  const imminent=[...otherOwned,...reserved].filter(x=>x.distance===1);
  if(imminent.length)alerts.push('FOREIGN_CONTROL_IN_IMMEDIATE_NEIGHBOR_RING');
  if(otherOwned.length)alerts.push('ADDITIONAL_FOREIGN_OWNED_ROOM');
  if(reserved.length)warnings.push('FOREIGN_RESERVED_ROOMS_PRESENT');
  if(owned.some(x=>x.controllerLevel>=8))
    warnings.push('FOREIGN_RCL8_WITHIN_TWO_ROOMS');
  const state=failures.length?'FAIL':missing.length?'INCOMPLETE':
    alerts.length?'ALERT':warnings.length?'WATCH':'PASS';
  return {status:state,source:'AUTHENTICATED_WORLD_GET_ONLY',
    target:{shard:EXPECTED.shard,room:EXPECTED.room,x:EXPECTED.x,y:EXPECTED.y,
      spawnName:EXPECTED.spawnName},
    ownedSpawnVerified:spawn,ringCoverageComplete:missing.length===0,
    verifiedRooms:ring?.verifiedRooms??0,foreignOwnedRooms:owned.length,
    foreignReservedRooms:reserved.length,
    // Only room coordinates and impersonal threat type; no player IDs/names.
    foreignControl:[...owned.map(x=>({room:x.room,distance:x.distance,
      kind:'OWNED',rcl:x.controllerLevel})),
      ...reserved.map(x=>({room:x.room,distance:x.distance,
        kind:'RESERVED',rcl:x.controllerLevel}))].sort((a,b)=>
          a.distance-b.distance||a.room.localeCompare(b.room)),
    failures:[...new Set(failures)],
    missing:[...new Set(missing)],
    alerts:[...new Set(alerts)],
    warnings:[...new Set(warnings)],
    gameMutationsAttempted:false,
    worldCodeUploadAttempted:false,
    branchActivationAttempted:false};
}

export async function inspectOperationalRivalRisk(api) {
  if(api?.defaultShard!=='shard0')
    throw new Error('OPERATIONAL_RIVAL_WATCH_WRONG_SHARD');
  const [account,branches,roomObjects]=await Promise.all([
    api.authMe(),api.userBranches(),
    api.gameRoomObjects(EXPECTED.room,EXPECTED.shard)
  ]);
  const id=account?._id||account?.id;
  if(!id)throw new Error('OPERATIONAL_RIVAL_WATCH_UNAUTHENTICATED');
  const ring=await inspectThreatRing(api,id,WORLD_TARGET);
  return assessOperationalRivalRing({account,branches,roomObjects,ring});
}

async function main(){
  const temporary=process.env.RUNNER_TEMP;
  if(!temporary)throw new Error('RUNNER_TEMP_REQUIRED');
  const output=process.env.WORLD_OPERATIONAL_RIVAL_OUTPUT_DIR||
    path.join(os.tmpdir(),'world-operational-rival-watch');
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  const config=path.join(temporary,'world-operational-rival-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),
    {flag:'wx',mode:0o600});
  try {
    const api=await ScreepsHttpClient.fromConfig('world',{
      file:config,shard:EXPECTED.shard
    });
    const report=await inspectOperationalRivalRisk(api);
    fs.writeFileSync(path.join(output,'operational-rival-watch.json'),
      JSON.stringify({...report,observedAt:new Date().toISOString()},null,2)+'\n',
      {mode:0o600});
    console.log('WORLD_OPERATIONAL_RIVAL_WATCH '+JSON.stringify(report));
    // WATCH is a verified readable threat, not a clean site or a failure.
    if(!['PASS','WATCH'].includes(report.status))process.exitCode=2;
  } finally {
    fs.rmSync(config,{force:true});
  }
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
  main().catch(()=>{console.error('WORLD_OPERATIONAL_RIVAL_GET_ONLY_UNVERIFIED');
    process.exitCode=1;});
