import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertLegacyWorldMutationDisabled }
  from './o45-world-mutation-entrypoint-hold.mjs';
import {
  createGithubWriterFenceTransport,releaseWorldWriterFence
} from './o44-world-writer-ref-fence.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tools=path.join(root,'tools');
const tmp=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP||os.tmpdir(),'o45-hold-'));
const scripts=[
  ['world-branch-bootstrap.mjs','legacy-code-bootstrap'],
  ['world-next-inactive-restage.mjs','legacy-inactive-restage'],
  ['world-next-separate-inactive-stage.mjs','legacy-separate-stage'],
  ['world-next-activate-spawn.mjs','legacy-spawn-activation'],
  ['world-next-place-spawn.mjs','legacy-spawn-placement'],
  ['world-first-spawn.mjs','legacy-first-spawn']
];
try{
  for(const [filename,operation] of scripts){
    assert.throws(()=>assertLegacyWorldMutationDisabled(operation),
      /O45_WORLD_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR/);
    const source=fs.readFileSync(path.join(tools,filename),'utf8');
    const main=/async function main\(\)\s*\{/.exec(source);
    assert.ok(main,filename+' main entrypoint must exist');
    const guard=source.indexOf("assertLegacyWorldMutationDisabled('"+operation+"')",
      main.index);
    assert.ok(guard>main.index,filename+' must call fail-closed guard');
    const after=source.slice(main.index,guard);
    assert.ok(!after.includes('ScreepsHttpClient.fromConfig'),
      filename+' may not authenticate before the HOLD');
    assert.ok(!after.includes('fs.writeFileSync'),
      filename+' may not write config before the HOLD');
    assert.ok(!after.includes("api._request('POST'"),
      filename+' may not mutate before the HOLD');
    // Run real CLI with every old approval field and a fake high-privilege
    // override. All code must abort without trying to authenticate.
    const env={
      PATH:process.env.PATH||'',
      RUNNER_TEMP:tmp,
      SCREEPS_SERVER:'world', SCREEPS_BRANCH:'chatgpt',
      SCREEPS_CONFIG:path.join(tmp,filename+'.json'),
      WORLD_BOOTSTRAP_CONFIRM:'STAGE_WORLD_CODE',
      WORLD_SEPARATE_STAGE_CONFIRM:'STAGE_SEPARATE_INACTIVE_CODE',
      WORLD_RESTAGE_CONFIRM:'RESTAGE_INACTIVE_WORLD_CODE',
      WORLD_W37S79_ACTIVATION_APPROVAL:'ACTIVATE_W37S79_VERIFIED_SPAWN_STAGE',
      WORLD_W37S79_PLACEMENT_APPROVAL:'PLACE_W37S79_37_26_ONLY',
      O45_ALLOW_WORLD_DEPLOY:'true'
    };
    const outcome=spawnSync(process.execPath,[path.join(tools,filename)],{
      cwd:tools,env,timeout:5000,encoding:'utf8'
    });
    assert.equal(outcome.status,1,filename+' must abort');
    assert.match(outcome.stderr,
      /O45_WORLD_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR/,
      filename+' must report consistent HOLD');
    assert.equal(fs.existsSync(env.SCREEPS_CONFIG),false,
      filename+' cannot create any auth config');
  }
  assert.throws(()=>assertLegacyWorldMutationDisabled('unknown'),
    /O45_WORLD_MUTATION_HOLD_UNKNOWN_OPERATION/);
  const deploy=fs.readFileSync(path.join(tools,'deploy-live.mjs'),'utf8');
  const worldHold=deploy.indexOf("if (serverName === 'world')");
  const api=deploy.indexOf('ScreepsHttpClient.fromConfig(serverName)');
  assert.ok(worldHold>0 && api>worldHold,
    'Direct World code uploader must abort before authentication');
  assert.match(deploy,/O43_WORLD_CODE_UPLOAD_HOLD_NO_APPROVED_TWO_PHASE_EXECUTOR/);

  const fence=fs.readFileSync(
    path.join(tools,'o44-world-writer-ref-fence.mjs'),'utf8');
  assert.ok(!fence.includes("send(transport,'DELETE'"),
    'Non-CAS DELETE of ref is never safe');
  assert.match(fence,/UNSAFE_NON_ATOMIC_REF_DELETE_DISABLED/);
  const transport=createGithubWriterFenceTransport({
    githubToken:'synthetic-token-very-long'
  });
  await assert.rejects(()=>transport({
    method:'DELETE',path:'/git/ref/tags/locks/screeps-world-code-writer'
  }),/O44_WRITER_LOCK_HOLD_UNEXPECTED_REQUEST/,
  'Even an authenticated GitHub transport must refuse Git-ref DELETE');

  // Reproduce the dangerous former TOCTOU shape: operator sees owner A at
  // GET, but another actor changes ref before any DELETE could be sent.
  let calls=0,deleteCount=0;
  const held={
    scope:'world',ref:'refs/tags/locks/screeps-world-code-writer',
    ownerTagSha:'a'.repeat(40),ownerRunId:'9888',lockHeld:true
  };
  const transportRace=async({method})=>{
    calls++;
    if(method==='DELETE') {deleteCount++;throw new Error('unsafe deletion');}
    assert.equal(method,'GET');
    return {status:200,data:{ref:held.ref,object:{
      type:'tag',sha:'a'.repeat(40)
    }}};
  };
  await assert.rejects(()=>releaseWorldWriterFence({
    transport:transportRace,held,operatorReleasePhrase:'RELEASE_WORLD_WRITER_LOCK',
    mutationOutcomeResolved:true
  }),/O44_WRITER_LOCK_HOLD_UNSAFE_NON_ATOMIC_REF_DELETE_DISABLED/);
  assert.equal(calls,1);
  assert.equal(deleteCount,0);
  const workflows=[
    'screeps-world-bootstrap.yml','screeps-world-next-inactive-restage.yml',
    'screeps-world-next-separate-inactive-stage.yml',
    'screeps-world-next-activate-spawn.yml',
    'screeps-world-next-place-spawn.yml',
    'screeps-world-first-spawn.yml'
  ];
  for(let i=0;i<workflows.length;i++){
    const wf=fs.readFileSync(path.join(root,'.github','workflows',workflows[i]),'utf8');
    assert.ok(wf.includes('node '+scripts[i][0]),
      'All known workflow mutation entrypoints must be covered: '+workflows[i]);
  }
} finally {
  fs.rmSync(tmp,{recursive:true,force:true});
}
console.log('O45 six World writer commands blocked before auth + CAS-less delete disabled: PASS');
