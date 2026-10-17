import assert from 'node:assert/strict';
import {inspectOriginalArtifactMetadata}
 from './o57-original-artifact-metadata.mjs';
import {ROADMAP_HISTORICAL_ARTIFACTS}
 from './o57-private-roadmap-evidence-vault.mjs';

function fake(server){
 const x=ROADMAP_HISTORICAL_ARTIFACTS[server];
 return {
  server,observedAt:'2026-10-17T20:00:00Z',
  run:{id:Number(x.runId),head_sha:x.commit,
   status:'completed',conclusion:'success',event:'workflow_run'},
  artifacts:{total_count:1,artifacts:[{
   id:Number(x.artifactId),expired:false,expires_at:x.expiresAt,
   size_in_bytes:server==='world'?193951:192120,
   archive_download_url:'https://api.github.com/repos/Riflex91/boringstuff/actions/artifacts/'+x.artifactId+'/zip'
  }]}
 };
}
for(const server of ['world','newbieland']){
 const f=fake(server),r=inspectOriginalArtifactMetadata(f);
 assert.equal(r.metadataAccepted,true);
 assert.deepEqual(r.failures,[]);
 assert.equal(r.archiveDownloaded,false);
 assert.equal(r.releaseAuthorized,false);
 const altered=[
  {...f,run:{...f.run,head_sha:'a'.repeat(40)}},
  {...f,run:{...f.run,event:'push'}},
  {...f,run:{...f.run,conclusion:'failure'}},
  {...f,artifacts:{total_count:2,artifacts:f.artifacts.artifacts}},
  {...f,artifacts:{total_count:1,artifacts:[]}},
  {...f,artifacts:{total_count:1,artifacts:[{
   ...f.artifacts.artifacts[0],expired:true
  }]}},
  {...f,artifacts:{total_count:1,artifacts:[{
   ...f.artifacts.artifacts[0],archive_download_url:'https://evil.invalid/zip'
  }]}},
  {...f,observedAt:'2026-11-17T00:00:00Z'},
  {...f,observedAt:'unparseable'}
 ];
 for(const a of altered){
  const verdict=inspectOriginalArtifactMetadata(a);
  assert.equal(verdict.metadataAccepted,false);
  assert.ok(verdict.failures.length>0);
  assert.equal(verdict.releaseAuthorized,false);
 }
}
console.log('O57 original World and Newbieland artifact metadata, expiry and no release authority: PASS');
