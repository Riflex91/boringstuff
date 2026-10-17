import { assertLegacyWorldMutationDisabled } from './o45-world-mutation-entrypoint-hold.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export function assessWorldCodeBootstrap({ account, status, branches, backup }) {
  const failures = [];
  if (account?.ok === false || !(account?._id || account?.id)) failures.push('ACCOUNT_UNVERIFIED');
  if (status?.ok === false || status?.status !== 'empty') failures.push('ACCOUNT_NOT_EMPTY');
  const list = Array.isArray(branches?.list) ? branches.list : [];
  if (list.some(b => b?.branch === 'chatgpt')) failures.push('WORLD_BRANCH_ALREADY_EXISTS');
  if (!list.some(b => b?.branch === 'default' && b?.activeWorld === true))
    failures.push('DEFAULT_BRANCH_NOT_ACTIVE');
  if (!backup?.modules || typeof backup.modules !== 'object' || Array.isArray(backup.modules))
    failures.push('CURRENT_CODE_BACKUP_NOT_READABLE');
  return { ok: failures.length === 0, failures, targetBranch: 'chatgpt' };
}
export function verifyUploadedWorldModules(expected, actual) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const names = Object.keys(expected).sort();
  const got = Object.keys(actual).sort();
  return names.length === got.length &&
    names.every((name,i) => name === got[i] && expected[name] === actual[name]);
}
function hash(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function validNewModuleSet(modules) {
  if (!modules || typeof modules!=='object' || Array.isArray(modules))
    return false;
  const names=Object.keys(modules);
  return names.length>=8 && typeof modules.main==='string' &&
    modules.main.trim().length>10 && typeof modules.config==='string' &&
    /VERSION\s*:/.test(modules.config) &&
    names.every(name => /^[a-zA-Z0-9_.-]+$/.test(name) &&
      typeof modules[name]==='string');
}

function safeBranchState(branches,status) {
  const list=Array.isArray(branches?.list)?branches.list:[];
  const selected=list.filter(b=>b?.branch==='chatgpt');
  const base=list.filter(b=>b?.branch==='default');
  return {
    worldEmpty:status?.status==='empty',
    defaultActive:base.length===1 && base[0].activeWorld===true,
    chatgptPresent:selected.length===1,
    chatgptActive:selected.some(b=>b.activeWorld===true),
    duplicateBranch:selected.length>1
  };
}

function exactInactiveBranch(branches,status) {
  const state=safeBranchState(branches,status);
  return state.worldEmpty && state.defaultActive &&
    state.chatgptPresent && !state.chatgptActive && !state.duplicateBranch;
}

export function classifyWorldStageFailure(err) {
  const code=Number(err?.statusCode);
  const httpStatus=Number.isSafeInteger(code)&&code>=100&&code<=599?code:null;
  const kind=httpStatus===401||httpStatus===403?'AUTHORIZATION_OR_SCOPE':
    httpStatus===429?'RATE_LIMIT':
    httpStatus===404?'ENDPOINT_OR_BRANCH_NOT_FOUND':
    httpStatus!==null?'HTTP_REJECTED':'LOCAL_OR_NETWORK_ERROR';
  // Only finite status codes and fixed categories are safe to expose: error
  // strings/responses may contain credentials, code contents or account ids.
  return {kind,httpStatus};
}

/**
 * Mutating ONLY under the workflow's STAGE_WORLD_CODE operator gate.
 * Official World exposes a separate "clone-branch" operation; code uploads
 * alone must not be relied on to create a missing branch.
 *
 * World default is never modified, chatgpt is NEVER made active.
 * After clone, failed upload leaves an inactive branch for manual diagnosis;
 * never auto-retry it or delete/activate it.
 */
export async function stageInactiveWorldCode(api,modules,onPhase=()=>{}) {
  // O49: imported World mutator remains quarantined even with an injected
  // duck-typed API that bypasses ScreepsHttpClient's HTTP firewall.
  assertLegacyWorldMutationDisabled('legacy-code-bootstrap');
  if (!validNewModuleSet(modules))
    throw new Error('INVALID_LOCAL_GAME_MODULE_SET');
  onPhase('READ_INITIAL_STATE');
  const [account,status,branches,backup]=await Promise.all([
    api.authMe(),api.userWorldStatus(),api.userBranches(),
    api._request('GET','/api/user/code',{branch:'default'})
  ]);
  const gate=assessWorldCodeBootstrap({account,status,branches,backup});
  if (!gate.ok) throw new Error('INITIAL_WORLD_GATE_BLOCKED');
  onPhase('CHECK_BEFORE_CLONE');
  // Close the read-to-write race by rechecking World state immediately before
  // creating anything on the official server.
  const [secondBranches,secondStatus]=await Promise.all([
    api.userBranches(),api.userWorldStatus()
  ]);
  if (!assessWorldCodeBootstrap({
    account,status:secondStatus,branches:secondBranches,backup
  }).ok) throw new Error('WORLD_STATE_CHANGED_BEFORE_CLONE');

  onPhase('CLONE_REQUEST');
  const clone=await api._request('POST','/api/user/clone-branch',{
    branch:'default',newName:'chatgpt',defaultModules:false
  });
  if (clone?.ok===false) throw new Error('WORLD_CLONE_NOT_ACCEPTED');

  onPhase('VERIFY_INACTIVE_CLONE');
  const [clonedBranches,clonedStatus]=await Promise.all([
    api.userBranches(),api.userWorldStatus()
  ]);
  if (!exactInactiveBranch(clonedBranches,clonedStatus))
    throw new Error('WORLD_CLONE_NOT_INACTIVE_OR_DEFAULT_CHANGED');

  onPhase('UPLOAD_CHATGPT_ONLY');
  const upload=await api._request('POST','/api/user/code',{
    branch:'chatgpt',modules
  });
  if(upload?.ok===false)throw new Error('WORLD_UPLOAD_NOT_ACCEPTED');

  onPhase('VERIFY_EXACT_UPLOAD');
  const [code,afterBranches,afterStatus]=await Promise.all([
    api._request('GET','/api/user/code',{branch:'chatgpt'}),
    api.userBranches(),api.userWorldStatus()
  ]);
  if(!exactInactiveBranch(afterBranches,afterStatus) ||
     !verifyUploadedWorldModules(modules,code?.modules))
    throw new Error('WORLD_EXACT_UPLOAD_VERIFICATION_FAILED');
  onPhase('STAGED_INACTIVE_VERIFIED');
  return {status:'PASS',branch:'chatgpt',moduleCount:Object.keys(modules).length,
    exactByteMatch:true,activeWorld:'default',spawnPlaced:false};
}

async function readSanitizedBranchState(api) {
  if(!api)return {verified:false};
  try {
    const [branches,status]=await Promise.all([
      api.userBranches(),api.userWorldStatus()
    ]);
    return {verified:true,...safeBranchState(branches,status)};
  } catch {
    return {verified:false};
  }
}

function writeStageReceipt(folder,name,record) {
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(folder,name),
    JSON.stringify(record,null,2)+'\n',{mode:0o600});
}

