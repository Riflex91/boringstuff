import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';
import { inspectWorld } from './world-readonly-preflight.mjs';
import { inspectSpawnTile, normalizeRoomStatusResponse } from './spawn-safety.mjs';
import { summarizeRoom } from './spawn-planner-core.mjs';
import { WORLD_TARGET } from './world-target-selection.mjs';
import { assessWorldCodeBootstrap } from './world-branch-bootstrap.mjs';

// Read-only World target check. No POST, spawn placement, code-upload,
// branch activation, manual gate token or game action anywhere in this module.
const VALID_SHARDS = new Set(['shard0', 'shard1', 'shard2', 'shard3']);
const VALID_ROOM = /^[WE][0-9]+[NS][0-9]+$/;

export function validateTarget(t) {
  if (!t || t.server !== 'world' || !VALID_SHARDS.has(t.shard) ||
      !VALID_ROOM.test(t.room) || !Number.isInteger(t.x) ||
      !Number.isInteger(t.y) || t.x < 2 || t.x > 47 ||
      t.y < 2 || t.y > 47 ||
      typeof t.spawnName !== 'string' ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(t.spawnName) ||
      t.branch !== 'chatgpt' ||
      !Array.isArray(t.knownRivalRooms) ||
      t.knownRivalRooms.length < 1 || t.knownRivalRooms.length > 8 ||
      new Set(t.knownRivalRooms).size !== t.knownRivalRooms.length ||
      t.knownRivalRooms.some(r => !VALID_ROOM.test(r) || r === t.room) ||
      t.placementApproved !== false || t.deploymentApproved !== false)
    throw new Error('World target must be a fixed read-only, unapproved normal-shard site');
  return t;
}

function parseRoom(rawStatus, rawObjects, terrainRaw, room, x, y, userId) {
  // Never interpret HTTP response omissions as an empty room.
  if (!rawObjects || !Array.isArray(rawObjects.objects) ||
      typeof terrainRaw?.terrain?.[0]?.terrain !== 'string')
    return { verified:false, reason:'ROOM_OBJECTS_OR_TERRAIN_UNAVAILABLE' };
  const status = normalizeRoomStatusResponse(rawStatus);
  const summary = summarizeRoom({
    roomName:room, objects:rawObjects.objects,
    users:rawObjects.users || {}, myUserId:userId,
    valid:true, roomStatus:status
  });
  const tile = inspectSpawnTile({
    encodedTerrain:terrainRaw.terrain[0].terrain,
    objects:rawObjects.objects,x,y
  });
  return {
    verified:true,status,
    controllerPresent:Boolean(summary.controller),
    ownerPresent:Boolean(summary.ownerId),
    reservationPresent:Boolean(summary.reservationId),
    sourceCount:summary.sourceCount,
    tile:{ok:tile.ok,terrain:tile.terrain,issues:tile.issues,
      occupiedTypes:tile.blockingObjects?.map(o=>o.type)||[]}
  };
}

function rivalObservation(rawStatus, rawObjects, room, userId) {
  if (!rawObjects || !Array.isArray(rawObjects.objects))
    return {room,verified:false,kind:'UNVERIFIED'};
  const status=normalizeRoomStatusResponse(rawStatus);
  const s=summarizeRoom({
    roomName:room,objects:rawObjects.objects,
    users:rawObjects.users||{},myUserId:userId,
    valid:true,roomStatus:status
  });
  if (!s.controller || status !== 'normal')
    return {room,verified:false,kind:'UNVERIFIED'};
  const kind = s.ownerId ? 'OWNED' : s.reservationId ? 'RESERVED' : 'NEUTRAL';
  return {room,verified:true,kind,
    ownerPresent:Boolean(s.ownerId),
    reservationPresent:Boolean(s.reservationId),
    controllerLevel:Number.isInteger(s.controller?.level)?s.controller.level:null};
}

