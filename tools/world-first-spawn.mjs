import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';
import { WORLD_TARGET } from './world-target-selection.mjs';
import { validateTarget } from './world-target-preflight.mjs';
import { inspectWorldLaunchDossier } from './world-threat-ring.mjs';
import { verifyInitialSpawnTarget } from './spawn-safety.mjs';

// SINGLE placement authorization, never an active branch release.
const TARGET=Object.freeze({shard:'shard0',room:'W37N11',x:12,y:13,
  spawnName:'Spawn1',branch:'chatgpt'});
export const PLACEMENT_CONFIRM='PLACE_W37N11_12_13';
export const RIVAL_CONFIRM='ACCEPT_W35N11_RCL8';

export function assessPinnedFirstSpawnSafety(dossier,finalCheck) {
  const failures=[];
  const t=dossier?.target;
  if(!t||t.shard!==TARGET.shard||t.room!==TARGET.room||
    t.x!==TARGET.x||t.y!==TARGET.y||t.spawnName!==TARGET.spawnName)
    failures.push('PINNED_TARGET_MISMATCH');
  if(dossier?.evidenceSource!=='LIVE_SCREEPS_WORLD_API'||
     dossier?.mode!=='GET_ONLY'||dossier.fixedTargetSitePassed!==true)
    failures.push('FRESH_TARGET_UNVERIFIED');
  if(dossier?.worldStatus!=='empty')
    failures.push('WORLD_NOT_EMPTY');
  if(dossier?.stagedCodeStatus!=='EXACT_INACTIVE_CODE'||
     dossier?.exactInactiveCode!==true||dossier?.branchActive!==false)
    failures.push('EXACT_INACTIVE_WORLD_CODE_UNVERIFIED');
  const ring=dossier?.ring;
  if(ring?.mode!=='GET_ONLY'||ring?.requestedRooms!==24||
     ring?.verifiedRooms!==24||ring?.coverageComplete!==true||
     !Array.isArray(ring?.observations)||ring.observations.length!==24 ||
     ring.observations.some(o=>!o.verified))
    failures.push('TWENTY_FOUR_ROOM_RISK_EVIDENCE_INCOMPLETE');
  if(!Array.isArray(ring?.unverifiedRooms)||ring.unverifiedRooms.length)
    failures.push('RIVAL_COVERAGE_GAPS');
  // User accepted exactly W35N11's known RCL8, not any new foreign base.
  const controlled=Array.isArray(ring?.observations)?ring.observations.filter(o=>
    o?.foreignOwner===true||o?.foreignReservation===true):[];
  if(controlled.some(o=>o.room!=='W35N11'||o.foreignReservation===true) ||
     ring?.foreignOwnedRooms>1||ring?.foreignReservedRooms!==0)
    failures.push('UNAPPROVED_ADDITIONAL_RIVAL_CONTROL');
  if(controlled.some(o=>o.room==='W35N11' && o.foreignOwner &&
      o.controllerLevel!==8))
    failures.push('KNOWN_RIVAL_LEVEL_CHANGED');
  if(finalCheck!==undefined) {
    if(finalCheck?.evidence?.spawnNameCheckRaw?.ok===false ||
       finalCheck?.evidence?.spawnNameCheckRaw?.error)
      failures.push('SPAWN_NAME_API_REJECTED');
    if(finalCheck?.ok!==true||finalCheck?.room!==TARGET.room||
       finalCheck?.x!==TARGET.x||finalCheck?.y!==TARGET.y||
       finalCheck?.name!==TARGET.spawnName||finalCheck?.branch!==TARGET.branch||
       finalCheck?.worldStatus!=='empty'||finalCheck?.roomStatus!=='normal'||
       finalCheck?.tile?.ok!==true||finalCheck?.tile?.terrain!=='plain')
      failures.push('FINAL_FIXED_TILE_VALIDATION_FAILED');
    const checks=finalCheck?.checks;
    for (const name of ['world-status-empty','room-status-normal',
      'controller-exists','controller-unowned','controller-unreserved',
      'spawn-tile-free-and-buildable','spawn-name-available',
      'world-branch-present','world-code-ready']) {
      if(!Array.isArray(checks)||!checks.some(c=>c?.name===name &&
          c.pass===true && c.severity==='error'))
        failures.push('FINAL_CHECK_MISSING_OR_FAILED_'+name.toUpperCase().replaceAll('-','_'));
    }
    if(finalCheck?.evidence?.placementEndpointCalled!==false)
      failures.push('FINAL_CHECK_ATTEMPTED_PLACEMENT');
  }
  return {ok:failures.length===0,failures,
    target:{...TARGET},acceptedRisk:'W35N11_RCL8_ONLY',
    branchActivationAuthorized:false};
}

