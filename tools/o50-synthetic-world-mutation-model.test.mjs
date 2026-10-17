import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  syntheticModules,initialSyntheticWorld,
  createSyntheticWorldMutationSimulator,SIMULATED_LEGACY_INTENTS
} from './o50-synthetic-world-mutation-model.mjs';

const expected=syntheticModules('tested');
const prior=syntheticModules('prior');
const denied=/O50_SYNTHETIC_MODEL_HOLD_/;
const simulator=(opts={},acks={})=>createSyntheticWorldMutationSimulator(
  initialSyntheticWorld({modules:expected,prior,...opts}),acks);
function checkDenial(receipt) {
  assert.equal(receipt.syntheticOnly,true);
  assert.equal(receipt.mayUploadWorldCode,false);
  assert.equal(receipt.mayPlaceWorldSpawn,false);
  assert.equal(receipt.mayActivateWorld,false);
  assert.equal(receipt.mayRetryMutation,false);
  assert.equal(receipt.releaseAuthorized,false);
}
assert.equal(SIMULATED_LEGACY_INTENTS.length,7);
assert.equal(Object.keys(expected).length,82);
assert.equal(expected.main.startsWith('SIMULATED_'),true);

// 1. Old first-stage clone and inactive code upload, without a real API.
const bootstrap=simulator({branches:{
  default:{active:true,modules:prior}
}});
checkDenial(bootstrap.run('stageInactiveWorldCode'));
assert.deepEqual(bootstrap.transcript,[
  'POST /api/user/clone-branch','POST /api/user/code']);
assert.equal(bootstrap.state.branches.chatgpt.active,false);
assert.deepEqual(bootstrap.state.branches.chatgpt.modules,expected);
assert.throws(()=>bootstrap.run('stageInactiveWorldCode'),denied);

// 2. Restore intentionally different inactive code.
const restage=simulator({branches:{
  default:{active:true,modules:prior},
  chatgpt:{active:false,modules:prior}
}});
checkDenial(restage.run('restageInactiveWorldCode'));
assert.deepEqual(restage.transcript,['POST /api/user/code']);
assert.deepEqual(restage.state.branches.chatgpt.modules,expected);
assert.throws(()=>restage.run('restageInactiveWorldCode'),denied);

// 3,4,5. W37S79 staged branch, one spawn, one activation.
const stage=simulator({mode:'normal',active:'chatgpt',branches:{
  default:{active:false,modules:prior},
  chatgpt:{active:true,modules:expected}
}});
checkDenial(stage.run('stageSeparateInactiveCode'));
assert.deepEqual(stage.transcript,[
  'POST /api/user/clone-branch','POST /api/user/code']);
checkDenial(stage.run('placeW37S79Only'));
assert.equal(stage.state.spawn.room,'W37S79');
assert.equal(stage.state.branches.chatgpt.active,true,
  'Placement does not activate newly staged branch');
checkDenial(stage.run('activateW37S79'));
assert.equal(stage.state.branches.chatgpt.active,false);
assert.equal(stage.state.branches['chatgpt-w37s79-stage'].active,true);
assert.equal(stage.transcript.length,4);

// 6,7. Pinned historical first spawn and separately gated activation.
const first=simulator({
  branches:{
    default:{active:true,modules:prior},
    chatgpt:{active:false,modules:expected}
  }
});
checkDenial(first.run('placePinnedWorldSpawn'));
assert.equal(first.state.spawn.room,'W37N11');
assert.equal(first.state.branches.default.active,true);
checkDenial(first.run('activateVerifiedWorldSpawn'));
assert.equal(first.state.branches.default.active,false);
assert.equal(first.state.branches.chatgpt.active,true);
assert.deepEqual(first.transcript,[
  'POST /api/game/place-spawn','POST /api/user/set-active-branch']);

// Malformed, absent or stale states cannot reach their simulated mutations.
for (const [intent,model] of [
  ['stageInactiveWorldCode',simulator()],
  ['restageInactiveWorldCode',simulator()],
  ['stageSeparateInactiveCode',simulator()],
  ['placeW37S79Only',simulator({mode:'normal',active:'chatgpt'})],
  ['activateW37S79',simulator({mode:'normal',active:'chatgpt'})],
  ['placePinnedWorldSpawn',simulator({mode:'normal'})],
  ['activateVerifiedWorldSpawn',simulator()]
]) {
  assert.throws(()=>model.run(intent),denied);
  assert.deepEqual(model.transcript,[],
    'Preflight denied before any synthetic mutation: '+intent);
}

// Acknowledgement lost *after simulated commit* means HOLD, never replay;
// readback may show the synthetic change, but never grants retry or release.
for(const intent of ['stageInactiveWorldCode','restageInactiveWorldCode',
  'placePinnedWorldSpawn','activateVerifiedWorldSpawn']){
  const initial=intent==='stageInactiveWorldCode'
    ?{branches:{default:{active:true,modules:prior}}}
    :intent==='restageInactiveWorldCode'
      ?{branches:{default:{active:true,modules:prior},
        chatgpt:{active:false,modules:prior}}}
      :intent==='activateVerifiedWorldSpawn'
        ?{mode:'normal',spawn:{room:'W37N11',user:'synthetic-operator',
            shard:'shard0',name:'Spawn1'}}
        :{branches:{default:{active:true,modules:prior},
            chatgpt:{active:false,modules:expected}}};
  const route=intent==='stageInactiveWorldCode'
    ?'POST /api/user/clone-branch'
    :intent==='restageInactiveWorldCode'
      ?'POST /api/user/code'
      :intent==='placePinnedWorldSpawn'
        ?'POST /api/game/place-spawn'
        :'POST /api/user/set-active-branch';
  const model=simulator(initial,{[route]:'drop-after-commit'});
  assert.throws(()=>model.run(intent),/COMMITTED_ACK_LOST_NO_RETRY/);
  assert.deepEqual(model.transcript,[route]);
  assert.throws(()=>model.run(intent),denied,'Never repeat mutation after lost ack');
  assert.deepEqual(model.transcript,[route]);
  checkDenial(model.denial);
}
for(const ack of ['reject','drop-after-commit']){
  const model=simulator({branches:{default:{active:true,modules:prior}}},
    {'POST /api/user/clone-branch':ack});
  assert.throws(()=>model.run('stageInactiveWorldCode'),denied);
  assert.equal(model.transcript.length,1);
  assert.equal(model.state.branches.chatgpt===undefined,ack==='reject');
}
assert.throws(()=>simulator().run('unknown'),denied);
assert.throws(()=>createSyntheticWorldMutationSimulator(null),denied);
assert.throws(()=>simulator({mode:'invalid'}),denied);

// Isolation contract: the model must have no imports, networking, credentials,
// storage, real game sources or real Screeps module dependencies.
const code=fs.readFileSync(new URL('./o50-synthetic-world-mutation-model.mjs',
  import.meta.url),'utf8');
assert.ok(!/^\s*import\s/m.test(code));
assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|https?\.request|process\.env)\s*\(/.test(code));
assert.ok(!code.includes('ScreepsHttpClient'));
assert.ok(!code.includes("from './world-"));
assert.ok(!code.includes('SCREEPS_TOKEN'));
console.log('O50 positive legacy intent simulations (7), gates, lost-ack no-retry, zero-network isolation: PASS');
