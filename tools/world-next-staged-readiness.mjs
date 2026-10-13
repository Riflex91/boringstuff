import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {WORLD_NEXT_TARGET_CANDIDATE as target} from './world-next-target-candidate.mjs';
import {inspectCandidateRing} from './world-next-target-threat-ring.mjs';
import {verifyInitialSpawnTarget} from './spawn-safety.mjs';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {assessNextSpawnReadiness} from './world-next-spawn-readiness.mjs';
export const STAGING_BRANCH='chatgpt-w37s79-stage';
export function assessStagedCode(branches,status,actual,expected) {
  const list=Array.isArray(branches?.list)?branches.list:[];
  const active=list.filter(b=>b?.activeWorld===true);
  const stage=list.filter(b=>b?.branch===STAGING_BRANCH);
  const failures=[];
  if(status?.status!=='empty')failures.push('WORLD_NOT_EMPTY');
  if(active.length!==1||active[0]?.branch!=='chatgpt')failures.push('CHATGPT_NOT_SOLE_ACTIVE');
  if(stage.length!==1||stage[0]?.activeWorld===true)failures.push('STAGING_BRANCH_NOT_UNIQUELY_INACTIVE');
  const names=Object.keys(expected).sort(),got=Object.keys(actual?.modules||{}).sort();
  const exact=actual?.ok!==false&&actual?.modules&&names.length===got.length&&
    names.every((name,i)=>name===got[i]&&typeof actual.modules[name]==='string'&&
      crypto.createHash('sha256').update(actual.modules[name]).digest('hex')===
      crypto.createHash('sha256').update(expected[name]).digest('hex'));
  if(!exact)failures.push('EXACT_STAGED_CODE_NOT_VERIFIED');
  return {ok:failures.length===0,failures,exactInactiveCode:failures.length===0,
    activationAuthorized:false,placementAuthorized:false,stageBranch:STAGING_BRANCH,
    expectedModuleCount:names.length,observedModuleCount:got.length};
}
export async function inspectStagedReadiness(api) {
  if(api?.defaultShard!==target.shard)throw new Error('EXACT_SHARD_REQUIRED');
  const me=await api.authMe();
  const id=me?._id||me?.id;
  if(!id)throw new Error('AUTH_REQUIRED');
  const ring=await inspectCandidateRing(api);
  const check=await verifyInitialSpawnTarget({api,room:target.room,x:target.x,y:target.y,
    name:target.spawnName,myUserId:id,branch:STAGING_BRANCH,
    requireNormalStatus:true,requireUniqueName:true,
    requireBranchPresent:true,requireWorldCodeReady:true});
  const [branches,status,actual]=await Promise.all([
    api.userBranches(),api.userWorldStatus(),
    api._request('GET','/api/user/code',{branch:STAGING_BRANCH})]);
  const game=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','game');
  const expected=Object.fromEntries(fs.readdirSync(game).filter(n=>n.endsWith('.js')).sort().map(n=>
    [n.slice(0,-3),fs.readFileSync(path.join(game,n),'utf8')]));
  const code=assessStagedCode(branches,status,actual,expected);
  // The original readiness gate pins chatgpt as the placement branch.
  // Reuse all its threat and site assertions against the new branch without
  // weakening its checks or authorizing placement.
  const normalizedCheck={...check,branch:target.branch};
  const gate=assessNextSpawnReadiness(ring,normalizedCheck,code);
  return {...gate,stageBranch:STAGING_BRANCH,activeBranch:'chatgpt',
    codeFailures:code.failures,exactInactiveCode:code.ok,
    ringRisk:ring.risk,ringVerifiedRooms:ring.verifiedRooms,
    finalCheckPassed:check.ok===true,placementAuthorized:false,
    activationAuthorized:false,deploymentAuthorized:false};
}
async function main(){
  if(!process.env.RUNNER_TEMP)throw new Error('RUNNER_TEMP_REQUIRED');
  const config=path.join(process.env.RUNNER_TEMP,'w37s79-stage-readiness-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),{mode:0o600,flag:'wx'});
  try{
    const api=await ScreepsHttpClient.fromConfig('world',{file:config,shard:target.shard});
    const result=await inspectStagedReadiness(api);
    console.log('WORLD_W37S79_STAGED_READINESS '+JSON.stringify(result));
    if(!result.ok)process.exitCode=2;
  }finally{fs.rmSync(config,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('WORLD_W37S79_STAGED_READINESS_FAILED',e.message);process.exitCode=1;});
