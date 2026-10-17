import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { assertUniqueActiveCodeBranch, assertRestorablePreuploadCodeBackup }
  from './o39-code-upload-active-branch-policy.mjs';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';
import { summarizeRoom } from './spawn-planner-core.mjs';
import { normalizeRoomStatusResponse } from './spawn-safety.mjs';

const ROOM = /^[WE]\d+[NS]\d+$/;
const SHARD = /^shard(?:\d+|X)$/i;
export function assessWorldDeployment({account, world, branches, roomObjects, status, room, shard, branch='chatgpt', code}) {
  const issues = [];
  if (!ROOM.test(room || '') || !SHARD.test(shard || '')) issues.push('INVALID_WORLD_TARGET');
  const id = account?._id || account?.id || null;
  if (!id || account?.ok === false) issues.push('ACCOUNT_NOT_VERIFIED');
  if (!world || world?.ok === false || world?.status === 'empty') issues.push('NO_ACTIVE_WORLD_SPAWN');
  if (normalizeRoomStatusResponse(status) !== 'normal') issues.push('ROOM_NOT_NORMAL');
  const objects = roomObjects?.objects;
  if (!Array.isArray(objects)) issues.push('ROOM_OBJECTS_NOT_AVAILABLE');
  const summary = Array.isArray(objects) && ROOM.test(room || '') ?
    summarizeRoom({roomName:room,objects,users:roomObjects?.users||{},
      myUserId:id,valid:true,roomStatus:'normal'}) : null;
  if (!summary?.controller || !summary?.ownerId || String(summary.ownerId)!==String(id))
    issues.push('ROOM_NOT_OWNED_BY_ACCOUNT');
  const ownedSpawn = Array.isArray(objects) && objects.some(o=>
    (o?.type==='spawn' || o?.structureType==='spawn') && String(o?.user || '')===String(id));
  if (!ownedSpawn) issues.push('OWNED_SPAWN_NOT_FOUND');
  const list = Array.isArray(branches?.list) ? branches.list : [];
  const selected = list.find(b=>b?.branch===branch);
  const active = selected?.activeWorld === true || branches?.activeWorld === branch;
  if (!selected || !active) issues.push('WORLD_BRANCH_NOT_ACTIVE');
  if (!code || code?.ok === false || !code?.modules || typeof code.modules!=='object' || Array.isArray(code.modules))
    issues.push('WORLD_BACKUP_CODE_UNAVAILABLE');
  return {ok:issues.length===0, issues, target:{server:'world',shard,room,branch},
    verified:{account:!!id,roomStatus:normalizeRoomStatusResponse(status),
      controllerOwned:!!summary?.ownerId && String(summary.ownerId)===String(id),
      ownedSpawn:Boolean(ownedSpawn),branchActive:Boolean(active),codeReadable:Boolean(code?.modules)}};
}
async function execute() {
  const configFile=process.env.SCREEPS_CONFIG;
  if (!configFile || !process.env.RUNNER_TEMP || !path.resolve(configFile).startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep))
    throw new Error('World configuration must be inside RUNNER_TEMP');
  if (process.env.WORLD_DEPLOY_APPROVAL !== 'DEPLOY_WORLD')
    throw new Error('Explicit World deployment confirmation missing');
  if (process.env.SCREEPS_SERVER !== 'world' || process.env.SCREEPS_BRANCH !== 'chatgpt')
    throw new Error('Wrong World deployment profile');
  const shard=process.env.SCREEPS_SHARD, room=process.env.SCREEPS_ROOM;
  if (!SHARD.test(shard||'') || !ROOM.test(room||'')) throw new Error('Invalid World target parameters');
  if (fs.existsSync(configFile)) throw new Error('Ephemeral World config must not already exist');
  fs.writeFileSync(configFile,JSON.stringify(buildWorldConfig(process.env)),{mode:0o600,flag:'wx'});
  // The subsequent GitHub Action removes this file with if: always().
  const api=await ScreepsHttpClient.fromConfig('world',{file:configFile,shard});
  const [account,world,branches,roomObjects,status,code]=await Promise.all([
    api.authMe(),api.userWorldStatus(),api.userBranches(),api.gameRoomObjects(room,shard),
    api.gameRoomStatus(room,shard),api._request('GET','/api/user/code',{branch:'chatgpt'})
  ]);
  // A readable JSON object is not a rollback. Require the uniquely active
  // requested World branch and all 82 restorable source modules by name.
  const gameDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','game');
  const files=fs.readdirSync(gameDir).filter(file=>file.endsWith('.js'));
  const expected=Object.fromEntries(files.map(file=>[
    file.slice(0,-3),fs.readFileSync(path.join(gameDir,file),'utf8')
  ]));
  assertUniqueActiveCodeBranch(branches,'chatgpt');
  assertRestorablePreuploadCodeBackup(code,expected);
  const decision=assessWorldDeployment({account,world,branches,roomObjects,status,code,room,shard});
  console.log('WORLD_DEPLOY_GATE '+JSON.stringify(decision));
  if (!decision.ok) throw new Error('World deployment is blocked by read-only preflight');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  execute().catch(err=>{console.error('World deployment gate failed:',String(err?.message||err));process.exitCode=1;});
