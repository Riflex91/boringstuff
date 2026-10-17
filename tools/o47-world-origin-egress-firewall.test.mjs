import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isOfficialWorldTarget,assertWorldHttpReadOnly,WORLD_HTTP_MUTATION_HOLD
} from './o46-world-http-write-policy.mjs';
import { ScreepsHttpClient } from './screeps-client.mjs';

// Host parsing must handle canonical, ports, trailing dots and subdomains
// without a substring matching bypass or accidental third-party host match.
for (const address of [
  'https://screeps.com/',
  'HTTPS://SCREEPS.COM./',
  'http://screeps.com:80/',
  'https://screeps.com:8443/api/',
  'https://www.screeps.com/',
  'https://api.screeps.com/api/',
  'https://operator@screeps.com/'
]) assert.equal(isOfficialWorldTarget(address),true,address);
for (const address of [
  'http://screeps.newbieland.net:21025/',
  'https://screeps.com.attacker.invalid/',
  'https://screeps.com@attacker.invalid/',
  'https://not-screeps.com/',
  'https://screepsxcom/',
  'https://example.invalid/path/screeps.com/',
  'ftp://screeps.com/',
  'not a URL',''
]) assert.equal(isOfficialWorldTarget(address),false,address);

// The same HTTP rules apply when the actual network destination points to
// official World even if a caller deliberately supplies an alternate label.
const official='https://screeps.com/';
for(const wrongName of ['newbieland','offline-fixture','ptr','WORLD','']){
  for(const endpoint of [
    '/api/user/code','/api/user/clone-branch',
    '/api/user/set-active-branch','/api/game/place-spawn',
    '/api/user/memory','/api/auth/signin'
  ]) {
    assert.throws(()=>assertWorldHttpReadOnly(
      wrongName,'POST',endpoint,official),new RegExp(WORLD_HTTP_MUTATION_HOLD));
  }
}
assert.equal(assertWorldHttpReadOnly('newbieland','GET','/api/user/code',official),
  undefined);
assert.equal(assertWorldHttpReadOnly('world','POST','/api/auth/signin',official),
  undefined);
assert.equal(assertWorldHttpReadOnly('newbieland','POST','/api/user/code',
  'http://screeps.newbieland.net:21025/'),undefined);

const fakeWorld=new ScreepsHttpClient('newbieland',{
  baseUrl:official,token:'synthetic-token',email:'fake@example.test',
  password:'not-a-real-password'
});
for (const action of [
  () => fakeWorld.userUploadCodeOnce('chatgpt',{}),
  () => fakeWorld.userSetActiveBranch('chatgpt'),
  () => fakeWorld.gamePlaceSpawn('W37S79',37,26,'Spawn1'),
  () => fakeWorld.gameCheckUniqueObjectName('spawn','Spawn1')
]) assert.throws(action,new RegExp(WORLD_HTTP_MUTATION_HOLD));
await assert.rejects(()=>fakeWorld._request('POST','/api/user/clone-branch',{}),
  new RegExp(WORLD_HTTP_MUTATION_HOLD));

// Observe actual localhost requests and ensure mid-flight base URL changes
// cannot redirect one of our initially allowed requests to official World.
const observations=[];
const server=http.createServer((req,res)=>{
  observations.push({method:req.method,path:req.url});
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({ok:1}));
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
try {
  const local='http://127.0.0.1:'+server.address().port+'/';
  const newbieland=new ScreepsHttpClient('newbieland',{
    baseUrl:local,token:'synthetic-token'
  });
  const reply=await newbieland._request('POST','/api/user/code',{branch:'fixture'});
  assert.equal(reply.ok,1);
  assert.deepEqual(observations,[{method:'POST',path:'/api/user/code'}],
    'Actual Newbieland-origin transport must remain usable');
  newbieland.server.baseUrl=official;
  const n=observations.length;
  for (const attempt of [
    ()=>newbieland.userSetActiveBranch('chatgpt'),
    ()=>newbieland.userUploadCodeOnce('chatgpt',{}),
    ()=>newbieland.gamePlaceSpawn('W37S79',37,26,'Spawn1'),
    ()=>newbieland.gameCheckUniqueObjectName('spawn','Spawn1')
  ]) assert.throws(attempt,new RegExp(WORLD_HTTP_MUTATION_HOLD));
  assert.equal(observations.length,n);

  const switchedDuringAuth=new ScreepsHttpClient('newbieland',{
    baseUrl:local,email:'only-fixture@example.test',password:'fixture-password'
  });
  let authenticated=0;
  switchedDuringAuth.auth=async()=>{
    authenticated++;
    switchedDuringAuth.token='fixture-token';
    switchedDuringAuth.server.baseUrl='https://www.screeps.com/';
    return {token:'fixture-token'};
  };
  await assert.rejects(()=>switchedDuringAuth._request('POST','/api/user/code',{}),
    new RegExp(WORLD_HTTP_MUTATION_HOLD));
  assert.equal(authenticated,1,'The first check allowed local, then auth changed target');
  assert.equal(observations.length,n,
    'Second per-dispatch origin check must stop redirected World POST');
  assert.equal(switchedDuringAuth.serverName,'newbieland',
    'The destination, not only the immutable label, controls egress');

  // Correctly named World client still permits read-only GET diagnostics
  // and its own auth POST; existing O46 regression checks the on-wire flow.
  const realWorldNamed=new ScreepsHttpClient('world',{
    baseUrl:local,token:'fixture'
  });
  await realWorldNamed.authMe();
  assert.equal(observations.at(-1).method,'GET');
  await assert.rejects(()=>realWorldNamed._request('POST','/api/user/code',{}),
    new RegExp(WORLD_HTTP_MUTATION_HOLD));
  assert.equal(observations.filter(x=>x.method==='POST').length,1);
} finally {
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
const clientSource=fs.readFileSync(new URL('./screeps-client.mjs',
  import.meta.url),'utf8');
const early=clientSource.indexOf(
  'assertWorldHttpReadOnly(this.serverName, method, endpoint, this.server?.baseUrl);');
const authenticate=clientSource.indexOf('if (!opts.skipAuth && !this.token) await this.auth()');
const late=clientSource.indexOf(
  'assertWorldHttpReadOnly(this.serverName, method, endpoint, configuredBaseUrl);');
const socket=clientSource.indexOf('const req = transport.request(');
assert.ok(early>0 && authenticate>early && late>authenticate && socket>late,
  'Origin must be checked both before auth and after auth before every socket request');
console.log('O47 official World origin masking + mutable URL TOCTOU egress regression: PASS');