function safeReceipt(folder,name,record) {
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(folder,name),JSON.stringify(record,null,2)+'\n',
    {mode:0o600});
}

async function finalPinnedCheck(api,id) {
  return verifyInitialSpawnTarget({
    api,room:TARGET.room,x:TARGET.x,y:TARGET.y,
    name:TARGET.spawnName,myUserId:id,branch:TARGET.branch,
    requireNormalStatus:true,requireUniqueName:true,
    requireBranchPresent:true,requireWorldCodeReady:true
  });
}

async function readBackSpawn(api,id) {
  const [objects,branches,status]=await Promise.all([
    api.gameRoomObjects(TARGET.room,TARGET.shard),
    api.userBranches(),api.userWorldStatus()
  ]);
  const list=branches?.list||[];
  const activeDefault=list.filter(x=>x?.branch==='default'&&x.activeWorld===true).length===1;
  const inactiveChatgpt=list.filter(x=>x?.branch==='chatgpt'&&x.activeWorld===false).length===1;
  const objectsList=Array.isArray(objects?.objects)?objects.objects:[];
  const spawn=objectsList.find(o=>
    (o?.type==='spawn'||o?.structureType==='spawn')&&
    o.x===TARGET.x&&o.y===TARGET.y&&
    o.name===TARGET.spawnName&&String(o.user||'')===String(id));
  return {spawnVerified:Boolean(spawn),activeDefault,inactiveChatgpt,
    observedWorldStatus:typeof status?.status==='string'?status.status:'UNKNOWN'};
}

export async function placePinnedWorldSpawn(api,id) {
  if(api?.defaultShard!==TARGET.shard||!id)
    throw new Error('WORLD_EXACT_SHARD_OR_ID_REQUIRED');
  const initial=await inspectWorldLaunchDossier(api,WORLD_TARGET);
  const firstGate=assessPinnedFirstSpawnSafety(initial);
  if(!firstGate.ok) throw Object.assign(new Error('WORLD_INITIAL_GATE_FAILED'),{
    phase:'INITIAL_GET_ONLY_GATE',failures:firstGate.failures});
  const exactFinal=await finalPinnedCheck(api,id);
  const check=assessPinnedFirstSpawnSafety(initial,exactFinal);
  if(!check.ok) throw Object.assign(new Error('WORLD_FINAL_SPAWN_CHECK_FAILED'),{
    phase:'NAME_AND_TILE_CHECK',failures:check.failures});
  // Re-read the complete live site and all 24 neighbours immediately before
  // the irreversible request. A stale or newly hostile map must fail closed.
  const refreshed=await inspectWorldLaunchDossier(api,WORLD_TARGET);
  const lastGate=assessPinnedFirstSpawnSafety(refreshed,exactFinal);
  if(!lastGate.ok) throw Object.assign(new Error('WORLD_RECHECK_BEFORE_POST_FAILED'),{
    phase:'LAST_GET_ONLY_GATE',failures:lastGate.failures});
  // The World startup must remain on default until separately authorized.
  const beforeBranches=await api.userBranches();
  if(!Array.isArray(beforeBranches?.list) ||
     beforeBranches.list.filter(x=>x?.branch==='default'&&x.activeWorld===true).length!==1 ||
     beforeBranches.list.filter(x=>x?.branch==='chatgpt'&&x.activeWorld===false).length!==1)
    throw Object.assign(new Error('WORLD_ACTIVE_BRANCH_CHANGED'),{
      phase:'LAST_BRANCH_STATE_GATE',
      failures:['DEFAULT_MUST_BE_ACTIVE_AND_CHATGPT_MUST_BE_INACTIVE']});
  // Exactly one irreversible POST, on the fixed shard/room/tile/name.
  let raw;
  try {
    raw=await api.gamePlaceSpawn(TARGET.room,TARGET.x,TARGET.y,
      TARGET.spawnName,TARGET.shard);
  } catch {
    // HTTP timeouts can happen after a successful placement; never retry POST.
    throw Object.assign(new Error('WORLD_PLACEMENT_RESULT_UNCERTAIN'),{
      phase:'PLACEMENT_API_RETURN_UNCERTAIN',failures:['REQUIRE_GET_ONLY_MANUAL_RECOVERY']});
  }
  if(raw?.ok===false||raw?.error)
    throw Object.assign(new Error('WORLD_PLACEMENT_REJECTED'),{
      phase:'PLACEMENT_API_REJECTED',failures:['REQUIRE_GET_ONLY_MANUAL_RECOVERY']});
  // GET-only readback. Never send a second placement request.
  let latest=null;
  for(let n=0;n<6;n++) {
    try {
      latest=await readBackSpawn(api,id);
      if(latest.spawnVerified && latest.activeDefault && latest.inactiveChatgpt)
        break;
    } catch {latest=null;}
    if(n<5) await new Promise(resolve=>setTimeout(resolve,1200));
  }
  if(!latest?.spawnVerified||!latest?.activeDefault||!latest?.inactiveChatgpt)
    throw Object.assign(new Error('WORLD_SPAWN_READBACK_UNVERIFIED'),{
      phase:'POST_PLACEMENT_GET_ONLY_VERIFICATION',
      failures:['NEVER_AUTOMATICALLY_RETRY_PLACEMENT']});
  return {status:'PASS',server:'world',target:{...TARGET},
    spawnVerified:true,worldCodeBranch:'chatgpt',
    activeBranch:'default',worldCodeActivated:false,
    placementApiCalls:1,acceptedRisk:'W35N11_RCL8_ONLY',
    observedWorldStatus:latest.observedWorldStatus};
}

