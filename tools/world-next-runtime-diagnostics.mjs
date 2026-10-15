import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {WORLD_NEXT_TARGET_CANDIDATE as target} from './world-next-target-candidate.mjs';
import {STAGING_BRANCH} from './world-next-staged-readiness.mjs';
export function assessWorldRuntime({me,branches,status,room,memory}){
  const failures=[],warnings=[];
  const id=me?._id||me?.id;
  if(!id)failures.push('AUTH_UNVERIFIED');
  const list=Array.isArray(branches?.list)?branches.list:[];
  const active=list.filter(b=>b?.activeWorld===true);
  if(active.length!==1||active[0]?.branch!==STAGING_BRANCH)failures.push('EXPECTED_BRANCH_NOT_ACTIVE');
  if(status?.status==='empty'||typeof status?.status!=='string')failures.push('WORLD_STATUS_INVALID');
  if(!Array.isArray(room?.objects))failures.push('ROOM_OBJECTS_UNAVAILABLE');
  const objects=Array.isArray(room?.objects)?room.objects:[];
  const spawn=objects.find(o=>(o?.type==='spawn'||o?.structureType==='spawn')&&
    o.x===target.x&&o.y===target.y&&o.name===target.spawnName&&
    String(o.user||'')===String(id));
  if(!spawn)failures.push('OWNED_PINNED_SPAWN_MISSING');
  const creeps=objects.filter(o=>o?.type==='creep'&&String(o.user||'')===String(id));
  const controller=objects.find(o=>o?.type==='controller');
  if(!controller)warnings.push('CONTROLLER_NOT_OBSERVED');
  if(!creeps.length)warnings.push('NO_OWNED_CREEPS_OBSERVED');
  const energy=Number(spawn?.energy);
  const capacity=Number(spawn?.energyCapacity);
  const result={ok:failures.length===0,failures,warnings,mode:'GET_ONLY',
    target:{shard:target.shard,room:target.room,x:target.x,y:target.y},
    activeBranch:active.length===1?active[0].branch:null,
    worldStatus:status?.status??null,spawnVerified:Boolean(spawn),
    spawnSpawning:spawn?.spawning??null,
    spawnEnergy:Number.isFinite(energy)?energy:null,
    spawnEnergyCapacity:Number.isFinite(capacity)?capacity:null,
    ownedCreepCount:creeps.length,
    ownedCreepRoles:creeps.reduce((acc,c)=>{const role=c?.memory?.role;
      if(typeof role==='string'&&role.length<50)acc[role]=(acc[role]||0)+1;
      return acc;},{}),
    controllerLevel:Number.isInteger(controller?.level)?controller.level:null,
    controllerProgress:Number.isFinite(Number(controller?.progress))?Number(controller.progress):null,
    memoryAvailable:memory?.ok!==false&&memory!==null,
    placementAttempted:false,activationAttempted:false};
  return result;
}
export async function inspectWorldRuntime(api){
  if(api?.defaultShard!==target.shard)throw new Error('EXACT_SHARD_REQUIRED');
  // The 10-minute diagnostic job must never be cancelled mid-read by
  // a slow World endpoint: each GET has an absolute 15-second deadline.
  // No POST/upload/activation retries or state-changing actions.
  const bounded={timeoutMs:10000,totalTimeoutMs:15000,
    max429Retries:0,max5xxRetries:0};
  const [me,branches,status,room,memory]=await Promise.all([
    api.authMe(bounded),api.userBranches(bounded),
    api.userWorldStatus(bounded),
    api.gameRoomObjects(target.room,target.shard,bounded),
    api.userMemory('',target.shard,bounded).catch(()=>null)]);
  return assessWorldRuntime({me,branches,status,room,memory});
}
async function main(){
  if(!process.env.RUNNER_TEMP)throw new Error('RUNNER_TEMP_REQUIRED');
  const config=path.join(process.env.RUNNER_TEMP,'w37s79-runtime-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),{mode:0o600,flag:'wx'});
  try{
    const api=await ScreepsHttpClient.fromConfig('world',{file:config,shard:target.shard});
    const result=await inspectWorldRuntime(api);
    console.log('WORLD_W37S79_RUNTIME '+JSON.stringify(result));
    if(!result.ok)process.exitCode=2;
  }finally{fs.rmSync(config,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('WORLD_W37S79_RUNTIME_FAILED',e.message);process.exitCode=1;});
