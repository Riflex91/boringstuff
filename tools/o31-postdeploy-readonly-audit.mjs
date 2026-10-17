// O31: audit retained post-deployment telemetry using independently
// authenticated Screeps GETs. This cannot produce canonical LIVE_100T_PASS:
// the independent same-run deployment receipt and continuous fatal/CPU
// coverage required by the release gate are not established by these GETs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {parseBotMemory,inspectDeployment} from './ci-deployment-guard.mjs';
import {assessReadOnlyPulse,expectedGameModuleHashes}
  from './o25-paired-100t-witness.mjs';

export const READONLY_TARGETS=Object.freeze({
  world:Object.freeze({room:'W37S79',shard:'shard0',branch:'chatgpt'}),
  newbieland:Object.freeze({room:'E8N1',shard:null,branch:'chatgpt'})
});

export function assessRetainedReleaseEvidence(memoryReply,pulse) {
  const bot=parseBotMemory(memoryReply);
  let inspection=null;
  if(bot && typeof bot.deploymentId==='string' && bot.deploymentId.length>0){
    try{inspection=inspectDeployment(bot,bot.deploymentId,100);}
    catch {/* untrusted/corrupt telemetry never authorizes a release */ }
  }
  const safeInt=n=>Number.isSafeInteger(n)&&n>=0&&n<=2_000_000_000?n:null;
  const safeNum=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
  const good=inspection?.status==='PASS';
  const receiptReason='INDEPENDENT_SAME_RUN_DEPLOYMENT_RECEIPT_UNAVAILABLE';
  return {
    result:pulse?.ok===true&&good?'RETAINED_POSTDEPLOY_100T_SAMPLED':'HOLD',
    pulseVerified:pulse?.ok===true,
    exactMainCodeVerified:pulse?.exactMainCodeVerified===true,
    retainedWindowStatus:['PASS','WAIT','FAIL'].includes(inspection?.status)?
      inspection.status:'UNVERIFIED',
    retainedWindowReason:typeof inspection?.reason==='string'?
      inspection.reason:null,
    deploymentTick:safeInt(inspection?.deploymentTick??inspection?.tick),
    observedJournalTicks:safeInt(inspection?.observedTicks),
    postDeploymentSnapshotTick:safeInt(inspection?.snapshotTick),
    checkedCpuSnapshots:safeInt(inspection?.checkedCpuSnapshots),
    minimumSnapshotBucket:safeNum(inspection?.minimumSnapshotBucket),
    maximumSnapshotCpu:safeNum(inspection?.maximumSnapshotCpu),
    blockers:[
      ...(!pulse?.ok?['CURRENT_EXACT_MAIN_LIVE_PULSE_UNVERIFIED']:[]),
      ...(!good?['RETAINED_100T_RELEASE_TELEMETRY_NOT_PASS']:[]),
      receiptReason,
      'CONTINUOUS_FATAL_CPU_COVERAGE_NOT_INDEPENDENTLY_VERIFIED'
    ],
    independentSameRunDeploymentReceiptVerified:false,
    fatalFreeContinuousCoverageVerified:false,
    canonicalLive100tPass:false,
    releaseAuthorized:false,
    apiMutationsAttempted:0
  };
}

export function assessReadOnlyReleaseProbe(raw,conf) {
  const pulse=assessReadOnlyPulse(raw,conf);
  const retained=assessRetainedReleaseEvidence(raw?.memory,pulse);
  return {
    server:conf.server,room:conf.room,
    currentServerTick:pulse.serverTick,
    activeCodeModuleFingerprint:pulse.codeFingerprint,
    currentHealth:pulse.snapshotHealth,
    ownedRoomCreeps:pulse.observedRoomCreeps,
    ...retained
  };
}

async function readSnapshot(api,conf) {
  const [me,branches,status,clock,objects,code,memory]=await Promise.all([
    api.authMe(),api.userBranches(),api.userWorldStatus(),
    api._request('GET','/api/game/time',
      conf.shard?{shard:conf.shard}:{}),
    api.gameRoomObjects(conf.room,conf.shard||undefined),
    api._request('GET','/api/user/code',{branch:conf.branch}),
    api.userMemory('bot',conf.shard||undefined)
  ]);
  return {me,branches,status,clock,objects,code,memory};
}

export async function runReadOnlyReleaseAudit(api,conf,{
  read=readSnapshot,expected=expectedGameModuleHashes()
}={}) {
  const raw=await read(api,conf);
  return assessReadOnlyReleaseProbe(raw,{...conf,expected});
}

async function main(){
  const server=process.argv[2];
  if(!Object.hasOwn(READONLY_TARGETS,server)||
     !process.env.RUNNER_TEMP)throw Error('EXPLICIT_READONLY_TARGET_AND_TEMP_REQUIRED');
  const conf={...READONLY_TARGETS[server],server};
  // The canonical retained-memory inspector selects its room when imported.
  // Reject misconfigured CLI invocations rather than auditing the wrong room.
  if(process.env.SCREEPS_SERVER!==server||
     process.env.SCREEPS_ROOM!==conf.room)
    throw Error('EXACT_CANONICAL_RELEASE_ROOM_REQUIRED');
  const file=path.join(process.env.RUNNER_TEMP,
    'o31-'+server+'-'+process.pid+'.json');
  if(server==='world')fs.writeFileSync(file,
    JSON.stringify(buildWorldConfig(process.env)),{flag:'wx',mode:0o600});
  try {
    const api=await ScreepsHttpClient.fromConfig(server,{
      file:server==='world'?file:process.env.SCREEPS_CONFIG,
      shard:conf.shard||undefined
    });
    const report=await runReadOnlyReleaseAudit(api,conf);
    // Never print source modules, account IDs, deployment IDs or raw Memory.
    console.log('O31_'+server.toUpperCase()+'_READONLY_RELEASE_AUDIT '+
      JSON.stringify(report));
    if(report.result==='HOLD')process.exitCode=2;
  }finally{
    if(server==='world')fs.rmSync(file,{force:true});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{console.error('O31_RELEASE_AUDIT_UNVERIFIED');
    process.exitCode=1;});
