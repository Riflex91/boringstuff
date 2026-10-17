import assert from 'node:assert/strict';
import {
  EXPECTED_MAIN_SHA,HISTORICAL_RUNS,extractOriginalLivePass,
  assessHistoricalRun,assessHistoricalPair,inspectGithubHistoricalRun
} from './o34-historical-actions-evidence.mjs';

const old='3f14590592d30dded0b6f61ab0e301e475ed6bf3';
const now=EXPECTED_MAIN_SHA;
const payload={status:'PASS',deploymentTick:1000,observedTicks:131,
  snapshotTick:1131,rcl:4,cpu:11.44,bucket:10000,
  checkedCpuSnapshots:2,minimumSnapshotBucket:10000,maximumSnapshotCpu:13.64,
  roomEvidence:{PRIVATE_CREEP:'SECRET_USERNAME_SHOULD_NOT_LEAK'}};
const line='2026-10-16T04:16:49.1086284Z LIVE_100T_PASS '+
  JSON.stringify(payload)+'\n';
assert.deepEqual(extractOriginalLivePass(line).valid,true);
assert.equal(extractOriginalLivePass(line).observedTicks,131);
assert.equal(extractOriginalLivePass(line).snapshotTick,1131);
assert.equal(extractOriginalLivePass(line).minimumSnapshotBucket,10000);
assert.ok(!JSON.stringify(extractOriginalLivePass(line)).includes('PRIVATE_CREEP'));
for(const input of [
 '', 'LIVE_100T_PASS '+JSON.stringify(payload)+'\n',
 line+line,line.replace('"PASS"','"FAIL"'),
 line.replace('"observedTicks":131','"observedTicks":99'),
 line.replace('"snapshotTick":1131','"snapshotTick":1031'),
 line.replace('"minimumSnapshotBucket":10000','"minimumSnapshotBucket":800'),
 line.replace('"bucket":10000','"bucket":10'),
 line.replace('"checkedCpuSnapshots":2','"checkedCpuSnapshots":0'),
 '2026-10-16T04:16:49.1086284Z LIVE_100T_PASS {oops}\n',
 '2026-10-16T04:16:49.1086284Z LIVE_100T_PASS {"status":"PASS"}\n'
])assert.equal(extractOriginalLivePass(input).valid,false);
assert.equal(extractOriginalLivePass('x'.repeat(24_000_001)).valid,false);

const cases={
 newbieland:{
  workflow:'Screeps auto-deploy (after main CI)',head:now,
  artifact:'screeps-deployment-evidence-'+now,
  upload:'Upload exact tested game code and verify every module',
  preflight:'Validate active target, credentials and backup accessibility',
  verify:'Verify active 100-tick release and fatal/CPU guards',
  guard:'Prevent deploying stale commits over newer main'
 },
 world:{
  workflow:'Screeps World W37S79 auto-deploy (after main CI)',head:old,
  artifact:'screeps-w37s79-auto-deploy-'+old,
  upload:'Upload exact tested game modules',
  preflight:'Verify exact active branch and backup access',
  verify:'Verify 100 live ticks, fatal and CPU safeguards',
  guard:'Prevent stale main deployment'
 }
};
const sample=(server)=>{
 const c=cases[server],id=HISTORICAL_RUNS[server];
 return {
  server,expectedRunId:id,
  run:{id,name:c.workflow,event:'workflow_run',
    status:'completed',conclusion:'success',
    head_sha:c.head,head_branch:'main'},
  jobs:[{id:id+111,name:'deploy',conclusion:'success',
    steps:[c.guard,c.preflight,c.upload,c.verify].map(name=>({
      name,conclusion:'success'
    }))}],
  artifacts:[{id:id+222,name:c.artifact,
    expired:false,size_in_bytes:200000}],
  jobLog:line
 };
};
const n=assessHistoricalRun(sample('newbieland'));
const w=assessHistoricalRun(sample('world'));
assert.equal(n.historicalCanonicalPass,true);
assert.equal(n.eligibleExactPredecessor,true);
assert.equal(w.historicalCanonicalPass,true);
assert.equal(w.exactMainSha,false);
assert.equal(w.eligibleExactPredecessor,false);
assert.deepEqual(w.issues,['HISTORICAL_PASS_SHA_DIFFERS_FROM_EXACT_MAIN']);
assert.equal(assessHistoricalPair(w,n).result,'HOLD_EXACT_PREDECESSOR_PAIR_MISSING');
assert.equal(assessHistoricalPair(w,n).newbielandExactMainHistoricalPass,true);
assert.equal(assessHistoricalPair(w,n).worldExactMainHistoricalPass,false);
assert.equal(assessHistoricalPair(w,n).releaseAuthorized,false);
assert.equal(n.originalReceiptArtifactMetadataVerified,true);
assert.equal(n.originalReceiptFileContentsVerified,false);
assert.equal(n.independentCurrentRuntimeHealthyVerified,false);
assert.equal(n.apiMutationsAttempted,0);
assert.equal(w.apiMutationsAttempted,0);
const both={...w,eligibleExactPredecessor:true,predecessorMainSha:now};
assert.equal(assessHistoricalPair(both,n).result,
  'TWO_HISTORICAL_SAME_SHA_RUNS_VERIFIED');
