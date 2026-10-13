import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WORLD_NEXT_TARGET_CANDIDATE as target} from './world-next-target-candidate.mjs';
import {inspectCandidateRing} from './world-next-target-threat-ring.mjs';
import {verifyInitialSpawnTarget} from './spawn-safety.mjs';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {inspectW37S79ExactCode} from './world-next-exact-code-gate.mjs';

export function assessNextSpawnReadiness(ring,check,exactCode) {
  const failures=[];
  if(ring?.target?.room!==target.room||ring?.target?.shard!==target.shard||
     ring?.target?.x!==target.x||ring?.target?.y!==target.y||
     ring?.siteChecksPass!==true)failures.push('TARGET_SITE_NOT_VERIFIED');
  if(ring?.mode!=='GET_ONLY'||ring?.requestedRooms!==24||
     ring?.verifiedRooms!==24||ring?.coverageComplete!==true||
     !Array.isArray(ring?.observations)||ring.observations.length!==24||
     ring.observations.some(o=>o?.verified!==true))
    failures.push('THREAT_RING_INCOMPLETE');
  if(ring?.foreignControlledRooms!==0||ring?.risk!=='NO_FOREIGN_CONTROL_IN_RING'||
     !Array.isArray(ring?.nearbyRcl8ForeignOwned)||
     ring.nearbyRcl8ForeignOwned.length!==0)
    failures.push('FOREIGN_CONTROL_OR_UNVERIFIED_RISK');
  if(check?.ok!==true||check?.room!==target.room||check?.x!==target.x||
     check?.y!==target.y||check?.name!==target.spawnName||
     check?.branch!==target.branch||check?.worldStatus!=='empty'||
     check?.roomStatus!=='normal'||check?.tile?.ok!==true||
     check?.tile?.terrain!=='plain')
    failures.push('FINAL_EXACT_SPAWN_CHECK_FAILED');
  for(const name of ['world-status-empty','room-status-normal','controller-exists',
    'controller-unowned','controller-unreserved','spawn-tile-free-and-buildable',
    'spawn-name-available','world-branch-present','world-code-ready']) {
    if(!Array.isArray(check?.checks)||!check.checks.some(c=>
      c?.name===name&&c.pass===true&&c.severity==='error'))
      failures.push('MISSING_CHECK_'+name.toUpperCase().replaceAll('-','_'));
  }
  if(check?.evidence?.placementEndpointCalled!==false)
    failures.push('PRECHECK_MUST_NOT_PLACE_SPAWN');
  if(exactCode?.ok!==true||exactCode?.exactInactiveCode!==true)
    failures.push('EXACT_INACTIVE_WORLD_CODE_NOT_VERIFIED');
  return {ok:failures.length===0,failures,mode:'GET_ONLY',
    target:{shard:target.shard,room:target.room,x:target.x,y:target.y},
    placementAuthorized:false,activationAuthorized:false,
    deploymentAuthorized:false,placementAttempted:false};
}
export async function inspectNextSpawnReadiness(api) {
  if(api?.defaultShard!==target.shard)throw new Error('EXACT_SHARD_REQUIRED');
  const me=await api.authMe();
  const id=me?._id||me?.id;
  if(!id)throw new Error('AUTH_REQUIRED');
  const ring=await inspectCandidateRing(api);
  const check=await verifyInitialSpawnTarget({api,room:target.room,x:target.x,
    y:target.y,name:target.spawnName,myUserId:id,branch:target.branch,
    requireNormalStatus:true,requireUniqueName:true,
    requireBranchPresent:true,requireWorldCodeReady:true});
  const exactCode=await inspectW37S79ExactCode(api);
  const gate=assessNextSpawnReadiness(ring,check,exactCode);
  return {...gate,ringRisk:ring.risk,ringVerifiedRooms:ring.verifiedRooms,
    finalCheckPassed:check.ok===true,exactInactiveCode:exactCode.ok===true};
}
async function main() {
  if(!process.env.RUNNER_TEMP)throw new Error('RUNNER_TEMP_REQUIRED');
  const file=path.join(process.env.RUNNER_TEMP,'w37s79-readiness-'+process.pid+'.json');
  fs.writeFileSync(file,JSON.stringify(buildWorldConfig(process.env)),{mode:0o600,flag:'wx'});
  try{
    const api=await ScreepsHttpClient.fromConfig('world',{file,shard:target.shard});
    const result=await inspectNextSpawnReadiness(api);
    const dir=process.env.WORLD_NEXT_READINESS_OUTPUT_DIR||process.env.RUNNER_TEMP;
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'W37S79-readiness.json'),JSON.stringify(result,null,2)+'\n');
    console.log('WORLD_W37S79_SPAWN_READINESS '+JSON.stringify(result));
    if(!result.ok)process.exitCode=2;
  }finally{fs.rmSync(file,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('WORLD_W37S79_READINESS_FAILED',e.message);process.exitCode=1;});
