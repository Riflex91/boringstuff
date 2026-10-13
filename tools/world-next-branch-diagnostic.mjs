import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {verifyStagedWorldCode} from './world-target-preflight.mjs';
import {assessPreActivationWorldBranches} from './world-first-spawn.mjs';
export function summarizeWorldBranchActivation(branches) {
  const list=Array.isArray(branches?.list)?branches.list:[];
  return {reportedActiveWorld:typeof branches?.activeWorld==='string'?branches.activeWorld:null,
    branches:list.map(b=>({name:b?.branch||null,activeWorld:b?.activeWorld===true,
      activeWorldFieldPresent:Object.hasOwn(b||{},'activeWorld')}))};
}
export async function inspectWorldBranchState(api,expected) {
  if(api?.defaultShard!=='shard0')throw new Error('EXACT_SHARD_REQUIRED');
  const [branches,status]=await Promise.all([api.userBranches(),api.userWorldStatus()]);
  const list=Array.isArray(branches?.list)?branches.list:[];
  const state=assessPreActivationWorldBranches(branches);
  const code=await verifyStagedWorldCode(api,list,expected);
  return {mode:'GET_ONLY',worldEmpty:status?.status==='empty',
    branchNames:list.map(b=>b?.branch).filter(Boolean).sort(),
    activationDetails:summarizeWorldBranchActivation(branches),
    defaultSoleActive:state.defaultSoleActive,
    chatgptUniqueInactive:state.stagedUniqueInactive,
    branchGatePass:state.ok,
    chatgptCodeStatus:code.status,
    exactSourceMatch:code.exactSourceMatch===true,
    expectedModuleCount:code.expectedModuleCount,
    observedModuleCount:code.observedModuleCount??null,
    codeReady:state.ok&&code.exactSourceMatch===true,
    placementAttempted:false,uploadAttempted:false,activationAttempted:false};
}
async function main(){
  if(!process.env.RUNNER_TEMP)throw new Error('RUNNER_TEMP_REQUIRED');
  const config=path.join(process.env.RUNNER_TEMP,'world-branch-diagnostic-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),{mode:0o600,flag:'wx'});
  try {
    const api=await ScreepsHttpClient.fromConfig('world',{file:config,shard:'shard0'});
    const game=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','game');
    const expected=Object.fromEntries(fs.readdirSync(game).filter(n=>n.endsWith('.js')).sort().map(n=>
      [n.slice(0,-3),fs.readFileSync(path.join(game,n),'utf8')]));
    const result=await inspectWorldBranchState(api,expected);
    const dir=path.join(process.env.RUNNER_TEMP,'world-branch-diagnostic');
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'branch-diagnostic.json'),JSON.stringify(result,null,2)+'\n');
    console.log('WORLD_BRANCH_DIAGNOSTIC '+JSON.stringify(result));
  }finally{fs.rmSync(config,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('WORLD_BRANCH_DIAGNOSTIC_FAILED',e.message);process.exitCode=1;});
