// O25: independent pre-merge World/Newbieland game-time witness.
// Authenticated GETs only, no deployment and deliberately NOT LIVE_100T_PASS.
// The production release gate still requires canonical post-deployment runs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {parseBotMemory} from './ci-deployment-guard.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';

const CASES=Object.freeze({
 world:{room:'W37S79',shard:'shard0',branch:'chatgpt'},
 newbieland:{room:'E8N1',shard:null,branch:'chatgpt'}
});
const goodTick=v=>Number.isSafeInteger(v)&&v>=0&&v<=2_000_000_000;
const goodCount=v=>Number.isSafeInteger(v)&&v>=0&&v<=10000;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const gamePath=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','game');

export function expectedGameModuleHashes(root=gamePath) {
  const files=fs.readdirSync(root).filter(s=>s.endsWith('.js')).sort();
  if(files.length<70||files.length>110)throw Error('EXPECTED_GAME_MODULE_COUNT_UNVERIFIED');
  return Object.fromEntries(files.map(name=>[
    name.slice(0,-3),hash(fs.readFileSync(path.join(root,name),'utf8'))
  ]));
}
export function assessReadOnlyPulse(raw,{room,branch,expected}){
  const failures=[];
  const me=raw?.me;
  const id=me?._id||me?.id;
  if(typeof id!=='string'||!id||me?.ok===false)
    failures.push('IDENTITY_UNVERIFIED');
  const active=Array.isArray(raw?.branches?.list)?
    raw.branches.list.filter(x=>x?.activeWorld===true):[];
  if(active.length!==1||active[0]?.branch!==branch)
    failures.push('ACTIVE_BRANCH_UNVERIFIED');
  if(raw?.status?.status!=='normal'||raw.status.ok===false)
    failures.push('ACCOUNT_NOT_NORMAL');
  const current=raw?.clock?.time;
  if(!goodTick(current))failures.push('GAME_CLOCK_UNVERIFIED');
  const observed=raw?.objects?.objects;
  if(!Array.isArray(observed)||raw.objects?.ok===false)
    failures.push('ROOM_OBJECTS_UNVERIFIED');
  const objects=Array.isArray(observed)?observed:[];
  const owns=o=>Boolean(id)&&String(o?.user||'')===String(id);
  if(!objects.some(x=>(x?.type==='spawn'||x?.structureType==='spawn')&&owns(x)))
    failures.push('OWNED_SPAWN_MISSING');
  if(!objects.some(x=>x?.type==='creep'&&owns(x)))
    failures.push('OWNED_CREEPS_MISSING');
  const code=raw?.code;
  const modules=code?.modules;
  const expectedNames=Object.keys(expected||{}).sort();
  const actualNames=modules&&typeof modules==='object'&&!Array.isArray(modules)?
    Object.keys(modules).sort():[];
  const expectedSet=new Set(expectedNames),actualSet=new Set(actualNames);
  const missingExpectedNames=expectedNames.filter(name=>!actualSet.has(name));
  const unexpectedCount=actualNames.filter(name=>!expectedSet.has(name)).length;
  const mismatchingExpectedNames=expectedNames.filter(name=>
    actualSet.has(name)&&(typeof modules[name]!=='string'||
      hash(modules[name])!==expected[name]));
  const exact=code?.ok!==false && expectedNames.length>=70 &&
    missingExpectedNames.length===0&&unexpectedCount===0 &&
    mismatchingExpectedNames.length===0;
  if(!exact)failures.push('ACTIVE_CODE_NOT_EXACT_MAIN');
  // Author-only source-module names; never print returned code contents,
  // names of previously unknown modules or raw account/runtime API data.
  const codeFingerprint={
    expectedModuleCount:expectedNames.length,
    actualModuleCount:actualNames.length,
    missingExpectedCount:missingExpectedNames.length,
    unexpectedCount,
    mismatchingExpectedCount:mismatchingExpectedNames.length,
    differingKnownModules:mismatchingExpectedNames.slice(0,12)
  };
  const bot=parseBotMemory(raw?.memory);
  if(!bot||typeof bot.deploymentId!=='string'||!bot.deploymentId)
    failures.push('BOT_MEMORY_UNVERIFIED');
  const snapshots=Array.isArray(bot?.telemetryJournal?.snapshots)?
    bot.telemetryJournal.snapshots:[];
  const events=Array.isArray(bot?.telemetryJournal?.events)?
    bot.telemetryJournal.events:[];
  if(snapshots.length>1000||events.length>2500)
    failures.push('JOURNAL_UNBOUNDED');
  const validSnapshot=snapshots.filter(s=>s?.c==='STATUS_SNAPSHOT'&&
    goodTick(s?.t)&&s?.x?.rooms?.[room] &&
    goodCount(s?.x?.totalCreeps)&&s.x.totalCreeps>0 &&
    s?.x?.rooms?.[room]?.health?.status!== 'CRITICAL' &&
    typeof s?.x?.rooms?.[room]?.health?.status==='string' &&
    (!goodTick(current)||s.t<=current));
  const snapshot=validSnapshot.sort((a,b)=>b.t-a.t)[0];
  const beats=events.filter(e=>e?.c==='BOT_HEARTBEAT'&&
    goodTick(e.t)&&goodCount(e?.x?.creeps)&&e.x.creeps>0&&
    goodCount(e?.x?.bucket)&&e?.x?.rooms>=1&&
    (!goodTick(current)||e.t<=current));
  const heartbeat=beats.sort((a,b)=>b.t-a.t)[0];
  if(!snapshot||!goodTick(current)||current-snapshot.t>210)
    failures.push('CURRENT_HEALTH_SNAPSHOT_UNVERIFIED');
  if(!heartbeat||!goodTick(current)||current-heartbeat.t>90)
    failures.push('RECENT_IN_GAME_HEARTBEAT_UNVERIFIED');
  const fatal=events.some(e=>goodTick(e?.t)&&heartbeat&&
    e.t>=heartbeat.t-125 && ['MAIN_FATAL','CPU_BUCKET_CRITICAL'].includes(e?.c));
  if(fatal)failures.push('RECENT_RETAINED_FATAL_OR_CRITICAL_CPU');
  return {
    ok:failures.length===0,failures,
    serverTick:goodTick(current)?current:null,
    heartbeatTick:heartbeat?.t??null,
    snapshotTick:snapshot?.t??null,
    snapshotHealth:snapshot?.x?.rooms?.[room]?.health?.status??null,
    observedRoomCreeps:objects.filter(x=>x?.type==='creep'&&owns(x)).length,
    deploymentFingerprint:typeof bot?.deploymentId==='string'?
      hash(bot.deploymentId):null,
    exactMainCodeVerified:Boolean(exact),
    codeFingerprint,
    source:'SEPARATE_AUTHENTICATED_GET_RESPONSES',
    observedGameTickProofOnly:true,
    canonicalLive100tPass:false,
    apiMutationsAttempted:0
  };
}
export function compareReadOnlyPulses(start,end){
  const failures=[];
  if(start?.ok!==true||end?.ok!==true)
    failures.push('PULSE_NOT_VERIFIED');
  if(!goodTick(start?.serverTick)||!goodTick(end?.serverTick)||
     end.serverTick-start.serverTick<100)
    failures.push('SERVER_GAME_TIME_SPAN_BELOW_100');
  if(!goodTick(start?.heartbeatTick)||!goodTick(end?.heartbeatTick)||
     end.heartbeatTick-start.heartbeatTick<100)
    failures.push('RETAINED_HEARTBEAT_SPAN_BELOW_100');
  if(!goodTick(start?.snapshotTick)||!goodTick(end?.snapshotTick)||
     end.snapshotTick-start.snapshotTick<100)
    failures.push('RETAINED_STATUS_SNAPSHOT_SPAN_BELOW_100');
  if(!start?.deploymentFingerprint||
     start.deploymentFingerprint!==end?.deploymentFingerprint)
    failures.push('DEPLOYMENT_ID_CHANGED');
  if(start?.exactMainCodeVerified!==true||end?.exactMainCodeVerified!==true)
    failures.push('EXACT_MAIN_CODE_NOT_VERIFIED_AT_BOTH_ENDPOINTS');
  // A pair of snapshots is a time-span witness, NOT continuous fatal/CPU
  // coverage and NOT the independently required deployment LIVE_100T_PASS.
  return {
    result:failures.length===0?'GET_ONLY_100T_WITNESS':'HOLD',
    failures,
    serverGameTickSpan:goodTick(start?.serverTick)&&goodTick(end?.serverTick)?
      end.serverTick-start.serverTick:null,
    heartbeatGameTickSpan:goodTick(start?.heartbeatTick)&&
      goodTick(end?.heartbeatTick)?end.heartbeatTick-start.heartbeatTick:null,
    snapshotGameTickSpan:goodTick(start?.snapshotTick)&&
      goodTick(end?.snapshotTick)?end.snapshotTick-start.snapshotTick:null,
    exactSameDeploymentVerified:failures.length===0,
    canonicalLive100tPass:false,
    fatalFreeContinuousCoverageVerified:false,
    apiMutationsAttempted:0
  };
}
async function readPulse(api,conf,expected){
  const [me,branches,status,clock,objects,code,memory]=await Promise.all([
    api.authMe(),api.userBranches(),api.userWorldStatus(),
    api._request('GET','/api/game/time',
      conf.shard?{shard:conf.shard}:{}),
    api.gameRoomObjects(conf.room,conf.shard||undefined),
    api._request('GET','/api/user/code',{branch:conf.branch}),
    api.userMemory('bot',conf.shard||undefined)
  ]);
  return assessReadOnlyPulse({me,branches,status,clock,objects,code,memory},
    {...conf,expected});
}
export async function runReadOnlyWitness(api,conf,{
  read=readPulse,sleep=ms=>delay(ms),maxPolls=85,pollMs=12000,
  expected=expectedGameModuleHashes()
}={}){
  const start=await read(api,conf,expected);
  if(!start.ok)return {start,result:'HOLD',reason:'START_PULSE_UNVERIFIED',
    canonicalLive100tPass:false,apiMutationsAttempted:0};
  let end=null;
  for(let attempt=0;attempt<maxPolls;attempt++){
    await sleep(pollMs);
    end=await read(api,conf,expected);
    if(!end.ok)return {start,end,result:'HOLD',
      reason:'END_PULSE_UNVERIFIED',
      canonicalLive100tPass:false,apiMutationsAttempted:0};
    if(end.serverTick-start.serverTick>=125&&
       end.heartbeatTick-start.heartbeatTick>=100&&
       end.snapshotTick-start.snapshotTick>=100)
      break;
  }
  const comparison=compareReadOnlyPulses(start,end);
  return {start,end,...comparison,pollLimit:maxPolls,
    canonicalLive100tPass:false,apiMutationsAttempted:0};
}
async function main(){
  const kind=process.argv[2];
  if(!Object.hasOwn(CASES,kind)||!process.env.RUNNER_TEMP)
    throw Error('EXPLICIT_SERVER_AND_TEMP_REQUIRED');
  const file=path.join(process.env.RUNNER_TEMP,
    'o25-'+kind+'-'+process.pid+'.json');
  if(kind==='world')fs.writeFileSync(file,
    JSON.stringify(buildWorldConfig(process.env)),
    {flag:'wx',mode:0o600});
  try{
    const api=await ScreepsHttpClient.fromConfig(kind,{
      file:kind==='world'?file:process.env.SCREEPS_CONFIG,
      shard:CASES[kind].shard||undefined
    });
    const report=await runReadOnlyWitness(api,CASES[kind]);
    // No raw Memory, account IDs, player names or creep names logged.
    console.log('O25_'+kind.toUpperCase()+'_100T_GET_ONLY '+
      JSON.stringify(report));
    if(report.result!=='GET_ONLY_100T_WITNESS')process.exitCode=2;
  }finally{if(kind==='world')fs.rmSync(file,{force:true})}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{console.error('O25_100T_GET_ONLY_UNVERIFIED');
    process.exitCode=1;});
