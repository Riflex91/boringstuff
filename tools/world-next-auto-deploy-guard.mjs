import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {assessWorldRuntime} from './world-next-runtime-diagnostics.mjs';
export function assessAutoDeployGate(input){
  // The operator-authorized W37S79 production branch is chatgpt.
  // Staging-specific read-only diagnostics retain their original default.
  const runtime=assessWorldRuntime(input,'chatgpt');
  const failures=[...runtime.failures];
  if(input?.status?.status!=='normal')failures.push('WORLD_STATUS_NOT_NORMAL');
  const objects=input?.room?.objects;
  const me=input?.me?._id||input?.me?.id;
  const controller=Array.isArray(objects)?objects.find(o=>o?.type==='controller'):null;
  if(!controller)failures.push('CONTROLLER_NOT_OBSERVED');
  if(controller?.user!=null&&String(controller.user)!==String(me))failures.push('CONTROLLER_OWNERSHIP_MISMATCH');
  if(!input?.code?.modules||typeof input.code.modules!=='object'||Array.isArray(input.code.modules)||
     Object.keys(input.code.modules).length<8)failures.push('BACKUP_MODULES_UNAVAILABLE');
  return {ok:failures.length===0,failures,spawnVerified:runtime.spawnVerified,
    activeBranch:runtime.activeBranch,mode:'GET_ONLY',uploadAttempted:false};
}
async function main(){
  if(process.env.SCREEPS_SERVER!=='world'||process.env.SCREEPS_BRANCH!=='chatgpt'||
     process.env.SCREEPS_SHARD!=='shard0'||process.env.SCREEPS_ROOM!=='W37S79')
    throw new Error('EXACT_WORLD_TARGET_REQUIRED');
  const config=process.env.SCREEPS_CONFIG;
  if(!config||!process.env.RUNNER_TEMP||!path.resolve(config).startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep))
    throw new Error('EPHEMERAL_CONFIG_REQUIRED');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),{mode:0o600,flag:'wx'});
  const api=await ScreepsHttpClient.fromConfig('world',{file:config,shard:'shard0'});
  const [me,branches,status,room,code]=await Promise.all([
    api.authMe(),api.userBranches(),api.userWorldStatus(),
    api.gameRoomObjects('W37S79','shard0'),
    api._request('GET','/api/user/code',{branch:'chatgpt'})]);
  const result=assessAutoDeployGate({me,branches,status,room,code});
  console.log('WORLD_W37S79_AUTO_DEPLOY_GATE '+JSON.stringify(result));
  if(!result.ok)throw new Error('AUTO_DEPLOY_GATE_BLOCKED');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('WORLD_W37S79_AUTO_DEPLOY_BLOCKED',e.message);process.exitCode=1;});
