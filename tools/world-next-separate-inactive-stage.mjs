import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {verifyUploadedWorldModules} from './world-branch-bootstrap.mjs';
export const TARGET_BRANCH='chatgpt-w37s79-stage';
export function assessSeparateStage(branches,status,confirmation,expectPresent=false) {
  const list=Array.isArray(branches?.list)?branches.list:[];
  const active=list.filter(b=>b?.activeWorld===true);
  const target=list.filter(b=>b?.branch===TARGET_BRANCH);
  const failures=[];
  if(confirmation!=='STAGE_SEPARATE_INACTIVE_CODE')failures.push('EXPLICIT_APPROVAL_REQUIRED');
  if(status?.status!=='empty')failures.push('WORLD_NOT_EMPTY');
  if(active.length!==1||active[0]?.branch!=='chatgpt')failures.push('CHATGPT_MUST_REMAIN_SOLE_ACTIVE');
  if(target.length!==(expectPresent?1:0))failures.push('TARGET_BRANCH_UNEXPECTED_STATE');
  if(target.some(b=>b?.activeWorld===true))failures.push('TARGET_ACTIVE');
  return {ok:failures.length===0,failures};
}
export async function stageSeparateInactiveCode(api,modules,approval,onPhase=()=>{}) {
  if(api?.defaultShard!=='shard0')throw new Error('EXACT_SHARD_REQUIRED');
  if(!modules||Object.keys(modules).length<8||typeof modules.main!=='string'||
    typeof modules.config!=='string')throw new Error('INVALID_MODULES');
  onPhase('READ_WORLD');
  const [account,branches,status,backup]=await Promise.all([
    api.authMe(),api.userBranches(),api.userWorldStatus(),
    api._request('GET','/api/user/code',{branch:'chatgpt'})]);
  if(account?.ok===false||!(account?._id||account?.id)||!backup?.modules||
     !assessSeparateStage(branches,status,approval).ok)
    throw new Error('INITIAL_STAGE_GATE_BLOCKED');
  onPhase('RECHECK_BEFORE_CLONE');
  const [beforeBranches,beforeStatus]=await Promise.all([api.userBranches(),api.userWorldStatus()]);
  if(!assessSeparateStage(beforeBranches,beforeStatus,approval).ok)
    throw new Error('STATE_CHANGED_BEFORE_CLONE');
  onPhase('CLONE_ACTIVE_BRANCH_TO_NEW_INACTIVE_BRANCH');
  const clone=await api._request('POST','/api/user/clone-branch',{
    branch:'chatgpt',newName:TARGET_BRANCH,defaultModules:false});
  if(clone?.ok===false)throw new Error('CLONE_REJECTED');
  onPhase('VERIFY_INACTIVE_CLONE');
  const [clonedBranches,clonedStatus]=await Promise.all([api.userBranches(),api.userWorldStatus()]);
  if(!assessSeparateStage(clonedBranches,clonedStatus,approval,true).ok)
    throw new Error('CLONE_NOT_INACTIVE');
  onPhase('UPLOAD_TO_NEW_INACTIVE_BRANCH_ONLY');
  const uploaded=await api._request('POST','/api/user/code',{branch:TARGET_BRANCH,modules});
  if(uploaded?.ok===false)throw new Error('UPLOAD_REJECTED');
  onPhase('VERIFY_EXACT_MODULES');
  const [readback,afterBranches,afterStatus]=await Promise.all([
    api._request('GET','/api/user/code',{branch:TARGET_BRANCH}),
    api.userBranches(),api.userWorldStatus()]);
  if(!assessSeparateStage(afterBranches,afterStatus,approval,true).ok||
     !verifyUploadedWorldModules(modules,readback?.modules))
    throw new Error('EXACT_INACTIVE_STAGE_VERIFICATION_FAILED');
  return {status:'PASS',branch:TARGET_BRANCH,activeBranch:'chatgpt',
    moduleCount:Object.keys(modules).length,exactByteMatch:true,
    placementAttempted:false,activationAttempted:false};
}
async function main(){
  if(!process.env.RUNNER_TEMP||process.env.WORLD_SEPARATE_STAGE_CONFIRM!=='STAGE_SEPARATE_INACTIVE_CODE')
    throw new Error('EXPLICIT_STAGE_CONFIRMATION_REQUIRED');
  const config=path.join(process.env.RUNNER_TEMP,'world-separate-stage-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),{mode:0o600,flag:'wx'});
  try{
    const api=await ScreepsHttpClient.fromConfig('world',{file:config,shard:'shard0'});
    const game=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','game');
    const files=fs.readdirSync(game).filter(n=>n.endsWith('.js')).sort();
    const modules=Object.fromEntries(files.map(n=>[n.slice(0,-3),fs.readFileSync(path.join(game,n),'utf8')]));
    const result=await stageSeparateInactiveCode(api,modules,process.env.WORLD_SEPARATE_STAGE_CONFIRM,
      phase=>console.log('WORLD_SEPARATE_STAGE_PHASE '+phase));
    console.log('WORLD_SEPARATE_STAGE_SUCCESS '+JSON.stringify(result));
  }finally{fs.rmSync(config,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('WORLD_SEPARATE_STAGE_FAILED',e.message);process.exitCode=1;});
