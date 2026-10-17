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

// O32: bounded provenance diagnostics. A truncated journal explains why a
// one-time marker MAY be unavailable; it never proves a missing marker existed,
// recovers lost events, or grants a release. No IDs or source payloads escape.
export function assessJournalRetention(memoryReply) {
  const bot=parseBotMemory(memoryReply);
  const journal=bot?.telemetryJournal;
  const unknown={status:'JOURNAL_PROVENANCE_UNVERIFIED',
    deploymentMarkerRetained:false,oldestRetainedTick:null,
    newestRetainedTick:null,oldestRetainedEventTick:null,
    oldestRetainedSnapshotTick:null,journalDroppedThroughSeq:null,
    journalNextSeq:null,retainedEventCount:null,
    retainedSnapshotCount:null,olderThanDeploymentTick:null};
  if(!bot||!journal||!Array.isArray(journal.events)||
     !Array.isArray(journal.snapshots)||
     journal.events.length>1500||journal.snapshots.length>512)
    return unknown;
  const safeTick=n=>Number.isSafeInteger(n)&&n>=0&&n<=2_000_000_000;
  const safeSeq=n=>Number.isSafeInteger(n)&&n>=0&&n<=2_000_000_000;
  const events=journal.events,snapshots=journal.snapshots;
  // Mixed or future timestamps do not establish a valid retention window.
  if([...events,...snapshots].some(e=>!safeTick(e?.t)))
    return unknown;
  const ticks=[...events,...snapshots].map(e=>e.t);
  const oldest=ticks.length?Math.min(...ticks):null;
  const newest=ticks.length?Math.max(...ticks):null;
  const oldestEvents=events.length?Math.min(...events.map(e=>e.t)):null;
  const oldestSnapshots=snapshots.length?
    Math.min(...snapshots.map(e=>e.t)):null;
  const deploymentTick=bot.deploymentTick;
  const retained=typeof bot.deploymentId==='string'&&
    safeTick(deploymentTick)&&events.some(e=>
      e?.c==='DEPLOYMENT_MARKER'&&e.t===deploymentTick&&
      e.x?.deploymentId===bot.deploymentId);
  const dropped=safeSeq(journal.droppedThroughSeq)?
    journal.droppedThroughSeq:null;
  const next=safeSeq(journal.nextSeq)&&journal.nextSeq>=1?
    journal.nextSeq:null;
  const older=oldest!==null&&safeTick(deploymentTick)?
    oldest>deploymentTick:null;
  let status='MARKER_MISSING_RETENTION_UNEXPLAINED';
  if(retained)status='DEPLOYMENT_MARKER_RETAINED';
  else if(older===true)status='ALL_RETAINED_RECORDS_NEWER_THAN_DEPLOYMENT';
  else if(dropped!==null&&dropped>0)
    status='MARKER_MISSING_WITH_PRIOR_PRUNING';
  return {status,deploymentMarkerRetained:retained,
    oldestRetainedTick:oldest,newestRetainedTick:newest,
    oldestRetainedEventTick:oldestEvents,
    oldestRetainedSnapshotTick:oldestSnapshots,
    journalDroppedThroughSeq:dropped,journalNextSeq:next,
    retainedEventCount:events.length,
    retainedSnapshotCount:snapshots.length,
    olderThanDeploymentTick:older};
}

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
    journalRetention:assessJournalRetention(memoryReply),
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
