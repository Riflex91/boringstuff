import { assertLegacyWorldMutationDisabled } from './o45-world-mutation-entrypoint-hold.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {WORLD_NEXT_TARGET_CANDIDATE as target} from './world-next-target-candidate.mjs';
import {inspectStagedReadiness} from './world-next-staged-readiness.mjs';
export const PLACEMENT_APPROVAL='PLACE_W37S79_37_26_ONLY';
export function assessPlacementApproval(approval,readiness){
  const failures=[];
  if(approval!==PLACEMENT_APPROVAL)failures.push('EXPLICIT_PLACEMENT_APPROVAL_REQUIRED');
  if(readiness?.ok!==true||readiness?.mode!=='GET_ONLY'||
     readiness?.target?.shard!==target.shard||
     readiness?.target?.room!==target.room||
     readiness?.target?.x!==target.x||readiness?.target?.y!==target.y||
     readiness?.stageBranch!=='chatgpt-w37s79-stage'||
     readiness?.activeBranch!=='chatgpt'||
     readiness?.exactInactiveCode!==true||
     readiness?.ringVerifiedRooms!==24||
     readiness?.ringRisk!=='NO_FOREIGN_CONTROL_IN_RING'||
     readiness?.finalCheckPassed!==true)
    failures.push('FRESH_READINESS_REQUIRED');
  return {ok:failures.length===0,failures};
}
export async function placeW37S79Only(api,id,approval,onPhase=()=>{}){
  // O49: imported World mutator remains quarantined even with an injected
  // duck-typed API that bypasses ScreepsHttpClient's HTTP firewall.
  assertLegacyWorldMutationDisabled('legacy-spawn-placement');
  if(api?.defaultShard!==target.shard||!id)throw new Error('EXACT_SHARD_AND_ID_REQUIRED');
  onPhase('FIRST_GET_ONLY_GATE');
  const first=await inspectStagedReadiness(api);
  if(!assessPlacementApproval(approval,first).ok)throw new Error('INITIAL_GATE_BLOCKED');
  onPhase('LAST_GET_ONLY_GATE');
  const last=await inspectStagedReadiness(api);
  if(!assessPlacementApproval(approval,last).ok)throw new Error('FINAL_GATE_BLOCKED');
  // Exactly one POST; never retry an ambiguous or rejected response.
  onPhase('SINGLE_PLACEMENT_POST');
  let raw;
  try{raw=await api.gamePlaceSpawn(target.room,target.x,target.y,target.spawnName,target.shard);}
  catch{throw new Error('PLACEMENT_RESULT_UNCERTAIN_NO_RETRY');}
  if(raw?.ok===false||raw?.error)throw new Error('PLACEMENT_REJECTED_NO_RETRY');
  onPhase('GET_ONLY_SPAWN_READBACK');
  const [objects,branches]=await Promise.all([
    api.gameRoomObjects(target.room,target.shard),api.userBranches()]);
  const spawn=Array.isArray(objects?.objects)&&objects.objects.some(o=>
    (o?.type==='spawn'||o?.structureType==='spawn')&&o.x===target.x&&o.y===target.y&&
    o.name===target.spawnName&&String(o.user||'')===String(id));
  const active=Array.isArray(branches?.list)?branches.list.filter(b=>b?.activeWorld===true):[];
  if(!spawn||active.length!==1||active[0]?.branch!=='chatgpt')
    throw new Error('PLACEMENT_READBACK_UNVERIFIED_NO_RETRY');
  return {status:'PASS',spawnVerified:true,target:{shard:target.shard,room:target.room,
    x:target.x,y:target.y,name:target.spawnName},activeBranch:'chatgpt',
    stagedBranch:'chatgpt-w37s79-stage',placementApiCalls:1,
    activationAttempted:false,deploymentAttempted:false};
}
async function main(){
  // O45: refuse World mutations even with old approval strings and secrets.
  // No credentials, config file or network call may precede this HOLD.
  assertLegacyWorldMutationDisabled('legacy-spawn-placement');
  if(!process.env.RUNNER_TEMP||process.env.WORLD_W37S79_PLACEMENT_APPROVAL!==PLACEMENT_APPROVAL)
    throw new Error('EXPLICIT_APPROVAL_REQUIRED');
  const config=path.join(process.env.RUNNER_TEMP,'w37s79-placement-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),{mode:0o600,flag:'wx'});
  try{
    const api=await ScreepsHttpClient.fromConfig('world',{file:config,shard:target.shard});
    const me=await api.authMe(),id=me?._id||me?.id;
    const result=await placeW37S79Only(api,id,process.env.WORLD_W37S79_PLACEMENT_APPROVAL,
      phase=>console.log('W37S79_PLACEMENT_PHASE '+phase));
    console.log('W37S79_PLACEMENT_SUCCESS '+JSON.stringify(result));
  }finally{fs.rmSync(config,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('W37S79_PLACEMENT_FAILED',e.message);process.exitCode=1;});
