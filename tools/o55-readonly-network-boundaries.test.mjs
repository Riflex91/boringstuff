import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {parse} from 'acorn';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {githubGet} from './world-first-spawn-live-gate.mjs';
import {
  assertGitHubEvidenceReadUrl,
  buildWorldScoutChildEnv,
  EVIDENCE_URL_HOLD,SCOUT_ENV_HOLD
} from './o55-readonly-network-boundaries.mjs';

const repo='Riflex91/boringstuff',run='39059103714';
const prefix='https://api.github.com/repos/'+repo;
const valid=[
  prefix+'/actions/runs/'+run,
  prefix+'/actions/runs/'+run+'/jobs?per_page=100',
  prefix+'/actions/jobs/117473212826/logs'
];
assert.deepEqual(valid.map(u=>assertGitHubEvidenceReadUrl(u,repo,run).kind),
  ['run','jobs','job-logs']);
const invalid=[
  'https://screeps.com/api/user/code',
  'https://api.github.com.attacker.invalid/repos/'+repo+'/actions/runs/'+run,
  'http://api.github.com/repos/'+repo+'/actions/runs/'+run,
  'https://attacker@api.github.com/repos/'+repo+'/actions/runs/'+run,
  'https://api.github.com:8443/repos/'+repo+'/actions/runs/'+run,
  prefix+'/actions/runs/39059103715',
  prefix+'/actions/runs/'+run+'?per_page=100',
  prefix+'/actions/runs/'+run+'#fragment',
  prefix+'/actions/runs/'+run+'/jobs?per_page=101',
  prefix+'/actions/runs/'+run+'/jobs?per_page=100&method=POST',
  prefix+'/actions/jobs/117473212826/logs?token=x',
  prefix+'/actions/jobs/117473212826/../logs',
  prefix+'/actions/jobs/117473212826%2flogs',
  prefix+'/actions/jobs/%2e%2e/logs',
  prefix+'/actions/jobs/1/logs',
  prefix+'/actions/jobs/1;POST/logs',
  'https://API.GITHUB.COM/repos/'+repo+'/actions/runs/'+run,
  prefix+'/issues/172',
  '//api.github.com/repos/'+repo+'/actions/runs/'+run,
  '',null,undefined
];
for(const url of invalid){
  assert.throws(()=>assertGitHubEvidenceReadUrl(url,repo,run),
    new RegExp(EVIDENCE_URL_HOLD),String(url));
}
for(const badContext of [
  ['wrong-owner/boringstuff',run],
  ['Riflex91/other',run],
  ['Riflex91/boringstuff?evil',run],
  [repo,'0123'],
  [repo,'39059103715']
]){
  assert.throws(()=>assertGitHubEvidenceReadUrl(valid[0],...badContext),
    new RegExp(EVIDENCE_URL_HOLD));
}

const requests=[];
const originalFetch=globalThis.fetch;
const token='SYNTHETIC_NON_SECRET_TEST_TOKEN';
try{
  globalThis.fetch=async(u,opts)=>{
    requests.push({u,opts});
    return {ok:true,status:200,redirected:false,type:'basic',
      json:async()=>({ok:1}),
      body:new ReadableStream({start(controller){
        controller.enqueue(new TextEncoder().encode('synthetic-log'));
        controller.close();
      }})};
  };
  for(const [i,url] of valid.entries()){
    const response=await githubGet(url,token,repo,run,i===2);
    assert.deepEqual(response,i===2?'synthetic-log':{ok:1});
  }
  assert.equal(requests.length,3);
  for(const {u,opts} of requests){
    assert.ok(valid.includes(u));
    assert.equal(opts.redirect,'manual','Never follow bearer-token redirects');
    assert.equal(opts.headers.Authorization,'Bearer '+token);
    assert.equal(opts.method,undefined,'GitHub evidence fetch must be GET');
  }
  for(const url of invalid){
    const before=requests.length;
    await assert.rejects(()=>githubGet(url,token,repo,run),
      new RegExp(EVIDENCE_URL_HOLD));
    assert.equal(requests.length,before,'Rejected URLs cannot reach fetch');
  }
  for(const reply of [
    {ok:false,redirected:false,type:'basic',status:302},
    {ok:true,redirected:true,type:'basic',status:200},
    {ok:false,redirected:false,type:'opaqueredirect',status:0},
    {ok:false,redirected:false,type:'basic',status:503}
  ]){
    globalThis.fetch=async(u,opts)=>{
      requests.push({u,opts});return {...reply};
    };
    await assert.rejects(()=>githubGet(valid[0],token,repo,run),
      /GITHUB_EVIDENCE_GET_FAILED_OR_REDIRECT_HOLD/);
    assert.equal(requests.at(-1).opts.redirect,'manual');
  }
}finally{
  globalThis.fetch=originalFetch;
}

