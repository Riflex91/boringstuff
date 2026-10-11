import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {decodeWorldMemory,assessWorldStartup} from './world-postlaunch-monitor-core.mjs';

export async function inspectCurrentWorldStartup(api) {
  if(api?.defaultShard!=='shard0')
    throw new Error('WORLD_MONITOR_WRONG_SHARD');
  // All requests here are GET. In particular no deployment, spawn or
  // branch-activation requests belong in this observer.
  const [account,world,branches,roomStatus,roomObjects,botReply,statsReply]=
    await Promise.all([
      api.authMe(),api.userWorldStatus(),api.userBranches(),
      api.gameRoomStatus('W37N11','shard0'),
      api.gameRoomObjects('W37N11','shard0'),
      api.userMemory('bot','shard0'),
      api.userMemory('stats','shard0')
    ]);
  return assessWorldStartup({
    account,world,branches,roomStatus,roomObjects,
    bot:decodeWorldMemory(botReply),stats:decodeWorldMemory(statsReply)
  });
}

function writeReceipt(output,report) {
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(output,'W37N11-postlaunch-health.json'),
    JSON.stringify({...report,checkedAt:new Date().toISOString()},null,2)+'\n',
    {mode:0o600});
}

export async function observeWorldFor100Ticks(api,{
  maxChecks=80,delayMs=12000,sleep=ms=>new Promise(r=>setTimeout(r,ms)),
  onCheck=()=>{}
}={}) {
  if(!Number.isInteger(maxChecks)||maxChecks<1||maxChecks>100 ||
     !Number.isInteger(delayMs)||delayMs<0)
    throw new Error('WORLD_MONITOR_WAIT_BOUNDS_INVALID');
  let last=null;
  for(let n=0;n<maxChecks;n++) {
    try {last=await inspectCurrentWorldStartup(api);}
    catch {last={status:'WAIT',reason:'WORLD_GET_UNAVAILABLE',
      missing:['WORLD_GET_UNAVAILABLE'],mutationsAttempted:false};}
    onCheck(last,n);
    if(last.status==='PASS'||last.status==='FAIL')return last;
    if(n<maxChecks-1)await sleep(delayMs);
  }
  return {...last,status:'INCOMPLETE',
    reason:'WORLD_100_TICK_EVIDENCE_TIMEOUT',
    mutationsAttempted:false};
}

async function main(){
  if(!process.env.RUNNER_TEMP)
    throw new Error('RUNNER_TEMP required for ephemeral World monitoring');
  const output=process.env.WORLD_MONITOR_OUTPUT_DIR ||
    path.join(os.tmpdir(),'screeps-world-postlaunch');
  const secret=path.join(process.env.RUNNER_TEMP,
    'world-postlaunch-monitor-'+process.pid+'.json');
  fs.writeFileSync(secret,JSON.stringify(buildWorldConfig(process.env)),
    {mode:0o600,flag:'wx'});
  try {
    const api=await ScreepsHttpClient.fromConfig('world',{
      file:secret,shard:'shard0'});
    const result=await observeWorldFor100Ticks(api,{
      maxChecks:74,delayMs:11000,
      onCheck:(r,n)=>{
        if(n===0 || n%5===0 ||r.status!=='WAIT')
          console.log('WORLD_POSTLAUNCH_PROGRESS '+JSON.stringify({
            attempt:n+1,status:r.status,reason:r.reason,
            observedTicks:r.observedTicks??null,
            missing:r.missing||[],failures:r.failures||[]
          }));
      }
    });
    writeReceipt(output,result);
    console.log('WORLD_POSTLAUNCH_100T_RESULT '+JSON.stringify(result));
    if(result.status!=='PASS')process.exitCode=2;
  } finally {
    fs.rmSync(secret,{force:true});
  }
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
  main().catch(()=>{console.error('WORLD_POSTLAUNCH_MONITOR_GET_ONLY_FAILED');
    process.exitCode=1;});
