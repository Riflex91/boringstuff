// O34: independently recheck ORIGINAL GitHub Actions deployment runs.
// GET-only against GitHub's own run/jobs/log/artifact records. No Screeps API,
// code upload, respawn, branch switch, GitHub issue mutation or fake receipt.
// A historical PASS on another SHA is NOT the exact predecessor-Main gate.
const OWNER='Riflex91',REPO='boringstuff';
export const EXPECTED_MAIN_SHA='bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c';
export const HISTORICAL_RUNS=Object.freeze({
  newbieland:38848802082,
  world:38808493499
});
const SERVERS=Object.freeze({
  newbieland:{workflow:'Screeps auto-deploy (after main CI)',
    artifact:'screeps-deployment-evidence-',upload:'Upload exact tested game code and verify every module'},
  world:{workflow:'Screeps World W37S79 auto-deploy (after main CI)',
    artifact:'screeps-w37s79-auto-deploy-',upload:'Upload exact tested game modules'}
});
const isSha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const isTick=n=>Number.isSafeInteger(n)&&n>0&&n<2_000_000_000;
const safeN=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const validId=x=>Number.isSafeInteger(x)&&x>0;

export function extractOriginalLivePass(log){
  // Only an authentic unwrapped live verifier log line (one only) qualifies.
  // No loose string search or arbitrary pasted PASS field can create proof.
  if(typeof log!=='string'||log.length>24_000_000)
    return {valid:false,reason:'JOB_LOG_MISSING_OR_UNBOUNDED'};
  const matches=[...log.matchAll(
    /^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z LIVE_100T_PASS (\{[^\r\n]{1,18000}\})\r?$/gm
  )];
  if(matches.length!==1)return {valid:false,
    reason:matches.length===0?'CANONICAL_PASS_LINE_NOT_FOUND':'MULTIPLE_CANONICAL_PASS_LINES'};
  let data;
  try{data=JSON.parse(matches[0][1]);}
  catch{return {valid:false,reason:'CANONICAL_PASS_JSON_INVALID'};}
  const valid=data?.status==='PASS'&&isTick(data?.deploymentTick)&&
    isTick(data?.snapshotTick)&&data.snapshotTick>=data.deploymentTick+100&&
    isTick(data?.observedTicks)&&data.observedTicks>=100&&
    isTick(data?.checkedCpuSnapshots)&&data.checkedCpuSnapshots>=1&&
    safeN(data?.cpu)&&safeN(data?.bucket)&&data.bucket>=1000&&
    safeN(data?.minimumSnapshotBucket)&&data.minimumSnapshotBucket>=1000&&
    safeN(data?.maximumSnapshotCpu);
  if(!valid)return {valid:false,reason:'INVALID_CANONICAL_100T_CPU_SNAPSHOT_VALUES'};
  // Compact immutable facts only, no deployment IDs, source, creep IDs,
  // raw room reports or runtime Memory contents.
  return {valid:true,reason:null,
    deploymentTick:data.deploymentTick,
    observedTicks:data.observedTicks,
    snapshotTick:data.snapshotTick,
    checkedCpuSnapshots:data.checkedCpuSnapshots,
    cpu:data.cpu,bucket:data.bucket,
    minimumSnapshotBucket:data.minimumSnapshotBucket,
    maximumSnapshotCpu:data.maximumSnapshotCpu};
}

export function assessHistoricalRun({server,expectedMainSha=EXPECTED_MAIN_SHA,
  expectedRunId,run,jobs,artifacts,jobLog}={}){
  const issues=[];
  const policy=SERVERS[server];
  if(!policy||!isSha(expectedMainSha)||!validId(expectedRunId))
    return {server:policy?server:null,
      historicalCanonicalPass:false,exactMainSha:false,
      eligibleExactPredecessor:false,issues:['INVALID_AUDIT_REQUEST'],
      originalReceiptFileContentsVerified:false,
      independentCurrentRuntimeHealthyVerified:false,
      apiMutationsAttempted:0};
  if(!run||run.id!==expectedRunId||!isSha(run.head_sha)||
     run.name!==policy.workflow||run.event!=='workflow_run'||
     run.conclusion!=='success'||run.status!=='completed'||
     run.head_branch!=='main')issues.push('GITHUB_WORKFLOW_RUN_IDENTITY_OR_SUCCESS_UNVERIFIED');
  if(!Array.isArray(jobs)||jobs.length!==1||
     jobs[0]?.name!=='deploy'||jobs[0]?.conclusion!=='success')
    issues.push('GITHUB_DEPLOY_JOB_SUCCESS_UNVERIFIED');
  const steps=jobs?.[0]?.steps;
  const successful=n=>Array.isArray(steps)&&
    steps.filter(s=>s?.name===n&&s?.conclusion==='success').length===1;
  if(!successful('Prevent stale main deployment')&&!successful('Prevent deploying stale commits over newer main'))
    issues.push('EXACT_TESTED_MAIN_HEAD_GUARD_NOT_PASSED');
  if(!successful('Verify exact active branch and backup access')&&
     !successful('Validate active target, credentials and backup accessibility'))
    issues.push('ACTIVE_BRANCH_AND_BACKUP_PREFLIGHT_NOT_PASSED');
  if(!successful(policy.upload))issues.push('ACTUAL_CODE_UPLOAD_STEP_NOT_PASSED');
  if(!successful('Verify 100 live ticks, fatal and CPU safeguards')&&
     !successful('Verify active 100-tick release and fatal/CPU guards'))
    issues.push('CANONICAL_100T_VERIFIER_STEP_NOT_PASSED');
  const proof=extractOriginalLivePass(jobLog);
  if(!proof.valid)issues.push(proof.reason);
  const artifactName=policy.artifact+(run?.head_sha||'');
  if(!Array.isArray(artifacts)||artifacts.filter(a=>
    a?.name===artifactName&&a?.expired===false&&validId(a?.id)&&
    Number.isSafeInteger(a?.size_in_bytes)&&a.size_in_bytes>0).length!==1)
    issues.push('ORIGINAL_DEPLOYMENT_ARTIFACT_UNAVAILABLE');
  const sameMain=run?.head_sha===expectedMainSha;
  const historical=issues.length===0;
  return {
    server,runId:expectedRunId,
    sourceHeadSha:isSha(run?.head_sha)?run.head_sha:null,
    predecessorMainSha:expectedMainSha,
    historicalCanonicalPass:historical,
    exactMainSha:Boolean(sameMain),
    eligibleExactPredecessor:historical&&sameMain,
    originalReceiptArtifactMetadataVerified:!issues.includes('ORIGINAL_DEPLOYMENT_ARTIFACT_UNAVAILABLE'),
    originalReceiptFileContentsVerified:false,
    independentCurrentRuntimeHealthyVerified:false,
    livePass:proof.valid?proof:null,
    issues:[...issues,...(!sameMain?['HISTORICAL_PASS_SHA_DIFFERS_FROM_EXACT_MAIN']:[])],
    pairedReleaseAuthorized:false,
    apiMutationsAttempted:0
  };
}
export function assessHistoricalPair(world,newbieland,expectedMainSha=EXPECTED_MAIN_SHA){
  const newb=newbieland?.eligibleExactPredecessor===true&&
    newbieland?.predecessorMainSha===expectedMainSha;
  const w=world?.eligibleExactPredecessor===true&&
    world?.predecessorMainSha===expectedMainSha;
  return {result:newb&&w?'TWO_HISTORICAL_SAME_SHA_RUNS_VERIFIED':
      'HOLD_EXACT_PREDECESSOR_PAIR_MISSING',
    newbielandExactMainHistoricalPass:newb,
    worldExactMainHistoricalPass:w,
    // Even two historic runs are not by themselves a complete release gate:
    // current operational health, pre-merge candidate CI and review are separate.
    releaseAuthorized:false,
    canonicalPremergeReleaseApproved:false,
    apiMutationsAttempted:0};
}

