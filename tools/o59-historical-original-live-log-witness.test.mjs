import assert from 'node:assert/strict';
import {HISTORICAL_JOB_PINS,inspectHistoricalJobLogWitness,
 compareHistoricalWorldNewbWitnesses,O59_ORIGINAL_LOG_HOLD}
 from './o59-historical-original-live-log-witness.mjs';
import {ORIGINAL_ARTIFACT_SHA256,ORIGINAL_ARTIFACT_LENGTH}
 from './o58-original-artifact-integrity.mjs';
import {PINNED_MAIN} from './o57-roadmap-release-closeout.mjs';

// In GitHub CI, deliberately use only synthetic reconstructed text. The
// actual original historical jobs were fetched through GitHub read-only
// connector and evaluated separately; no credentials or original log text
// are embedded in source control.
const stamp='2026-10-16T04:05:42.0000000Z ';
function fixture(server){
 const p=HISTORICAL_JOB_PINS[server];
 const marker={
  status:'PASS',deploymentTick:p.deploymentTick,
  observedTicks:p.observedTicks,snapshotTick:p.snapshotTick,
  rcl:p.rcl,cpu:p.maximumSnapshotCpu-1,bucket:10000,
  checkedCpuSnapshots:p.checkedCpuSnapshots,
  minimumSnapshotBucket:p.minimumSnapshotBucket,
  maximumSnapshotCpu:p.maximumSnapshotCpu,
  roomEvidence:{sampledRoomSnapshots:2,sampledEnergySnapshots:2},
  expansionEvidence:{snapshotTick:p.snapshotTick}
 };
 const statements=[
  'Starting historical fixture (not real original Actions log)',
  'Server:            '+server,
  'Branch:            '+p.branch,
  'Runtime modules:   82',
  'Deployment ID:     '+p.deploymentId,
  'Server before:     0.3.0-shadow.15-node24',
  'Backup written:    /tmp/synthetic-no-original.zip',
  'Upload completed.',
  'Server after:      0.3.0-shadow.15-node24',
  'Server-side deployment verification passed.',
  'Deployment marker will be emitted by the first runtime tick',
  'LIVE_100T_PASS '+JSON.stringify(marker),
  'Beginning upload of artifact content to blob storage',
  'Uploaded bytes '+ORIGINAL_ARTIFACT_LENGTH[server],
  'SHA256 digest of uploaded artifact zip is '+ORIGINAL_ARTIFACT_SHA256[server],
  'Finalizing artifact upload',
  'Artifact historical-synthetic.zip successfully finalized. Artifact ID '+p.artifactId,
  'End synthetic fixture'
 ];
 return {
  server,run:{id:p.runId,head_sha:p.headSha,
   conclusion:'success',status:'completed',event:'workflow_run'},
  job:{id:p.jobId,run_id:p.runId,
   status:'completed',conclusion:'success',name:'deploy'},
  artifact:{id:p.artifactId,expired:false,
   size_in_bytes:ORIGINAL_ARTIFACT_LENGTH[server],
   archive_download_url:'https://api.github.com/repos/Riflex91/boringstuff/actions/artifacts/'+p.artifactId+'/zip'},
  logText:statements.map(x=>stamp+x).join('\n')
 };
}
const samples={world:fixture('world'),newbieland:fixture('newbieland')};
const validated={};
for(const server of ['world','newbieland']){
 const q=samples[server],r=inspectHistoricalJobLogWitness(q);
 validated[server]=r;
 assert.equal(r.historicalWindowPassed,true);
 assert.equal(r.sameShaAsCurrentMain,server==='newbieland');
 assert.equal(r.artifactUploadLogMatchesPinnedZip,true);
 assert.equal(r.observedTicks,HISTORICAL_JOB_PINS[server].observedTicks);
 assert.equal(r.artifactZipSha256,ORIGINAL_ARTIFACT_SHA256[server]);
 assert.equal(r.originalJobSourceAuthenticatedByThisFunction,false);
 assert.equal(r.exactMainWorldWitnessAuthorized,false);
 assert.equal(r.releaseAuthorized,false);
 assert.equal(r.mayMergeCandidate,false);
 assert.equal(r.mayUploadWorldCode,false);
}
const pair=compareHistoricalWorldNewbWitnesses(validated);
assert.equal(pair.historicalBothPassed,true);
assert.equal(pair.historicalCommitsMatch,false);
assert.equal(pair.worldOriginalMatchesCurrentMain,false);
assert.equal(pair.newbOriginalMatchesCurrentMain,true);
assert.equal(pair.releaseHold,'HOLD_EXACT_PREDECESSOR_PAIR_MISSING');
assert.equal(pair.releaseAuthorized,false);
const hold=new RegExp(O59_ORIGINAL_LOG_HOLD);
const valid=samples.world;
const p=HISTORICAL_JOB_PINS.world;
const malicious=[
 {...valid,run:{...valid.run,head_sha:PINNED_MAIN}},
 {...valid,run:{...valid.run,conclusion:'failure'}},
 {...valid,run:{...valid.run,event:'push'}},
 {...valid,job:{...valid.job,id:123}},
 {...valid,job:{...valid.job,run_id:12}},
 {...valid,job:{...valid.job,conclusion:'failure'}},
 {...valid,artifact:{...valid.artifact,expired:true}},
 {...valid,artifact:{...valid.artifact,
  archive_download_url:'https://attacker.invalid/artifact.zip'}},
 {...valid,artifact:{...valid.artifact,size_in_bytes:1}},
 {...valid,logText:valid.logText+"\n"+stamp+'LIVE_100T_PASS '+JSON.stringify({status:'PASS'})},
 {...valid,logText:valid.logText.replace('LIVE_100T_PASS ','LIVE_100T_FAIL ')},
 {...valid,logText:valid.logText.replace('"observedTicks":166','"observedTicks":99')},
 {...valid,logText:valid.logText.replace('"deploymentTick":78327634','"deploymentTick":78327635')},
 {...valid,logText:valid.logText.replace('"maximumSnapshotCpu":12.445','"maximumSnapshotCpu":12.5')},
 {...valid,logText:valid.logText.replace('Server-side deployment verification passed.','Missing verification')},
 {...valid,logText:valid.logText.replace('Runtime modules:   82','Runtime modules:   81')},
 {...valid,logText:valid.logText.replace('Deployment ID:     '+p.deploymentId,'Deployment ID:     fake')},
 {...valid,logText:valid.logText.replace(ORIGINAL_ARTIFACT_SHA256.world,'f'.repeat(64))},
 {...valid,logText:valid.logText.replace('Artifact ID '+p.artifactId,'Artifact ID 42')},
 {...valid,logText:valid.logText.replace('Upload completed.','Upload failed.')},
 {...valid,logText:valid.logText.split('\n').reverse().join('\n')},
 {...valid,logText:''},
 {...valid,logText:'x'.repeat(1000001)}
];
for(const [index,obj] of malicious.entries())
 assert.throws(()=>inspectHistoricalJobLogWitness(obj),hold,'malicious fixture '+index);
assert.throws(()=>compareHistoricalWorldNewbWitnesses({
 world:{...validated.world,runId:3},newbieland:validated.newbieland
}),hold);
console.log('O59 historical deploy jobs, exact ZIP digest, live tick window, predecessor SHA mismatch and adversarial logs: PASS');