async function main() {
  // O45: refuse World mutations even with old approval strings and secrets.
  // No credentials, config file or network call may precede this HOLD.
  assertLegacyWorldMutationDisabled('legacy-code-bootstrap');
  const temp=process.env.RUNNER_TEMP;
  if(!temp || process.env.WORLD_BOOTSTRAP_CONFIRM!=='STAGE_WORLD_CODE')
    throw new Error('World code staging requires explicit authorized workflow gate');
  const filename=path.join(temp,'screeps-world-bootstrap-'+process.pid+'.json');
  const evidenceDir=path.join(temp,'world-bootstrap-evidence');
  fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});
  fs.writeFileSync(filename,JSON.stringify(buildWorldConfig(process.env)),
    {flag:'wx',mode:0o600});
  let api=null,phase='CONNECT';
  try {
    api=await ScreepsHttpClient.fromConfig('world',{file:filename});
    const game=path.join(here,'..','game');
    const files=fs.readdirSync(game).filter(x=>x.endsWith('.js')).sort();
    const modules=Object.fromEntries(files.map(f=>[
      f.slice(0,-3),fs.readFileSync(path.join(game,f),'utf8')
    ]));
    const result=await stageInactiveWorldCode(api,modules,next=>{
      phase=next;
      console.log('WORLD_CODE_STAGE_PHASE '+next);
    });
    writeStageReceipt(evidenceDir,'world-code-stage-receipt.json',{
      createdAt:new Date().toISOString(),server:'world',
      branch:'chatgpt',activated:false,worldStatus:'empty',
      moduleCount:files.length,
      sourceModuleHashes:Object.fromEntries(Object.entries(modules).map(
        ([name,bytes])=>[name,hash(bytes)])),
      exactModuleBytesVerified:true,spawnPlacementPerformed:false
    });
    console.log('WORLD_CODE_STAGED '+JSON.stringify(result));
  } catch(err) {
    const failure={status:'FAILED',phase,...classifyWorldStageFailure(err),
      branchState:await readSanitizedBranchState(api),
      spawnPlacementPerformed:false,worldActivationPerformed:false,
      requiresManualReview:true};
    writeStageReceipt(evidenceDir,'world-code-stage-failure.json',failure);
    console.error('WORLD_CODE_STAGE_FAILED '+JSON.stringify(failure));
    process.exitCode=1;
  } finally {
    fs.rmSync(filename,{force:true});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(err=>{
    // Only expose the fixed safety HOLD; do not log raw API or credential errors.
    console.error(String(err?.message || '').startsWith('O45_WORLD_MUTATION_HOLD_')
      ? 'O45_WORLD_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR'
      : 'World code bootstrap failed before protected World staging');
    process.exitCode=1;
  });