const base='https://api.github.com/repos/'+OWNER+'/'+REPO;
export async function inspectGithubHistoricalRun(server,runId,{
  token=process.env.GITHUB_TOKEN,read=githubGet
}={}){
  if(!SERVERS[server]||!validId(runId))throw Error('EXACT_TRUSTED_SERVER_RUN_REQUIRED');
  const uri='/actions/runs/'+runId;
  const [run,jobData,artifactData]=await Promise.all([
    read(base+uri,token,'json'),
    read(base+uri+'/jobs?per_page=100',token,'json'),
    read(base+uri+'/artifacts?per_page=100',token,'json')
  ]);
  const jobs=jobData?.jobs;
  // Bound to exactly one verified deploy job before requesting its log.
  const job=Array.isArray(jobs)&&jobs.length===1?jobs[0]:null;
  const jobLog=validId(job?.id)?
    await read(base+'/actions/jobs/'+job.id+'/logs',token,'text'):null;
  return assessHistoricalRun({server,expectedRunId:runId,run,jobs,
    artifacts:artifactData?.artifacts,jobLog});
}

export async function githubGet(url,token,type){
  if(typeof token!=='string'||!token)throw Error('GITHUB_READ_TOKEN_UNAVAILABLE');
  const target=new URL(url);
  if(target.protocol!=='https:'||target.host!=='api.github.com'||
     !target.pathname.startsWith('/repos/'+OWNER+'/'+REPO+'/actions/'))
    throw Error('GITHUB_READ_ENDPOINT_NOT_ALLOWLISTED');
  const reply=await fetch(url,{method:'GET',
    headers:{Authorization:'Bearer '+token,
      Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28'},
    signal:AbortSignal.timeout(25000)});
  if(!reply.ok)throw Error('GITHUB_READ_NOT_VERIFIED_'+reply.status);
  const declared=Number(reply.headers.get('content-length')||0);
  if(declared>24_000_000)throw Error('GITHUB_REPLY_UNBOUNDED');
  const raw=await reply.text();
  if(raw.length>24_000_000)throw Error('GITHUB_REPLY_UNBOUNDED');
  if(type==='text')return raw;
  if(type!=='json')throw Error('GITHUB_REPLY_TYPE_NOT_ALLOWED');
  return JSON.parse(raw);
}

async function main(){
  if(process.env.GITHUB_REPOSITORY!=='Riflex91/boringstuff'||
     !process.env.GITHUB_TOKEN)throw Error('TRUSTED_READONLY_GITHUB_ACTIONS_CONTEXT_REQUIRED');
  const [newb,world]=await Promise.all([
    inspectGithubHistoricalRun('newbieland',HISTORICAL_RUNS.newbieland),
    inspectGithubHistoricalRun('world',HISTORICAL_RUNS.world)
  ]);
  const pair=assessHistoricalPair(world,newb);
  console.log('O34_HISTORICAL_NEWB_'+JSON.stringify(newb));
  console.log('O34_HISTORICAL_WORLD_'+JSON.stringify(world));
  console.log('O34_EXACT_MAIN_DUAL_RELEASE_'+JSON.stringify(pair));
  if(pair.result!=='TWO_HISTORICAL_SAME_SHA_RUNS_VERIFIED')
    process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)
  main().catch(()=>{console.error('O34_GITHUB_PROVENANCE_GET_UNVERIFIED');
    process.exitCode=2;});
