import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';

const EXPECTED_USER='riflex91';
const MAIN_BRANCH='chatgpt';
const EXISTING_ACTIVE='chatgpt-w37s79-stage';
const EXPECTED_MAIN='bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c';
const HASH=value=>crypto.createHash('sha256').update(value).digest('hex');

function confirmedZeroOwnedWorldRooms(data){
  const source=data?.shards??data?.rooms;
  if(!source||typeof source!=='object'||Array.isArray(source))return false;
  const keys=Object.keys(source);
  for(const shard of ['shard0','shard1','shard2','shard3']){
    if(!Array.isArray(source[shard])||source[shard].length!==0)return false;
  }
  return keys.every(key=>Array.isArray(source[key])&&source[key].length===0);
}
function assertState(account,branches,rooms,expectedActive) {
  if(account?.status!=='empty')throw Error('WORLD_ACCOUNT_NOT_EMPTY');
  if(!confirmedZeroOwnedWorldRooms(rooms))
    throw Error('WORLD_ZERO_OWNED_ROOMS_UNVERIFIED');
  const list=Array.isArray(branches?.list)?branches.list:[];
  const active=list.filter(item=>item.activeWorld===true);
  const chatgpt=list.filter(item=>item.branch===MAIN_BRANCH);
  const stage=list.filter(item=>item.branch===EXISTING_ACTIVE);
  if(active.length!==1||active[0].branch!==expectedActive||
     chatgpt.length!==1||stage.length!==1)
    throw Error('WORLD_BRANCH_STATE_CHANGED_OR_UNVERIFIED');
  if(list.some(item=>!item?.branch||typeof item.branch!=='string'))
    throw Error('WORLD_BRANCH_LIST_MALFORMED');
  return true;
}
function exactModules(observed,expected){
  if(!observed||typeof observed!=='object'||Array.isArray(observed))return false;
  const a=Object.keys(observed).sort(),b=Object.keys(expected).sort();
  return a.length===b.length&&b.every((name,i)=>
    a[i]===name && typeof observed[name]==='string' &&
    HASH(observed[name])===HASH(expected[name]));
}
async function evidence(api) {
  const [me,status,branches,rooms]=await Promise.all([
    api.authMe(),api.userWorldStatus(),api.userBranches(),
    api.userRooms()
  ]);
  if(me?.username!==EXPECTED_USER)throw Error('WORLD_ACCOUNT_USERNAME_MISMATCH');
  return {status,branches,rooms};
}
async function readCode(api,branch){
  const response=await api._request('GET','/api/user/code',{branch});
  if(response?.ok===false||!response?.modules)
    throw Error('WORLD_CODE_READBACK_UNVERIFIED');
  return response.modules;
}
async function onceWriteCode(api,branch,modules){
  // Zero automatic replay for every transport failure, 401, 429 or 5xx.
  // A failed/ambiguous write requires a separate GET-only reconciliation.
  const response=await api._request('POST','/api/user/code',
    {branch,modules},{max429Retries:0,max5xxRetries:0,retryAuth:false});
  if(response?.ok===false||response?.error)
    throw Error('INACTIVE_CODE_WRITE_NOT_VERIFIED_NO_RETRY');
}
export async function normalizeEmptyWorldBootstrap(api,modules,onPhase=()=>{}) {
  if(api?.defaultShard!=='shard0'||!modules||
     Object.keys(modules).length<8||typeof modules.main!=='string'||
     typeof modules.config!=='string')
    throw Error('EXACT_WORLD_BOOTSTRAP_MODULE_SET_REQUIRED');
  // This initial layout was observed twice immediately post-respawn: active
  // stage, inactive chatgpt, no owned rooms. All deviations FAIL CLOSED.
  const before=await evidence(api);
  assertState(before.status,before.branches,before.rooms,EXISTING_ACTIVE);
  onPhase('VERIFY_INACTIVE_CHATGPT');
  if(!exactModules(await readCode(api,MAIN_BRANCH),modules)){
    const fresh=await evidence(api);
    assertState(fresh.status,fresh.branches,fresh.rooms,EXISTING_ACTIVE);
    onPhase('WRITE_EXACT_MAIN_TO_INACTIVE_CHATGPT_ONCE');
    await onceWriteCode(api,MAIN_BRANCH,modules);
    if(!exactModules(await readCode(api,MAIN_BRANCH),modules))
      throw Error('CHATGPT_READBACK_UNVERIFIED_NO_RETRY');
  }
  const ready=await evidence(api);
  assertState(ready.status,ready.branches,ready.rooms,EXISTING_ACTIVE);
  if(!exactModules(await readCode(api,MAIN_BRANCH),modules))
    throw Error('CHATGPT_NOT_EXACT_BEFORE_ACTIVATION');

  // One activation while account is still EMPTY and owns NO rooms.
  // This ensures that the *later* Spawn1 creation starts on known Main code.
  onPhase('ACTIVATE_EXACT_MAIN_CHATGPT_WHILE_WORLD_EMPTY_ONCE');
  const response=await api.userSetActiveBranch(MAIN_BRANCH,'activeWorld');
  if(response?.ok===false||response?.error)
    throw Error('WORLD_ACTIVATION_RESPONSE_UNVERIFIED_NO_RETRY');
  const after=await evidence(api);
  assertState(after.status,after.branches,after.rooms,MAIN_BRANCH);
  if(!exactModules(await readCode(api,MAIN_BRANCH),modules))
    throw Error('ACTIVE_WORLD_CODE_CHANGED');

  // The original guarded single-placement tool requires a *separate*
  // inactive stage with byte-identical code; stage it without switching.
  onPhase('RESTAGE_SEPARATE_INACTIVE_BRANCH_ONCE');
  await onceWriteCode(api,EXISTING_ACTIVE,modules);
  const final=await evidence(api);
  assertState(final.status,final.branches,final.rooms,MAIN_BRANCH);
  if(!exactModules(await readCode(api,EXISTING_ACTIVE),modules)||
     !exactModules(await readCode(api,MAIN_BRANCH),modules))
    throw Error('FINAL_EXACT_BRANCH_READBACK_UNVERIFIED_NO_RETRY');
  return {status:'PASS',worldStatus:'empty',
    usernameVerified:true,zeroOwnedRoomsVerified:true,
    activeBranch:MAIN_BRANCH,inactiveBranch:EXISTING_ACTIVE,
    bothExactMainModules:true,moduleCount:Object.keys(modules).length,
    originalMainSHA:EXPECTED_MAIN,spawnPlaced:false,
    placementPostAttempted:false,gameActionExecuted:false};
}
function readMainGameModules(){
  const game=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','game');
  return Object.fromEntries(fs.readdirSync(game).filter(p=>p.endsWith('.js'))
    .sort().map(p=>[p.slice(0,-3),fs.readFileSync(path.join(game,p),'utf8')]));
}
async function main(){
  if(!process.env.RUNNER_TEMP||
     process.env.WORLD_BOOTSTRAP_CONFIRM!=='USER_APPROVED_W37S79_37_26'||
     process.env.EXPECTED_MAIN_SHA!==EXPECTED_MAIN)
    throw Error('EXPLICIT_EXACT_MAIN_BOOTSTRAP_AUTHORIZATION_REQUIRED');
  const file=path.join(process.env.RUNNER_TEMP,
    'world-empty-branch-normalization-'+process.pid+'.json');
  fs.writeFileSync(file,JSON.stringify(buildWorldConfig(process.env)),
    {mode:0o600,flag:'wx'});
  try{
    const api=await ScreepsHttpClient.fromConfig('world',{file,shard:'shard0'});
    const outcome=await normalizeEmptyWorldBootstrap(api,readMainGameModules(),
      phase=>console.log('WORLD_EMPTY_BOOTSTRAP_PHASE '+phase));
    console.log('WORLD_EMPTY_BOOTSTRAP_SUCCESS '+JSON.stringify(outcome));
  }finally{fs.rmSync(file,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{
    // Errors identify stages without private IDs or response objects.
    console.error('WORLD_EMPTY_BOOTSTRAP_FAIL_CLOSED',e.message);
    process.exitCode=1;
  });
