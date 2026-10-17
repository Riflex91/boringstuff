import { assertLegacyWorldMutationDisabled } from './o45-world-mutation-entrypoint-hold.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';
import { WORLD_TARGET } from './world-target-selection.mjs';
import { validateTarget,verifyStagedWorldCode } from './world-target-preflight.mjs';
import { inspectWorldLaunchDossier } from './world-threat-ring.mjs';
import { verifyInitialSpawnTarget } from './spawn-safety.mjs';

// SINGLE placement authorization, never an active branch release.
const TARGET=Object.freeze({shard:'shard0',room:'W37N11',x:12,y:13,
  spawnName:'Spawn1',branch:'chatgpt'});
export const PLACEMENT_CONFIRM='PLACE_W37N11_12_13';
export const RIVAL_CONFIRM='ACCEPT_W35N11_RCL8';
export const ACTIVATION_CONFIRM='ACTIVATE_W37N11_AFTER_VERIFIED_SPAWN';

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

/**
 * Screeps can omit "activeWorld" on an inactive branch instead of setting
 * activeWorld:false. Only activeWorld:true counts as active. An absent branch,
 * duplicate branch, no active branch or multiple actives still block writes.
 */
export function assessPreActivationWorldBranches(branches) {
  const list=Array.isArray(branches?.list)?branches.list:[];
  const defaults=list.filter(b=>b?.branch==='default');
  const staged=list.filter(b=>b?.branch==='chatgpt');
  const active=list.filter(b=>b?.activeWorld===true);
  const defaultSoleActive=defaults.length===1 &&
    defaults[0].activeWorld===true &&
    active.length===1 && active[0].branch==='default' &&
    (typeof branches?.activeWorld!=='string'||branches.activeWorld==='default');
  const stagedUniqueInactive=staged.length===1 &&
    staged[0]?.activeWorld!==true;
  return {ok:defaultSoleActive&&stagedUniqueInactive,
    defaultSoleActive,stagedUniqueInactive};
}

async function readBackSpawn(api,id) {
  const [objects,branches,status]=await Promise.all([
    api.gameRoomObjects(TARGET.room,TARGET.shard),
    api.userBranches(),api.userWorldStatus()
  ]);
  const {defaultSoleActive:activeDefault,
    stagedUniqueInactive:inactiveChatgpt}=assessPreActivationWorldBranches(branches);
  const objectsList=Array.isArray(objects?.objects)?objects.objects:[];
  const spawn=objectsList.find(o=>
    (o?.type==='spawn'||o?.structureType==='spawn')&&
    o.x===TARGET.x&&o.y===TARGET.y&&
    o.name===TARGET.spawnName&&String(o.user||'')===String(id));
  return {spawnVerified:Boolean(spawn),activeDefault,inactiveChatgpt,
    observedWorldStatus:typeof status?.status==='string'?status.status:'UNKNOWN'};
}

/**
 * Explicitly authorized World activation, only after the pinned owned spawn
 * has been independently verified. NEVER automatically retry a POST.
 */
