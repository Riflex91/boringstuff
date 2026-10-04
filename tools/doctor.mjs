import { ScreepsHttpClient } from './screeps-client-node18.mjs';

const SERVER = process.env.SCREEPS_SERVER || 'newbieland';
const [major, minor] = process.versions.node.split('.').map(Number);

console.log(`Node: ${process.version}`);
if (major < 18 || (major === 18 && minor < 20)) {
  console.error('FAIL: Node 18.20.0 or newer is required for these local tools.');
  process.exit(2);
}
console.log('Node compatibility: OK');

try {
  const api = await ScreepsHttpClient.fromConfig(SERVER);
  const me = await api.authMe();
  const world = await api.userWorldStatus();
  console.log(`Server config: ${SERVER}`);
  console.log(`Authentication: OK (${me?.username || me?.email || me?._id || me?.id || 'user'})`);
  console.log(`World status: ${world?.status ?? 'unknown'}`);
  console.log('HTTP API: OK');
  console.log('Doctor check passed.');
} catch (err) {
  console.error(`FAIL: ${err?.stack || err}`);
  process.exit(1);
}
