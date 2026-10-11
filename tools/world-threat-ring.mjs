import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WORLD_TARGET } from './world-target-selection.mjs';
import { validateTarget, inspectSelectedWorldTarget } from './world-target-preflight.mjs';
import { summarizeRoom } from './spawn-planner-core.mjs';
import { normalizeRoomStatusResponse } from './spawn-safety.mjs';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';

// Standalone, read-only 5x5 threat ring. No name checks, code upload,
// placement endpoints, branch activation or game mutations.
export function threatRingRooms(target = WORLD_TARGET) {
  validateTarget(target);
  const match = /^W(\d+)N(\d+)$/.exec(target.room);
  if (!match) throw new Error('Threat ring is pinned to W/N selected World site');
  const [w,n] = [Number(match[1]), Number(match[2])];
  const names = [];
  for (let dw=-2; dw<=2; dw++) for (let dn=-2; dn<=2; dn++) {
    if (dw===0 && dn===0) continue;
    if (w+dw<0 || n+dn<0) throw new Error('Threat ring crosses quadrant');
    names.push({room:`W${w+dw}N${n+dn}`,distance:Math.max(Math.abs(dw),Math.abs(dn))});
  }
  if (names.length!==24 || new Set(names.map(x=>x.room)).size!==24)
    throw new Error('Threat ring must have exactly 24 unique rooms');
  return names;
}

async function inspectRoom(api,site,userId,target) {
  try {
    const [rawStatus,rawObjects] = await Promise.all([
      api.gameRoomStatus(site.room,target.shard),
      api.gameRoomObjects(site.room,target.shard)
    ]);
    if (!rawObjects || !Array.isArray(rawObjects.objects) ||
        rawObjects?.ok===false || rawStatus?.ok===false)
      throw new Error('World room GET incomplete');
    const status=normalizeRoomStatusResponse(rawStatus);
    if (!status) throw new Error('World room status missing');
    const summary=summarizeRoom({
      roomName:site.room,objects:rawObjects.objects,
      users:rawObjects.users||{},myUserId:userId,
      valid:true,roomStatus:status
    });
    // Public room classification only. Never include player identifiers,
    // player names, user object dumps or raw response bodies in artifact.
    let control='NO_CONTROLLER';
    if (summary.controller) {
      control=summary.ownerId?'OWNED':
        summary.reservationId?'RESERVED':'NEUTRAL';
    }
    const foreignOwner=Boolean(summary.ownerId)&&
      String(summary.ownerId)!==String(userId);
    const foreignReservation=Boolean(summary.reservationId)&&
      String(summary.reservationId)!==String(userId);
    return {room:site.room,distance:site.distance,verified:true,
      roomStatus:status,control,
      foreignOwner,foreignReservation,
      controllerLevel:Number.isInteger(summary.controller?.level)
        ?summary.controller.level:null};
  } catch {
    return {room:site.room,distance:site.distance,verified:false,
      roomStatus:'UNVERIFIED',control:'UNVERIFIED',foreignOwner:null,
      foreignReservation:null,controllerLevel:null};
  }
}

export async function inspectThreatRing(api,userId,target=WORLD_TARGET) {
  validateTarget(target);
  if (api?.defaultShard!==target.shard || !userId)
    throw new Error('Exact shard-pinned, authenticated World client required');
  const entries=threatRingRooms(target);
  const observations=Array(entries.length);
  let next=0;
  // Bounded GET-only concurrency to reduce API throttling.
  await Promise.all(Array.from({length:4},async()=>{
    while (next<entries.length) {
      const idx=next++;
      observations[idx]=await inspectRoom(api,entries[idx],userId,target);
    }
  }));
  const verified=observations.filter(x=>x.verified);
  const owned=verified.filter(x=>x.foreignOwner);
  const reserved=verified.filter(x=>x.foreignReservation);
  const critical=owned.filter(x=>x.distance<=2&&x.controllerLevel>=8);
  const gaps=observations.filter(x=>!x.verified).map(x=>x.room);
  return {
    target:{shard:target.shard,room:target.room,x:target.x,y:target.y,
      spawnName:target.spawnName},
    scanScope:'CHEBYSHEV_RADIUS_TWO_5X5_EXCLUDING_TARGET',
    mode:'GET_ONLY',requestedRooms:entries.length,
    verifiedRooms:verified.length,unverifiedRooms:gaps,
    coverageComplete:gaps.length===0,
    foreignOwnedRooms:owned.length,
    foreignReservedRooms:reserved.length,
    nearbyRcl8ForeignOwned:critical.map(x=>x.room),
    risk:critical.length?'NEARBY_FOREIGN_RCL8':
      owned.length||reserved.length?'NEARBY_FOREIGN_CONTROL':
      gaps.length?'INCOMPLETE_THREAT_EVIDENCE':'NO_FOREIGN_CONTROL_IN_SAMPLED_RING',
    observations,
    operatorRiskAccepted:false,
    readyForPlacement:false,
    readyForDeployment:false,
    placementAttempted:false,
    branchActivationAttempted:false,
    deploymentAttempted:false
  };
}