assert.equal(assessHistoricalPair(both,n).releaseAuthorized,false);
const mut=(name,obj)=>{
 const a=sample('newbieland');Object.assign(a[name],obj);return a;
};
for(const [property,value] of [
 ['head_sha',old],['event','workflow_dispatch'],['name','npm test'],
 ['conclusion','failure'],['status','queued'],['head_branch','feature']
])assert.equal(assessHistoricalRun(mut('run',{[property]:value}))
 .eligibleExactPredecessor,false);
for(const kind of ['newbieland','world']){
 const sampleRun=sample(kind);
 const withoutUpload={...sampleRun,jobs:[{
  ...sampleRun.jobs[0],
  steps:sampleRun.jobs[0].steps.filter(s=>s.name!==cases[kind].upload)
 }]};
 assert.equal(assessHistoricalRun(withoutUpload).historicalCanonicalPass,false);
 assert.ok(assessHistoricalRun(withoutUpload).issues.includes(
   'ACTUAL_CODE_UPLOAD_STEP_NOT_PASSED'));
 const expired={...sampleRun,artifacts:sampleRun.artifacts.map(a=>({...a,expired:true}))};
 assert.equal(assessHistoricalRun(expired).historicalCanonicalPass,false);
 const noLogs={...sampleRun,jobLog:''};
 assert.equal(assessHistoricalRun(noLogs).historicalCanonicalPass,false);
 const wrongID={...sampleRun,run:{...sampleRun.run,id:42}};
 assert.equal(assessHistoricalRun(wrongID).historicalCanonicalPass,false);
}
assert.equal(assessHistoricalRun({server:'world'}).historicalCanonicalPass,false);

const history=[];
const mockRead=async(url,_token,type)=>{
 assert.match(url,/^https:\/\/api\.github\.com\/repos\/Riflex91\/boringstuff\/actions\//);
 history.push({url,type});
 const data=sample(url.includes('/38848802082')?'newbieland':'world');
 if(url.includes('/actions/jobs/'))return line;
 if(url.endsWith('/jobs?per_page=100'))return {jobs:data.jobs};
 if(url.endsWith('/artifacts?per_page=100'))return {artifacts:data.artifacts};
 return data.run;
};
const actualN=await inspectGithubHistoricalRun('newbieland',
 HISTORICAL_RUNS.newbieland,{token:'REDACTED_TEST_TOKEN',read:mockRead});
assert.equal(actualN.eligibleExactPredecessor,true);
assert.deepEqual(history.map(x=>x.type).sort(),['json','json','json','text'].sort());
assert.equal(history.length,4);
assert.ok(!JSON.stringify(actualN).includes('REDACTED_TEST_TOKEN'));
console.log('O34 audited GitHub canonical historical PASS provenance and exact Main HOLD: PASS');
