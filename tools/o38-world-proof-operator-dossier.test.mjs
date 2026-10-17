import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
 PINNED_MAIN_CI_RUN,assessPinnedMainCi,
 assessWorldEvidenceBootstrapDossier,inspectWorldEvidenceBootstrap,
 writeReadOnlyDossier
} from './o38-world-proof-operator-dossier.mjs';
import {PREDECESSOR_MAIN,ORIGINAL_WORLD_RUN_SHA}
 from './o36-world-git-tree-equivalence.mjs';
import {HISTORICAL_RUNS} from './o34-historical-actions-evidence.mjs';

const expectedSteps=['Setup Node 24.21.0','Run canonical test suite',
 'P3 paired benchmark and exact baseline equivalence'];
const ci={id:PINNED_MAIN_CI_RUN,name:'npm test',
 head_sha:PREDECESSOR_MAIN,head_branch:'main',event:'push',
 status:'completed',conclusion:'success'};
const jobs={jobs:[{name:'test',conclusion:'success',
 steps:expectedSteps.map(name=>({name,conclusion:'success'}))}]};
const ciGood=assessPinnedMainCi(ci,jobs);
assert.equal(ciGood.verified,true);
const change=(obj,fn)=>{const x=structuredClone(obj);fn(x);return x;};
for(const [c,j] of [
 [change(ci,v=>v.head_sha=ORIGINAL_WORLD_RUN_SHA),jobs],
 [change(ci,v=>v.event='workflow_dispatch'),jobs],
 [change(ci,v=>v.conclusion='failure'),jobs],
 [change(ci,v=>v.id=PINNED_MAIN_CI_RUN+1),jobs],
 [change(ci,v=>v.head_branch='feature'),jobs],
 [ci,change(jobs,v=>v.jobs[0].steps[2].conclusion='skipped')],
 [ci,change(jobs,v=>v.jobs.push({...v.jobs[0]}))],
 [ci,change(jobs,v=>v.jobs[0].steps.push({...v.jobs[0].steps[2]}))]
])assert.equal(assessPinnedMainCi(c,j).verified,false);

const runtime={
 runtimeReadOnlyVerified:true,
 result:'WORLD_O16_IDENTICAL_NO_OPERATIONAL_DEPLOY_NEEDED',
 activeGameIdenticalToExactMain:true,
 ownedPinnedSpawnVerified:true,activeBranchVerified:true,
 observedWorldTick:78367845,ownedCreepCount:9,
 releaseAuthorized:false,mayUploadWorldCode:false,
 apiMutationsAttempted:0
};
const gameTree={gameBytesIdentical:true,
 originalSourceSha:ORIGINAL_WORLD_RUN_SHA,
 predecessorMainSha:PREDECESSOR_MAIN,
 originalGameTreeSha:'d42762afc8ada46ef1cbc98e7fe173429dbcbd8e',
 currentGameTreeSha:'d42762afc8ada46ef1cbc98e7fe173429dbcbd8e',
 gameModuleCount:82,releaseAuthorized:false,
 originalWorldRunMatchesExactMain:false
};
const archive=(server)=>({
 historicalCanonicalPass:true,
 originalReceiptFileContentsVerified:true,
 eligibleExactPredecessor:server==='newbieland',
 exactMainSha:server==='newbieland',
 sourceHeadSha:server==='newbieland'?PREDECESSOR_MAIN:ORIGINAL_WORLD_RUN_SHA,
 runId:HISTORICAL_RUNS[server],
 livePass:{valid:true,deploymentTick:server==='world'?78327634:3956969,
  observedTicks:server==='world'?166:131,
  snapshotTick:server==='world'?78327800:3957100}
});
const newbielandOriginal=archive('newbieland'),worldOriginal=archive('world');
const params={runtime,gameTree,newbielandOriginal,worldOriginal,mainCi:ciGood};
const valid=assessWorldEvidenceBootstrapDossier(params);
assert.equal(valid.baselineComplete,true);
assert.equal(valid.result,'READONLY_BASELINE_READY_FOR_OPERATOR_REVIEW');
assert.equal(valid.observedOwnedWorldCreeps,9);
assert.equal(valid.mainOfflineCIRunId,PINNED_MAIN_CI_RUN);
assert.equal(valid.originalNewbielandRunId,HISTORICAL_RUNS.newbieland);
assert.equal(valid.originalWorldRunId,HISTORICAL_RUNS.world);
assert.equal(valid.exactMainWorldCanonicalLive100tPass,false);
assert.equal(valid.originalWorldExactShaConfirmed,false);
assert.equal(valid.explicitHumanWorldUploadApprovalVerified,false);
assert.equal(valid.futureMutatingImplementationIncluded,false);
assert.equal(valid.pairedExactMainReleaseGate,'HOLD_EXACT_PREDECESSOR_PAIR_MISSING');
assert.equal(valid.mayUploadWorldCode,false);
assert.equal(valid.mayMergeCandidate,false);
assert.equal(valid.mayRespawnWorld,false);
assert.equal(valid.releaseAuthorized,false);
assert.equal(valid.githubMutationAttempted,false);
assert.equal(valid.screepsMutationAttempted,false);
assert.equal(valid.currentRecommendedAction,'PRESERVE_HEALTHY_RUNNING_WORLD');
assert.equal(valid.missingEvidence.length,0);
assert.ok(valid.prospectiveApprovalAndRollbackChecklist.length>=14);
assert.ok(!JSON.stringify(valid).includes('PRIVATE_TOKEN'));

