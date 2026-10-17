import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {githubGet} from './world-first-spawn-live-gate.mjs';
import {
  assertSignedJobLogLocation,followOneSignedJobLogRedirect,
  readBoundedJobLog,MAX_JOB_LOG_BYTES,
  O56_LOG_REDIRECT_HOLD,O56_LOG_SIZE_HOLD
} from './o56-signed-job-log-download.mjs';

const repo='Riflex91/boringstuff',run='39059103714';
const prefix='https://api.github.com/repos/'+repo;
const logApi=prefix+'/actions/jobs/117473212826/logs';
const apiRun=prefix+'/actions/runs/'+run;
const token='SYNTHETIC_GITHUB_BEARER_SECRET_DO_NOT_FORWARD';
const azure='https://productionresultssa18.blob.core.windows.net/actions-results/job-uuid/logs/job.txt?sp=r&se=2099-01-01T00%3A00%3A00Z&sig=syntheticSignature';
const cdn='https://pipelines.actions.githubusercontent.com/abcde/logs.zip?token=syntheticDownloadSignature';
const HOLD=new RegExp(O56_LOG_REDIRECT_HOLD),SIZE=new RegExp(O56_LOG_SIZE_HOLD);
const bytes=x=>new TextEncoder().encode(x);
const body=chunks=>new ReadableStream({
  start(controller){
    for(const x of chunks)controller.enqueue(x);
    controller.close();
  }
});
const textResponse=(content,status=200)=>({
  ok:status>=200&&status<300,status,redirected:false,type:'basic',
  body:body([bytes(content)])
});
const redirect=(location,status=302)=>({
  status,ok:false,redirected:false,type:'basic',
  headers:{get:key=>key==='location'?location:null}
});
for(const location of [azure,cdn]){
  assert.equal(assertSignedJobLogLocation(location).allowed,true);
  assert.equal(typeof assertSignedJobLogLocation(location).kind,'string');
}
const invalidLocations=[
  'http://pipelines.actions.githubusercontent.com/abc/logs.zip',
  'https://pipelines.actions.githubusercontent.com.attacker.example/logs.zip',
  'https://pipelines.actions.githubusercontent.com:8443/logs.zip',
  'https://bad@pipelines.actions.githubusercontent.com/logs.zip',
  'https://pipelines.actions.githubusercontent.com/',
  'https://pipelines.actions.githubusercontent.com//logs.zip',
  'https://pipelines.actions.githubusercontent.com/a/../logs.zip',
  'https://pipelines.actions.githubusercontent.com/path%2flogs.zip',
  'https://pipelines.actions.githubusercontent.com/logs.zip#fragment',
  'https://pipelines.actions.githubusercontent.com\\@attacker.example/logs.zip',
  'https://api.github.com/repos/'+repo+'/actions/runs/'+run,
  'https://screeps.com/api/user/code',
  'https://localhost/logs.txt','https://127.0.0.1/logs.txt',
  'https://productionresultssa18.blob.core.windows.net/actions-results/x/logs.txt',
  'https://productionresultssa18.blob.core.windows.net/actions-results/x/logs.txt?sp=w&sig=x&se=tomorrow',
  'https://productionresultssa18.blob.core.windows.net/actions-results/x/logs.txt?sp=rw&sig=x&se=tomorrow',
  'https://productionresultssa18.blob.core.windows.net/private/x/logs.txt?sp=r&sig=x&se=tomorrow',
  'https://productionresultssa18.blob.core.windows.net/actions-results/x/logs.txt?sp=r&sig=x&sig=y&se=tomorrow',
  'https://productionresultssa18.blob.core.windows.net/actions-results/x/logs.txt?sp=r&sig=x',
  'https://productionresultssa18.blob.core.windows.net/actions-results/x/logs.txt?sp=r&sig=x&se=tomorrow#x',
  'https://productionresultssa18.blob.core.windows.net.evil.invalid/actions-results/x?sp=r&sig=x&se=tomorrow',
  'https://productionresultssaX.blob.core.windows.net/actions-results/x?sp=r&sig=x&se=tomorrow',
  'ftp://pipelines.actions.githubusercontent.com/logs.zip',
  'https://pipelines.actions.githubusercontent.com/logs.zip\nBadHeader: yes',
  '//pipelines.actions.githubusercontent.com/logs.zip','',null
];
for(const loc of invalidLocations){
  assert.throws(()=>assertSignedJobLogLocation(loc),HOLD,String(loc));
}