export async function inspectWorldLaunchDossier(api,target=WORLD_TARGET) {
  validateTarget(target);
  // Reuse the audited current exact-code and fixed-site preflight.
  const site=await inspectSelectedWorldTarget(api,target);
  const identity=await api.authMe();
  const userId=identity?._id||identity?.id;
  if(!userId)throw new Error('World account could not be identified');
  const ring=await inspectThreatRing(api,userId,target);
  const exactInactiveCode=site.worldCodeReadiness?.exactInactiveCode===true;
  return {generatedAt:new Date().toISOString(),
    evidenceSource:'LIVE_SCREEPS_WORLD_API',
    mode:'GET_ONLY',
    target:ring.target,
    fixedTargetSitePassed:site.siteChecksPass===true,
    worldStatus:site.preflight.worldStatus,
    stagedCodeStatus:site.stagedCodeReadback.status,
    exactInactiveCode,
    branchActive:site.stagedCodeReadback.activeWorld,
    knownRivalRisk:site.risk,
    ring,
    // Full ring & exact-code validation do not authorize irreversible writes.
    evidenceComplete:site.siteChecksPass===true &&
      exactInactiveCode&&ring.coverageComplete,
    spawnNameUniquenessVerified:false,
    finalPlacementCheckPassed:false,
    operatorRiskAccepted:false,
    placementAuthorized:false,
    activationAuthorized:false,
    readyForPlacement:false,
    readyForDeployment:false,
    nextAction:!site.siteChecksPass?'INVESTIGATE_WORLD_SITE':
      !exactInactiveCode?'INVESTIGATE_WORLD_CODE':
      !ring.coverageComplete?'RECHECK_UNVERIFIED_RING_ROOMS':
      'REQUIRE_EXPLICIT_RIVAL_RISK_REVIEW_AND_PLACEMENT_APPROVAL',
    placementAttempted:false,activationAttempted:false,
    deploymentAttempted:false
  };
}

async function main(){
  const target=validateTarget(WORLD_TARGET);
  const temp=process.env.RUNNER_TEMP;
  if(!temp)throw new Error('RUNNER_TEMP required for ephemeral World authentication');
  const evidenceDir=process.env.WORLD_RISK_OUTPUT_DIR||
    path.join(os.tmpdir(),'world-W37N11-risk-evidence');
  fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});
  const credentials=path.join(temp,'world-threat-ring-'+process.pid+'.json');
  fs.writeFileSync(credentials,JSON.stringify(buildWorldConfig(process.env)),
    {mode:0o600,flag:'wx'});
  try {
    const api=await ScreepsHttpClient.fromConfig('world',{
      file:credentials,shard:target.shard
    });
    const report=await inspectWorldLaunchDossier(api,target);
    fs.writeFileSync(path.join(evidenceDir,'W37N11-risk-ring.json'),
      JSON.stringify(report,null,2)+'\n',{mode:0o600});
    console.log('WORLD_W37N11_GET_ONLY_RISK '+JSON.stringify(report));
    // Missing exact-code or target data is a blocking site gate.
    if(!report.fixedTargetSitePassed || !report.exactInactiveCode)
      process.exitCode=2;
  } finally {
    fs.rmSync(credentials,{force:true});
  }
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
  main().catch(err=>{
    console.error('World risk dossier GET-only failed:',
      err instanceof Error?'WORLD_RISK_COLLECTION_ERROR':'UNKNOWN_ERROR');
    process.exitCode=1;
  });
