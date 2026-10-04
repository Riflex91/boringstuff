import assert from 'node:assert/strict';
import { normalizeRoomStatusResponse, inspectSpawnTile, verifyInitialSpawnTarget } from './spawn-safety.mjs';

assert.equal(normalizeRoomStatusResponse({ room: { status: 'normal' } }), 'normal');
assert.equal(normalizeRoomStatusResponse({ status: 'closed' }), 'closed');
assert.equal(normalizeRoomStatusResponse({ data: { room: { status: 'normal' } } }), 'normal');

const plain = '0'.repeat(2500);
const tile = inspectSpawnTile({ encodedTerrain: plain, objects: [], x: 20, y: 29 });
assert.equal(tile.ok, true);
assert.equal(tile.terrain, 'plain');

const wallChars = plain.split('');
wallChars[29 * 50 + 20] = '1';
const wallTile = inspectSpawnTile({ encodedTerrain: wallChars.join(''), objects: [], x: 20, y: 29 });
assert.equal(wallTile.ok, false);
assert.ok(wallTile.issues.includes('wall-tile'));

const ruinTile = inspectSpawnTile({
  encodedTerrain: plain,
  objects: [{ type: 'ruin', _id: 'old-spawn-ruin', x: 20, y: 29 }],
  x: 20,
  y: 29
});
assert.equal(ruinTile.ok, true);
assert.equal(ruinTile.blockingObjects.length, 0);
assert.equal(ruinTile.nonBlockingObjects.length, 1);
assert.equal(ruinTile.nonBlockingObjects[0].type, 'ruin');

const occupiedStructureTile = inspectSpawnTile({
  encodedTerrain: plain,
  objects: [{ type: 'spawn', _id: 'other-spawn', x: 20, y: 29 }],
  x: 20,
  y: 29
});
assert.equal(occupiedStructureTile.ok, false);
assert.ok(occupiedStructureTile.issues.includes('occupied-tile'));
assert.equal(occupiedStructureTile.blockingObjects[0].type, 'spawn');

function makeApi(overrides = {}) {
  const base = {
    async userWorldStatus() { return { status: 'empty' }; },
    async gameRoomStatus() { return { ok: 1, room: { status: 'normal', novice: null, respawnArea: null } }; },
    async gameRoomObjects() {
      return {
        objects: [
          { type: 'controller', x: 25, y: 25, level: 0 },
          { type: 'source', x: 10, y: 10 },
          { type: 'source', x: 40, y: 40 }
        ],
        users: {}
      };
    },
    async gameRoomTerrain() { return { terrain: [{ terrain: plain }] }; },
    async gameCheckUniqueObjectName() { return { ok: 1 }; },
    async userBranches() { return { list: [{ branch: 'chatgpt' }] }; }
  };
  return Object.assign(base, overrides);
}

const pass = await verifyInitialSpawnTarget({
  api: makeApi(), room: 'E8N1', x: 20, y: 29, name: 'Spawn1', myUserId: 'me', branch: 'chatgpt'
});
assert.equal(pass.ok, true);
assert.equal(pass.roomStatus, 'normal');
assert.equal(pass.worldStatus, 'empty');
assert.equal(pass.evidence.placementEndpointCalled, false);

const reserved = await verifyInitialSpawnTarget({
  api: makeApi({
    async gameRoomObjects() {
      return {
        objects: [{ type: 'controller', x: 25, y: 25, reservation: { user: 'other' } }],
        users: { other: { username: 'OtherPlayer' } }
      };
    }
  }),
  room: 'E8N1', x: 20, y: 29, name: 'Spawn1', myUserId: 'me', branch: 'chatgpt'
});
assert.equal(reserved.ok, false);
assert.ok(reserved.failures.some(c => c.name === 'controller-unreserved'));

const wrongWorld = await verifyInitialSpawnTarget({
  api: makeApi({ async userWorldStatus() { return { status: 'normal' }; } }),
  room: 'E8N1', x: 20, y: 29, name: 'Spawn1', myUserId: 'me', branch: 'chatgpt'
});
assert.equal(wrongWorld.ok, false);
assert.ok(wrongWorld.failures.some(c => c.name === 'world-status-empty'));

console.log('spawn safety tests passed');
