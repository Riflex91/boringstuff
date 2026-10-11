import assert from 'node:assert/strict';
import {verifyLiveRunEvidence} from './world-first-spawn-live-gate.mjs';
const sha='a'.repeat(40);
const run={head_sha:sha,event:'workflow_run',
 path:'.github/workflows/screeps-auto-deploy.yml',
 status:'completed',conclusion:'success'};
const jobs=[{status:'completed',conclusion:'success'}];
const logs='2026-10-11 LIVE_100T_PASS '+JSON.stringify({
 status:'PASS',observedTicks:178,bucket:10000,cpu:11.5})+'\n';
const success=verifyLiveRunEvidence(run,jobs,logs,sha);
assert.deepEqual(success,{ok:true,failures:[],observedTicks:178});
assert.equal(verifyLiveRunEvidence(run,jobs,logs,'b'.repeat(40)).ok,false);
assert.equal(verifyLiveRunEvidence({...run,conclusion:'cancelled'},jobs,logs,sha).ok,false);
assert.equal(verifyLiveRunEvidence(run,[],logs,sha).ok,false);
assert.equal(verifyLiveRunEvidence(run,jobs,'LIVE_100T_FAIL {}',sha).ok,false);
assert.equal(verifyLiveRunEvidence(run,jobs,'LIVE_100T_PASS {}',sha).ok,false);
assert.equal(verifyLiveRunEvidence(run,jobs,
 'LIVE_100T_PASS '+JSON.stringify({status:'PASS',observedTicks:99,bucket:10000}),
 sha).ok,false);
assert.equal(verifyLiveRunEvidence(run,jobs,
 'LIVE_100T_PASS '+JSON.stringify({status:'FAIL',observedTicks:200,bucket:10000}),
 sha).ok,false);
assert.equal(verifyLiveRunEvidence({...run,event:'push'},jobs,logs,sha).ok,false);
console.log('World exact-main Newbieland LIVE_100T_PASS proof gate: PASS');
