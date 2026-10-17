import {ORIGINAL_ARTIFACT_SHA256,ORIGINAL_ARTIFACT_LENGTH}
 from './o58-original-artifact-integrity.mjs';
import {PINNED_MAIN,LEGACY_WORLD_SHA}
 from './o57-roadmap-release-closeout.mjs';

// O59: reproduce STRUCTURAL verification of the exact two historical
// GitHub Actions job logs linked to the original ZIPs, with no HTTP calls.
// The actual GitHub connector independently retrieved both real job logs
// on 2026-10-17. Caller-provided JSON/text is NOT itself authentication;
// this module NEVER grants a deployment, merge or exact-Main World pass.
export const O59_ORIGINAL_LOG_HOLD='O59_ORIGINAL_LOG_WITNESS_HOLD';
export const HISTORICAL_JOB_PINS=Object.freeze({
 world:Object.freeze({
  runId:38808493499,jobId:116675425473,
  headSha:LEGACY_WORLD_SHA,artifactId:12007967018,
  deploymentId:'20261015211553693-2342',
  branch:'chatgpt-w37s79-stage',server:'world',room:'W37S79',
  observedTicks:166,deploymentTick:78327634,snapshotTick:78327800,
  maximumSnapshotCpu:12.445,minimumSnapshotBucket:10000,
  rcl:4,checkedCpuSnapshots:2
 }),
 newbieland:Object.freeze({
  runId:38848802082,jobId:116805212652,
  headSha:PINNED_MAIN,artifactId:12024822115,
  deploymentId:'20261016040542647-2155',
  branch:'chatgpt',server:'newbieland',room:'E8N1',
  observedTicks:131,deploymentTick:3956969,snapshotTick:3957100,
  maximumSnapshotCpu:13.637,minimumSnapshotBucket:10000,
  rcl:6,checkedCpuSnapshots:2
 })
});
const deny=()=>{throw new Error(O59_ORIGINAL_LOG_HOLD);};
const check=v=>{if(!v)deny();};
const stamp=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z /;
function singleBy(lines,re){
 const matches=lines.map((line,index)=>({line,index})).filter(e=>re.test(e.line));
 check(matches.length===1);
 return matches[0];
}
const tokenLine=(l)=>stamp.test(l)&&/LIVE_100T_PASS /.test(l);
export function inspectHistoricalJobLogWitness({
 server,run,job,logText,artifact
}={}){
 check(Object.hasOwn(HISTORICAL_JOB_PINS,server));
 const pin=HISTORICAL_JOB_PINS[server];
 check(run?.id===pin.runId&&run?.head_sha===pin.headSha&&
   run?.conclusion==='success'&&run?.status==='completed'&&
   run?.event==='workflow_run'&&
   job?.id===pin.jobId&&job?.run_id===pin.runId&&
   job?.status==='completed'&&job?.conclusion==='success'&&
   job?.name==='deploy');
 check(artifact?.id===pin.artifactId&&artifact.expired===false&&
   artifact.size_in_bytes===ORIGINAL_ARTIFACT_LENGTH[server]&&
   artifact?.archive_download_url===
    'https://api.github.com/repos/Riflex91/boringstuff/actions/artifacts/'+
      pin.artifactId+'/zip');
 check(typeof logText==='string'&&logText.length>100&&logText.length<1000000&&
   !logText.includes('\0'));
 const lines=logText.replace(/^\uFEFF/,'').split(/\r?\n/);
 check(lines.length>=10&&lines.length<=12000);
 // A single marker is mandatory; a duplicated/replayed marker must HOLD.
 const row=singleBy(lines,tokenLine);
 const separator='LIVE_100T_PASS ';
 const start=row.line.indexOf(separator);
 check(start>0);
 const jsonText=row.line.slice(start+separator.length);
 check(jsonText.startsWith('{"status":"PASS",'));
 let marker;
 try{marker=JSON.parse(jsonText);}catch{deny();}
 check(marker&&typeof marker==='object'&&!Array.isArray(marker)&&
   marker.status==='PASS'&&marker.observedTicks===pin.observedTicks&&
   marker.deploymentTick===pin.deploymentTick&&
   marker.snapshotTick===pin.snapshotTick&&
   marker.snapshotTick-marker.deploymentTick===pin.observedTicks&&
   marker.checkedCpuSnapshots===pin.checkedCpuSnapshots&&
   marker.minimumSnapshotBucket===pin.minimumSnapshotBucket&&
   marker.maximumSnapshotCpu===pin.maximumSnapshotCpu&&
   marker.rcl===pin.rcl&&marker.bucket>=pin.minimumSnapshotBucket&&
   typeof marker.cpu==='number'&&Number.isFinite(marker.cpu)&&marker.cpu>=0&&
   marker.cpu<=marker.maximumSnapshotCpu&&
   marker.roomEvidence?.sampledRoomSnapshots>=2&&
   marker.roomEvidence?.sampledEnergySnapshots>=2&&
   marker.expansionEvidence?.snapshotTick===pin.snapshotTick);
 const deployment=singleBy(lines,/Deployment ID:\s+[0-9]{13,}-[0-9]+/);
 const upload=singleBy(lines,/Upload completed\./);
 const verified=singleBy(lines,/Server-side deployment verification passed\./);
 const zipped=singleBy(lines,/SHA256 digest of uploaded artifact zip is [a-f0-9]{64}/);
 const finalized=singleBy(lines,/successfully finalized\. Artifact ID [0-9]+/);
 const serverLog=singleBy(lines,/Server:\s+(world|newbieland)$/);
 const branchLog=singleBy(lines,/Branch:\s+[a-zA-Z0-9_-]+$/);
 const localModules=singleBy(lines,/Runtime modules:\s+\d+$/);
 check(deployment.line.endsWith('Deployment ID:     '+pin.deploymentId)&&
   upload.index>deployment.index&&verified.index>upload.index&&
   row.index>verified.index&&
   zipped.index>row.index&&finalized.index>zipped.index&&
   zipped.line.endsWith(ORIGINAL_ARTIFACT_SHA256[server])&&
   finalized.line.endsWith('Artifact ID '+pin.artifactId)&&
   serverLog.line.trimEnd().endsWith('Server:            '+server)&&
   branchLog.line.endsWith('Branch:            '+pin.branch)&&
   localModules.line.endsWith('Runtime modules:   82'));
 // The marker itself does not carry a source SHA or deploymentId. The
 // authenticated run metadata, job, corresponding upload & ZIP receipt
 // must all be independently sourced; never infer commit from marker.
 return Object.freeze({
  server,runId:pin.runId,jobId:pin.jobId,artifactId:pin.artifactId,
  observedRunCommit:pin.headSha,requiredCurrentMain:PINNED_MAIN,
  historicalWindowPassed:true,observedTicks:marker.observedTicks,
  cpuSamples:marker.checkedCpuSnapshots,maxCpu:marker.maximumSnapshotCpu,
  minBucket:marker.minimumSnapshotBucket,
  artifactZipSha256:ORIGINAL_ARTIFACT_SHA256[server],
  artifactUploadLogMatchesPinnedZip:true,
  sameShaAsCurrentMain:pin.headSha===PINNED_MAIN,
  originalJobSourceAuthenticatedByThisFunction:false,
  currentRuntimeRechecked:false,originalReceiptReplaced:false,
  exactMainWorldWitnessAuthorized:false,
  releaseAuthorized:false,mayUploadWorldCode:false,
  mayMergeCandidate:false
 });
}
export function compareHistoricalWorldNewbWitnesses({
 world,newbieland
}={}){
 check(world?.server==='world'&&newbieland?.server==='newbieland'&&
   world?.runId===HISTORICAL_JOB_PINS.world.runId&&
   newbieland?.runId===HISTORICAL_JOB_PINS.newbieland.runId&&
   world?.historicalWindowPassed===true&&
   newbieland?.historicalWindowPassed===true);
 return Object.freeze({
  historicalBothPassed:true,
  historicalCommitsMatch:world.observedRunCommit===newbieland.observedRunCommit,
  worldOriginalMatchesCurrentMain:world.sameShaAsCurrentMain===true,
  newbOriginalMatchesCurrentMain:newbieland.sameShaAsCurrentMain===true,
  exactPredecessorPairAvailable:false,
  releaseHold:'HOLD_EXACT_PREDECESSOR_PAIR_MISSING',
  releaseAuthorized:false,mayMergeCandidate:false,mayUploadWorldCode:false
 });
}
