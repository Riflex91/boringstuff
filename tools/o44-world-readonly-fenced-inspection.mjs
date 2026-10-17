import { inspectWorldWriterFence }
  from './o44-world-writer-ref-fence.mjs';
import { verifyTwoPhaseWorldPrePostGate }
  from './o43-two-phase-world-gate.mjs';

// Review-only O44 composition: verified GitHub ref ownership before and
// after the O43 read-only World gate. Deliberately NO single world-code POST
// capability. External non-cooperating writers are still not fenced.
export async function inspectWorldEscrowUnderWriterFence({
  writerTransport,writerLock,...o43
}) {
  const first=await inspectWorldWriterFence({
    transport:writerTransport,held:writerLock
  });
  const state=await verifyTwoPhaseWorldPrePostGate(o43);
  const second=await inspectWorldWriterFence({
    transport:writerTransport,held:writerLock
  });
  if (!first.lockHeld || !second.lockHeld ||
      first.ownerTagSha!==second.ownerTagSha ||
      state.stage!=='REMOTE_ESCROW_AND_GETS_VERIFIED_NO_WRITE')
    throw new Error('O44_WORLD_FENCED_DIAGNOSTIC_HOLD');
  return Object.freeze({
    status:'O44_LOCK_AND_REMOTE_ESCROW_VERIFIED_READ_ONLY',
    ownerTagSha:first.ownerTagSha,
    mayUploadWorldCode:false,mayRetryCodePost:false,
    mayWriteDeploymentReceipt:false,
    canonicalLive100tPass:false,releaseAuthorized:false,
    requiresOperatorReview:true
  });
}