export async function activateVerifiedWorldSpawn(api,id,placement) {
  // O49: imported World mutator remains quarantined even with an injected
  // duck-typed API that bypasses ScreepsHttpClient's HTTP firewall.
  assertLegacyWorldMutationDisabled('legacy-first-spawn');
  if(api?.defaultShard!==TARGET.shard || !id ||
     placement?.status!=='PASS' || placement?.spawnVerified!==true ||
     placement?.target?.shard!==TARGET.shard ||
     placement?.target?.room!==TARGET.room ||
     placement?.target?.x!==TARGET.x || placement?.target?.y!==TARGET.y ||
     placement?.activeBranch!=='default' ||
     placement?.worldCodeActivated!==false)
    throw Object.assign(new Error('WORLD_ACTIVATION_REQUIRES_VERIFIED_PLACEMENT'),{
      phase:'ACTIVATION_PRECONDITIONS',
      failures:['OWNED_EXACT_SPAWN_NOT_YET_VERIFIED']});
  const proof=await readBackSpawn(api,id);
  if(!proof.spawnVerified||!proof.activeDefault||!proof.inactiveChatgpt)
    throw Object.assign(new Error('WORLD_SPAWN_OR_BRANCH_CHANGED'),{
      phase:'ACTIVATION_FRESH_READBACK',
      failures:['OWNED_SPAWN_AND_INACTIVE_BRANCH_REQUIRED']});
  const game=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','game');
  const expected=Object.fromEntries(fs.readdirSync(game).filter(name=>name.endsWith('.js'))
    .sort().map(name=>[name.slice(0,-3),
      fs.readFileSync(path.join(game,name),'utf8')]));
  if(Object.keys(expected).length<8)
    throw Object.assign(new Error('WORLD_LOCAL_GAME_MODULE_SET_INVALID'),{
      phase:'ACTIVATION_CODE_READBACK',failures:['GAME_MODULES_UNVERIFIED']});
  const branches=await api.userBranches();
  const exact=await verifyStagedWorldCode(api,branches?.list,expected);
  if(exact.status!=='EXACT_INACTIVE_CODE'||exact.exactSourceMatch!==true)
    throw Object.assign(new Error('WORLD_CODE_NOT_EXACTLY_STAGED'),{
      phase:'ACTIVATION_CODE_READBACK',
      failures:['CHATGPT_CODE_MUST_MATCH_EXACT_TESTED_MAIN']});
  const final=await readBackSpawn(api,id);
  if(!final.spawnVerified||!final.activeDefault||!final.inactiveChatgpt)
    throw Object.assign(new Error('WORLD_ACTIVATION_STATE_CHANGED'),{
      phase:'ACTIVATION_LAST_GET_GATE',
      failures:['OWNED_SPAWN_OR_WORLD_BRANCH_CHANGED']});
  let response;
  try {
    response=await api.userSetActiveBranch('chatgpt','activeWorld');
  } catch {
    throw Object.assign(new Error('WORLD_ACTIVATION_RESULT_UNCERTAIN'),{
      phase:'ACTIVATION_POST_UNCERTAIN',
      failures:['GET_ONLY_RECOVERY_DO_NOT_RETRY']});
  }
  if(response?.ok===false||response?.error)
    throw Object.assign(new Error('WORLD_ACTIVATION_RESPONSE_REJECTED'),{
      phase:'ACTIVATION_POST_REJECTED',
      failures:['GET_ONLY_RECOVERY_DO_NOT_RETRY']});
  try {
    const [objects,branchesAfter]=await Promise.all([
      api.gameRoomObjects(TARGET.room,TARGET.shard),api.userBranches()
    ]);
    const spawn=Array.isArray(objects?.objects)&&objects.objects.some(o=>
      (o?.type==='spawn'||o?.structureType==='spawn') &&
      o.x===TARGET.x && o.y===TARGET.y &&
      o.name===TARGET.spawnName && String(o.user||'')===String(id));
    const active=Array.isArray(branchesAfter?.list)?
      branchesAfter.list.filter(b=>b?.activeWorld===true):[];
    if(!spawn||active.length!==1||active[0]?.branch!=='chatgpt')
      throw new Error('POST_ACTIVATION_READBACK_MISMATCH');
  } catch {
    throw Object.assign(new Error('WORLD_ACTIVATION_NOT_VERIFIED'),{
      phase:'ACTIVATION_POST_GET_UNVERIFIED',
      failures:['GET_ONLY_RECOVERY_DO_NOT_RETRY']});
  }
  return {status:'PASS',server:'world',target:{...TARGET},
    spawnVerified:true,activeBranch:'chatgpt',
    worldCodeActivated:true,placementApiCalls:1,activationApiCalls:1,
    acceptedRisk:'W35N11_RCL8_ONLY'};
}

export async function placePinnedWorldSpawn(api,id) {
  // O49: imported World mutator remains quarantined even with an injected
  // duck-typed API that bypasses ScreepsHttpClient's HTTP firewall.
  assertLegacyWorldMutationDisabled('legacy-first-spawn');
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
  if(!assessPreActivationWorldBranches(beforeBranches).ok)
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
  // O45: refuse World mutations even with old approval strings and secrets.
  // No credentials, config file or network call may precede this HOLD.
  assertLegacyWorldMutationDisabled('legacy-first-spawn');
  const required={
    WORLD_FIRST_SPAWN_CONFIRM:PLACEMENT_CONFIRM,
    WORLD_RCL8_RISK_CONFIRM:RIVAL_CONFIRM,
    WORLD_ACTIVATION_CONFIRM:ACTIVATION_CONFIRM,
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
      // Durable spawn proof must survive even if later activation fails.
      safeReceipt(output,'world-first-spawn-success.json',{
        ...result,sourceCommit:process.env.GITHUB_SHA||null,
        confirmedAt:new Date().toISOString()});
      console.log('WORLD_FIRST_SPAWN_VERIFIED '+JSON.stringify(result));
      const activated=await activateVerifiedWorldSpawn(api,id,result);
      safeReceipt(output,'world-first-spawn-activation.json',{
        ...activated,sourceCommit:process.env.GITHUB_SHA||null,
        confirmedAt:new Date().toISOString()});
      console.log('WORLD_FIRST_SPAWN_ACTIVATED '+JSON.stringify(activated));
    } catch(err) {
      const receipt={status:'FAILED_OR_UNVERIFIED',
        phase:typeof err?.phase==='string'?err.phase:'UNKNOWN_STAGE',
        failures:Array.isArray(err?.failures)?err.failures:
          ['WORLD_PLACEMENT_UNVERIFIED'],
        target:{...TARGET},mayHavePlacedSpawn:
          ['PLACEMENT_API_RETURN_UNCERTAIN','PLACEMENT_API_REJECTED',
            'POST_PLACEMENT_GET_ONLY_VERIFICATION'].includes(err?.phase),
        neverRetryAutomatically:true,
        activationAttempted:['ACTIVATION_POST_UNCERTAIN',
          'ACTIVATION_POST_REJECTED','ACTIVATION_POST_GET_UNVERIFIED'].includes(err?.phase),
        activationMayHaveOccurred:['ACTIVATION_POST_UNCERTAIN',
          'ACTIVATION_POST_REJECTED','ACTIVATION_POST_GET_UNVERIFIED'].includes(err?.phase),
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
  main().catch(err=>{
    // Keep credentials out of errors while showing the exact O45 block reason.
    console.error(String(err?.message || '').startsWith('O45_WORLD_MUTATION_HOLD_')
      ? 'O45_WORLD_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR'
      : 'World placement blocked before protected staging');
    process.exitCode=1;
  });