async function main() {
  const required={
    WORLD_FIRST_SPAWN_CONFIRM:PLACEMENT_CONFIRM,
    WORLD_RCL8_RISK_CONFIRM:RIVAL_CONFIRM,
    SCREEPS_SERVER:'world',
    SCREEPS_SHARD:TARGET.shard,
    SCREEPS_BRANCH:'chatgpt'
  };
  for(const [key,value] of Object.entries(required))
    if(process.env[key]!==value)
      throw new Error('EXPLICIT_WORLD_PLACEMENT_WORKFLOW_GATE_NOT_SATISFIED');
  validateTarget(WORLD_TARGET);
  const temp=process.env.RUNNER_TEMP,config=process.env.SCREEPS_CONFIG;
  if(!temp||!config||!path.resolve(config).startsWith(path.resolve(temp)+path.sep)||
     fs.existsSync(config))throw new Error('EPHEMERAL_CONFIG_PRECONDITION_FAILED');
  const output=path.join(temp,'world-first-spawn-evidence');
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),
    {mode:0o600,flag:'wx'});
  try {
    const api=await ScreepsHttpClient.fromConfig('world',{
      file:config,shard:TARGET.shard});
    const me=await api.authMe();
    const id=me?._id||me?.id;
    if(!id)throw new Error('WORLD_AUTH_ID_MISSING');
    try {
      const result=await placePinnedWorldSpawn(api,id);
      safeReceipt(output,'world-first-spawn-success.json',{
        ...result,sourceCommit:process.env.GITHUB_SHA||null,
        confirmedAt:new Date().toISOString()});
      console.log('WORLD_FIRST_SPAWN_VERIFIED '+JSON.stringify(result));
    } catch(err) {
      const receipt={status:'FAILED_OR_UNVERIFIED',
        phase:typeof err?.phase==='string'?err.phase:'UNKNOWN_STAGE',
        failures:Array.isArray(err?.failures)?err.failures:
          ['WORLD_PLACEMENT_UNVERIFIED'],
        target:{...TARGET},mayHavePlacedSpawn:
          ['PLACEMENT_API_RETURN_UNCERTAIN','PLACEMENT_API_REJECTED',
            'POST_PLACEMENT_GET_ONLY_VERIFICATION'].includes(err?.phase),
        neverRetryAutomatically:true,activationAttempted:false,
        verifiedAt:new Date().toISOString()};
      safeReceipt(output,'world-first-spawn-failure.json',receipt);
      console.error('WORLD_FIRST_SPAWN_FAIL_CLOSED '+JSON.stringify(receipt));
      process.exitCode=1;
    }
  } finally {
    fs.rmSync(config,{force:true});
  }
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
  main().catch(()=>{console.error('World placement blocked before protected staging');
    process.exitCode=1;});
