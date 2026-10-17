// O35: independently preserve a PUBLIC-SAFE, immutable-by-run attestation
// of genuine archived GitHub original evidence before ZIPs expire.
// The backed-up source modules, original receipt JSON and deployment IDs
// MUST NEVER be written into this attestation. No Screeps calls or writes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EXPECTED_MAIN_SHA,HISTORICAL_RUNS,
  assessHistoricalPair,inspectGithubHistoricalRun}
  from './o34-historical-actions-evidence.mjs';

const isDigest=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const isSha=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);
const safeId=n=>Number.isSafeInteger(n)&&n>0;
const safeTick=n=>Number.isSafeInteger(n)&&n>=0&&n<2_000_000_000;
export const ORIGINAL_ARCHIVE_EXPIRY=Object.freeze({
 world:'2026-10-29T21:26:02Z',
 newbieland:'2026-10-30T04:16:49Z'
});

export function buildPublicHistoricalAttestation({world,newbieland,
  inspectorHeadSha,createdAt}={}){
  if(!isSha(inspectorHeadSha)||typeof createdAt!=='string'||
     !Number.isFinite(Date.parse(createdAt)))
    return {ok:false,reason:'INVALID_ATTESTATION_CONTEXT'};
  const entries={world,newbieland};
  const clean={};
  for(const server of ['world','newbieland']){
    const r=entries[server];
    const proof=r?.livePass;
    const integrity=r?.originalArtifactIntegrity;
    if(r?.historicalCanonicalPass!==true||
       r.runId!==HISTORICAL_RUNS[server]||
       r.predecessorMainSha!==EXPECTED_MAIN_SHA||
       r.exactMainSha!==(server==='newbieland')||
       r.eligibleExactPredecessor!==(server==='newbieland')||
       r.originalReceiptFileContentsVerified!==true||
       !safeId(r?.runId)||!isSha(r?.sourceHeadSha)||
       !isDigest(integrity?.archiveSha256)||
       !isDigest(integrity?.originalJobLogSha256)||
       !safeId(integrity?.artifactId)||
       integrity.artifactExpiresAt!==ORIGINAL_ARCHIVE_EXPIRY[server]||
       proof?.valid!==true||!safeTick(proof.deploymentTick)||
       !safeTick(proof.snapshotTick)||proof.observedTicks<100||
       proof.snapshotTick<proof.deploymentTick+100)
      return {ok:false,reason:'UNVERIFIED_ORIGINAL_'+server.toUpperCase()+'_EVIDENCE'};
    clean[server]={
      sourceRunId:r.runId,
      sourceCommitSha:r.sourceHeadSha,
      exactCurrentMainSha:r.sourceHeadSha===EXPECTED_MAIN_SHA,
      originalArtifactId:integrity.artifactId,
      sourceArtifactExpiresAt:integrity.artifactExpiresAt,
      sha256OfOriginalDownloadedZip:integrity.archiveSha256,
      sha256OfOriginalJobLog:integrity.originalJobLogSha256,
      originalReceiptContentIndependentlyVerified:true,
      historicalCanonical100TickPass:true,
      deploymentTick:proof.deploymentTick,
      observedGameTicks:proof.observedTicks,
      finalSnapshotTick:proof.snapshotTick,
      checkedCpuSnapshots:proof.checkedCpuSnapshots,
      minimumSnapshotBucket:proof.minimumSnapshotBucket,
      // This is an archive-fingerprint statement, NOT an in-game witness.
      currentHealthyOrFatalFree100TickCoverageVerified:false
    };
  }
  const paired=assessHistoricalPair(world,newbieland);
  if(paired.result!=='HOLD_EXACT_PREDECESSOR_PAIR_MISSING'||
     paired.newbielandExactMainHistoricalPass!==true||
     paired.worldExactMainHistoricalPass!==false)
    return {ok:false,reason:'UNEXPECTED_EXACT_PREDECESSOR_STATE'};
  const attestation={
    schemaVersion:1,
    title:'O35_ORIGINAL_GITHUB_ACTIONS_RECEIPTS_REDACTED',
    evidenceClass:'HISTORICAL_NOT_CURRENT_RELEASE',
    currentProductionMainSha:EXPECTED_MAIN_SHA,
    auditFeatureHeadSha:inspectorHeadSha,
    auditCreatedAt:createdAt,
    originalSource:'GITHUB_ACTIONS_AUTHENTICATED_GET',
    originalSensitiveBackupBytesSaved:false,
    originalDeploymentIdSaved:false,
    originalReceiptContentsSaved:false,
    newbieland:clean.newbieland,
    world:clean.world,
    exactPredecessorResult:'HOLD_EXACT_PREDECESSOR_PAIR_MISSING',
    worldExactShaStillMissing:true,
    pairedReleaseAuthorized:false,
    canonicalLive100tPairCertified:false,
    productionApiWriteCount:0
  };
  return {ok:true,attestation};
}

export function writeAttestation(file,attestation){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     !attestation||attestation.schemaVersion!==1||
     attestation.pairedReleaseAuthorized!==false||
     attestation.canonicalLive100tPairCertified!==false)
    throw Error('INVALID_NONRELEASE_ATTESTATION');
  fs.writeFileSync(file,JSON.stringify(attestation,null,2)+'\n',{
    encoding:'utf8',flag:'wx',mode:0o600
  });
  return file;
}

async function main(){
  if(process.env.GITHUB_REPOSITORY!=='Riflex91/boringstuff'||
     !process.env.GITHUB_TOKEN||
     !isSha(process.env.GITHUB_SHA)||
     !process.env.RUNNER_TEMP)throw Error('TRUSTED_GITHUB_READONLY_CONTEXT_REQUIRED');
  const [newbieland,world]=await Promise.all([
    inspectGithubHistoricalRun('newbieland',HISTORICAL_RUNS.newbieland),
    inspectGithubHistoricalRun('world',HISTORICAL_RUNS.world)
  ]);
  const verdict=buildPublicHistoricalAttestation({
    world,newbieland,inspectorHeadSha:process.env.GITHUB_SHA,
    createdAt:new Date().toISOString()
  });
  if(!verdict.ok){
    console.error('O35_ORIGINAL_ATTESTATION_HOLD_'+verdict.reason);
    process.exitCode=2;return;
  }
  const dest=path.join(process.env.RUNNER_TEMP,'o35-redacted-github-evidence.json');
  writeAttestation(dest,verdict.attestation);
  console.log('O35_VERIFIED_REDACTED_ATTESTATION_CREATED '+JSON.stringify({
    fileName:path.basename(dest),
    mainSha:EXPECTED_MAIN_SHA,originalNewbRunId:newbieland.runId,
    originalWorldRunId:world.runId,
    worldMainShaMatches:false,exactPredecessorRelease:'HOLD',
    originalPrivateDataPersisted:false
  }));
}
if(process.argv[1]&&
   path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{
    console.error('O35_READONLY_ARCHIVE_AUDIT_UNVERIFIED');
    process.exitCode=2;
  });