const wrong=[
 {...params,mainCi:{...ciGood,verified:false}},
 {...params,mainCi:{...ciGood,runId:12}},
 {...params,runtime:{...runtime,observedWorldTick:null}},
 {...params,runtime:{...runtime,ownedCreepCount:0}},
 {...params,runtime:{...runtime,mayUploadWorldCode:true}},
 {...params,runtime:{...runtime,apiMutationsAttempted:1}},
 {...params,runtime:{...runtime,result:'HOLD_WORLD_RUNTIME_OR_MAIN_BYTES_UNVERIFIED'}},
 {...params,gameTree:{...gameTree,gameBytesIdentical:false}},
 {...params,gameTree:{...gameTree,originalGameTreeSha:'0'.repeat(40)}},
 {...params,gameTree:{...gameTree,predecessorMainSha:ORIGINAL_WORLD_RUN_SHA}},
 {...params,gameTree:{...gameTree,gameModuleCount:81}},
 {...params,newbielandOriginal:{...newbielandOriginal,sourceHeadSha:ORIGINAL_WORLD_RUN_SHA}},
 {...params,newbielandOriginal:{...newbielandOriginal,originalReceiptFileContentsVerified:false}},
 {...params,worldOriginal:{...worldOriginal,runId:7}},
 {...params,worldOriginal:{...worldOriginal,exactMainSha:true}},
 {...params,worldOriginal:{...worldOriginal,sourceHeadSha:PREDECESSOR_MAIN}},
 {...params,worldOriginal:{...worldOriginal,livePass:{
  ...worldOriginal.livePass,observedTicks:99
 }}}
];
for(const [i,bad] of wrong.entries()){
 const got=assessWorldEvidenceBootstrapDossier(bad);
 assert.equal(got.baselineComplete,false,'unsafe variant '+i);
 assert.equal(got.result,'HOLD_INCOMPLETE_PROVENANCE_NO_DEPLOY');
 assert.equal(got.releaseAuthorized,false);
 assert.equal(got.mayUploadWorldCode,false);
 assert.ok(got.missingEvidence.length>=1);
}
const fetched=[];
const actual=await inspectWorldEvidenceBootstrap({
 getWorldRuntime:async()=>{fetched.push('worldLive');return runtime;},
 readGameTree:async()=>{fetched.push('gameTree');return gameTree;},
 readHistory:async(s,id)=>{
  fetched.push(s+id);
  assert.equal(id,HISTORICAL_RUNS[s]);
  return s==='world'?worldOriginal:newbielandOriginal;
 },
 readGithub:async(id,type)=>{
  assert.equal(id,PINNED_MAIN_CI_RUN);fetched.push(type);
  return type==='run'?ci:jobs;
 }
});
assert.equal(fetched.length,6);
assert.equal(actual.baselineComplete,true);
await assert.rejects(()=>inspectWorldEvidenceBootstrap({}),/ALL_INDEPENDENT_READ_ADAPTERS_REQUIRED/);

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'o38-readonly-'));
try{
 const file=path.join(tmp,'review.json');
 writeReadOnlyDossier(file,actual);
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).releaseAuthorized,false);
 assert.throws(()=>writeReadOnlyDossier(file,actual),/EEXIST/);
 assert.throws(()=>writeReadOnlyDossier(path.join(tmp,'unsafe.json'),{
  ...actual,mayUploadWorldCode:true}),/MUTATING_OR_UNVERIFIED_DOSSIER_REFUSED/);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log('O38 exact-Main CI + 2 genuine receipts + World evidence; explicit approval remains HOLD: PASS');
