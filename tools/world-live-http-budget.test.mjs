import assert from 'node:assert/strict';
import http from 'node:http';
import {ScreepsHttpClient} from './screeps-client.mjs';

let requests=0;
const server=http.createServer((req,res)=>{
  requests++;
  if(req.url?.startsWith('/slow')) {
    res.writeHead(200,{'Content-Type':'application/json'});
    const trickle=setInterval(()=>res.write(' '),20);
    res.on('close',()=>clearInterval(trickle));
    return;
  }
  if(req.url?.startsWith('/api/user/memory')) {
    res.writeHead(503,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:'upstream offline'}));
    return;
  }
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({ok:1}));
});
try {
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const address=server.address();
  assert.ok(address && typeof address!=='string');
  const client=new ScreepsHttpClient('world',{
    baseUrl:'http://127.0.0.1:'+address.port+'/',
    token:'unit-fixture'
  },{shard:'shard0'});
  const started=Date.now();
  await assert.rejects(
    client._request('GET','/slow',{},{
      timeoutMs:120,totalTimeoutMs:240,
      max429Retries:0,max5xxRetries:0
    }),
    /HTTP (hard deadline|socket timeout)/
  );
  assert.ok(Date.now()-started<3000,
    'a trickling World response cannot occupy the whole Actions job');
  assert.equal(requests,1,
    'bounded read-only request never retries failed streaming responses');
  await assert.rejects(
    client.userMemory('bot',null,{
      timeoutMs:1000,totalTimeoutMs:1500,
      max429Retries:0,max5xxRetries:0
    }),/503/
  );
  assert.equal(requests,2,
    'userMemory forwards explicit bounded options without implicit 503 retry');
  const happy=await client._request('GET','/ok',{},{
    timeoutMs:1000,totalTimeoutMs:1500,
    max429Retries:0,max5xxRetries:0
  });
  assert.equal(happy.ok,1);
  console.log('World GET absolute deadline and explicit no-retry live gate PASS');
} finally {
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
