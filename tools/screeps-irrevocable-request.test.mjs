import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {ScreepsHttpClient} from './screeps-client.mjs';

// Local loopback HTTP fixture: ensure a *single on-wire POST* in all
// ambiguous/retryable failure cases, not merely one wrapper method call.
async function scenario(route,kind,invoker) {
  let requests=0,loginRequests=0,receivedBody=null;
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/api/auth/signin') {
      loginRequests++;
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({token:'newToken'}));
      return;
    }
    requests++;
    const chunks=[];
    for await (const chunk of req) chunks.push(chunk);
    receivedBody=Buffer.concat(chunks).toString('utf8');
    assert.equal(req.method,'POST');
    assert.equal(req.url,route);
    if(kind==='drop')return req.socket.destroy();
    if(kind==='429') {
      res.writeHead(429,{'Content-Type':'application/json','Retry-After':'0'});
      return res.end(JSON.stringify({error:'RATE_LIMITED'}));
    }
    if(kind==='503') {
      res.writeHead(503,{'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:'TEMPORARY'}));
    }
    if(kind==='401') {
      res.writeHead(401,{'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:'UNAUTHORIZED'}));
    }
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({ok:1}));
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address=server.address();
  const client=new ScreepsHttpClient('world',{
    baseUrl:'http://127.0.0.1:'+address.port+'/',
    token:'token',
    email:'test@example.test',password:'in-memory-credentials'
  },{shard:'shard0'});
  try {
    if(kind==='ok')assert.equal((await invoker(client)).ok,1);
    else await assert.rejects(()=>invoker(client));
    assert.equal(requests,1,route+' '+kind+' must make ONE on-wire POST');
    assert.equal(loginRequests,0,'No auth retry or re-signin on a mutation');
    assert.equal(typeof JSON.parse(receivedBody),'object');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
}
for(const kind of ['ok','429','503','401','drop']) {
  await scenario('/api/game/place-spawn',kind,client=>
    client.gamePlaceSpawn('W37N11',12,13,'Spawn1','shard0'));
  await scenario('/api/user/set-active-branch',kind,client=>
    client.userSetActiveBranch('chatgpt','activeWorld'));
}
// Read-only GETs should retain their normal bounded transient error recovery.
{
  let count=0;
  const server=http.createServer((req,res)=>{
    count++;
    if(count===1){res.writeHead(503);return res.end('{}');}
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end('{"_id":"my-account"}');
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const client=new ScreepsHttpClient('world',{
    baseUrl:'http://127.0.0.1:'+server.address().port+'/',token:'token'
  },{shard:'shard0'});
  try {
    const me=await client.authMe();
    assert.equal(me._id,'my-account');
    assert.equal(count,2,'GET must still have bounded retries');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
}
console.log('World first-spawn and activation on-wire no-retry transport tests: PASS');
