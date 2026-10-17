import assert from 'node:assert/strict';
import {
 PINNED_MAIN,LEGACY_WORLD_SHA,LEGACY_WORLD_RUN,
 PREDECESSOR_NEWB_RUN,assessRoadmapRelease,inspectIncidentReadOnly
} from './o57-roadmap-release-closeout.mjs';

const n={
 runId:PREDECESSOR_NEWB_RUN,headSha:PINNED_MAIN,
 conclusion:'success',marker:'LIVE_100T_PASS',
 actualTickCount:131,originalReceiptVerified:true,
 fatalFree:true,cpuGatePass:true,bucketGatePass:true
};
const oldWorld={
 runId:LEGACY_WORLD_RUN,headSha:LEGACY_WORLD_SHA,
 repository:'Riflex91/boringstuff',
 conclusion:'success',marker:'LIVE_100T_PASS',
 actualTickCount:166,originalReceiptVerified:true,
 originalJobProvenanceAuthenticated:true,
 fatalFree:true,cpuGatePass:true,bucketGatePass:true
};
const baseline=assessRoadmapRelease({
 mainSha:PINNED_MAIN,newbieland:n,world:oldWorld
});
assert.ok(baseline.ready.includes('EXACT_MAIN_NEWBIELAND_ORIGINAL_LIVE_100T'));
assert.ok(baseline.missing.includes('EXACT_MAIN_WORLD_CANONICAL_LIVE_100T'));
assert.equal(baseline.predecessorExactPairAuthenticated,false);
assert.equal(baseline.releaseAuthorized,false);
assert.equal(baseline.mayMergeCandidate,false);
assert.equal(baseline.mayUploadWorldCode,false);
assert.equal(baseline.mayRespawnWorld,false);
const healthy={status:'normal',shard:'shard0',room:'W37S79',
 branch:'chatgpt',ownedSpawn:true,ownedCreeps:9,observedFresh:true};
const readyInputs={
 mainSha:PINNED_MAIN,newbieland:n,
 world:{...oldWorld,headSha:PINNED_MAIN,runId:'39999999999'},
 worldRuntime:healthy,
 escrow:{original82ModulesVerified:true,encryptedOffRunnerArchived:true,
  offlinePrivateKeyVerified:true,restoredOfflineSuccessfully:true,
  separateDurableStorageVerified:true},
 writer:{ownerVerified:true,globalCooperationReviewed:true,
  atomicSafeLifecycleReviewed:true,uncertainMutationResolved:true},
 archive:{originalNewbPrivatelyPreserved:true,originalWorldPrivatelyPreserved:true,
  hashesVerified:true,retentionVerified:true},
 review:{exactHeadNode24Pass:true,p3FourIdentical:true,
  zeroBlockingReviews:true,behindBy:0,oneAtATime:true},
 operatorApproval:{specificWorldUploadApproval:true,
  approvalContextMatchesCurrentState:true}
};
const claimed=assessRoadmapRelease(readyInputs);
// Even "all-green" caller-supplied fields are NOT authenticated original
// evidence, cannot waive current-Main origin verification or issue permit.
assert.deepEqual(claimed.missing,[]);
assert.equal(claimed.state,'REQUIRE_INDEPENDENT_AUTHENTICATED_EXECUTOR');
assert.equal(claimed.releaseAuthorized,false);
assert.equal(claimed.predecessorExactPairAuthenticated,false);
assert.equal(claimed.mayUploadWorldCode,false);
assert.equal(claimed.mayMergeCandidate,false);
for(const candidate of [
 {...readyInputs,newbieland:{...n,headSha:LEGACY_WORLD_SHA}},
 {...readyInputs,world:{...readyInputs.world,actualTickCount:99}},
 {...readyInputs,world:{...readyInputs.world,originalJobProvenanceAuthenticated:false}},
 {...readyInputs,worldRuntime:{...healthy,ownedSpawn:false}},
 {...readyInputs,escrow:{...readyInputs.escrow,offlinePrivateKeyVerified:false}},
 {...readyInputs,writer:{...readyInputs.writer,atomicSafeLifecycleReviewed:false}},
 {...readyInputs,archive:{...readyInputs.archive,retentionVerified:false}},
 {...readyInputs,operatorApproval:{...readyInputs.operatorApproval,
   specificWorldUploadApproval:false}},
 {...readyInputs,review:{...readyInputs.review,behindBy:1}}
]){
 const r=assessRoadmapRelease(candidate);
 assert.ok(r.missing.length>=1);
 assert.equal(r.releaseAuthorized,false);
 assert.equal(r.mayMergeCandidate,false);
}
const incident=inspectIncidentReadOnly({
 worldStatus:'normal',worldRoom:'W37S79',worldSpawn:true,worldCreeps:9,
 newbSpawnBusy:true,newbSameTickSpawningJob:false,
 newbObservedTicks:500,hostileOffensiveParts:9,defenderCount:0
});
assert.ok(incident.concerns.includes('E8N1_SPAWN_SAME_TICK_JOB_UNVERIFIED'));
assert.ok(incident.concerns.includes('E8N1_DEFENDER_SHORTFALL_REVIEW'));
assert.equal(incident.mayCancelSpawn,false);
assert.equal(incident.mayForceDefender,false);
const unhealthy=inspectIncidentReadOnly({worldStatus:'lost',newbSpawnBusy:true});
assert.ok(unhealthy.concerns.includes('WORLD_CURRENT_GET_READBACK_REQUIRED'));
assert.equal(unhealthy.mayResetWorld,false);
console.log('O57 full roadmap exact-SHA release HOLD, all-green false authority, E8N1/World incidents: PASS');
