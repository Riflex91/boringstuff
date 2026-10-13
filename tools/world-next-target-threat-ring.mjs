import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_NEXT_TARGET_CANDIDATE as target } from './world-next-target-candidate.mjs';
import { inspectNextTarget } from './world-next-target-preflight.mjs';
import { summarizeRoom } from './spawn-planner-core.mjs';
import { normalizeRoomStatusResponse } from './spawn-safety.mjs';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';

export function candidateRingRooms(room=target.room) {
  const match=/^([WE])(\d+)([NS])(\d+)$/.exec(room);
  if(!match)throw new Error('INVALID_TARGET_ROOM');
  const [,ew,wx,ns,ny]=match;
  const x=Number(wx),y=Number(ny);
  const rooms=[];
  for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){
    if(!dx&&!dy)continue;
    if(x+dx<0||y+dy<0)throw new Error('RING_CROSSES_QUADRANT');
    rooms.push({room:ew+(x+dx)+ns+(y+dy),distance:Math.max(Math.abs(dx),Math.abs(dy))});
  }
  if(rooms.length!==24||new Set(rooms.map(x=>x.room)).size!==24)
    throw new Error('INVALID_RING_COVERAGE');
  return rooms;
}
export async function inspectCandidateRing(api) {
  if(api?.defaultShard!==target.shard)throw new Error('EXACT_SHARD_REQUIRED');
  const identity=await api.authMe();
  const userId=identity?._id||identity?.id;
  if(!userId)throw new Error('AUTH_REQUIRED');
  const site=await inspectNextTarget(api);
  const rooms=candidateRingRooms();
  const observations=[];
  for(let offset=0;offset<rooms.length;offset+=4){
    const batch=await Promise.all(rooms.slice(offset,offset+4).map(async item=>{
      try{
        const [rawStatus,rawObjects]=await Promise.all([
          api.gameRoomStatus(item.room,target.shard),
          api.gameRoomObjects(item.room,target.shard)
        ]);
        if(rawStatus?.ok===false||rawObjects?.ok===false||
          !Array.isArray(rawObjects?.objects))throw new Error('INCOMPLETE');
        const status=normalizeRoomStatusResponse(rawStatus);
        if(!status)throw new Error('NO_STATUS');
        const summary=summarizeRoom({roomName:item.room,objects:rawObjects.objects,
          users:rawObjects.users||{},myUserId:userId,valid:true,roomStatus:status});
        return {...item,verified:true,roomStatus:status,
          foreignOwner:Boolean(summary.ownerId)&&String(summary.ownerId)!==String(userId),
          foreignReservation:Boolean(summary.reservationId)&&String(summary.reservationId)!==String(userId),
          controllerLevel:Number.isInteger(summary.controller?.level)?summary.controller.level:null};
      }catch{return {...item,verified:false,roomStatus:'UNVERIFIED',
        foreignOwner:null,foreignReservation:null,controllerLevel:null};}
    }));
    observations.push(...batch);
  }
  const gaps=observations.filter(x=>!x.verified).map(x=>x.room);
  const hostile=observations.filter(x=>x.foreignOwner||x.foreignReservation);
  const rcl8=observations.filter(x=>x.foreignOwner&&x.controllerLevel>=8);
  return {mode:'GET_ONLY',target:{shard:target.shard,room:target.room,x:target.x,y:target.y},
    siteChecksPass:site.siteChecksPass,siteFailures:site.failures,
    requestedRooms:24,verifiedRooms:24-gaps.length,unverifiedRooms:gaps,
    coverageComplete:gaps.length===0,foreignControlledRooms:hostile.length,
    nearbyRcl8ForeignOwned:rcl8.map(x=>x.room),
    risk:gaps.length?'INCOMPLETE_EVIDENCE':rcl8.length?'NEARBY_RCL8':
      hostile.length?'FOREIGN_CONTROL':'NO_FOREIGN_CONTROL_IN_RING',
    observations,placementAuthorized:false,deploymentAuthorized:false,
    placementAttempted:false,deploymentAttempted:false};
}
async function main(){
  if(!process.env.RUNNER_TEMP)throw new Error('RUNNER_TEMP_REQUIRED');
  const credential=path.join(process.env.RUNNER_TEMP,'world-w37s79-ring-'+process.pid+'.json');
  fs.writeFileSync(credential,JSON.stringify(buildWorldConfig(process.env)),{mode:0o600,flag:'wx'});
  try{
    const api=await ScreepsHttpClient.fromConfig('world',{file:credential,shard:target.shard});
    const report=await inspectCandidateRing(api);
    const dir=process.env.WORLD_NEXT_RING_OUTPUT_DIR||process.env.RUNNER_TEMP;
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'W37S79-ring.json'),JSON.stringify(report,null,2)+'\n');
    console.log('WORLD_W37S79_RING_GET_ONLY '+JSON.stringify(report));
    if(!report.siteChecksPass||!report.coverageComplete)process.exitCode=2;
  }finally{fs.rmSync(credential,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('WORLD_W37S79_RING_FAILED',e.message);process.exitCode=1;});
