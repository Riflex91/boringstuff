import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildPublicHistoricalAttestation,writeAttestation,
  ORIGINAL_ARCHIVE_EXPIRY} from './o35-redacted-original-attestation.mjs';
import {EXPECTED_MAIN_SHA,HISTORICAL_RUNS}
  from './o34-historical-actions-evidence.mjs';
const digest='c'.repeat(64),logDigest='a'.repeat(64);
const sourceWorld='3f14590592d30dded0b6f61ab0e301e475ed6bf3';
const inspector='f'.repeat(40);
const mock=(server)=>({
  historicalCanonicalPass:true,
  originalReceiptFileContentsVerified:true,
  server,
  runId:HISTORICAL_RUNS[server],
  predecessorMainSha:EXPECTED_MAIN_SHA,
  sourceHeadSha:server==='world'?sourceWorld:EXPECTED_MAIN_SHA,
  exactMainSha:server==='newbieland',
  eligibleExactPredecessor:server==='newbieland',
  originalArtifactIntegrity:{
    archiveSha256:digest,originalJobLogSha256:logDigest,
    artifactId:server==='world'?12007967018:12024822115,
    artifactExpiresAt:ORIGINAL_ARCHIVE_EXPIRY[server]
  },
  livePass:{
    valid:true,deploymentTick:server==='world'?78327634:3956969,
    observedTicks:server==='world'?166:131,
    snapshotTick:server==='world'?78327800:3957100,
    checkedCpuSnapshots:2,minimumSnapshotBucket:10000
  }
});
const newbieland=mock('newbieland'),world=mock('world');
const context={world,newbieland,inspectorHeadSha:inspector,
  createdAt:'2026-10-17T12:35:00.000Z'};
const result=buildPublicHistoricalAttestation(context);
assert.equal(result.ok,true);
const data=result.attestation;
assert.equal(data.schemaVersion,1);
assert.equal(data.world.sha256OfOriginalDownloadedZip,digest);
assert.equal(data.newbieland.originalReceiptContentIndependentlyVerified,true);
assert.equal(data.world.exactCurrentMainSha,false);
assert.equal(data.newbieland.exactCurrentMainSha,true);
assert.equal(data.exactPredecessorResult,'HOLD_EXACT_PREDECESSOR_PAIR_MISSING');
assert.equal(data.pairedReleaseAuthorized,false);
assert.equal(data.canonicalLive100tPairCertified,false);
assert.equal(data.originalDeploymentIdSaved,false);
assert.equal(data.originalReceiptContentsSaved,false);
assert.equal(data.originalSensitiveBackupBytesSaved,false);
assert.equal(data.productionApiWriteCount,0);
for(const secret of ['20261016040545000-12345','PASSWORD',
 'DEPLOYMENT_ID_SECRET','PRIVATE_SOURCE_CONTENT'])
  assert.ok(!JSON.stringify(data).includes(secret));
const unsafe=[
  {...context,world:{...world,runId:1}},
  {...context,newbieland:{...newbieland,exactMainSha:false}},
  {...context,world:{...world,originalReceiptFileContentsVerified:false}},
  {...context,world:{...world,historicalCanonicalPass:false}},
  {...context,world:{...world,originalArtifactIntegrity:{
    ...world.originalArtifactIntegrity,archiveSha256:'not-sha256'}}},
  {...context,world:{...world,originalArtifactIntegrity:{
    ...world.originalArtifactIntegrity,artifactExpiresAt:'2099-01-01T00:00:00Z'}}},
  {...context,world:{...world,livePass:{
    ...world.livePass,observedTicks:99}}},
  {...context,world:{...world,livePass:{
    ...world.livePass,snapshotTick:78327650}}},
  {...context,world:{...world,predecessorMainSha:sourceWorld}},
  {...context,newbieland:{...newbieland,sourceHeadSha:sourceWorld}},
  {...context,inspectorHeadSha:'invalid'},
  {...context,createdAt:'not-a-date'}
];
for(const x of unsafe){
 const verdict=buildPublicHistoricalAttestation(x);
 assert.equal(verdict.ok,false,JSON.stringify(verdict).slice(0,200));
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'o35-original-proof-'));
try{
 const file=path.join(temp,'o35-redacted.json');
 writeAttestation(file,data);
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),data);
 assert.throws(()=>writeAttestation(file,data),/EEXIST/);
 assert.throws(()=>writeAttestation(path.join(temp,'bad.json'),{
   ...data,pairedReleaseAuthorized:true}),/INVALID_NONRELEASE_ATTESTATION/);
 const saved=fs.readFileSync(file,'utf8');
 assert.ok(!saved.includes('PRIVATE_'));
 assert.ok(saved.includes('HOLD_EXACT_PREDECESSOR_PAIR_MISSING'));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log('O35 redacted historical archive digests, immutable HOLD and nonsecret retention: PASS');
