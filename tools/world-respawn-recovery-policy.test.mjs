import assert from 'node:assert/strict';
import {WORLD_RECOVERY_POLICY,assessWorldRespawnReadiness}
 from './world-respawn-recovery-policy.mjs';
assert.equal(WORLD_RECOVERY_POLICY.autoRespawnUserApproved,true);
assert.equal(WORLD_RECOVERY_POLICY.allowAutoCodeDeploymentBypassingMainGate,false);
const ready={
  observations:[{status:'lost',unixSeconds:1000},
    {status:'lost',unixSeconds:1400}],
  worldAccountIdentityVerified:true,
  allShardAndSimHoldingsEnumerated:true,
  sameTickEngineSpawnCount:0,sameTickEngineCreepCount:0,
  globalAllShardCreepAbsenceVerified:true,
  otherRecoverableFootholdAbsentVerified:true,
  accountResetScopeVerified:true,
  documentedRespawnTransportVerified:true,
  nonRetryingRespawnExecutorAvailable:true,
  preWriteFreshWorldStatus:'lost'
};
const eligible=assessWorldRespawnReadiness(ready);
assert.equal(eligible.verdict,'ELIGIBLE_FOR_SEPARATELY_VERIFIED_EXECUTOR');
assert.equal(eligible.worldResetCompleted,false);
assert.equal(eligible.mutationAttempted,false);
for(const [key,value,code] of [
 ['worldAccountIdentityVerified',false,'WORLD_ACCOUNT_IDENTITY_UNVERIFIED'],
 ['allShardAndSimHoldingsEnumerated',false,'FOOTHOLD_ENUMERATION_INCOMPLETE'],
 ['sameTickEngineSpawnCount',1,'ENGINE_SPAWN_ABSENCE_NOT_VERIFIED'],
 ['sameTickEngineCreepCount',1,'ENGINE_CREEP_ABSENCE_NOT_VERIFIED'],
 ['globalAllShardCreepAbsenceVerified',false,'GLOBAL_OWNED_CREEP_ABSENCE_NOT_VERIFIED'],
 ['otherRecoverableFootholdAbsentVerified',false,'RECOVERABLE_FOOTHOLD_NOT_RULED_OUT'],
 ['accountResetScopeVerified',false,'RESET_SCOPE_UNVERIFIED'],
 ['documentedRespawnTransportVerified',false,'RESPAWN_TRANSPORT_NOT_VERIFIED'],
 ['nonRetryingRespawnExecutorAvailable',false,'EXACTLY_ONCE_EXECUTOR_MISSING'],
 ['preWriteFreshWorldStatus','normal','IMMEDIATE_PREWRITE_LOST_GET_REQUIRED']
]){
 const result=assessWorldRespawnReadiness({...ready,[key]:value});
 assert.equal(result.verdict,'HOLD',key);
 assert.ok(result.blockers.includes(code),key);
 assert.equal(result.mutationAttempted,false);
}
assert.equal(assessWorldRespawnReadiness({...ready,
  observations:[{status:'lost',unixSeconds:1000},{status:'lost',
    unixSeconds:1020}]}).verdict,'HOLD');
assert.equal(assessWorldRespawnReadiness({...ready,
  observations:[{status:'lost',unixSeconds:1000},{status:'normal',
    unixSeconds:1400}]}).verdict,'HOLD');
assert.equal(assessWorldRespawnReadiness({...ready,
  observations:[{status:'lost',unixSeconds:1000}]}).verdict,'HOLD');
const actualKnown={observations:[{status:'lost',unixSeconds:1000},
  {status:'lost',unixSeconds:1400}],
  worldAccountIdentityVerified:true,
  sameTickEngineCreepCount:0,
  sameTickEngineSpawnCount:0,
  otherRecoverableFootholdAbsentVerified:false,
  allShardAndSimHoldingsEnumerated:false,
  accountResetScopeVerified:false,
  documentedRespawnTransportVerified:false,
  nonRetryingRespawnExecutorAvailable:false,
  preWriteFreshWorldStatus:'lost'
};
const hold=assessWorldRespawnReadiness(actualKnown);
assert.equal(hold.verdict,'HOLD');
assert.ok(hold.blockers.includes('RESPAWN_TRANSPORT_NOT_VERIFIED'));
assert.ok(hold.blockers.includes('RECOVERABLE_FOOTHOLD_NOT_RULED_OUT'));
assert.ok(hold.blockers.includes('GLOBAL_OWNED_CREEP_ABSENCE_NOT_VERIFIED'));
assert.ok(assessWorldRespawnReadiness({...ready,globalAllShardCreepAbsenceVerified:undefined})
  .blockers.includes('GLOBAL_OWNED_CREEP_ABSENCE_NOT_VERIFIED'));
console.log('O23 approved World auto-respawn fail-closed policy PASS');
