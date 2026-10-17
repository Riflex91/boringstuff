import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyDurableCodeBackup } from './o41-durable-code-backup.mjs';

// O42 protocol rehearsal ONLY. Public repository Actions artifacts must never
// contain plaintext rollback code, a deployment ID, or an encryption key.
// This module does NOT call Screeps, write a live deployment receipt, or grant
// permission to perform a code POST.
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hold = reason => { throw new Error('O42_ESCROW_HOLD_' + reason); };
const validate = (value, pattern) => typeof value === 'string' && pattern.test(value);
const expectedContext = ctx => {
  if (!ctx || !validate(ctx.repository, /^[\w.-]{1,100}\/[\w.-]{1,100}$/) ||
      !validate(ctx.commit, /^[a-f0-9]{40}$/) ||
      !validate(ctx.runId, /^[1-9][0-9]{1,19}$/) ||
      !['world','newbieland'].includes(ctx.server) ||
      !validate(ctx.branch, /^[A-Za-z0-9_-]{1,80}$/))
    hold('CONTEXT_UNVERIFIED');
  return {
    repository: ctx.repository, commit: ctx.commit, runId: ctx.runId,
    server: ctx.server, branch: ctx.branch
  };
};
function getKey(keyHex) {
  if (!validate(keyHex, /^[a-f0-9]{64}$/i)) hold('KEY_UNVERIFIED');
  return Buffer.from(keyHex, 'hex');
}
function strictFile(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink()) hold('FILE_NOT_REGULAR');
  return fs.readFileSync(file);
}
function onlyTwoFiles(directory) {
  const entries=fs.readdirSync(directory).sort();
  if (entries.length !== 2 ||
      entries[0] !== 'backup.enc' || entries[1] !== 'escrow-envelope.json')
    hold('UNEXPECTED_ARCHIVE_CONTENTS');
  for (const name of entries)
    strictFile(path.join(directory,name));
}
function assertContainedFile(directory, file) {
  if (typeof directory !== 'string' || typeof file !== 'string' ||
      !path.isAbsolute(directory) || !path.isAbsolute(file) ||
      path.dirname(file) !== path.resolve(directory)) hold('ESCROW_PATH_INVALID');
  const dirStat = fs.lstatSync(directory);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) hold('DIRECTORY_UNSAFE');
}
const deny = verified => Object.freeze({
  remoteEncryptedEscrowVerified: verified,
  mayUploadWorldCode: false,
  mayRetryCodePost: false,
  mayWriteDeploymentReceipt: false,
  mayMergeCandidate: false,
  releaseAuthorized: false,
  canonicalLive100tPass: false,
  requiresSeparateApprovedProductionIntegration: true
});

export function sealBackupForOfflineEscrow({
  backupFile, backupSha256, archiveDir, keyHex, context,
  deploymentId, previousModules
}) {
  const ctx=expectedContext(context), key=getKey(keyHex);
  try {
    const verified=verifyDurableCodeBackup({
      file: backupFile, sha256: backupSha256,
      server: ctx.server, branch: ctx.branch, deploymentId,
      expectedPriorModules: previousModules
    });
    if (!verified.verified) hold('BACKUP_UNVERIFIED');
    if (!path.isAbsolute(archiveDir) || fs.existsSync(archiveDir))
      hold('ARCHIVE_ALREADY_EXISTS_OR_RELATIVE');
    fs.mkdirSync(archiveDir, {mode:0o700});
    const contents=strictFile(backupFile);
    const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
    cipher.setAAD(Buffer.from(JSON.stringify(ctx),'utf8'));
    const encrypted=Buffer.concat([cipher.update(contents),cipher.final()]);
    const envelope={
      format:'O42_OFFLINE_ENCRYPTED_BACKUP_V1',
      context:ctx, originalSha256:sha(contents),
      deploymentIdSha256:sha(Buffer.from(deploymentId)),
      encryptedSha256:sha(encrypted),
      iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex')
    };
    const encryptionPath=path.join(archiveDir,'backup.enc');
    const envelopePath=path.join(archiveDir,'escrow-envelope.json');
    fs.writeFileSync(encryptionPath,encrypted,{flag:'wx',mode:0o600});
    fs.writeFileSync(envelopePath,JSON.stringify(envelope,null,2)+'\n',
      {flag:'wx',mode:0o600});
    onlyTwoFiles(archiveDir);
    return deny(false);
  } catch (err) {
    if (String(err?.message||'').startsWith('O42_ESCROW_HOLD_')) throw err;
    hold('PREPARATION_FAILED');
  }
}

export function verifyOfflineRemoteEscrow({
  localArchiveDir, remoteArchiveDir, backupFile,
  backupSha256, keyHex, context, deploymentId, previousModules
}) {
  const ctx=expectedContext(context), key=getKey(keyHex);
  try {
    if (!path.isAbsolute(localArchiveDir) ||
        !path.isAbsolute(remoteArchiveDir) ||
        path.resolve(localArchiveDir) === path.resolve(remoteArchiveDir))
      hold('REMOTE_NOT_INDEPENDENT');
    assertContainedFile(path.dirname(backupFile),backupFile);
    onlyTwoFiles(localArchiveDir);
    onlyTwoFiles(remoteArchiveDir);
    const read=(dir,name)=>strictFile(path.join(dir,name));
    const envelopeLocal=read(localArchiveDir,'escrow-envelope.json');
    const envelopeRemote=read(remoteArchiveDir,'escrow-envelope.json');
    const cipherLocal=read(localArchiveDir,'backup.enc');
    const cipherRemote=read(remoteArchiveDir,'backup.enc');
    if (!envelopeLocal.equals(envelopeRemote) || !cipherLocal.equals(cipherRemote))
      hold('REMOTE_BYTES_DIFFER');
    const e=JSON.parse(envelopeRemote.toString('utf8'));
    if (e.format!=='O42_OFFLINE_ENCRYPTED_BACKUP_V1' ||
        JSON.stringify(e.context)!==JSON.stringify(ctx) ||
        e.originalSha256!==backupSha256 ||
        e.encryptedSha256!==sha(cipherRemote) ||
        e.deploymentIdSha256!==sha(Buffer.from(deploymentId)) ||
        !validate(e.iv,/^[a-f0-9]{24}$/) ||
        !validate(e.tag,/^[a-f0-9]{32}$/))
      hold('ENVELOPE_MISMATCH');
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'hex'));
    decipher.setAAD(Buffer.from(JSON.stringify(ctx),'utf8'));
    decipher.setAuthTag(Buffer.from(e.tag,'hex'));
    const decrypted=Buffer.concat([decipher.update(cipherRemote),decipher.final()]);
    const original=strictFile(backupFile);
    if (!decrypted.equals(original) || sha(original)!==backupSha256)
      hold('ROLLBACK_BYTES_MISMATCH');
    verifyDurableCodeBackup({
      file:backupFile,sha256:backupSha256,server:ctx.server,
      branch:ctx.branch,deploymentId,expectedPriorModules:previousModules
    });
    return deny(true);
  } catch (err) {
    if (String(err?.message||'').startsWith('O42_ESCROW_HOLD_')) throw err;
    hold('REMOTE_VERIFICATION_FAILED');
  }
}
