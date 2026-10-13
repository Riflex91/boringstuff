import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessPreActivationWorldBranches} from './world-first-spawn.mjs';
import {verifyStagedWorldCode} from './world-target-preflight.mjs';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';

export function assessRestageGate(branches,status,code,confirmed) {
  const state=assessPreActivationWorldBranches(branches);
  const failures=[];
  if(confirmed!=='RESTAGE_INACTIVE_WORLD_CODE')failures.push('EXPLICIT_RESTAGE_APPROVAL_REQUIRED');
  if(status?.status!=='empty')failures.push('WORLD_MUST_BE_EMPTY');
  if(!state.ok)failures.push('EXACT_INACTIVE_BRANCH_STATE_REQUIRED');
  if(code?.status==='EXACT_INACTIVE_CODE'&&code?.exactSourceMatch===true)
    failures.push('ALREADY_EXACT_NO_UPLOAD_REQUIRED');
  if(!['INCOMPLETE_OR_MISMATCHED_CODE','EXACT_INACTIVE_CODE'].includes(code?.status))
    failures.push('EXISTING_BRANCH_CODE_NOT_VERIFIED');
  return {ok:failures.length===0,failures,mode:'INACTIVE_BRANCH_RESTAGE_ONLY'};
}
export async function restageInactiveWorldCode(api,modules,confirmation,onPhase=()=>{}) {
  if(api?.defaultShard!=='shard0')throw new Error('EXACT_SHARD_REQUIRED');
  if(!modules||Object.keys(modules).length<8||typeof modules.main!=='string'||
     typeof modules.config!=='string')throw new Error('INVALID_LOCAL_MODULE_SET');
  onPhase('READ_EXISTING_BRANCH');
  const [branches,status]=await Promise.all([api.userBranches(),api.userWorldStatus()]);
  const code=await verifyStagedWorldCode(api,branches?.list,modules);
  const gate=assessRestageGate(branches,status,code,confirmation);
  if(!gate.ok)throw new Error('RESTAGE_GATE_BLOCKED_'+gate.failures.join('_'));
  onPhase('RECHECK_BEFORE_UPLOAD');
  const [freshBranches,freshStatus]=await Promise.all([api.userBranches(),api.userWorldStatus()]);
  const freshCode=await verifyStagedWorldCode(api,freshBranches?.list,modules);
  const fresh=assessRestageGate(freshBranches,freshStatus,freshCode,confirmation);
  if(!fresh.ok)throw new Error('RESTAGE_STATE_CHANGED');
  onPhase('UPLOAD_INACTIVE_CHATGPT_ONLY');
  const result=await api._request('POST','/api/user/code',{branch:'chatgpt',modules});
  if(result?.ok===false)throw new Error('RESTAGE_POST_REJECTED');
  onPhase('VERIFY_EXACT_READBACK');
  const [afterBranches,afterStatus]=await Promise.all([api.userBranches(),api.userWorldStatus()]);
  const afterCode=await verifyStagedWorldCode(api,afterBranches?.list,modules);
  if(!assessPreActivationWorldBranches(afterBranches).ok||
     afterStatus?.status!=='empty'||afterCode.status!=='EXACT_INACTIVE_CODE'||
     afterCode.exactSourceMatch!==true)throw new Error('RESTAGE_READBACK_FAILED');
  return {status:'PASS',branch:'chatgpt',exactInactiveCode:true,
    moduleCount:Object.keys(modules).length,spawnPlaced:false,activated:false};
}
async function main() {
  if(!process.env.RUNNER_TEMP)throw new Error('RUNNER_TEMP_REQUIRED');
  const config=path.join(process.env.RUNNER_TEMP,'w37s79-restage-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),{mode:0o600,flag:'wx'});
  try{
    const api=await ScreepsHttpClient.fromConfig('world',{file:config,shard:'shard0'});
    const game=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','game');
    const files=fs.readdirSync(game).filter(f=>f.endsWith('.js')).sort();
    const modules=Object.fromEntries(files.map(f=>[f.slice(0,-3),
      fs.readFileSync(path.join(game,f),'utf8')]));
    const result=await restageInactiveWorldCode(api,modules,
      process.env.WORLD_RESTAGE_CONFIRM,phase=>console.log('WORLD_RESTAGE_PHASE '+phase));
    console.log('WORLD_RESTAGE_SUCCESS '+JSON.stringify(result));
  }finally{fs.rmSync(config,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('WORLD_RESTAGE_FAILED',e.message);process.exitCode=1;});