const parent={
  PATH:'/usr/bin:/bin',NODE_OPTIONS:"--import=malicious.mjs",
  NODE_PATH:'/unexpected/modules',SCREEPS_TOKEN_WORLD:'FAKE',
  SCREEPS_TOKEN_NEWBIELAND:'FAKE',
  GITHUB_TOKEN:'FAKE',LD_PRELOAD:'/untrusted.so',
  DYLD_INSERT_LIBRARIES:'/untrusted.dylib',
  SCREEPS_CONFIG:'/malicious/config',SCREEPS_LOG_DIR:'/malicious/logs',
  WORLD_SCOUT_MAX_PER_SHARD:'96'
};
const child=buildWorldScoutChildEnv(parent,'/tmp/scoped-private-config.json',
  '/tmp/readonly-planner-logs');
assert.equal(Object.isFrozen(child),true);
assert.deepEqual(Object.keys(child).sort(),
  ['PATH','SCREEPS_CONFIG','SCREEPS_LOG_DIR']);
assert.equal(child.SCREEPS_CONFIG,'/tmp/scoped-private-config.json');
assert.equal(child.SCREEPS_LOG_DIR,'/tmp/readonly-planner-logs');
for(const key of ['NODE_OPTIONS','NODE_PATH','GITHUB_TOKEN',
  'SCREEPS_TOKEN_WORLD','SCREEPS_TOKEN_NEWBIELAND','LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES','WORLD_SCOUT_MAX_PER_SHARD'])
  assert.equal(Object.hasOwn(child,key),false,key+' must not be inherited');
const poison=new Proxy({PATH:'/usr/bin:/bin'},{
  get(obj,key){if(key!=='PATH')throw new Error('DANGEROUS_PARENT_ENV_ENUMERATED');
    return obj[key];},
  ownKeys(){throw new Error('UNSAFE_ENV_SPREAD');}
});
assert.deepEqual(Object.keys(buildWorldScoutChildEnv(poison,'/tmp/a','/tmp/b')),
  ['PATH','SCREEPS_CONFIG','SCREEPS_LOG_DIR']);
for(const [env,config,log] of [
  [{PATH:'/usr/bin'},'relative','/tmp/log'],
  [{PATH:'/usr/bin'},'/tmp/file','relative'],
  [{PATH:'/usr/bin',NODE_OPTIONS:'--import=evil'},'/tmp/file\0bad','/tmp/log'],
  [{PATH:'/usr/bin\0evil'},'/tmp/file','/tmp/log'],
  [{PATH:'a'.repeat(8200)},'/tmp/file','/tmp/log'],
  [{},'/tmp/file','/tmp/log']
]){
  assert.throws(()=>buildWorldScoutChildEnv(env,config,log),
    new RegExp(SCOUT_ENV_HOLD));
}

// Execute a child with this exact environment to verify no inherited Node
// auto-import options. This reads local process.env only, never contacts API.
const subprocess=spawnSync(process.execPath,
  ['-e','process.stdout.write(JSON.stringify(process.env))'],
  {env:child,encoding:'utf8',timeout:5000});
assert.equal(subprocess.status,0,subprocess.stderr);
assert.deepEqual(Object.keys(JSON.parse(subprocess.stdout)).sort(),
  ['PATH','SCREEPS_CONFIG','SCREEPS_LOG_DIR']);

// Independent structural proof of *call ordering* in the real source, not
// just a separately working validator helper.
function findCalls(ast,name){
  const matches=[];
  function walk(n){
    if(!n||typeof n!=='object')return;
    if(Array.isArray(n)){n.forEach(walk);return;}
    if(n.type==='CallExpression'&&n.callee?.type==='Identifier'&&
       n.callee.name===name)matches.push(n);
    for(const [k,v] of Object.entries(n)){
      if(k==='loc'||k==='start'||k==='end')continue;
      if(v&&typeof v==='object')walk(v);
    }
  }
  walk(ast);return matches;
}
const toolsPath=path.dirname(fileURLToPath(import.meta.url));
const githubSource=fs.readFileSync(path.join(toolsPath,
  'world-first-spawn-live-gate.mjs'),'utf8');
const scoutSource=fs.readFileSync(path.join(toolsPath,'world-scout.mjs'),'utf8');
const githubAst=parse(githubSource,{ecmaVersion:'latest',sourceType:'module'});
const scoutAst=parse(scoutSource,{ecmaVersion:'latest',sourceType:'module'});
const validated=findCalls(githubAst,'assertGitHubEvidenceReadUrl');
const fetches=findCalls(githubAst,'fetch');
assert.equal(validated.length,1);
assert.equal(fetches.length,1);
assert.ok(validated[0].start<fetches[0].start,
  'Authorization URL must be validated BEFORE token-bearing fetch');
assert.equal(githubSource.includes("redirect:'manual'"),true);
const builds=findCalls(scoutAst,'buildWorldScoutChildEnv');
const spawns=findCalls(scoutAst,'spawnSync');
assert.equal(builds.length,1);
assert.equal(spawns.length,1);
assert.ok(builds[0].start<spawns[0].start);
assert.equal(scoutSource.includes('...process.env,SCREEPS_CONFIG'),false);
console.log('O55 GitHub bearer evidence URL/redirect denial + clean World scout child env and static call order: PASS');
