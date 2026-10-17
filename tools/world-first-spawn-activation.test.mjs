import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {activateVerifiedWorldSpawn,ACTIVATION_CONFIRM} from './world-first-spawn.mjs';

assert.equal(ACTIVATION_CONFIRM,'ACTIVATE_W37N11_AFTER_VERIFIED_SPAWN');
const game=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','game');
const modules=Object.fromEntries(fs.readdirSync(game).filter(f=>f.endsWith('.js'))
  .sort().map(f=>[f.slice(0,-3),fs.readFileSync(path.join(game,f),'utf8')]));
// The initially approved World code had 56 modules; VNext gameplay growth
// is additive. The inactive World staging integrity guard still compares
// every actual module byte-for-byte before any optional activation.
assert.ok(Object.keys(modules).length>=56,
  'Never regress below the verified original World module baseline');
assert.equal(typeof modules['defense.requests.shadow'],'string',
  'Roadmap D1 module must be included in the staged-code equality fixture');
const placement={status:'PASS',spawnVerified:true,
 target:{shard:'shard0',room:'W37N11',x:12,y:13},
 activeBranch:'default',worldCodeActivated:false};
function fake({missingSpawn=false,codeChanged=false,alreadyActive=false,
 reject=false,throwActivation=false}={}) {
 let active=alreadyActive?'chatgpt':'default',count=0;
 const calls=[];
 const api={defaultShard:'shard0',
   async gameRoomObjects(room,shard) {
     assert.equal(room,'W37N11');assert.equal(shard,'shard0');
     calls.push('GET_OBJECTS');
     return {objects:missingSpawn?[]:[{type:'spawn',name:'Spawn1',
       x:12,y:13,user:'my-user-id'}]};
   },
   async userWorldStatus() {
     calls.push('GET_STATUS');return {status:'normal'};
   },
   async userBranches() {
     calls.push('GET_BRANCHES');return {list:[
       {branch:'default',activeWorld:active==='default'},
       {branch:'chatgpt',...(active==='chatgpt'?{activeWorld:true}:{})}]};
   },
   async _request(method,endpoint,payload) {
     calls.push('GET_CODE');
     assert.equal(method,'GET');assert.equal(endpoint,'/api/user/code');
     assert.deepEqual(payload,{branch:'chatgpt'});
     return {modules:codeChanged?{main:'tampered'}:modules};
   },
   async userSetActiveBranch(branch,field) {
     calls.push('SET_ACTIVE');count++;
     assert.deepEqual([branch,field],['chatgpt','activeWorld']);
     if(throwActivation)throw new Error('could be committed');
     if(reject)return {ok:false};
     active='chatgpt';return {ok:1};
   }
 };
 return {api,calls,count:()=>count};
}
// O49: the mutator export cannot be invoked with a duck-typed API in the
// real tool path, even when it forges placement evidence and approval.
for(const scenario of [{},{missingSpawn:true},{codeChanged:true},
  {alreadyActive:true},{reject:true},{throwActivation:true}]){
  const f=fake(scenario);
  await assert.rejects(()=>activateVerifiedWorldSpawn(f.api,
    'my-user-id',placement),
    /O45_WORLD_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR/);
  assert.equal(f.calls.length,0,'No injected World API operation');
  assert.equal(f.count(),0,'No activation');
}
console.log('World exact Spawn1 post-placement activation guards: PASS');
