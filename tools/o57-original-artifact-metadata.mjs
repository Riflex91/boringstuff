import {ROADMAP_HISTORICAL_ARTIFACTS}
 from './o57-private-roadmap-evidence-vault.mjs';

// O57 audited metadata readback for two original GitHub Actions runs.
// Source objects must originate from an authenticated READ-ONLY GitHub API
// client. This shape verifier does not perform HTTP or download artifact ZIPs
// and cannot authenticate an untrusted caller-supplied JSON object.
export function inspectOriginalArtifactMetadata({
 server,run,artifacts,observedAt
}={}){
 if(!['world','newbieland'].includes(server))
  throw new Error('O57_ARTIFACT_METADATA_HOLD_SERVER');
 const pinned=ROADMAP_HISTORICAL_ARTIFACTS[server];
 const failures=[];
 if(run?.id!==Number(pinned.runId)||run?.head_sha!==pinned.commit||
    run?.status!=='completed'||run?.conclusion!=='success'||
    run?.event!=='workflow_run')
   failures.push('ORIGINAL_WORKFLOW_RUN_NOT_MATCHED');
 const records=artifacts?.artifacts;
 const matches=Array.isArray(records)
  ?records.filter(a=>a?.id===Number(pinned.artifactId)):[];
 if(matches.length!==1||artifacts.total_count!==1||
    matches[0]?.expired!==false||
    matches[0]?.expires_at!==pinned.expiresAt||
    !Number.isInteger(matches[0]?.size_in_bytes)||
    matches[0].size_in_bytes<1000||
    matches[0]?.archive_download_url!==
      'https://api.github.com/repos/Riflex91/boringstuff/actions/artifacts/'+
        pinned.artifactId+'/zip')
   failures.push('ORIGINAL_ARTIFACT_NOT_VERIFIED');
 const now=Date.parse(observedAt);
 if(typeof observedAt!=='string'||!Number.isFinite(now))
   failures.push('OBSERVATION_TIME_INVALID');
 else if(now>=Date.parse(pinned.expiresAt))
   failures.push('ARTIFACT_EXPIRED');
 return Object.freeze({
  server,originalRunId:pinned.runId,artifactId:pinned.artifactId,
  expectedCommit:pinned.commit,
  expiry:pinned.expiresAt,
  metadataAccepted:failures.length===0,
  failures:Object.freeze(failures),
  archiveDownloaded:false,privatelyReplicated:false,
  originalReceiptAuthenticated:false,
  canonicalPairedReleaseProof:false,
  releaseAuthorized:false
 });
}
