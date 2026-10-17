import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import fs from 'node:fs';
import { resolveSafeScreepsApiTarget,SCREEPS_API_TARGET_HOLD }
  from './o48-safe-api-target.mjs';
import { ScreepsHttpClient } from './screeps-client.mjs';

const target=(base,endpoint)=>resolveSafeScreepsApiTarget(base,endpoint);
const accepted=[
  ['https://screeps.com/','/api/user/code','https://screeps.com/api/user/code'],
  ['https://screeps.com/','/api/game/shards/info','https://screeps.com/api/game/shards/info'],
  ['http://screeps.newbieland.net:21025/','/api/auth/me',
   'http://screeps.newbieland.net:21025/api/auth/me'],
  ['https://synthetic.invalid/proxy/','/api/user/branches',
   'https://synthetic.invalid/proxy/api/user/branches'],
  ['https://synthetic.invalid/proxy/','/api/user/world-status',
   'https://synthetic.invalid/proxy/api/user/world-status'],
  ['https://synthetic.invalid/','/api/game/room-objects',
   'https://synthetic.invalid/api/game/room-objects']
];
for(const [base,endpoint,resolved] of accepted){
  assert.equal(target(base,endpoint).href,resolved);
}
const evilEndpoints=[
  'https://screeps.com/api/user/code',
  'http://screeps.com/api/user/code',
  'https://screeps.com:443/api/user/code',
  '//screeps.com/api/user/code',
  '/https://screeps.com/api/user/code',
  '/api//user/code',
  '/api/../api/user/code',
  '/api/user/../../user/code',
  '/api/%2e%2e/api/user/code',
  '/api/user/%2Fcode',
  '/api/user/code?branch=chatgpt',
  '/api/user/code#fragment',
  '/api/user/code\\x',
  '/api/user/code\nInjected: yes',
  '/api/user/code%00',
  '/api/',
  '/API/user/code',
  'api/user/code',
  '',
  1,
  null
];
for(const bad of evilEndpoints){
  assert.throws(()=>target('https://synthetic.invalid/proxy/',bad),
    new RegExp(SCREEPS_API_TARGET_HOLD),
    'Unsafe API endpoint must be rejected: '+String(bad));
}
for(const base of [
  'https://synthetic.invalid/proxy',
  'https://synthetic.invalid/proxy/?token=fake',
  'https://synthetic.invalid/proxy/#fragment',
  'https://username:password@synthetic.invalid/proxy/',
  'ftp://synthetic.invalid/',
  'not a URL',
  {},
  null
])assert.throws(()=>target(base,'/api/user/code'),
  new RegExp(SCREEPS_API_TARGET_HOLD),
  'Unsafe configured base URL must fail closed');

// Prove endpoint injection cannot bypass O47 using a named non-World client
// and a synthetic safe localhost baseURL. No network contact to Screeps.
const observed=[];
const server=http.createServer((req,res)=>{
  observed.push({method:req.method,route:req.url});
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({ok:1}));
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
try{
  const baseUrl='http://127.0.0.1:'+server.address().port+'/';
  const localClient=()=>new ScreepsHttpClient('newbieland',
    {baseUrl,token:'synthetic-credential'});

  for(const endpoint of evilEndpoints){
    const api=localClient();
    const before=observed.length;
    for(const method of ['GET','POST']){
      await assert.rejects(()=>api._request(method,endpoint,
        {branch:'chatgpt'}, {retryAuth:true,max5xxRetries:10}),
        new RegExp(SCREEPS_API_TARGET_HOLD));
      assert.equal(observed.length,before,
        'Malformed target must fail before socket and retries');
    }
  }

  const noToken=new ScreepsHttpClient('newbieland',{
    baseUrl,email:'synthetic-user',password:'synthetic-password'
  });
  let authCount=0;
  noToken.auth=async()=>{authCount++;throw new Error('unexpected login');};
  await assert.rejects(
    ()=>noToken._request('POST','https://screeps.com/api/user/code',
      {branch:'chatgpt'}),
    new RegExp(SCREEPS_API_TARGET_HOLD));
  assert.equal(authCount,0,'Endpoint injection must fail before login');

  // Ordinary API request and parameters remain supported at the same host.
  const response=await localClient()._request('GET','/api/user/branches',
    {shard:'shard0'});
  assert.equal(response.ok,1);
  assert.deepEqual(observed,[{
    method:'GET',route:'/api/user/branches?shard=shard0'
  }]);
}finally{
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
// Ensure the policy is used in both pre-auth and pre-wire positions.
const source=fs.readFileSync(new URL('./screeps-client.mjs',import.meta.url),
  'utf8');
const beforeAuth=source.indexOf(
  'resolveSafeScreepsApiTarget(this.server?.baseUrl,endpoint);');
const auth=source.indexOf('if (!opts.skipAuth && !this.token) await this.auth()');
const preWire=source.indexOf(
  'const url = resolveSafeScreepsApiTarget(configuredBaseUrl,endpoint);');
const send=source.indexOf('const req = transport.request(');
assert.ok(beforeAuth>0 && beforeAuth<auth && preWire>auth && preWire<send);
console.log('O48 absolute endpoint / URL traversal pre-auth and pre-wire egress firewall: PASS');
