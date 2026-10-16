import assert from 'node:assert/strict';
import http from 'node:http';
import { ScreepsHttpClient } from './screeps-client.mjs';

// Real, loopback HTTP transport regression. Previous generic _request()
// retried a POST after network resets, 429 and 5xx by default. Such a POST
// may already have committed a world branch clone, upload or spawn placement.
// Never send an irreversible request twice. Reads keep bounded retry policy.
const counts=Object.create(null);
const server=http.createServer((req,res)=>{
  const key=req.method+' '+new URL(req.url,'http://localhost').pathname;
  counts[key]=(counts[key]||0)+1;
  const n=counts[key];
  if(key==='POST /write-transport-lost'){
    req.socket.destroy(); // Server saw the write, caller lost its response.
    return;
  }
  let status=200;
  if(key==='POST /api/user/code')status=503;
  if(key==='POST /api/user/clone-branch')status=429;
  if(key==='POST /api/user/set-active-branch')status=401;
  if(key==='POST /api/game/place-spawn')status=500;
  if(key==='GET /read-retry-5xx'&&n===1)status=503;
  if(key==='GET /read-retry-429'&&n===1)status=429;
  if(key==='GET /read-no-retries')status=503;
  if(key==='POST /api/auth/signin')status=503;
  res.writeHead(status,{'Content-Type':'application/json'});
  res.end(JSON.stringify(status===200?{ok:1}:
    {error:'SIMULATED_'+status}));
});
await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
});
try{
  const address=server.address();
  assert.equal(typeof address.port,'number');
  const client=new ScreepsHttpClient('world',{
    baseUrl:'http://127.0.0.1:'+address.port+'/',
    token:'synthetic-token',email:'fake@example.invalid',
    password:'not-a-real-password'
  });
  // These routes are performed via direct _request('POST',...) in the world
  // staging/bootstrap tools, not through the two already-protected helpers.
  for(const [url,expected] of [
    ['/api/user/code',503],
    ['/api/user/clone-branch',429],
    ['/api/user/set-active-branch',401],
    ['/api/game/place-spawn',500],
    ['/api/auth/signin',503]
  ]){
    const name='POST '+url;
    await assert.rejects(client._request('POST',url,{branch:'chatgpt'},{
      max429Retries:7,max5xxRetries:7,retryAuth:true
    }),err=>err.statusCode===expected,
    'non-GET '+url+' must fail closed, without any retry');
    assert.equal(counts[name],1,'MUTATION MUST HAVE EXACTLY ONE ATTEMPT: '+url);
  }
  await assert.rejects(client._request('POST','/write-transport-lost',
    {branch:'chatgpt'},{
      max5xxRetries:5,max429Retries:5,retryAuth:true
    }),/socket hang up|ECONNRESET|aborted/i);
  assert.equal(counts['POST /write-transport-lost'],1,
    'lost acknowledgement is NOT permission to retry a possibly committed POST');

  // Legacy GET queries remain safely replayable with explicit retry budgets.
  assert.deepEqual(await client._request('GET','/read-retry-5xx',{},
    {max5xxRetries:1}),{ok:1});
  assert.equal(counts['GET /read-retry-5xx'],2);
  assert.deepEqual(await client._request('GET','/read-retry-429',{},
    {max429Retries:1}),{ok:1});
  assert.equal(counts['GET /read-retry-429'],2);
  await assert.rejects(client._request('GET','/read-no-retries',{},
    {max5xxRetries:0}),err=>err.statusCode===503);
  assert.equal(counts['GET /read-no-retries'],1);
} finally {
  await new Promise(resolve=>server.close(resolve));
}
console.log('Screeps non-GET exactly-once transport safety regression PASS');
