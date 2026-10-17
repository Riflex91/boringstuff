import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  acquireWorldWriterFence,inspectWorldWriterFence,releaseWorldWriterFence,
  createGithubWriterFenceTransport
} from './o44-world-writer-ref-fence.mjs';

const commit='b'.repeat(40);
const REF='refs/tags/locks/screeps-world-code-writer';
const P='/git/ref/tags/locks/screeps-world-code-writer';

// Emulate GitHub REST's atomic git-ref creation with a shared in-memory
// object. All mock operations are local, no credentials, no Screeps access.
function remote({preexisting=false,tagStatus=201,refStatus=201,
  lostTagAck=false,lostRefAck=false,deleteStatus=204,
  lostDeleteAck=false,invalidRefSha=false}={}) {
  let lock=preexisting?'a'.repeat(40):null;
  let counter=0;
  const calls=[];
  const transport=async request=>{
    calls.push({method:request.method,path:request.path,body:request.body});
    if(request.method==='GET'&&request.path===P) {
      return lock===null?{status:404,data:null}:{
        status:200,data:{ref:REF,object:{
          type:'tag',sha:invalidRefSha?'not-a-sha':lock}}};
    }
    if(request.method==='POST'&&request.path==='/git/tags') {
      if(lostTagAck) throw new Error('response lost');
      if(tagStatus!==201)return {status:tagStatus,data:{error:'redacted'}};
      assert.equal(request.body.object,commit);
      assert.equal(request.body.type,'commit');
      assert.equal(request.body.tag,'locks/screeps-world-code-writer');
      const payload=JSON.parse(request.body.message);
      assert.equal(payload.protocol,'O44_SINGLE_WRITER_V1');
      assert.equal(payload.pinnedCommit,commit);
      assert.match(payload.nonce,/^[a-f0-9]{48}$/);
      counter++;
      return {status:201,data:{sha:counter.toString(16).padStart(40,'0')}};
    }
    if(request.method==='POST'&&request.path==='/git/refs') {
      if (lock!==null) return {status:422,data:{message:'Reference already exists'}};
      if(refStatus!==201) return {status:refStatus,data:{}};
      assert.equal(request.body.ref,REF);
      lock=request.body.sha;
      if(lostRefAck) throw new Error('socket disconnected after commit');
      return {status:201,data:{ref:REF,object:{type:'tag',sha:lock}}};
    }
    if(request.method==='DELETE'&&request.path===P) {
      if(deleteStatus!==204)return {status:deleteStatus,data:{}};
      lock=null;
      if(lostDeleteAck)throw new Error('socket lost after delete');
      return {status:204,data:null};
    }
    throw new Error('unexpected request '+request.method+' '+request.path);
  };
  return {transport,calls,get lock(){return lock;},set lock(value){lock=value;}};
}
const request=(transport,runId='987654')=>({
  transport,pinnedCommit:commit,runId
});
const count=(r,method,path)=>r.calls.filter(c=>c.method===method&&c.path===path).length;

