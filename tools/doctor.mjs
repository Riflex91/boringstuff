import { ScreepsHttpClient } from './screeps-client.mjs';

const SERVER = process.env.SCREEPS_SERVER || 'newbieland';
const EXPECTED_NODE_VERSION = '24.21.0';

console.log(`Node: ${process.version}`);
if (process.versions.node !== EXPECTED_NODE_VERSION) {
  console.error(`FAIL: Node ${EXPECTED_NODE_VERSION} is required for these local tools; actual=${process.versions.node}.`);
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
