import assert from 'node:assert/strict';
import {normalizeEmptyWorldBootstrap} from './world-empty-bootstrap.mjs';

const modules=Object.fromEntries(Array.from({length:8},(_,i)=>
  [i===0?'main':i===1?'config':'m'+i,'MAIN_BYTE_EXACT_'+i]));
function mock(opts={}){
 let active=opts.active??'chatgpt-w37s79-stage';
 let state=opts.status??'empty',writes=[],failPost=opts.failPost??null;
 let stored={
   chatgpt:opts.chatgptExact?{...modules}:{main:'old',config:'old'},
   'chatgpt-w37s79-stage':{main:'stale',config:'old'}
 };
 const roomMap={shards:{shard0:[],shard1:[],shard2:[],shard3:[],sim:[]}};
 if(opts.roomsNotEmpty)roomMap.shards.shard0=['W37S79'];
 const api={
   defaultShard:'shard0',
   async authMe(){return {_id:'private-id',username:opts.username??'riflex91'};},
   async userWorldStatus(){return {status:state};},
   async userRooms(userId){
     assert.equal(userId,'private-id');
     return roomMap;
   },
   async userBranches(){return {list:[
     {branch:'default',activeWorld:false},
     {branch:'chatgpt',activeWorld:active==='chatgpt'},
     {branch:'chatgpt-w37s79-stage',
       activeWorld:active==='chatgpt-w37s79-stage'}
   ]};},
   async _request(method,endpoint,body,reqOpts){
     if(method==='GET'){
       assert.equal(endpoint,'/api/user/code');
       return {modules:stored[body.branch]};
     }
     assert.equal(method,'POST');
     assert.equal(endpoint,'/api/user/code');
     assert.equal(reqOpts.max429Retries,0);
     assert.equal(reqOpts.max5xxRetries,0);
     assert.equal(reqOpts.retryAuth,false);
     writes.push({op:'upload',branch:body.branch});
     if(failPost===body.branch)throw Error('private transport uncertain');
     stored[body.branch]={...body.modules};
     return {ok:1};
   },
   async userSetActiveBranch(branch,which){
     assert.equal(which,'activeWorld');
     assert.equal(branch,'chatgpt');
     writes.push({op:'activate',branch});
     if(failPost==='activation')throw Error('private activation uncertain');
     active=branch;
     return {ok:1};
   }
 };
 return {api,writes,getActive:()=>active,getStored:()=>stored,
   forceStatus(s){state=s}};
}
const good=mock();
const phases=[];
const result=await normalizeEmptyWorldBootstrap(good.api,modules,p=>phases.push(p));
assert.equal(result.status,'PASS');
assert.equal(result.activeBranch,'chatgpt');
assert.equal(result.inactiveBranch,'chatgpt-w37s79-stage');
assert.equal(result.spawnPlaced,false);
assert.equal(result.placementPostAttempted,false);
assert.equal(result.gameActionExecuted,false);
assert.equal(result.bothExactMainModules,true);
assert.deepEqual(good.writes,[
 {op:'upload',branch:'chatgpt'},
 {op:'activate',branch:'chatgpt'},
 {op:'upload',branch:'chatgpt-w37s79-stage'}
]);
assert.equal(good.getActive(),'chatgpt');
assert.deepEqual(good.getStored()['chatgpt-w37s79-stage'],modules);
assert.ok(!JSON.stringify(result).includes('private-id'));
for(const opts of [
 {username:'other-player'}, {status:'lost'}, {status:'normal'},
 {roomsNotEmpty:true},{active:'default'}, {active:'chatgpt'}
]){
 const m=mock(opts);
 await assert.rejects(()=>normalizeEmptyWorldBootstrap(m.api,modules));
 assert.equal(m.writes.length,0,
   'fail-closed preflight must never emit any POST');
}
const uncertain=mock({failPost:'chatgpt'});
await assert.rejects(
  ()=>normalizeEmptyWorldBootstrap(uncertain.api,modules),
  /CODE_UPLOAD_OUTCOME_UNCERTAIN_NO_RETRY/);
assert.deepEqual(uncertain.writes,[{op:'upload',branch:'chatgpt'}]);
const ambiguousActivation=mock({failPost:'activation'});
await assert.rejects(
  ()=>normalizeEmptyWorldBootstrap(ambiguousActivation.api,modules),
  /ACTIVATION_OUTCOME_UNCERTAIN_NO_RETRY/);
assert.equal(ambiguousActivation.writes.length,2);
assert.equal(ambiguousActivation.getActive(),
 'chatgpt-w37s79-stage','no retry or mutation after lost acknowledgement');
const halfStage=mock({failPost:'chatgpt-w37s79-stage'});
await assert.rejects(
  ()=>normalizeEmptyWorldBootstrap(halfStage.api,modules),
  /CODE_UPLOAD_OUTCOME_UNCERTAIN_NO_RETRY/);
assert.equal(halfStage.writes.length,3);
assert.equal(halfStage.getActive(),'chatgpt');
const alreadyExact=mock({chatgptExact:true});
const done=await normalizeEmptyWorldBootstrap(alreadyExact.api,modules);
assert.equal(done.status,'PASS');
assert.deepEqual(alreadyExact.writes,[
 {op:'activate',branch:'chatgpt'},
 {op:'upload',branch:'chatgpt-w37s79-stage'}
]);
console.log('World empty-account exact-main branch bootstrap offline regression PASS');