const requests=[];
const realFetch=globalThis.fetch;
try{
  for(const target of [azure,cdn]){
    requests.length=0;
    const expectedLog='2026-10-17 worker\nLIVE_100T_PASS {"status":"PASS","observedTicks":100,"bucket":7000}\n';
    globalThis.fetch=async(url,opts)=>{
      requests.push({url,opts});
      if(requests.length===1)return redirect(target);
      if(requests.length===2)return textResponse(expectedLog);
      throw Error('NETWORK_ATTEMPT_OVER_LIMIT');
    };
    const result=await githubGet(logApi,token,repo,run,true);
    assert.equal(result,expectedLog);
    assert.equal(requests.length,2);
    assert.equal(requests[0].url,logApi);
    assert.equal(requests[0].opts.headers.Authorization,'Bearer '+token);
    assert.equal(requests[0].opts.redirect,'manual');
    assert.equal(requests[1].url,target);
    assert.equal(requests[1].opts.method,'GET');
    assert.equal(requests[1].opts.redirect,'manual');
    assert.equal(requests[1].opts.cache,'no-store');
    assert.equal(requests[1].opts.headers.Accept,'text/plain');
    assert.equal(Object.hasOwn(requests[1].opts.headers,'Authorization'),false);
    assert.equal(JSON.stringify(requests[1].opts).includes(token),false);
    assert.ok(requests[1].opts.signal instanceof AbortSignal);
  }
  // Reject target *before* starting a second-hop connection.
  for(const bad of invalidLocations){
    requests.length=0;
    globalThis.fetch=async(url,opts)=>{
      requests.push({url,opts});
      if(requests.length===1)return redirect(bad);
      throw Error('UNAUTHORIZED_EXTERNAL_REQUEST');
    };
    await assert.rejects(()=>githubGet(logApi,token,repo,run,true),HOLD);
    assert.equal(requests.length,1);
  }
  // 302 is forbidden for other GitHub API resources, even to a valid CDN.
  for(const apiEndpoint of [apiRun,apiRun+'/jobs?per_page=100']){
    requests.length=0;
    globalThis.fetch=async(url,opts)=>{
      requests.push({url,opts});return redirect(azure);
    };
    await assert.rejects(()=>githubGet(apiEndpoint,token,repo,run),
      /GITHUB_EVIDENCE_GET_FAILED_OR_REDIRECT_HOLD/);
    assert.equal(requests.length,1);
  }
  // A second redirect must never be auto-followed, nor should an expired
  // signed link cause fallback to forwarding GitHub Authorization.
  for(const response of [
    redirect('https://other.example/evil'),
    {status:301,ok:false,redirected:false,type:'basic'},
    {status:302,ok:false,redirected:true,type:'basic'},
    {status:200,ok:true,redirected:true,type:'basic',body:body([bytes('leak')])},
    {status:403,ok:false,redirected:false,type:'basic'},
    {status:200,ok:true,redirected:false,type:'opaqueredirect'}
  ]){
    requests.length=0;
    globalThis.fetch=async(url,opts)=>{
      requests.push({url,opts});
      return requests.length===1?redirect(azure):response;
    };
    await assert.rejects(()=>githubGet(logApi,token,repo,run,true),HOLD);
    assert.equal(requests.length,2);
    assert.equal(Object.hasOwn(requests[1].opts.headers,'Authorization'),false);
  }
  // A network exception can embed the signed capability URL in its
  // message/cause. Exposed failures must contain only a fixed HOLD.
  requests.length=0;
  globalThis.fetch=async(url,opts)=>{
    requests.push({url,opts});
    if(requests.length===1)return redirect(azure);
    throw new TypeError('socket failed at '+azure+' with sig=PRIVATE');
  };
  await assert.rejects(()=>githubGet(logApi,token,repo,run,true),
    error=>error.message===O56_LOG_REDIRECT_HOLD &&
      !error.message.includes('sig=')&&!error.message.includes(azure));
  assert.equal(requests.length,2);
  assert.equal(Object.hasOwn(requests[1].opts.headers,'Authorization'),false);

  for(const status of [301,303,307,308]){
    requests.length=0;
    globalThis.fetch=async(url,opts)=>{
      requests.push({url,opts});return redirect(azure,status);
    };
    await assert.rejects(()=>githubGet(logApi,token,repo,run,true),
      /GITHUB_EVIDENCE_GET_FAILED_OR_REDIRECT_HOLD/);
    assert.equal(requests.length,1);
  }
}finally{globalThis.fetch=realFetch;}

// Body cannot bypass the size bound by omitting Content-Length.
assert.equal(await readBoundedJobLog(textResponse('bounded log')),'bounded log');
const full=new Uint8Array(MAX_JOB_LOG_BYTES+1);
await assert.rejects(()=>readBoundedJobLog({
  body:body([full])
}),SIZE);
await assert.rejects(()=>readBoundedJobLog({body:body([bytes('fine')])},0),SIZE);
await assert.rejects(()=>readBoundedJobLog({body:body([new Uint8Array([0xff,0xfe])])}),SIZE);
await assert.rejects(()=>readBoundedJobLog({body:null}),SIZE);
await assert.rejects(()=>followOneSignedJobLogRedirect({
  status:302,type:'opaqueredirect',redirected:false,
  headers:{get:()=>azure}
}),HOLD);
// No arbitrary live access or optional "unsafeAllow" flag may appear in
// the actual downloader, and the source contains no Screeps API transport.
const source=fs.readFileSync(new URL('./o56-signed-job-log-download.mjs',
  import.meta.url),'utf8');
assert.ok(!/SCREEPS_TOKEN|userUploadCodeOnce|gamePlaceSpawn/.test(source));
assert.ok(source.includes("redirect:'manual'"));
assert.ok(source.includes('MAX_JOB_LOG_BYTES'));
console.log('O56 signed job log one-hop tokenless download, reject redirect chains and bounded stream: PASS');
