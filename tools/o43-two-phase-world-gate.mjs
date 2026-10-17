import { assertUniqueActiveCodeBranch, assertRestorablePreuploadCodeBackup }
  from './o39-code-upload-active-branch-policy.mjs';
import { writeDurableCodeBackup } from './o41-durable-code-backup.mjs';
import {
  sealRecoverableBackup, verifyDownloadedRecoverableBackup
} from './o43-recoverable-escrow.mjs';

// O43: stages are deliberately GET ONLY. This review-only implementation
// will NEVER call the user code POST. A later explicit operator-reviewed
// executor must consume a fresh attestation and add a single writer fence.
const hold = reason => { throw new Error('O43_TWO_PHASE_HOLD_' + reason); };
const denied = stage => Object.freeze({
  stage, prePostReadsVerified:true,
  mayUploadWorldCode:false, mayRetryCodePost:false,
  mayWriteDeploymentReceipt:false,
  mayMergeCandidate:false,releaseAuthorized:false,
  canonicalLive100tPass:false
});
function exactModules(left,right) {
  if (!left || !right || typeof left!=='object' || typeof right!=='object' ||
      Array.isArray(left) || Array.isArray(right)) return false;
  const names=Object.keys(left).sort(),rnames=Object.keys(right).sort();
  return names.length===82 && rnames.length===82 &&
    names.every((name,i)=>name===rnames[i] &&
      typeof left[name]==='string' && left[name]===right[name]);
}
async function GET(api,route,params={}) {
  if (!api || !api.token || typeof api._request!=='function') hold('AUTH_GET_ONLY');
  return api._request('GET',route,params,{retryAuth:false});
}
async function snapshot(api,branch) {
  // All settled: an unsuccessful preflight must not leave an orphaned request
  // writing a result later. This function never refreshes auth with POST.
  const p=await Promise.allSettled([
    GET(api,'/api/auth/me'),
    GET(api,'/api/user/world-status'),
    GET(api,'/api/user/branches'),
    GET(api,'/api/user/code',{branch})
  ]);
  if (p.some(x=>x.status!=='fulfilled')) hold('GET_FAILED');
  const [account,status,branches,code]=p.map(x=>x.value);
  return {account,status,branches,code};
}
function checkWorldSnapshot({account,status,branches,code},branch,expectedBefore) {
  try { assertUniqueActiveCodeBranch(branches,branch); }
  catch { hold('ACTIVE_WORLD_BRANCH_CHANGED'); }
  const id=account?._id||account?.id;
  if (!id || account?.ok===false) hold('ACCOUNT_IDENTITY');
  if (status?.ok===false || status?.status!=='normal')
    hold('WORLD_STATUS_NOT_NORMAL');
  if (expectedBefore) {
    if (!exactModules(code?.modules,expectedBefore))
      hold('SERVER_CODE_CHANGED_OR_INCOMPLETE');
  } else if (!code || !code.modules) {
    hold('PREUPLOAD_CODE_MISSING');
  }
  return String(id);
}
export async function prepareTwoPhaseWorldEscrow({
  api,context,targetModules,backupDirectory,archiveDirectory,
  deploymentId,recipientPublicKeyPem,recipientFingerprint,version
}) {
  if (context?.server!=='world') hold('WORLD_ONLY');
  if (!targetModules || Object.keys(targetModules).length!==82)
    hold('TARGET_SET_UNVERIFIED');
  const before=await snapshot(api,context.branch);
  const accountId=checkWorldSnapshot(before,context.branch);
  assertRestorablePreuploadCodeBackup(before.code,targetModules);
  const backup=writeDurableCodeBackup({
    directory:backupDirectory,server:'world',branch:context.branch,
    version,deploymentId,previousReply:before.code,expectedModules:targetModules
  });
  const escrow=sealRecoverableBackup({
    backupFile:backup.file,backupSha256:backup.sha256,
    archiveDir:archiveDirectory,context,deploymentId,
    previousModules:before.code.modules,
    recipientPublicKeyPem,recipientFingerprint
  });
  return Object.freeze({
    backupFile:backup.file,backupSha256:backup.sha256,
    accountId,originalModules:before.code.modules,
    deploymentId,ephemeralKeyHex:escrow.ephemeralKeyHex,
    context,targetModuleCount:82,
    ...denied('WAIT_FOR_VERIFIED_REMOTE_ESCROW')
  });
}
export async function verifyTwoPhaseWorldPrePostGate({
  api,prepared,targetModules,localArchiveDir,downloadedArchiveDir,
  recipientPublicKeyPem,recipientFingerprint
}) {
  if (prepared?.context?.server!=='world' ||
      prepared?.targetModuleCount!==82 ||
      !targetModules || Object.keys(targetModules).length!==82 ||
      !prepared.accountId) hold('PREPARATION_NOT_VERIFIED');
  const verified=verifyDownloadedRecoverableBackup({
    localArchiveDir,downloadedArchiveDir,
    backupFile:prepared.backupFile,backupSha256:prepared.backupSha256,
    context:prepared.context,deploymentId:prepared.deploymentId,
    previousModules:prepared.originalModules,
    recipientPublicKeyPem,recipientFingerprint,
    ephemeralKeyHex:prepared.ephemeralKeyHex
  });
  if (!verified.remoteBackupVerified) hold('REMOTE_BACKUP_NOT_VERIFIED');
  const state=await snapshot(api,prepared.context.branch);
  const currentId=checkWorldSnapshot(state,prepared.context.branch,
    prepared.originalModules);
  if (currentId!==prepared.accountId) hold('ACCOUNT_CHANGED');
  // This produces a diagnostic signal only. It never grants release or POST
  // authorization and cannot fence external writers after these GETs.
  return denied('REMOTE_ESCROW_AND_GETS_VERIFIED_NO_WRITE');
}
