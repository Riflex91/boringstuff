import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_NEXT_TARGET_CANDIDATE as candidate } from './world-next-target-candidate.mjs';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';
import { inspectWorld } from './world-readonly-preflight.mjs';
import { summarizeRoom } from './spawn-planner-core.mjs';
import { inspectSpawnTile,normalizeRoomStatusResponse } from './spawn-safety.mjs';

export async function inspectNextTarget(api) {
  if(api?.defaultShard!==candidate.shard) throw new Error('EXACT_SHARD_REQUIRED');
  const [account,me,status,objects,terrain]=await Promise.all([
    inspectWorld(api),api.authMe(),api.gameRoomStatus(candidate.room,candidate.shard),
    api.gameRoomObjects(candidate.room,candidate.shard),api.gameRoomTerrain(candidate.room,candidate.shard)
  ]);
  const id=me?._id||me?.id;
  if(!id||!Array.isArray(objects?.objects)||typeof terrain?.terrain?.[0]?.terrain!=='string')
    throw new Error('INCOMPLETE_WORLD_EVIDENCE');
  const roomStatus=normalizeRoomStatusResponse(status);
  const summary=summarizeRoom({roomName:candidate.room,objects:objects.objects,
    users:objects.users||{},myUserId:id,valid:true,roomStatus});
  const tile=inspectSpawnTile({encodedTerrain:terrain.terrain[0].terrain,
    objects:objects.objects,x:candidate.x,y:candidate.y});
  const failures=[];
  if(account.worldStatus!=='empty'||account.hasNoSpawn!==true)failures.push('ACCOUNT_NOT_EMPTY');
  if(roomStatus!=='normal')failures.push('ROOM_NOT_NORMAL');
  if(!summary.controller)failures.push('CONTROLLER_MISSING');
  if(summary.ownerId||summary.reservationId)failures.push('ROOM_CONTROLLED');
  if(summary.sourceCount!==2)failures.push('TWO_SOURCES_REQUIRED');
  if(!tile.ok)failures.push('SPAWN_TILE_BLOCKED');
  return {mode:'GET_ONLY',sourceScoutingRun:candidate.sourceScoutingRun,
    target:{shard:candidate.shard,room:candidate.room,x:candidate.x,y:candidate.y},
    siteChecksPass:failures.length===0,failures,worldStatus:account.worldStatus,
    roomStatus,sourceCount:summary.sourceCount,tile:{ok:tile.ok,terrain:tile.terrain,issues:tile.issues},
    threatRingVerified:false,placementAuthorized:false,deploymentAuthorized:false,
    placementAttempted:false,deploymentAttempted:false};
}
async function main(){
  if(!process.env.RUNNER_TEMP)throw new Error('RUNNER_TEMP_REQUIRED');
  const config=path.join(process.env.RUNNER_TEMP,'world-next-preflight-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),{mode:0o600,flag:'wx'});
  try {
    const api=await ScreepsHttpClient.fromConfig('world',{file:config,shard:candidate.shard});
    const result=await inspectNextTarget(api);
    const dir=process.env.WORLD_NEXT_PREFLIGHT_OUTPUT_DIR||process.env.RUNNER_TEMP;
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'W37S79-preflight.json'),JSON.stringify(result,null,2)+'\n');
    console.log('WORLD_NEXT_TARGET_GET_ONLY '+JSON.stringify(result));
    if(!result.siteChecksPass)process.exitCode=2;
  }finally{fs.rmSync(config,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('WORLD_NEXT_PREFLIGHT_FAILED',e.message);process.exitCode=1;});
