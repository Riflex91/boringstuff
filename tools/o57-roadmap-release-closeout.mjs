// O57 unified review-only roadmap gate. It does not authenticate GitHub
// artifacts, verify a production backup, authorize a Screeps POST or merge.
// Those require separately authenticated, original evidence and a reviewed
// operator-controlled workflow. Arbitrary fixture fields cannot grant release.
export const PINNED_MAIN='bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c';
export const PREDECESSOR_NEWB_RUN='38848802082';
export const LEGACY_WORLD_RUN='38808493499';
export const LEGACY_WORLD_SHA='3f14590592d30dded0b6f61ab0e301e475ed6bf3';
const DENIAL=Object.freeze({
 mayMergeCandidate:false,mayUploadWorldCode:false,mayPlaceSpawn:false,
 mayRespawnWorld:false,mayActivateBranch:false,releaseAuthorized:false,
 canonicalPairVerified:false
});
const valid=(v)=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
function checkWindow(record,sha,runId){
 if(!record||record.headSha!==sha||record.runId!==runId||
   record.conclusion!=='success'||record.marker!=='LIVE_100T_PASS'||
   record.actualTickCount<100||!Number.isInteger(record.actualTickCount)||
   record.fatalFree!==true||record.cpuGatePass!==true||
   record.bucketGatePass!==true||record.originalReceiptVerified!==true)
   return false;
 return true;
}
export function assessRoadmapRelease({
 mainSha=PINNED_MAIN,newbieland=null,world=null,
 worldRuntime=null,escrow=null,writer=null,archive=null,
 review=null,operatorApproval=null
}={}){
 const missing=[],ready=[];
 const record=(test,name)=>{(test?ready:missing).push(name);};
 record(valid(mainSha)&&mainSha===PINNED_MAIN,'MAIN_PINNED_EXACT');
 record(checkWindow(newbieland,PINNED_MAIN,PREDECESSOR_NEWB_RUN),
   'EXACT_MAIN_NEWBIELAND_ORIGINAL_LIVE_100T');
 // A bare user input claiming World success is NOT enough to verify its
 // origin; the original job ZIP, log and deployment receipt need an
 // independent authenticated run-level validator outside this policy.
 const worldCandidate=world?.headSha===PINNED_MAIN &&
   world?.marker==='LIVE_100T_PASS'&&
   Number.isInteger(world?.actualTickCount)&&world.actualTickCount>=100&&
   world?.originalReceiptVerified===true&&world?.fatalFree===true&&
   world?.cpuGatePass===true&&world?.bucketGatePass===true&&
   world?.repository==='Riflex91/boringstuff'&&
   world?.originalJobProvenanceAuthenticated===true;
 record(worldCandidate,'EXACT_MAIN_WORLD_CANONICAL_LIVE_100T');
 record(worldRuntime?.status==='normal'&&
   worldRuntime?.room==='W37S79'&&worldRuntime?.shard==='shard0'&&
   worldRuntime?.branch==='chatgpt'&&worldRuntime?.ownedSpawn===true&&
   Number.isInteger(worldRuntime?.ownedCreeps)&&worldRuntime.ownedCreeps>0&&
   worldRuntime?.observedFresh===true,'FRESH_WORLD_READONLY_HEALTH');
 record(escrow?.original82ModulesVerified===true&&
   escrow?.encryptedOffRunnerArchived===true&&
   escrow?.offlinePrivateKeyVerified===true&&
   escrow?.restoredOfflineSuccessfully===true&&
   escrow?.separateDurableStorageVerified===true,
   'OPERATOR_HELD_RECOVERABLE_REMOTE_BACKUP');
 record(writer?.ownerVerified===true&&
   writer?.globalCooperationReviewed===true&&
   writer?.atomicSafeLifecycleReviewed===true&&
   writer?.uncertainMutationResolved===true,
   'SAFE_CROSS_WRITER_LIFECYCLE');
 record(archive?.originalNewbPrivatelyPreserved===true&&
   archive?.originalWorldPrivatelyPreserved===true&&
   archive?.hashesVerified===true&&archive?.retentionVerified===true,
   'DURABLE_ORIGINAL_EVIDENCE_ARCHIVE');
 record(review?.exactHeadNode24Pass===true&&
   review?.p3FourIdentical===true&&review?.zeroBlockingReviews===true&&
   review?.behindBy===0&&review?.oneAtATime===true,
   'EXACT_HEAD_REVIEW_GATES');
 record(operatorApproval?.specificWorldUploadApproval===true&&
   operatorApproval?.approvalContextMatchesCurrentState===true,
   'SEPARATE_EXPLICIT_WORLD_WRITE_APPROVAL');
 return Object.freeze({
   state:missing.length?'HOLD_REQUIREMENTS_OUTSTANDING':
     'REQUIRE_INDEPENDENT_AUTHENTICATED_EXECUTOR',
   missing:Object.freeze(missing),ready:Object.freeze(ready),
   claimedWorldProofIsIndependentVerified:false,
   predecessorExactPairAuthenticated:false,
   ...DENIAL
 });
}
export function inspectIncidentReadOnly({
 worldStatus,worldRoom,worldSpawn,worldCreeps,
 newbSpawnBusy,newbSameTickSpawningJob,
 newbObservedTicks,hostileOffensiveParts,defenderCount
}={}){
 const concerns=[];
 if(worldStatus!=='normal'||worldRoom!=='W37S79'||worldSpawn!==true||
   !Number.isInteger(worldCreeps)||worldCreeps<=0)
   concerns.push('WORLD_CURRENT_GET_READBACK_REQUIRED');
 if(newbSpawnBusy===true&&
   (!newbSameTickSpawningJob||!Number.isInteger(newbObservedTicks)||
    newbObservedTicks<150))
   concerns.push('E8N1_SPAWN_SAME_TICK_JOB_UNVERIFIED');
 if(Number.isInteger(hostileOffensiveParts)&&hostileOffensiveParts>0&&
   defenderCount===0)
   concerns.push('E8N1_DEFENDER_SHORTFALL_REVIEW');
 return Object.freeze({
   concerns:Object.freeze(concerns),mode:'OFFLINE_INCIDENT_DECISION',
   mustUseFreshSynchronizedObservations:true,
   mayCancelSpawn:false,mayResetWorld:false,
   mayForceDefender:false,mayOverrideParentVeto:false,
   releaseAuthorized:false
 });
}
