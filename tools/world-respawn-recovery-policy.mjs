// O23: fail-closed respawn *decision* contract. Pure function, no HTTP calls.
// Owner has approved respawn and future automatic recovery on 2026-10-16.
// No documented authenticated respawn transport or signed-in game browser is
// connected. This module MUST NOT manufacture a POST URL or execute resets.
export const WORLD_RECOVERY_POLICY = Object.freeze({
  autoRespawnUserApproved: true,
  approvalSource: 'user-2026-10-16',
  minimumDistinctLostObservations: 2,
  minimumElapsedSeconds: 180,
  requireProvenNoFunctionalFoothold: true,
  requireVerifiedSupportedRespawnAction: true,
  requireExplicitResetScope: true,
  allowAutoCodeDeploymentBypassingMainGate: false
});

const knownStatuses = new Set(['normal', 'lost', 'empty']);
const safeTime = n => Number.isSafeInteger(n) && n >= 0;

export function assessWorldRespawnReadiness(evidence, policy = WORLD_RECOVERY_POLICY) {
  const blockers = [];
  const obs = Array.isArray(evidence?.observations) ? evidence.observations : [];
  if (!policy?.autoRespawnUserApproved) blockers.push('USER_APPROVAL_REQUIRED');
  if (obs.length < 2 || obs.length > 12 ||
      obs.some(o => !knownStatuses.has(o?.status) || !safeTime(o?.unixSeconds))) {
    blockers.push('TWO_VALID_ACCOUNT_OBSERVATIONS_REQUIRED');
  }
  const latest = obs.at(-1), earliest = obs[0];
  if (obs.length >= 2 && latest?.status !== 'lost')
    blockers.push('ACCOUNT_STATUS_NOT_LOST');
  if (obs.length >= 2 && obs.some(o => o.status !== 'lost'))
    blockers.push('LOSS_NOT_STABLE_ACROSS_OBSERVATIONS');
  if (obs.length >= 2 &&
      (!safeTime(earliest?.unixSeconds) || !safeTime(latest?.unixSeconds) ||
      latest.unixSeconds - earliest.unixSeconds <
        policy.minimumElapsedSeconds))
    blockers.push('LOSS_OBSERVATION_WINDOW_TOO_SHORT');
  if (evidence?.worldAccountIdentityVerified !== true)
    blockers.push('WORLD_ACCOUNT_IDENTITY_UNVERIFIED');
  if (evidence?.allShardAndSimHoldingsEnumerated !== true)
    blockers.push('FOOTHOLD_ENUMERATION_INCOMPLETE');
  if (evidence?.sameTickEngineSpawnCount !== 0)
    blockers.push('ENGINE_SPAWN_ABSENCE_NOT_VERIFIED');
  if (evidence?.sameTickEngineCreepCount !== 0)
    blockers.push('ENGINE_CREEP_ABSENCE_NOT_VERIFIED');
  if (evidence?.otherRecoverableFootholdAbsentVerified !== true)
    blockers.push('RECOVERABLE_FOOTHOLD_NOT_RULED_OUT');
  if (evidence?.accountResetScopeVerified !== true)
    blockers.push('RESET_SCOPE_UNVERIFIED');
  if (evidence?.documentedRespawnTransportVerified !== true)
    blockers.push('RESPAWN_TRANSPORT_NOT_VERIFIED');
  if (evidence?.nonRetryingRespawnExecutorAvailable !== true)
    blockers.push('EXACTLY_ONCE_EXECUTOR_MISSING');
  if (evidence?.preWriteFreshWorldStatus !== 'lost')
    blockers.push('IMMEDIATE_PREWRITE_LOST_GET_REQUIRED');
  // This result intentionally has no 'execute' callback. Any integration
  // requires a separately reviewed transport and no bypass of main LIVE gate.
  return {
    verdict: blockers.length === 0 ? 'ELIGIBLE_FOR_SEPARATELY_VERIFIED_EXECUTOR'
      : 'HOLD',
    blockers,
    policyUserApproved: policy.autoRespawnUserApproved === true,
    mutationAttempted: false,
    codeDeploymentAuthorized: false,
    placementAuthorized: false,
    worldResetCompleted: false
  };
}
