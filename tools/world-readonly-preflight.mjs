import fs from 'node:fs';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';

// Deliberately GET-only: never invokes the spawn planner's --place mode.
export async function inspectWorld(api) {
  const [account, status, branches, shards] = await Promise.all([
    api.authMe(), api.userWorldStatus(), api.userBranches(),
    api._request('GET', '/api/game/shards/info')
  ]);
  if (account?.ok === false || status?.ok === false || branches?.ok === false || shards?.ok === false) {
    throw new Error('World read-only preflight returned an unsuccessful response');
  }
  return {
    authenticated: true,
    worldStatus: status?.status ?? null,
    shards: Array.isArray(shards?.shards) ? shards.shards.map(s => ({ name:s.name, rooms:s.rooms, users:s.users })) : [],
    branches: Array.isArray(branches?.list) ? branches.list.map(b => ({ branch:b.branch, activeWorld:b.activeWorld })) : [],
    hasNoSpawn: status?.status === 'empty'
  };
}

async function main() {
  const config = buildWorldConfig(process.env);
  const target = process.env.RUNNER_TEMP;
  if (!target) throw new Error('RUNNER_TEMP required for ephemeral configuration');
  const filename = target + '/screeps-world-readonly-' + process.pid + '.json';
  fs.writeFileSync(filename, JSON.stringify(config), { mode:0o600, flag:'wx' });
  try {
    const api = await ScreepsHttpClient.fromConfig('world', { file:filename });
    console.log('WORLD_READONLY_PREFLIGHT ' + JSON.stringify(await inspectWorld(api)));
  } finally { fs.rmSync(filename, { force:true }); }
}
if (process.argv[1]?.endsWith('/world-readonly-preflight.mjs')) main().catch(e => { console.error('World read-only preflight failed:',e.message); process.exitCode=1; });