export function decideWorldTarget({preflight, room, nearby},target=WORLD_TARGET) {
  validateTarget(target);
  const failures=[];
  if (!preflight?.authenticated || preflight.worldStatus !== 'empty' ||
      preflight.hasNoSpawn !== true)
    failures.push('ACCOUNT_NOT_IN_EMPTY_INITIAL_SPAWN_STATE');
  if (!Array.isArray(preflight?.shards) ||
      !preflight.shards.some(s=>s?.name===target.shard))
    failures.push('SELECTED_SHARD_UNAVAILABLE');
  if (!room?.verified) failures.push('TARGET_ROOM_DATA_UNVERIFIED');
  else {
    if (room.status !== 'normal') failures.push('TARGET_ROOM_STATUS_NOT_NORMAL');
    if (!room.controllerPresent) failures.push('TARGET_CONTROLLER_MISSING');
    if (room.ownerPresent) failures.push('TARGET_ALREADY_OWNED');
    if (room.reservationPresent) failures.push('TARGET_RESERVED');
    if (room.sourceCount !== 2) failures.push('TARGET_SOURCE_GEOMETRY_CHANGED');
    if (!room.tile?.ok) failures.push('EXACT_SPAWN_TILE_BLOCKED');
  }
  const branchPresent = Array.isArray(preflight?.branches) &&
    preflight.branches.some(x => x?.branch === target.branch);
  const rivals = Array.isArray(nearby) ? nearby : [];
  const rivalsComplete = rivals.length === target.knownRivalRooms.length &&
    target.knownRivalRooms.every(name=>rivals.some(r=>r.room===name && r.verified));
  const hostileRivals = rivals.filter(r=>r.kind==='OWNED'||r.kind==='RESERVED');
  const risk = !rivalsComplete ? 'UNVERIFIED' :
    hostileRivals.length ? 'RIVAL_PRESENCE_REQUIRES_REVIEW' : 'NO_RIVAL_IN_CHECKED_ROOMS';
  // The user chose a target, but this doesn't grant blanket permission to
  // assume rival threat or global map coverage is clear.
  const siteChecksPass = failures.length === 0;
  return {
    target:{shard:target.shard,room:target.room,x:target.x,y:target.y,
      spawnName:target.spawnName,branch:target.branch},
    mode:'GET_ONLY',siteChecksPass,failures,
    risk,knownRivals: rivals,
    worldBranchPresent: branchPresent,
    stagingRequired:!branchPresent,
    scoutingCoverage:'SAMPLED_NOT_COMPLETE',
    // Risk acceptance, spawn-name availability, current World code, exact
    // final placement validation and operator release are still separate.
    readyForPlacement:false,
    readyForDeployment:false,
    placementAttempted:false,
    deploymentAttempted:false,
    nextAction:!siteChecksPass?'INVESTIGATE_BLOCKING_SITE_GATE':
      !branchPresent?'STAGE_ISOLATED_INACTIVE_WORLD_CODE':
      risk!=='NO_RIVAL_IN_CHECKED_ROOMS'?'MANUAL_RIVAL_RISK_REVIEW':
      'AWAIT_FINAL_EXPLICIT_PLACEMENT_APPROVAL'
  };
}

