import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyDurableCodeBackup } from './o41-durable-code-backup.mjs';

// O43: confidential rollback escrow with a RECOVERABLE content key.
// The recipient private key is NEVER needed on the deployment runner.
// This module deliberately has no HTTP or Screeps upload capability.
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = reason => { throw new Error('O43_RECOVERABLE_ESCROW_HOLD_' + reason); };
const isHex = (value, length) => typeof value === 'string' &&
  new RegExp('^[a-f0-9]{' + length + '}$').test(value);
const expected = ctx => {
  if (!ctx || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(ctx.repository || '') ||
      !isHex(ctx.commit, 40) || !/^[1-9][0-9]{0,19}$/.test(ctx.runId || '') ||
      !['world', 'newbieland'].includes(ctx.server) ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(ctx.branch || '')) fail('CONTEXT');
  return Object.freeze({
    repository: ctx.repository, commit: ctx.commit, runId: ctx.runId,
    server: ctx.server, branch: ctx.branch
  });
};
function publicKey(pem) {
  try {
    const key=crypto.createPublicKey(pem);
    if (key.asymmetricKeyType !== 'rsa' ||
        !Number.isInteger(key.asymmetricKeyDetails?.modulusLength) ||
        key.asymmetricKeyDetails.modulusLength < 3072) fail('RSA_KEY_TOO_WEAK');
    return key;
  } catch { fail('RSA_PUBLIC_KEY'); }
}
export function rsaRecipientFingerprint(publicKeyPem) {
  const key=publicKey(publicKeyPem);
  return digest(key.export({type:'spki',format:'der'}));
}
function assertRecipient(publicKeyPem, fingerprint) {
  const key=publicKey(publicKeyPem);
  if (!isHex(fingerprint,64) ||
      rsaRecipientFingerprint(publicKeyPem)!==fingerprint)
    fail('PINNED_RECIPIENT_MISMATCH');
  return key;
}
function readArtifactFile(file) {
  const stat=fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('UNSAFE_ARTIFACT_FILE');
  // GitHub download-artifact normalizes downloaded file modes to 0644.
  // The archive is encrypted public data; its integrity is authenticated.
  return fs.readFileSync(file);
}
function readPrivateFile(file) {
  const stat=fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      (process.platform !== 'win32' && (stat.mode & 0o077)!==0))
    fail('UNSAFE_PRIVATE_BACKUP');
  return fs.readFileSync(file);
}
function readEnvelope(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir))
    fail('ARCHIVE_DIRECTORY');
  let stat;
  try { stat=fs.lstatSync(dir); }
  catch { fail('ARCHIVE_DIRECTORY'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('ARCHIVE_DIRECTORY');
  const files=fs.readdirSync(dir).sort();
  if (files.length!==2 || files[0]!=='backup.enc' ||
      files[1]!=='escrow-envelope.json') fail('ARCHIVE_INVENTORY');
  const body=readArtifactFile(path.join(dir,'backup.enc'));
  const raw=readArtifactFile(path.join(dir,'escrow-envelope.json'));
  let envelope;
  try { envelope=JSON.parse(raw.toString('utf8')); }
  catch { fail('ENVELOPE_JSON'); }
  return {body,raw,envelope};
}
function validateEnvelope(e,ctx,pin,body) {
  if (e?.format!=='O43_RECOVERABLE_ESCROW_V1' ||
      JSON.stringify(e.context)!==JSON.stringify(ctx) ||
      e.recipientFingerprint!==pin ||
      !isHex(e.originalSha256,64) ||
      !isHex(e.encryptedSha256,64) ||
      e.encryptedSha256!==digest(body) ||
      !isHex(e.deploymentIdSha256,64) ||
      !isHex(e.iv,24) || !isHex(e.tag,32) ||
      typeof e.wrappedKey!=='string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(e.wrappedKey))
    fail('ENVELOPE_INVALID');
}
function decrypt(body,e,ctx,key) {
  try {
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'hex'));
    decipher.setAAD(Buffer.from(JSON.stringify({context:ctx,recipient:e.recipientFingerprint})));
    decipher.setAuthTag(Buffer.from(e.tag,'hex'));
    const plaintext=Buffer.concat([decipher.update(body),decipher.final()]);
    if (digest(plaintext)!==e.originalSha256) fail('PLAINTEXT_HASH');
    return plaintext;
  } catch { fail('AUTHENTICATED_DECRYPTION'); }
}
const noApproval=verified=>Object.freeze({
  remoteBackupVerified:verified, releaseAuthorized:false,
  mayUploadWorldCode:false, mayMergeCandidate:false,
  mayWriteDeploymentReceipt:false, mayRetryCodePost:false,
  privateRecoveryKeyStayedOffRunner:true
});
export function sealRecoverableBackup({
  backupFile, backupSha256, archiveDir, context,
  deploymentId, previousModules, recipientPublicKeyPem, recipientFingerprint
}) {
  const ctx=expected(context), pub=assertRecipient(recipientPublicKeyPem,recipientFingerprint);
  verifyDurableCodeBackup({
    file:backupFile,sha256:backupSha256,server:ctx.server,branch:ctx.branch,
    deploymentId,expectedPriorModules:previousModules
  });
  if (!path.isAbsolute(archiveDir) || fs.existsSync(archiveDir))
    fail('ARCHIVE_EXISTS_OR_RELATIVE');
  const plaintext=readPrivateFile(backupFile);
  const key=crypto.randomBytes(32), iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(JSON.stringify({context:ctx,recipient:recipientFingerprint})));
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  const wrapped=crypto.publicEncrypt({
    key:pub,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'
  },key);
  const envelope={
    format:'O43_RECOVERABLE_ESCROW_V1',
    context:ctx,recipientFingerprint,
    originalSha256:digest(plaintext),
    deploymentIdSha256:digest(Buffer.from(deploymentId)),
    encryptedSha256:digest(ciphertext),
    wrappedKey:wrapped.toString('base64'),
    iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex')
  };
  fs.mkdirSync(archiveDir,{mode:0o700});
  fs.writeFileSync(path.join(archiveDir,'backup.enc'),ciphertext,
    {mode:0o600,flag:'wx'});
  fs.writeFileSync(path.join(archiveDir,'escrow-envelope.json'),
    JSON.stringify(envelope,null,2)+'\n',{mode:0o600,flag:'wx'});
  readEnvelope(archiveDir);
  // This ephemeral key is ONLY for authenticated same-run readback.
  // The remote archive also contains its RSA-wrapped recovery copy.
  return Object.freeze({
    ephemeralKeyHex:key.toString('hex'),
    fingerprint:recipientFingerprint,
    ...noApproval(false)
  });
}
export function verifyDownloadedRecoverableBackup({
  localArchiveDir,downloadedArchiveDir,backupFile,backupSha256,
  context,deploymentId,previousModules,
  recipientPublicKeyPem,recipientFingerprint,ephemeralKeyHex
}) {
  const ctx=expected(context);
  assertRecipient(recipientPublicKeyPem,recipientFingerprint);
  if (!isHex(ephemeralKeyHex,64) ||
      path.resolve(localArchiveDir)===path.resolve(downloadedArchiveDir))
    fail('UNVERIFIED_REMOTE_OR_KEY');
  const local=readEnvelope(localArchiveDir);
  const remote=readEnvelope(downloadedArchiveDir);
  if (!local.body.equals(remote.body) || !local.raw.equals(remote.raw))
    fail('REMOTE_BYTES_CHANGED');
  validateEnvelope(remote.envelope,ctx,recipientFingerprint,remote.body);
  const plaintext=decrypt(remote.body,remote.envelope,ctx,
    Buffer.from(ephemeralKeyHex,'hex'));
  if (remote.envelope.deploymentIdSha256!==digest(Buffer.from(deploymentId)) ||
      backupSha256!==digest(plaintext) ||
      !plaintext.equals(readPrivateFile(backupFile)))
    fail('ORIGINAL_BACKUP_MISMATCH');
  verifyDurableCodeBackup({
    file:backupFile,sha256:backupSha256,server:ctx.server,branch:ctx.branch,
    deploymentId,expectedPriorModules:previousModules
  });
  return noApproval(true);
}
export function restoreBackupWithOfflinePrivateKey({
  downloadedArchiveDir,context,recipientFingerprint,recipientPrivateKeyPem
}) {
  const ctx=expected(context);
  const {body,envelope}=readEnvelope(downloadedArchiveDir);
  validateEnvelope(envelope,ctx,recipientFingerprint,body);
  let key;
  try {
    key=crypto.privateDecrypt({
      key:recipientPrivateKeyPem,
      padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'
    },Buffer.from(envelope.wrappedKey,'base64'));
  } catch { fail('OFFLINE_PRIVATE_KEY_NOT_MATCHED'); }
  if (key.length!==32) fail('UNWRAPPED_KEY_LENGTH');
  const plaintext=decrypt(body,envelope,ctx,key);
  // Operator keeps this key OFF the GitHub runner. No restored source logged.
  return Object.freeze({
    restoredBytes:plaintext,originalSha256:digest(plaintext),
    ...noApproval(true)
  });
}
