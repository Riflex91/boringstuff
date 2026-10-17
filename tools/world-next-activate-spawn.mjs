import { assertLegacyWorldMutationDisabled } from './o45-world-mutation-entrypoint-hold.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {WORLD_NEXT_TARGET_CANDIDATE as target} from './world-next-target-candidate.mjs';
import {STAGING_BRANCH,assessStagedCode} from './world-next-staged-readiness.mjs';
export const ACTIVATION_APPROVAL='ACTIVATE_W37S79_VERIFIED_SPAWN_STAGE';
export function assessActivationState({approval,branches,objects,me,code,status,expected}){
  const failures=[];
  if(approval!==ACTIVATION_APPROVAL)failures.push('EXPLICIT_APPROVAL_REQUIRED');
  const id=me?._id||me?.id;
  if(!id)failures.push('AUTH_REQUIRED');
  const owned=Array.isArray(objects?.objects)&&objects.objects.some(o=>
    (o?.type==='spawn'||o?.structureType==='spawn')&&o.x===target.x&&o.y===target.y&&
    o.name===target.spawnName&&String(o.user||'')===String(id));
  if(!owned)failures.push('OWNED_EXACT_SPAWN_NOT_VERIFIED');
  const list=Array.isArray(branches?.list)?branches.list:[];
  const active=list.filter(b=>b?.activeWorld===true);
  const staged=list.filter(b=>b?.branch===STAGING_BRANCH);
  if(active.length!==1||active[0]?.branch!=='chatgpt')failures.push('ACTIVE_BRANCH_CHANGED');
  if(staged.length!==1||staged[0]?.activeWorld===true)failures.push('STAGING_NOT_INACTIVE');
  // Post-placement World must no longer be empty. Fail closed on unknown status.
  if(status?.status==='empty'||typeof status?.status!=='string')failures.push('WORLD_STATUS_NOT_POST_SPAWN');
  const exact=assessStagedCode(branches,{status:'empty'},code,expected);
  if(!exact.exactInactiveCode)failures.push('STAGED_CODE_NOT_EXACT');
  return {ok:failures.length===0,failures,ownedSpawnVerified:Boolean(owned),
    exactStagedCode:exact.exactInactiveCode};
}
export async function activateW37S79(api,approval,onPhase=()=>{}){
  if(api?.defaultShard!==target.shard)throw new Error('EXACT_SHARD_REQUIRED');
  const game=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','game');
  const expected=Object.fromEntries(fs.readdirSync(game).filter(n=>n.endsWith('.js')).sort().map(n=>
    [n.slice(0,-3),fs.readFileSync(path.join(game,n),'utf8')]));
  if(Object.keys(expected).length<8)throw new Error('INVALID_EXPECTED_MODULES');
  const inspect=async()=>{
    const [me,branches,objects,code,status]=await Promise.all([
      api.authMe(),api.userBranches(),api.gameRoomObjects(target.room,target.shard),
      api._request('GET','/api/user/code',{branch:STAGING_BRANCH}),api.userWorldStatus()]);
    return assessActivationState({approval,branches,objects,me,code,status,expected});
  };
  onPhase('INITIAL_GET_ONLY_GATE');
  if(!(await inspect()).ok)throw new Error('INITIAL_ACTIVATION_GATE_BLOCKED');
  onPhase('LAST_GET_ONLY_GATE');
  if(!(await inspect()).ok)throw new Error('LAST_ACTIVATION_GATE_BLOCKED');
  onPhase('SINGLE_ACTIVATION_POST');
  let raw;
  try{raw=await api.userSetActiveBranch(STAGING_BRANCH,'activeWorld');}
  catch{throw new Error('ACTIVATION_RESULT_UNCERTAIN_NO_RETRY');}
  if(raw?.ok===false||raw?.error)throw new Error('ACTIVATION_REJECTED_NO_RETRY');
  onPhase('GET_ONLY_ACTIVATION_READBACK');
  const [branches,objects,me]=await Promise.all([
    api.userBranches(),api.gameRoomObjects(target.room,target.shard),api.authMe()]);
  const active=Array.isArray(branches?.list)?branches.list.filter(b=>b?.activeWorld===true):[];
  const id=me?._id||me?.id;
  const owned=Array.isArray(objects?.objects)&&objects.objects.some(o=>
    (o?.type==='spawn'||o?.structureType==='spawn')&&o.x===target.x&&o.y===target.y&&
    o.name===target.spawnName&&String(o.user||'')===String(id));
  if(!owned||active.length!==1||active[0]?.branch!==STAGING_BRANCH)
    throw new Error('ACTIVATION_READBACK_UNVERIFIED_NO_RETRY');
  return {status:'PASS',branch:STAGING_BRANCH,spawnVerified:true,
    activationApiCalls:1,placementAttempted:false};
}
async function main(){
  // O45: refuse World mutations even with old approval strings and secrets.
  // No credentials, config file or network call may precede this HOLD.
  assertLegacyWorldMutationDisabled('legacy-spawn-activation');
  if(!process.env.RUNNER_TEMP||process.env.WORLD_W37S79_ACTIVATION_APPROVAL!==ACTIVATION_APPROVAL)
    throw new Error('EXPLICIT_APPROVAL_REQUIRED');
  const config=path.join(process.env.RUNNER_TEMP,'w37s79-activation-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),{mode:0o600,flag:'wx'});
  try{
    const api=await ScreepsHttpClient.fromConfig('world',{file:config,shard:target.shard});
    const result=await activateW37S79(api,process.env.WORLD_W37S79_ACTIVATION_APPROVAL,
      phase=>console.log('W37S79_ACTIVATION_PHASE '+phase));
    console.log('W37S79_ACTIVATION_SUCCESS '+JSON.stringify(result));
  }finally{fs.rmSync(config,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('W37S79_ACTIVATION_FAILED',e.message);process.exitCode=1;});
