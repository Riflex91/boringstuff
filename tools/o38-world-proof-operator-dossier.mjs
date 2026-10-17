// O38: assemble an AUTHENTICATED, NO-WRITE human authorization dossier.
// The paired exact-SHA gate is missing for World. A healthy World and a
// historical byte-identical World PASS do NOT approve new metadata uploads.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {runWorldReadOnlyPreflight,WORLD_TARGET}
  from './o37-world-proof-acquisition-preflight.mjs';
import {inspectLiveGithubTrees,PREDECESSOR_MAIN,
  ORIGINAL_WORLD_RUN_SHA} from './o36-world-git-tree-equivalence.mjs';
import {inspectGithubHistoricalRun,HISTORICAL_RUNS,githubGet}
  from './o34-historical-actions-evidence.mjs';

export const PINNED_MAIN_CI_RUN=38848775090;
const safeTick=n=>Number.isSafeInteger(n)&&n>0&&n<2_000_000_000;
export function assessPinnedMainCi(run,jobResponse){
  const jobs=jobResponse?.jobs;
  const steps=Array.isArray(jobs)&&jobs.length===1?jobs[0]?.steps:null;
  const ok=run?.id===PINNED_MAIN_CI_RUN&&run?.name==='npm test'&&
    run?.head_sha===PREDECESSOR_MAIN&&run?.head_branch==='main'&&
    run?.event==='push'&&run?.status==='completed'&&
    run?.conclusion==='success'&&jobs?.length===1&&
    jobs[0]?.name==='test'&&jobs[0]?.conclusion==='success'&&
    Array.isArray(steps)&&
    ['Setup Node 24.21.0','Run canonical test suite',
      'P3 paired benchmark and exact baseline equivalence'].every(name=>
        steps.filter(s=>s?.name===name&&s.conclusion==='success').length===1);
  return {verified:Boolean(ok),runId:PINNED_MAIN_CI_RUN,
    exactMainSha:PREDECESSOR_MAIN};
}
const checklist=Object.freeze([
  'REVIEW_EXACT_MAIN_SHA_AND_FRESH_GREEN_CANDIDATE_HEAD',
  'CONFIRM_EXPLICIT_OPERATOR_AUTHORIZATION_FOR_SINGLE_WORLD_CODE_POST',
  'USE_GITHUB_PROTECTED_ENVIRONMENT_WITH_HUMAN_APPROVER',
  'EXCLUDE_NEWBIELAND_FROM_WORLD_PROOF_WRITE_SCOPE',
  'SERIALIZE_WORLD_MUTATING_JOBS_AND_DISABLE_OTHER_AUTO_UPLOADS',
  'RECHECK_WORLD_USERNAME_BRANCH_SPAWN1_WORKFORCE_CONTROLLER_AND_CODE',
  'CAPTURE_COMPLETE_PREUPLOAD_WORLD_BRANCH_BACKUP_IN_PRIVATE_ARTIFACT',
  'VERIFY_ROLLBACK_RESTORE_METHOD_BEFORE_ANY_API_POST',
  'ONE_EXACT_MAIN_WORLD_UPLOAD_WITH_NEW_REAL_DEPLOYMENT_ID_ONLY_IF_APPROVED',
  'VERIFY_SERVER_WRITTEN_MODULE_BYTES_AND_ACTIVE_BRANCH',
  'VERIFY_GENUINE_POSTDEPLOY_MARKER_AND_100_DISTINCT_GAME_TICKS',
  'REQUIRE_POST_WINDOW_ROOM_SNAPSHOT_CPU_AND_FATAL_COVERAGE',
  'REQUIRE_SAME_RUN_RECEIPT_AND_PRIVATE_EVIDENCE_BEFORE_ARCHIVE_RETENTION',
  'ON_UNKNOWN_POST_RESULT_STOP_NO_RETRY_AND_ESCALATE',
  'REVERIFY_DUAL_SERVER_CANONICAL_GATE_AND_REVIEWS_BEFORE_ANY_MERGE'
]);
export function assessWorldEvidenceBootstrapDossier({
  runtime,gameTree,newbielandOriginal,worldOriginal,mainCi
}={}){
  const missing=[];
  if(mainCi?.verified!==true||mainCi.exactMainSha!==PREDECESSOR_MAIN||
     mainCi.runId!==PINNED_MAIN_CI_RUN)
    missing.push('EXACT_PREDECESSOR_MAIN_NODE24_P3_UNVERIFIED');
  if(runtime?.runtimeReadOnlyVerified!==true||
     runtime.result!=='WORLD_O16_IDENTICAL_NO_OPERATIONAL_DEPLOY_NEEDED'||
     runtime.activeGameIdenticalToExactMain!==true||
     runtime.ownedPinnedSpawnVerified!==true||
     runtime.activeBranchVerified!==true||
     !safeTick(runtime.observedWorldTick)||
     !Number.isInteger(runtime.ownedCreepCount)||runtime.ownedCreepCount<1||
     runtime.releaseAuthorized!==false||
     runtime.mayUploadWorldCode!==false||
     runtime.apiMutationsAttempted!==0)
    missing.push('HEALTHY_LIVE_WORLD_EXACT_MAIN_RUNTIME_UNVERIFIED');
  if(gameTree?.gameBytesIdentical!==true||
     gameTree.originalSourceSha!==ORIGINAL_WORLD_RUN_SHA||
     gameTree.predecessorMainSha!==PREDECESSOR_MAIN||
     gameTree.originalGameTreeSha!==gameTree.currentGameTreeSha||
     gameTree.gameModuleCount!==82||
     gameTree.releaseAuthorized!==false||
     gameTree.originalWorldRunMatchesExactMain!==false)
    missing.push('AUTHENTICATED_GAME_TREE_BYTE_IDENTITY_UNVERIFIED');
  if(newbielandOriginal?.historicalCanonicalPass!==true||
     newbielandOriginal?.originalReceiptFileContentsVerified!==true||
     newbielandOriginal?.eligibleExactPredecessor!==true||
     newbielandOriginal?.sourceHeadSha!==PREDECESSOR_MAIN||
     newbielandOriginal?.runId!==HISTORICAL_RUNS.newbieland||
     !safeTick(newbielandOriginal.livePass?.snapshotTick)||
     newbielandOriginal.livePass.observedTicks<100)
    missing.push('ORIGINAL_NEWB_EXACT_MAIN_CANONICAL_RECEIPT_UNVERIFIED');
  if(worldOriginal?.historicalCanonicalPass!==true||
     worldOriginal?.originalReceiptFileContentsVerified!==true||
     worldOriginal?.sourceHeadSha!==ORIGINAL_WORLD_RUN_SHA||
     worldOriginal?.runId!==HISTORICAL_RUNS.world||
     worldOriginal?.exactMainSha!==false||
     worldOriginal?.eligibleExactPredecessor!==false||
     !safeTick(worldOriginal.livePass?.snapshotTick)||
     worldOriginal.livePass.observedTicks<100)
    missing.push('ORIGINAL_WORLD_OLD_SHA_CANONICAL_RECEIPT_UNVERIFIED');
  const baselineComplete=missing.length===0;
  return {
    schemaVersion:1,
    result:baselineComplete?
      'READONLY_BASELINE_READY_FOR_OPERATOR_REVIEW':
      'HOLD_INCOMPLETE_PROVENANCE_NO_DEPLOY',
    baselineComplete,
    exactMainSha:PREDECESSOR_MAIN,
    worldRoom:WORLD_TARGET.room,
    worldShard:WORLD_TARGET.shard,
    activeWorldBranch:WORLD_TARGET.branch,
    observedWorldTick:safeTick(runtime?.observedWorldTick)?
      runtime.observedWorldTick:null,
    observedOwnedWorldCreeps:Number.isInteger(runtime?.ownedCreepCount)?
      runtime.ownedCreepCount:null,
    mainOfflineCIRunId:PINNED_MAIN_CI_RUN,
    originalNewbielandRunId:HISTORICAL_RUNS.newbieland,
    originalWorldRunId:HISTORICAL_RUNS.world,
    originalWorldRunSha:ORIGINAL_WORLD_RUN_SHA,
    originalWorldGameBytesIdenticalToMain:gameTree?.gameBytesIdentical===true,
    originalWorldExactShaConfirmed:false,
    exactMainWorldCanonicalLive100tPass:false,
    pairedExactMainReleaseGate:'HOLD_EXACT_PREDECESSOR_PAIR_MISSING',
    // Deliberate boundary: a future operator must approve a *separate*
    // workflow, with a reviewed implementation and GitHub environment guard.
    explicitHumanWorldUploadApprovalVerified:false,
    futureMutatingImplementationIncluded:false,
    prospectiveApprovalAndRollbackChecklist:[...checklist],
    futureOperatorDecision:baselineComplete?
      'REVIEW_CONTROLLED_SINGLE_UPLOAD_PROTOCOL_OR_PRESERVE_HEALTHY_WORLD':
      'INVESTIGATE_MISSING_READONLY_EVIDENCE_FIRST',
    currentRecommendedAction:'PRESERVE_HEALTHY_RUNNING_WORLD',
    missingEvidence:missing,
    mayUploadWorldCode:false,
    mayMergeCandidate:false,
    mayRespawnWorld:false,
    releaseAuthorized:false,
    githubMutationAttempted:false,
    screepsMutationAttempted:false
  };
}
export async function inspectWorldEvidenceBootstrap({
  getWorldRuntime,readGithub,readGameTree,readHistory
}={}){
  if(typeof getWorldRuntime!=='function'||typeof readGithub!=='function'||
     typeof readGameTree!=='function'||typeof readHistory!=='function')
    throw Error('ALL_INDEPENDENT_READ_ADAPTERS_REQUIRED');
  const [runtime,gameTree,newbielandOriginal,worldOriginal,ciRun,ciJobs]=
    await Promise.all([
      getWorldRuntime(),readGameTree(),
      readHistory('newbieland',HISTORICAL_RUNS.newbieland),
      readHistory('world',HISTORICAL_RUNS.world),
      readGithub(PINNED_MAIN_CI_RUN,'run'),
      readGithub(PINNED_MAIN_CI_RUN,'jobs')
    ]);
  return assessWorldEvidenceBootstrapDossier({
    runtime,gameTree,newbielandOriginal,worldOriginal,
    mainCi:assessPinnedMainCi(ciRun,ciJobs)
  });
}
export function writeReadOnlyDossier(file,dossier){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     dossier?.schemaVersion!==1||
     dossier?.releaseAuthorized!==false||
     dossier?.mayUploadWorldCode!==false||
     dossier?.futureMutatingImplementationIncluded!==false||
     dossier?.screepsMutationAttempted!==false)
    throw Error('MUTATING_OR_UNVERIFIED_DOSSIER_REFUSED');
  fs.writeFileSync(file,JSON.stringify(dossier,null,2)+'\n',{
    mode:0o600,flag:'wx',encoding:'utf8'
  });
}
async function main(){
  const env=process.env;
  if(env.GITHUB_REPOSITORY!=='Riflex91/boringstuff'||
     !env.GITHUB_TOKEN||!env.RUNNER_TEMP||
     env.SCREEPS_SERVER!=='world'||env.SCREEPS_BRANCH!=='chatgpt'||
     env.SCREEPS_SHARD!=='shard0'||env.SCREEPS_ROOM!=='W37S79')
    throw Error('EXACT_READONLY_WORLD_PROOF_CONTEXT_REQUIRED');
  const config=path.join(env.RUNNER_TEMP,'o38-world-readonly-'+process.pid+'.json');
  fs.writeFileSync(config,JSON.stringify(buildWorldConfig(env)),{
    flag:'wx',mode:0o600
  });
  try{
    const client=await ScreepsHttpClient.fromConfig('world',{
      file:config,shard:'shard0'
    });
    const answer=await inspectWorldEvidenceBootstrap({
      getWorldRuntime:()=>runWorldReadOnlyPreflight(client),
      readGameTree:()=>inspectLiveGithubTrees(),
      readHistory:(server,id)=>inspectGithubHistoricalRun(server,id),
      readGithub:async(runId,kind)=>{
        const suffix=kind==='run'?'':kind==='jobs'?'/jobs?per_page=100':null;
        if(runId!==PINNED_MAIN_CI_RUN||suffix===null)
          throw Error('ORIGINAL_CI_READ_TARGET_MISMATCH');
        return githubGet('https://api.github.com/repos/Riflex91/boringstuff/actions/runs/'+
          runId+suffix,env.GITHUB_TOKEN,'json');
      }
    });
    const file=path.join(env.RUNNER_TEMP,'o38-world-review-only-dossier.json');
    writeReadOnlyDossier(file,answer);
    console.log('O38_WORLD_PROOF_REVIEW_ONLY '+JSON.stringify(answer));
    if(!answer.baselineComplete)process.exitCode=2;
    // Success means only a complete READONLY dossier, not a release approval.
  }finally{fs.rmSync(config,{force:true});}
}
if(process.argv[1]&&
   path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{
    console.error('O38_WORLD_READONLY_DOSSIER_FAILED');
    process.exitCode=2;
  });
