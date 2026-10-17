import assert from 'node:assert/strict';
import { ScreepsHttpClient } from './screeps-client.mjs';

// No network requests. The existing strategic planner uses these same client methods.
function probe(shard, serverName='world') {
  const api = new ScreepsHttpClient(serverName, { token: 'offline-test', baseUrl: 'https://screeps.com/' }, { shard });
  const calls = [];
  api._request = async (method, endpoint, params) => { calls.push({ method, endpoint, params }); return { ok: 1 }; };
  return { api, calls };
}
const scoped = probe('shard3');
await scoped.api.gameRooms();
await scoped.api.gameWorldSize();
await scoped.api.gameRoomObjects('E1S1');
await scoped.api.gameRoomStatus('E1S1');
await scoped.api.gameRoomTerrain('E1S1');
assert.equal(scoped.calls.length, 5);
assert.ok(scoped.calls.every(c => c.params.shard === 'shard3'));
assert.equal(scoped.calls.filter(c => c.method === 'POST').length, 0);
assert.equal(scoped.calls[4].params.encoded, 1);
for(const invoke of [
  () => scoped.api.gameCheckUniqueObjectName('spawn','Spawn1'),
  () => scoped.api.gamePlaceSpawn('E1S1',25,25,'Spawn1'),
  () => scoped.api.userSetActiveBranch('chatgpt')
]){
  assert.throws(invoke,/O46_WORLD_HTTP_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR/);
}
assert.equal(scoped.calls.length,5,'Even monkeypatched _request cannot bypass World method wrappers');
// The method-shard forwarding regression is preserved using a non-World
// *purely mocked* API object; it does not permit World mutations.
const simulated=probe('shard3','offline-routing-fixture');
await simulated.api.gameCheckUniqueObjectName('spawn','Spawn1');
await simulated.api.gamePlaceSpawn('E1S1',25,25,'Spawn1');
assert.equal(simulated.calls.length,2);
assert.ok(simulated.calls.every(c=>c.method==='POST'&&c.params.shard==='shard3'));

await scoped.api.userMemory('bot');
assert.equal(scoped.calls.at(-1).params.shard, 'shard3');
assert.equal(scoped.calls.at(-1).params.path, 'bot');

await scoped.api.gameRoomObjects('E1S2', 'shard2');
assert.equal(scoped.calls.at(-1).params.shard, 'shard2', 'explicit shard overrides scoped default');

const special = probe('shardX');
await special.api.gameRoomStatus('E2S3');
assert.equal(special.calls[0].params.shard,'shardX');

const unscoped = probe(null);
await unscoped.api.gameRoomObjects('E1S1');
assert.equal(unscoped.calls[0].params.shard, null, 'Newbieland routing remains unchanged');
console.log('World shard routing (offline only): PASS');