{
  const r=remote();
  const held=await acquireWorldWriterFence(request(r.transport));
  assert.equal(held.lockHeld,true);
  assert.equal(held.lockHeld,true);
  assert.equal(held.mayUploadWorldCode,false);
  assert.equal(held.releaseAuthorized,false);
  assert.equal(held.ownerTagSha,r.lock);
  assert.equal(count(r,'POST','/git/tags'),1);
  assert.equal(count(r,'POST','/git/refs'),1);
  assert.equal(await inspectWorldWriterFence({transport:r.transport,held})
    .then(x=>x.lockHeld),true);
  await assert.rejects(()=>acquireWorldWriterFence(request(r.transport,'654321')),
    /O44_WRITER_LOCK_HOLD_HELD_BY_ANOTHER_RUN/);
  assert.equal(count(r,'POST','/git/tags'),1);
  await assert.rejects(()=>releaseWorldWriterFence({
    transport:r.transport,held,operatorReleasePhrase:'RELEASE_WORLD_WRITER_LOCK',
    mutationOutcomeResolved:false
  }),/EXPLICIT_REVIEW_REQUIRED/);
  await assert.rejects(()=>releaseWorldWriterFence({
    transport:r.transport,held,operatorReleasePhrase:'RELEASE_WORLD_WRITER_LOCK'
  }),/EXPLICIT_REVIEW_REQUIRED/);
  assert.equal(count(r,'DELETE',P),0);
  const release=await releaseWorldWriterFence({
    transport:r.transport,held,operatorReleasePhrase:'RELEASE_WORLD_WRITER_LOCK',
    mutationOutcomeResolved:true
  });
  assert.equal(release.released,true);
  assert.equal(release.mayUploadWorldCode,false);
  assert.equal(r.lock,null);
  assert.equal(count(r,'DELETE',P),1);
}
{
  const r=remote();
  // Both initial reads may see 404; the Git ref create remains atomic.
  const [a,b]=await Promise.allSettled([
    acquireWorldWriterFence(request(r.transport,'111111')),
    acquireWorldWriterFence(request(r.transport,'222222'))
  ]);
  assert.equal([a,b].filter(x=>x.status==='fulfilled').length,1);
  assert.equal([a,b].filter(x=>x.status==='rejected').length,1);
  assert.equal(count(r,'POST','/git/refs'),2);
  assert.equal(count(r,'POST','/git/tags'),2);
  assert.match([a,b].find(x=>x.status==='rejected').reason.message,
    /O44_WRITER_LOCK_HOLD_CREATE_REF_UNCERTAIN_NO_RETRY/);
}
for(const initial of [
  {preexisting:true}, {tagStatus:401},{tagStatus:429},{tagStatus:503},
  {lostTagAck:true}, {refStatus:401},{refStatus:429},
  {refStatus:503},{lostRefAck:true},{invalidRefSha:true}
]){
  const r=remote(initial);
  await assert.rejects(
    ()=>acquireWorldWriterFence(request(r.transport)),
    /O44_WRITER_LOCK_HOLD_/);
  assert.ok(count(r,'POST','/git/tags')<=1);
  assert.ok(count(r,'POST','/git/refs')<=1);
  assert.equal(count(r,'DELETE',P),0,'Never auto-clean a stale/ambiguous lock');
}
{
  const r=remote({lostRefAck:true});
  await assert.rejects(()=>acquireWorldWriterFence(request(r.transport)),
    /O44_WRITER_LOCK_HOLD_TRANSPORT_OUTCOME_UNCERTAIN_NO_RETRY/);
  assert.ok(r.lock,'Lost acknowledgement may still have committed ref');
  await assert.rejects(()=>acquireWorldWriterFence(request(r.transport)),
    /O44_WRITER_LOCK_HOLD_HELD_BY_ANOTHER_RUN/);
  assert.equal(count(r,'POST','/git/refs'),1,'Do not retry a lost acknowledgement');
}
{
  const r=remote();
  const held=await acquireWorldWriterFence(request(r.transport));
  r.lock='c'.repeat(40);
  await assert.rejects(()=>inspectWorldWriterFence({transport:r.transport,held}),
    /O44_WRITER_LOCK_HOLD_OWNERSHIP_LOST/);
  await assert.rejects(()=>releaseWorldWriterFence({
    transport:r.transport,held,operatorReleasePhrase:'RELEASE_WORLD_WRITER_LOCK',
    mutationOutcomeResolved:true
  }),/O44_WRITER_LOCK_HOLD_OWNERSHIP_LOST/);
  assert.equal(count(r,'DELETE',P),0);
}
for(const opts of [{deleteStatus:429},{deleteStatus:503},{lostDeleteAck:true}]){
  const r=remote(opts);
  const held=await acquireWorldWriterFence(request(r.transport));
  await assert.rejects(()=>releaseWorldWriterFence({
    transport:r.transport,held,operatorReleasePhrase:'RELEASE_WORLD_WRITER_LOCK',
    mutationOutcomeResolved:true
  }),/O44_WRITER_LOCK_HOLD_/);
  assert.equal(count(r,'DELETE',P),1);
}
for(const bad of [
  {...request(async()=>null),pinnedCommit:'bad'},
  {...request(async()=>null),runId:'0'},
  {...request(async()=>null),runId:'x'},
  {...request(async()=>null),transport:null}
]) await assert.rejects(()=>acquireWorldWriterFence(bad),/O44_WRITER_LOCK_HOLD_PARAMETERS/);

assert.throws(()=>createGithubWriterFenceTransport({
  githubToken:'not-real-token',repository:'other/example'
}),/O44_WRITER_LOCK_HOLD_GITHUB_CREDENTIALS/);
assert.throws(()=>createGithubWriterFenceTransport({
  githubToken:'not-real-token',baseUrl:'http://127.0.0.1/'
}),/O44_WRITER_LOCK_HOLD_UNTRUSTED_GITHUB_ENDPOINT/);
const source=fs.readFileSync(new URL('./o44-world-writer-ref-fence.mjs',
  import.meta.url),'utf8');
assert.match(source,/redirect:'error'/);
assert.ok(!source.includes('ScreepsHttpClient'));
const deploy=fs.readFileSync(new URL('./deploy-live.mjs',import.meta.url),'utf8');
assert.match(deploy,/O43_WORLD_CODE_UPLOAD_HOLD_NO_APPROVED_TWO_PHASE_EXECUTOR/);
assert.ok(!deploy.includes('acquireWorldWriterFence('),
  'Legacy World upload must remain closed; lock cannot authorize uploads.');
console.log('O44 concurrent GitHub fixed ref writer fence + ack loss + fail-closed stale lock: PASS');