export async function inspectSelectedWorldTarget(api,target=WORLD_TARGET) {
  validateTarget(target);
  if (!api || api.defaultShard !== target.shard)
    throw new Error('World API must be pinned to the exact selected shard');
  const preflight=await inspectWorld(api);
  const identity=await api.authMe();
  const userId=identity?._id||identity?.id||null;
  if (!userId) throw new Error('World authenticated user id missing');
  const getRoom=async room=>{
    const [status,objects,terrain]=await Promise.all([
      api.gameRoomStatus(room,target.shard),
      api.gameRoomObjects(room,target.shard),
      api.gameRoomTerrain(room,target.shard)
    ]);
    return {status,objects,terrain};
  };
  let room;
  try {
    const live=await getRoom(target.room);
    room=parseRoom(live.status,live.objects,live.terrain,target.room,
      target.x,target.y,userId);
  } catch(err) {
    room={verified:false,reason:'TARGET_GET_FAILED'};
  }
  const nearby=[];
  for(const name of target.knownRivalRooms) {
    try {
      const [status,objects]=await Promise.all([
        api.gameRoomStatus(name,target.shard),
        api.gameRoomObjects(name,target.shard)
      ]);
      nearby.push(rivalObservation(status,objects,name,userId));
    } catch(err) {
      nearby.push({room:name,verified:false,kind:'UNVERIFIED'});
    }
  }
  // GET-only proof of the exact inactive-branch staging prerequisites.
  // The POST staging operation remains exclusively in the manually
  // authorized STAGE_WORLD_CODE workflow.
  let inactiveStageGate;
  try {
    const [worldStatus,branches,defaultCode]=await Promise.all([
      api.userWorldStatus(),
      api.userBranches(),
      api._request('GET','/api/user/code',{branch:'default'})
    ]);
    inactiveStageGate=assessWorldCodeBootstrap({
      account:identity,status:worldStatus,
      branches,backup:defaultCode
    });
  } catch (_) {
    inactiveStageGate={ok:false,
      failures:['WORLD_DEFAULT_CODE_BACKUP_OR_GATE_UNVERIFIED'],
      targetBranch:'chatgpt'};
  }
  const decision=decideWorldTarget({preflight,room,nearby},target);
  const stagePreconditionsPass=inactiveStageGate.ok &&
    decision.siteChecksPass && decision.risk!=='UNVERIFIED';
  const stageGateFailures=[
    ...(Array.isArray(inactiveStageGate.failures)?inactiveStageGate.failures:
      ['WORLD_DEFAULT_CODE_BACKUP_OR_GATE_UNVERIFIED']),
    ...(!decision.siteChecksPass?['TARGET_SITE_GATE_NOT_PASSED']:[]),
    ...(decision.risk==='UNVERIFIED'?['KNOWN_RIVAL_ROOMS_UNVERIFIED']:[])
  ];

  return {
    generatedAt:new Date().toISOString(),
    evidenceSource:'LIVE_SCREEPS_WORLD_API',
    selectedByOperator:true,
    preflight:{
      authenticated:preflight.authenticated,
      worldStatus:preflight.worldStatus,
      targetShardPresent:preflight.shards.some(s=>s.name===target.shard),
      branchPresent:decision.worldBranchPresent
    },
    room, ...decision,
    inactiveStageGate:{
      preconditionsPass:stagePreconditionsPass,
      failures:stageGateFailures,
      targetBranch:'chatgpt',
      manualApprovalRequired:true,
      stagingAuthorized:false,
      stagingAttempted:false,
      defaultCodeContentsIncluded:false
    },
    nextAction:decision.stagingRequired && !stagePreconditionsPass
      ? 'INVESTIGATE_INACTIVE_STAGE_GATE' : decision.nextAction
  };
}

async function main() {
  const target=validateTarget(WORLD_TARGET);
  if (!process.env.RUNNER_TEMP)
    throw new Error('RUNNER_TEMP required to keep World credentials ephemeral');
  const output=process.env.WORLD_TARGET_OUTPUT_DIR ||
    path.join(os.tmpdir(),'screeps-world-target-evidence');
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  const credentials=path.join(process.env.RUNNER_TEMP,
    'screeps-world-target-'+process.pid+'.json');
  fs.writeFileSync(credentials,JSON.stringify(buildWorldConfig(process.env)),
    {mode:0o600,flag:'wx'});
  try {
    const api=await ScreepsHttpClient.fromConfig('world',{
      file:credentials,shard:target.shard
    });
    const evidence=await inspectSelectedWorldTarget(api,target);
    fs.writeFileSync(path.join(output,'W37N11-preflight.json'),
      JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
    console.log('WORLD_TARGET_GET_ONLY '+JSON.stringify(evidence));
    if (!evidence.siteChecksPass) {
      console.error('World target failed one or more fresh site gates');
      process.exitCode=2;
    }
  } finally {
    fs.rmSync(credentials,{force:true});
  }
}

if (process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(err=>{
    console.error('World target preflight failed:',err.message);
    process.exitCode=1;
  });
