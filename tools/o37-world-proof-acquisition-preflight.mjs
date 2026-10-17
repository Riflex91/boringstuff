// O37 - The World release-evidence bootstrap has no silent workaround:
// authentic archived World LIVE_100T_PASS was produced on an older commit,
// although all 82 original game Git blobs match current Main. This module
// checks current production runtime via authenticated Screeps GETs ONLY.
// Never creates a new deployment ID/marker, sends POST, changes active code,
// triggers an action, grants release, or attempts a respawn.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {PREDECESSOR_MAIN,ORIGINAL_WORLD_RUN_SHA}
  from './o36-world-git-tree-equivalence.mjs';

const home=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../game');
export const WORLD_TARGET=Object.freeze({
  room:'W37S79',shard:'shard0',branch:'chatgpt',
  spawnName:'Spawn1',x:37,y:26,username:'riflex91'
});
const validTick=n=>Number.isSafeInteger(n)&&n>=1&&n<2_000_000_000;
export function expectedWorldModules(gameDir=home){
  const names=fs.readdirSync(gameDir)
    .filter(s=>/^[a-zA-Z0-9._-]+\.js$/.test(s)).sort();
  if(names.length!==82||!names.includes('main.js')||
     !names.includes('config.js')||!names.includes('telemetry.journal.js'))
    throw Error('PINNED_MAIN_GAME_FILE_SET_NOT_82');
  const result={};
  for(const file of names){
    const full=path.join(gameDir,file);
    if(!fs.statSync(full).isFile())throw Error('NONREGULAR_GAME_MODULE');
    result[file.slice(0,-3)]=fs.readFileSync(full,'utf8');
    if(!result[file.slice(0,-3)]||result[file.slice(0,-3)].length>2_000_000)
      throw Error('GAME_MODULE_BYTES_INVALID');
  }
  return result;
}
export function assessCurrentWorldProofPlan(raw,expected){
  const failures=[];
  const user=raw?.me?._id||raw?.me?.id;
  if(typeof user!=='string'||!user)failures.push('AUTHENTICATED_WORLD_USER_ID_MISSING');
  const uname=raw?.me?.username;
  if(typeof uname!=='string'||uname.toLowerCase()!==WORLD_TARGET.username)
    failures.push('WORLD_ACCOUNT_USERNAME_NOT_VERIFIED');
  const list=raw?.branches?.list;
  const active=Array.isArray(list)?list.filter(b=>b?.activeWorld===true):[];
  if(active.length!==1||active[0]?.branch!==WORLD_TARGET.branch)
    failures.push('EXACT_ACTIVE_CHATGPT_BRANCH_NOT_VERIFIED');
  if(raw?.status?.status!=='normal')failures.push('WORLD_STATUS_NOT_NORMAL');
  const objects=raw?.room?.objects;
  if(!Array.isArray(objects)||objects.length>5000)
    failures.push('ROOM_OBJECT_CENSUS_UNVERIFIED');
  const own=Array.isArray(objects)&&typeof user==='string'?
    objects.filter(o=>String(o?.user||'')===user):[];
  const spawns=own.filter(o=>o?.type==='spawn'||o?.structureType==='spawn');
  const pinned=spawns.filter(o=>o?.name===WORLD_TARGET.spawnName&&
    o?.x===WORLD_TARGET.x&&o?.y===WORLD_TARGET.y);
  if(spawns.length!==1||pinned.length!==1)
    failures.push('EXACT_OWNED_SPAWN1_NOT_VERIFIED');
  const creeps=own.filter(o=>o?.type==='creep');
  if(creeps.length<1)failures.push('OWNED_WORKFORCE_NOT_VERIFIED');
  const controller=Array.isArray(objects)?objects.filter(o=>o?.type==='controller'):[];
  if(controller.length!==1||String(controller[0]?.user||'')!==user||
     !Number.isSafeInteger(controller[0]?.level)||controller[0].level<1)
    failures.push('OWNED_ROOM_CONTROLLER_NOT_VERIFIED');
  const actual=raw?.code?.modules;
  if(!actual||Array.isArray(actual)||typeof actual!=='object'||
     !expected||Array.isArray(expected)||typeof expected!=='object')
    failures.push('FULL_ACTIVE_GAME_MODULES_NOT_VERIFIED');
  else{
    const required=Object.keys(expected).sort();
    const present=Object.keys(actual).sort();
    if(required.length!==82||present.length!==82||
       required.some((name,i)=>present[i]!==name))
      failures.push('FULL_82_MAIN_GAME_MODULE_SET_MISMATCH');
    else if(required.some(name=>typeof actual[name]!=='string'||
      actual[name]!==expected[name]))
      failures.push('ACTIVE_GAME_MODULE_BYTES_DIFFER_FROM_MAIN');
  }
  const time=raw?.clock?.time;
  if(!validTick(time))failures.push('CURRENT_WORLD_GAME_TICK_UNVERIFIED');
  const opHealthy=failures.length===0;
  return {
    result:opHealthy?'WORLD_O16_IDENTICAL_NO_OPERATIONAL_DEPLOY_NEEDED':
      'HOLD_WORLD_RUNTIME_OR_MAIN_BYTES_UNVERIFIED',
    runtimeReadOnlyVerified:opHealthy,
    failures,
    observedWorldTick:validTick(time)?time:null,
    ownedCreepCount:Array.isArray(objects)&&typeof user==='string'?
      creeps.length:null,
    ownedPinnedSpawnVerified:pinned.length===1&&spawns.length===1,
    activeBranchVerified:active.length===1&&
      active[0]?.branch===WORLD_TARGET.branch,
    sourceCommit:ORIGINAL_WORLD_RUN_SHA,
    exactRequiredMain:PREDECESSOR_MAIN,
    activeGameIdenticalToExactMain:opHealthy,
    historicalWorldOriginalExactMainSha:false,
    currentExactMainWorldCanonicalLive100tPass:false,
    freshCanonicalDeploymentReceiptRequiredForExactSha:true,
    mayUploadWorldCode:false,
    mayResetWorld:false,
    mayMergeCandidate:false,
    // A healthy, byte-identical production runtime does not justify an
    // otherwise prohibited gameplay upload merely to mint new metadata.
    safestOperationalAction:opHealthy?'PRESERVE_HEALTHY_RUNNING_WORLD':
      'HOLD_AND_INVESTIGATE_READONLY',
    nextReleaseAction:'EXPLICIT_OPERATOR_APPROVAL_ORIGINAL_MAIN_WORLD_PROOF_PROTOCOL_REQUIRED',
    releaseAuthorized:false,apiMutationsAttempted:0
  };
}
export async function runWorldReadOnlyPreflight(api,{
  read=async(client)=>{
    const [me,branches,status,room,code,clock]=await Promise.all([
      client.authMe(),client.userBranches(),client.userWorldStatus(),
      client.gameRoomObjects(WORLD_TARGET.room,WORLD_TARGET.shard),
      client._request('GET','/api/user/code',{branch:WORLD_TARGET.branch}),
      client._request('GET','/api/game/time',{shard:WORLD_TARGET.shard})
    ]);
    return {me,branches,status,room,code,clock};
  },
  expected=expectedWorldModules()
}={}){
  if(api?.defaultShard!==WORLD_TARGET.shard)
    throw Error('EXACT_WORLD_SHARD_REQUIRED');
  return assessCurrentWorldProofPlan(await read(api),expected);
}
async function main(){
  if(process.env.SCREEPS_SERVER!=='world'||
     process.env.SCREEPS_ROOM!==WORLD_TARGET.room||
     process.env.SCREEPS_BRANCH!==WORLD_TARGET.branch||
     process.env.SCREEPS_SHARD!==WORLD_TARGET.shard||
     !process.env.RUNNER_TEMP)
    throw Error('EXACT_WORLD_READONLY_CONTEXT_REQUIRED');
  const file=path.join(process.env.RUNNER_TEMP,
    'o37-world-readonly-'+process.pid+'.json');
  fs.writeFileSync(file,JSON.stringify(buildWorldConfig(process.env)),{
    mode:0o600,flag:'wx'
  });
  try{
    const api=await ScreepsHttpClient.fromConfig('world',{
      file,shard:WORLD_TARGET.shard
    });
    const result=await runWorldReadOnlyPreflight(api);
    console.log('O37_WORLD_PROOF_ACQUISITION_READONLY '+JSON.stringify(result));
    if(!result.runtimeReadOnlyVerified)process.exitCode=2;
    // Green signifies ONLY read-only runtime assessment, NOT release eligibility.
  }finally{fs.rmSync(file,{force:true});}
}
if(process.argv[1]&&
   path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{
    console.error('O37_WORLD_PREDEPLOY_GETONLY_UNVERIFIED');
    process.exitCode=2;
  });
