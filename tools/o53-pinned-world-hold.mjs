import {createHash} from 'node:crypto';

// O53: the AST can prove imports and first-statement calls but NOT that
// the imported guard continues to unconditionally throw. Pin its entire
// reviewed Git blob. Any edit, even a comment, requires independent review
// and an explicit pin refresh; NO auto-update from checked-out source.
export const PINNED_WORLD_HOLD_GIT_BLOB =
  '7f832a573082c5e6dd8ce714f97da95e7829f230';
export const WORLD_HOLD_IMPLEMENTATION_MISMATCH =
  'O53_WORLD_HOLD_IMPLEMENTATION_BLOB_MISMATCH';

export function gitBlobSha(source){
  if(typeof source!=='string')throw new Error(WORLD_HOLD_IMPLEMENTATION_MISMATCH);
  const data=Buffer.from(source,'utf8');
  return createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex');
}
export function verifyPinnedWorldHoldImplementation(source){
  const actual=gitBlobSha(source);
  return Object.freeze({
    actualGitBlob:actual,
    pinnedGitBlob:PINNED_WORLD_HOLD_GIT_BLOB,
    verified:actual===PINNED_WORLD_HOLD_GIT_BLOB,
    mayUploadWorldCode:false,mayRetryCodePost:false,
    releaseAuthorized:false
  });
}
