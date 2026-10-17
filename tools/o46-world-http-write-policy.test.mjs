import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { assertWorldHttpReadOnly,WORLD_HTTP_MUTATION_HOLD }
  from './o46-world-http-write-policy.mjs';
import { stageInactiveWorldCode }
  from './world-branch-bootstrap.mjs';
import { stageSeparateInactiveCode }
  from './world-next-separate-inactive-stage.mjs';

// Localhost-only HTTP fixture. A World client can authenticate and read,
// but every mutating HTTP verb/endpoint must fail BEFORE the network.
const hits=[],state={mode:'default',signins:0};
const server=http.createServer((req,res)=>{
  const address=new URL(req.url,'http://127.0.0.1');
  hits.push({method:req.method,path:address.pathname,
    query:Object.fromEntries(address.searchParams.entries())});
  const json=data=>{res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(data));};
  if(req.method==='POST'&&address.pathname==='/api/auth/signin'){
    state.signins++;return json({token:'fixture-auth-token'});
  }
  if(req.method!=='GET'){
    res.writeHead(500);return res.end(JSON.stringify({error:'MUTATION_REACHED_NETWORK'}));
  }
  if(address.pathname==='/api/auth/me')return json({_id:'offline-world-user',ok:1});
  if(address.pathname==='/api/user/world-status')
    return json({ok:1,status:'empty'});
  if(address.pathname==='/api/user/branches')return json({list:
    state.mode==='default'?
    [{branch:'default',activeWorld:true}]:
    [{branch:'chatgpt',activeWorld:true},
     {branch:'default',activeWorld:false}]});
  if(address.pathname==='/api/user/code'){
    const branch=address.searchParams.get('branch');
    return json({modules:{main:'legacy original',config:'legacy config',branch}});
  }
  res.writeHead(404);res.end('{}');
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const baseUrl='http://127.0.0.1:'+server.address().port+'/';
const fixtureWorld=()=>new ScreepsHttpClient('world',{
  baseUrl,token:'fixture',email:'fixture@example.test',
  password:'synthetic-password'
},{shard:'shard0'});
try{
  for(const endpoint of [
    '/api/user/code','/api/user/clone-branch',
    '/api/user/set-active-branch','/api/game/place-spawn',
    '/api/user/memory','/api/game/check-unique-object-name'
  ]){
    for(const verb of ['POST','PUT','PATCH','DELETE']){
      assert.throws(()=>assertWorldHttpReadOnly('world',verb,endpoint),
        /O46_WORLD_HTTP_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR/);
    }
    const api=fixtureWorld();
    const before=hits.length;
    await assert.rejects(
      ()=>api._request('POST',endpoint,{branch:'chatgpt'},{
        max429Retries:10,max5xxRetries:10,retryAuth:true,skipAuth:true
      }),/O46_WORLD_HTTP_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR/);
    assert.equal(hits.length,before,'World POST must not reach loopback even with retry overrides');
  }
  assert.equal(assertWorldHttpReadOnly('world','GET','/api/user/code'),undefined);
  assert.equal(assertWorldHttpReadOnly('world','POST','/api/auth/signin'),undefined);
  assert.equal(assertWorldHttpReadOnly('newbieland','POST','/api/user/code'),undefined);
  assert.throws(()=>assertWorldHttpReadOnly('world','GET','/evil/outside'),
    /O46_WORLD_HTTP_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR/);
  assert.throws(()=>assertWorldHttpReadOnly('world','post','/api/user/code'),
    /O46_WORLD_HTTP_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR/);

  // Raw entrypoint import can no longer make actual World HTTP writes.
  // Bootstrap safely reaches GET-only preflight but stops at clone-branch.
  const source={
    main:'module.exports.loop = () => {};',
    config:"module.exports={VERSION:'synthetic'};",
    a:'test',b:'test',c:'test',d:'test',e:'test',f:'test'
  };
  const api=fixtureWorld();
  const prior=hits.length;
  await assert.rejects(()=>stageInactiveWorldCode(api,source),
    /O46_WORLD_HTTP_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR/);
  assert.ok(hits.length>prior,'World staging must first complete GET-only checks');
  assert.equal(hits.slice(prior).every(x=>x.method==='GET'),true,
    'Imported World staging must never POST to real World client');

  // A second imported mutating helper reaches its own guarded POST but
  // cannot evade the shared transport firewall.
  state.mode='chatgpt';
  const second=hits.length;
  await assert.rejects(()=>stageSeparateInactiveCode(fixtureWorld(),
    source,'STAGE_SEPARATE_INACTIVE_CODE'),
    /O46_WORLD_HTTP_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR/);
  assert.ok(hits.length>second);
  assert.ok(hits.slice(second).every(x=>x.method==='GET'));

  // Wrapper guards also prevent a caller from swapping _request out after
  // constructing an actual World client.
  const swapped=fixtureWorld();
  let injectedRequests=0;
  swapped._request=async ()=>{injectedRequests++;return {ok:1};};
  for(const invocation of [
    ()=>swapped.userUploadCodeOnce('chatgpt',source),
    ()=>swapped.userSetActiveBranch('chatgpt'),
    ()=>swapped.gamePlaceSpawn('W37S79',37,26,'Spawn1'),
    ()=>swapped.gameCheckUniqueObjectName('spawn','Spawn1')
  ]) assert.throws(invocation,new RegExp(WORLD_HTTP_MUTATION_HOLD));
  assert.equal(injectedRequests,0);

  // With no token, World POST must be rejected before implicit POST login.
  const noToken=new ScreepsHttpClient('world',{
    baseUrl,email:'fixture@example.test',password:'fixture-password'
  });
  const noTokenBefore=hits.length;
  await assert.rejects(()=>noToken._request('POST','/api/user/code',{}),
    /O46_WORLD_HTTP_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR/);
  assert.equal(hits.length,noTokenBefore);
  // Authentication is still possible to support permitted GET-only checks.
  const me=await noToken.authMe();
  assert.equal(me._id,'offline-world-user');
  assert.equal(state.signins,1);
  const allMethods=hits.filter(x=>x.method!=='GET');
  assert.deepEqual(allMethods.map(x=>x.path),['/api/auth/signin'],
    'World network must see only GET and auth signin, never game mutations');
}finally{
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const clientSource=fs.readFileSync(path.join(root,'tools','screeps-client.mjs'),'utf8');
const guard=clientSource.indexOf('assertWorldHttpReadOnly(this.serverName, method, endpoint);');
const auth=clientSource.indexOf('if (!opts.skipAuth && !this.token) await this.auth()');
const network=clientSource.indexOf('const req = transport.request(');
assert.ok(guard>0 && auth>guard && network>auth,
  'World request guard must run before authentication and socket initialization');
const holdScript=fs.readFileSync(path.join(root,'tools','deploy-live.mjs'),'utf8');
assert.match(holdScript,/O43_WORLD_CODE_UPLOAD_HOLD_NO_APPROVED_TWO_PHASE_EXECUTOR/);
console.log('O46 World HTTP mutation firewall + imported legacy staging with real client: PASS');
