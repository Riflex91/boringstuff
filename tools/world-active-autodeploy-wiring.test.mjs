import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assessWorldRuntime} from './world-next-runtime-diagnostics.mjs';
import {assessAutoDeployGate} from './world-next-auto-deploy-guard.mjs';

const base={me:{_id:'owner'},
  branches:{list:[{branch:'chatgpt',activeWorld:true},
    {branch:'chatgpt-w37s79-stage',activeWorld:false}]},
  status:{status:'normal'},
  room:{objects:[
    {type:'spawn',x:37,y:26,name:'Spawn1',user:'owner'},
    {type:'controller',user:'owner',level:5}
  ]},code:{modules:Object.fromEntries(
    Array.from({length:9},(_,n)=>['module'+n,'safe-before-'+n]))}};
assert.equal(assessAutoDeployGate(base).ok,true,
  'production auto gate recognizes the genuine chatgpt activeWorld');
assert.equal(assessAutoDeployGate(base).activeBranch,'chatgpt');
assert.equal(assessWorldRuntime(base).ok,false,
  'old stage-specific diagnostic must retain its stage-only default');
assert.equal(assessWorldRuntime(base,'chatgpt').ok,true,
  'explicit live target must not force stage diagnostic to change');
for(const active of ['chatgpt-w37s79-stage','test-branch']){
  const branches={list:[
    {branch:'chatgpt',activeWorld:false},
    {branch:active,activeWorld:true}
  ]};
  const result=assessAutoDeployGate({...base,branches});
  assert.equal(result.ok,false,'reject any other active branch');
  assert.ok(result.failures.includes('EXPECTED_BRANCH_NOT_ACTIVE'));
}
assert.equal(assessAutoDeployGate({...base,room:{objects:[
  {type:'spawn',x:38,y:26,name:'Spawn1',user:'owner'},
  base.room.objects[1]
]}}).ok,false,'pinned Spawn coordinates still required');
assert.equal(assessAutoDeployGate({...base,code:{modules:{}}}).ok,false,
  'cannot deploy without readable rollback code');
assert.equal(assessAutoDeployGate({...base,room:{objects:[
  base.room.objects[0],
  {type:'controller',user:'rival',level:5}
]}}).ok,false,'owned controller remains mandatory');

const wf=fs.readFileSync(new URL(
  '../.github/workflows/screeps-world-next-auto-deploy.yml',
  import.meta.url),'utf8');
const guard=fs.readFileSync(new URL('world-next-auto-deploy-guard.mjs',
  import.meta.url),'utf8');
const supply=fs.readFileSync(new URL('world-supply-evidence.mjs',
  import.meta.url),'utf8');
assert.match(wf,/SCREEPS_SERVER: world/);
assert.match(wf,/SCREEPS_BRANCH: chatgpt\s*\n/);
assert.match(wf,/SCREEPS_SHARD: shard0/);
assert.match(wf,/SCREEPS_ROOM: W37S79/);
assert.match(wf,/github\.event\.workflow_run\.event == 'push'/);
assert.match(wf,/github\.event\.workflow_run\.head_branch == 'main'/);
assert.match(wf,/\bnpm test\b/);
assert.match(wf,/\bnpm run bench:p3\b/);
assert.match(wf,/node world-next-auto-deploy-guard\.mjs/);
assert.match(wf,/node ci-deployment-guard\.mjs preflight/);
assert.match(wf,/node deploy-live\.mjs/);
assert.match(wf,/node ci-deployment-guard\.mjs verify/);
assert.match(wf,/node world-supply-evidence\.mjs/);
assert.match(wf,/name: Save backup and deployment evidence[\s\S]*?if: always\(\)/);
assert.doesNotMatch(wf,/SCREEPS_BRANCH: chatgpt-w37s79-stage/,
  'inactive stage must never receive an automatic production upload');
assert.match(guard,/assessWorldRuntime\(input,'chatgpt'\)/);
assert.match(guard,/SCREEPS_BRANCH!=='chatgpt'/);
assert.match(guard,/api\.gameRoomObjects\('W37S79','shard0'\)/);
assert.match(guard,/\/api\/user\/code',\{branch:'chatgpt'\}/);
assert.match(supply,/branch !== 'chatgpt'/);
assert.match(supply,/readDeploymentReceipt\(\{logDir, server, branch\}\)/);
console.log('World W37S79 genuine active branch auto deploy and post-supply diagnostics wiring PASS');
