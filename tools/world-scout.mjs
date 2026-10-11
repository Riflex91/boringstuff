import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';
import { inspectWorld } from './world-readonly-preflight.mjs';
import { summarizeRoom } from './spawn-planner-core.mjs';
import { inspectSpawnTile, normalizeRoomStatusResponse } from './spawn-safety.mjs';
import { extractWorldRooms, sampleWorldRooms, fallbackProbeRooms, selectStrategicWinner, summarizeWorldRemoteRouting, verifyShardName } from './world-scout-core.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const output = process.env.WORLD_SCOUT_OUTPUT_DIR || path.join(os.tmpdir(), 'screeps-world-scout-results');
const temp = process.env.RUNNER_TEMP;
const maxPerShard = Number(process.env.WORLD_SCOUT_MAX_PER_SHARD || '24');
if (![24, 48, 96].includes(maxPerShard))
  throw new Error('WORLD_SCOUT_MAX_PER_SHARD must be 24, 48 or 96');
// Bounded sampling only; never claim full-map optimality.
function write(name, value) {
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
}
async function verifyReadOnlyTarget(api, candidate, userId) {
  const shard = candidate.shard;
  const { room, x, y } = candidate.report.selected;
  const [statusRaw, objectsRaw, terrainRaw] = await Promise.all([
    api.gameRoomStatus(room, shard),
    api.gameRoomObjects(room, shard),
    api.gameRoomTerrain(room, shard)
  ]);
  const status = normalizeRoomStatusResponse(statusRaw);
  const objects = objectsRaw?.objects;
  const terrain = terrainRaw?.terrain?.[0]?.terrain;
  if (!Array.isArray(objects)) throw new Error('Room objects not returned');
  const summary = summarizeRoom({
    roomName: room, objects, users: objectsRaw?.users || {}, myUserId: userId,
    valid: true, roomStatus: status
  });
  const tile = inspectSpawnTile({encodedTerrain: terrain, objects, x, y});
  const ok = status === 'normal' && Boolean(summary.controller) &&
    !summary.ownerId && !summary.reservationId &&
    summary.sourceCount > 0 && tile.ok;
  return {ok, shard, room, x, y, roomStatus: status,
    controller: Boolean(summary.controller), owned: Boolean(summary.ownerId),
    reserved: Boolean(summary.reservationId), sources: summary.sourceCount,
    tileIssues: tile.issues, inspectedAt: new Date().toISOString()};
}
async function main() {
  if (!temp) throw new Error('RUNNER_TEMP required for temporary credentials');
  fs.mkdirSync(output, {recursive:true});
  const configFile = path.join(temp, 'world-scout-' + process.pid + '.json');
  fs.writeFileSync(configFile, JSON.stringify(buildWorldConfig(process.env)), {mode:0o600,flag:'wx'});
  try {
    const api = await ScreepsHttpClient.fromConfig('world', {file:configFile});
    const preflight = await inspectWorld(api);
    const evidence = {generatedAt:new Date().toISOString(), mode:'READ_ONLY',
      preflight, scopes:[], provisional:true, spawnPlacementAttempted:false,
      deployAttempted:false, readyForPlacement:false,
      warning:'Best-scored room is among sampled rooms, not proven globally optimal.'};
    if (!preflight.hasNoSpawn) {
      write('world-scout-summary.json', {...evidence,error:'Account not in empty status'});
      throw new Error('Account not in empty initial-spawn status');
    }
    const shards = preflight.shards.map(s => verifyShardName(s.name));
    if (!shards.length || shards.length > 16 || new Set(shards).size !== shards.length)
      throw new Error('Missing, excessive or duplicate shards');
    const reports = [];
    for (const shard of shards) {
      const scope = {shard, discovered:0, sampled:0, plannerCompleted:false, reason:null};
      evidence.scopes.push(scope);
      if (shard === 'shardX') {
        scope.reason = 'Restricted shard requires separate verified access entitlement';
        continue;
      }
      try {
        let exactRooms = [];
        try {
          exactRooms = extractWorldRooms(await api.gameRooms(shard));
        } catch (err) {
          // Expected for the official World API. Never suppress authentication
          // failures, throttling, or server failures as a missing endpoint.
          if (err?.statusCode !== 404) throw err;
          scope.roomListEndpoint = 'unavailable-404';
        }
        let selected;
        if (exactRooms.length) {
          scope.discoveryMode = 'exact-room-list';
          scope.discovered = exactRooms.length;
          selected = sampleWorldRooms(exactRooms,maxPerShard);
        } else {
          let size = null;
          try {
            size = await api.gameWorldSize(shard);
          } catch (err) {
            if (err?.statusCode !== 404) throw err;
            scope.worldSizeEndpoint = 'unavailable-404';
          }
          selected = fallbackProbeRooms(size,maxPerShard);
          scope.discoveryMode = 'spatial-grid-probe';
          scope.discovered = null; // Do not misrepresent sampled probes as a complete room list.
          scope.worldSizeKnown = Boolean(size && Number.isInteger(Number(size?.width ?? size?.size ?? size?.worldSize)));
        }
        scope.sampled = selected.length;
        if (!selected.length) { scope.reason = 'No bounded room probes available'; continue; }
        const logDir = path.join(output,shard);
        fs.mkdirSync(logDir,{recursive:true});
        const fd = fs.openSync(path.join(logDir,'planner.log'),'w',0o600);
        const env = {...process.env,SCREEPS_CONFIG:configFile,SCREEPS_LOG_DIR:logDir};
        delete env.SCREEPS_TOKEN_WORLD;
        delete env.SCREEPS_TOKEN_NEWBIELAND;
        let run;
        try {
          run = spawnSync(process.execPath,['initial-spawn-planner.mjs','--server','world',
            '--shard',shard,'--deep-top','5','--top-rooms','5','--strategic-radius','2',
            '--cache-hours','0','--refresh','--concurrency','4',...selected],{
              cwd:dir,env,stdio:['ignore',fd,fd],timeout:7*60*1000
            });
        } finally {fs.closeSync(fd);}
        scope.plannerExit = run.status;
        scope.plannerSignal = run.signal || null;
        if (run.status !== 0) {
          scope.reason = 'Planner failed; see evidence artifact';
          continue;
        }
        const names = fs.readdirSync(logDir).filter(n=>/^initial-spawn-plan-.*\.json$/.test(n));
        if (names.length !== 1) {scope.reason='Planner report missing or ambiguous';continue;}
        const report = JSON.parse(fs.readFileSync(path.join(logDir,names[0]),'utf8'));
        scope.plannerCompleted = true;
        scope.bestScored = report.selected ? {room:report.selected.room,
          score:report.selected.strategicScore,x:report.selected.x,y:report.selected.y,
          remoteRouting:summarizeWorldRemoteRouting(report.selected)} : null;
        reports.push({shard,report});
      } catch(err) {
        scope.reason = 'Read-only inspection failed: '+String(err?.message || err).slice(0,120);
      }
    }
    const winner = selectStrategicWinner(reports);
    if (winner) {
      evidence.provisionalWinner = {shard:winner.shard,room:winner.report.selected.room,
        x:winner.report.selected.x,y:winner.report.selected.y,
        strategicScore:winner.report.selected.strategicScore,scoreModel:winner.report.scoreModel,
        remoteRouting:summarizeWorldRemoteRouting(winner.report.selected)};
      try {
        const me = await api.me();
        evidence.freshTileVerification = await verifyReadOnlyTarget(api,winner,me?._id||me?.id||null);
      } catch(err) {
        evidence.freshTileVerification = {ok:false,error:String(err?.message||err)};
      }
    }
    evidence.completeCoverage = evidence.scopes.every(s=>
      s.plannerCompleted && s.discovered === s.sampled);
    write('world-scout-summary.json',evidence);
    console.log('WORLD_SCOUT_READONLY '+JSON.stringify({
      status:winner?'provisional-candidate':'no-verified-candidate',
      shards:evidence.scopes.map(s=>({shard:s.shard,discovered:s.discovered,
        sampled:s.sampled,discoveryMode:s.discoveryMode || null,
        plannerCompleted:s.plannerCompleted,bestScored:s.bestScored || null,reason:s.reason})),
      selected:evidence.provisionalWinner||null,
      freshTilePass:evidence.freshTileVerification?.ok===true,
      completeCoverage:evidence.completeCoverage,readyForPlacement:false
    }));
    if (!winner || evidence.freshTileVerification?.ok !== true) process.exitCode=2;
  } finally {
    fs.rmSync(configFile,{force:true});
  }
}
main().catch(err=>{
  console.error('World read-only scouting failed:',String(err?.message||err));
  process.exitCode=1;
});
