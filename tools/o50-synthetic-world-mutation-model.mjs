// O50 SYNTHETIC MODEL ONLY. Never import ScreepsHttpClient, fetch, ws,
// legacy mutators, game modules, filesystem, networking, or credential APIs.
// This is a regression model of the old seven workflow intents, NOT an
// executor, a release receipt, or an authorization to run historical writes.
const HOLD = 'O50_SYNTHETIC_MODEL_HOLD_';
const deny = reason => {throw new Error(HOLD+reason);};
const immutableDenial = Object.freeze({
  syntheticOnly:true, mayUploadWorldCode:false, mayWriteDeploymentReceipt:false,
  mayActivateWorld:false, mayPlaceWorldSpawn:false, mayRetryMutation:false,
  releaseAuthorized:false, canonicalLive100tPass:false
});
export const SIMULATED_LEGACY_INTENTS = Object.freeze([
  'stageInactiveWorldCode','restageInactiveWorldCode',
  'stageSeparateInactiveCode','placeW37S79Only','activateW37S79',
  'placePinnedWorldSpawn','activateVerifiedWorldSpawn'
]);
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const clone=x=>structuredClone(x);
const equal=(a,b)=>{
  if(!isObject(a)||!isObject(b))return false;
  const aa=Object.keys(a).sort(),bb=Object.keys(b).sort();
  return aa.length===bb.length && aa.every((name,i)=>
    name===bb[i]&&typeof a[name]==='string'&&a[name]===b[name]);
};
export function syntheticModules(tag='target'){
  if(typeof tag!=='string'||!(/^[a-z0-9_-]{1,24}$/i).test(tag))deny('MODULE_TAG');
  const out={main:'SIMULATED_'+tag+'_main',config:'SIMULATED_'+tag+'_config'};
  for(let i=0;i<80;i++)out['synthetic_'+String(i).padStart(2,'0')]=tag+'_'+i;
  return Object.freeze(out);
}
export function initialSyntheticWorld({mode='empty',active='default',
  modules=syntheticModules('target'),prior=syntheticModules('prior'),
  branches=null,spawn=null}={}){
  if(!['empty','normal'].includes(mode)||!['default','chatgpt'].includes(active)||
    !isObject(modules)||Object.keys(modules).length!==82||
    !isObject(prior)||Object.keys(prior).length!==82)deny('INITIAL_STATE');
  const records=branches?clone(branches):{
    default:{active:active==='default',modules:clone(prior)},
    chatgpt:{active:active==='chatgpt',modules:clone(modules)}
  };
  return {status:mode,branches:records,spawn:clone(spawn),expected:clone(modules),
    account:'synthetic-operator',shard:'shard0'};
}
export function createSyntheticWorldMutationSimulator(initial,acks={}){
  const state=clone(initial);
  const operations=[],attempted=new Set();
  if(!isObject(state)||!isObject(state.branches)||
    !isObject(state.expected)||Object.keys(state.expected).length!==82)
    deny('STATE_SHAPE');
  if(!isObject(acks)||Object.values(acks).some(x=>
      !['ok','reject','drop-after-commit'].includes(x)))deny('ACK_VALUES');
  const soleActive=name=>{
    const current=Object.entries(state.branches).filter(([,v])=>v?.active);
    return current.length===1&&current[0][0]===name;
  };
  const presence=(branch,active)=>isObject(state.branches[branch])&&
    state.branches[branch].active===active;
  const exact=branch=>equal(state.branches[branch]?.modules,state.expected);
  function mutate(route,fn){
    if(attempted.has(route))deny('MUTATION_REPLAY');
    attempted.add(route);
    operations.push(route);
    const ack=acks[route]||'ok';
    if(ack==='reject')deny('MUTATION_REJECTED_NO_RETRY');
    fn(); // "drop-after-commit" simulates server-side commit first.
    if(ack==='drop-after-commit')deny('COMMITTED_ACK_LOST_NO_RETRY');
  }
  function place(spawnRoom,name,requiredActive,requireEmpty){
    if(!soleActive(requiredActive)||!exact('chatgpt')||state.spawn||
       (requireEmpty&&state.status!=='empty')||
       (!requireEmpty&&state.status!=='normal'))
      deny('PREPLACEMENT_GET_GATE');
    mutate('POST /api/game/place-spawn',()=>{
      state.spawn={room:spawnRoom,name,user:state.account,shard:'shard0'};
      state.status='normal';
    });
    return immutableDenial;
  }
  function activate(target,room,requirePrior){
    if(!soleActive(requirePrior)||!presence(target,false)||
       !exact(target)||state.status!=='normal'||
       state.spawn?.room!==room||state.spawn?.user!==state.account)
      deny('PREACTIVATION_GET_GATE');
    mutate('POST /api/user/set-active-branch',()=>{
      state.branches[requirePrior].active=false;
      state.branches[target].active=true;
    });
    return immutableDenial;
  }
  return Object.freeze({
    get state(){return clone(state);},
    get transcript(){return operations.slice();},
    get denial(){return immutableDenial;},
    run(intent){
      if(!SIMULATED_LEGACY_INTENTS.includes(intent))deny('UNKNOWN_INTENT');
      switch(intent){
        case 'stageInactiveWorldCode':
          if(state.status!=='empty'||!soleActive('default')||
             state.branches.chatgpt)deny('BOOTSTRAP_GET_GATE');
          mutate('POST /api/user/clone-branch',()=>{
            state.branches.chatgpt={active:false,modules:clone(state.branches.default.modules)};
          });
          if(!soleActive('default')||!presence('chatgpt',false))
            deny('BOOTSTRAP_CLONE_READBACK');
          mutate('POST /api/user/code',()=>{
            state.branches.chatgpt.modules=clone(state.expected);
          });
          if(!exact('chatgpt'))deny('BOOTSTRAP_UPLOAD_READBACK');
          return immutableDenial;
        case 'restageInactiveWorldCode':
          if(state.status!=='empty'||!soleActive('default')||
             !presence('chatgpt',false)||exact('chatgpt'))
            deny('RESTAGE_GET_GATE');
          mutate('POST /api/user/code',()=>{
            state.branches.chatgpt.modules=clone(state.expected);
          });
          if(!exact('chatgpt'))deny('RESTAGE_READBACK');
          return immutableDenial;
        case 'stageSeparateInactiveCode':
          if(!soleActive('chatgpt')||state.branches['chatgpt-w37s79-stage']||
             state.status!=='normal')deny('SEPARATE_STAGE_GET_GATE');
          mutate('POST /api/user/clone-branch',()=>{
            state.branches['chatgpt-w37s79-stage']={
              active:false,modules:clone(state.branches.chatgpt.modules)
            };
          });
          if(!soleActive('chatgpt')||!presence('chatgpt-w37s79-stage',false))
            deny('SEPARATE_CLONE_READBACK');
          mutate('POST /api/user/code',()=>{
            state.branches['chatgpt-w37s79-stage'].modules=clone(state.expected);
          });
          if(!exact('chatgpt-w37s79-stage'))deny('SEPARATE_UPLOAD_READBACK');
          return immutableDenial;
        case 'placeW37S79Only':
          if(!presence('chatgpt-w37s79-stage',false)||
             !exact('chatgpt-w37s79-stage'))deny('PLACEMENT_STAGED_CODE');
          return place('W37S79','Spawn1','chatgpt',false);
        case 'activateW37S79':
          return activate('chatgpt-w37s79-stage','W37S79','chatgpt');
        case 'placePinnedWorldSpawn':
          return place('W37N11','Spawn1','default',true);
        case 'activateVerifiedWorldSpawn':
          return activate('chatgpt','W37N11','default');
      }
    }
  });
}
