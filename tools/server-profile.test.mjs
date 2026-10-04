import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.OK = 0;
global.ERR_GCL_NOT_ENOUGH = -15;
global.ERR_FULL = -8;
global.ERR_INVALID_TARGET = -7;
global.ERR_NOT_OWNER = -1;
global.ERR_BUSY = -4;

let serverProfile = require('../game/server.profile.js');

{
  const memory = {};
  const game = { time: 100 };
  const profile = serverProfile.ensure(memory);
  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.claimPolicy.discoveredClaimLimit, null);
  assert.equal(profile.claimPolicy.confidence, 0);
  assert.deepEqual(profile.claimPolicy.observations, []);

  serverProfile.observeClaimResult(ERR_GCL_NOT_ENOUGH, {
    roomName: 'E1N1', ownedRooms: 3, gclLevel: 4
  }, memory, game);

  assert.equal(memory.bot.serverProfile.claimPolicy.discoveredClaimLimit, 3);
  assert.equal(memory.bot.serverProfile.claimPolicy.confidence, 0.25);
  assert.equal(memory.bot.serverProfile.claimPolicy.lastFailure.result, 'CLAIM_CAPACITY');
  assert.equal(memory.bot.serverProfile.claimPolicy.lastFailure.tick, 100);

  // Simulate a code reload/restart: module-local state disappears, Memory remains.
  delete require.cache[require.resolve('../game/server.profile.js')];
  serverProfile = require('../game/server.profile.js');
  const restarted = serverProfile.snapshot(memory);
  assert.equal(restarted.claimPolicy.discoveredClaimLimit, 3);
  assert.equal(restarted.claimPolicy.confidence, 0.25);
  assert.equal(restarted.claimPolicy.observationCount, 1);

  serverProfile.observeClaimResult(OK, {
    roomName: 'E2N2', ownedRooms: 2, gclLevel: 4
  }, memory, { time: 200 });
  const afterSuccess = serverProfile.snapshot(memory);
  assert.equal(afterSuccess.claimPolicy.discoveredClaimLimit, 3);
  assert.equal(afterSuccess.claimPolicy.confidence, 0.30);
  assert.equal(afterSuccess.claimPolicy.lastFailure, null);
}

{
  const memory = {};
  serverProfile.observeClaimResult(ERR_FULL, {
    roomName: 'W1N1', ownedRooms: 5, gclLevel: 10
  }, memory, { time: 300 });
  const snap = serverProfile.snapshot(memory);
  assert.equal(snap.claimPolicy.discoveredClaimLimit, 5);
  assert.equal(snap.claimPolicy.lastFailure.result, 'SERVER_CAPACITY');
}

{
  assert.equal(serverProfile.normalizeClaimResult(ERR_INVALID_TARGET).kind, 'INVALID_TARGET');
  assert.equal(serverProfile.normalizeClaimResult(ERR_NOT_OWNER).kind, 'NOT_OWNER');
  assert.equal(serverProfile.normalizeClaimResult(ERR_BUSY).kind, 'BUSY');
  assert.equal(serverProfile.normalizeClaimResult(-999).kind, 'OTHER');
}

{
  const memory = {};
  for (let i = 0; i < 20; i++) {
    serverProfile.observeClaimResult(-999, { roomName: 'E0N0' }, memory, { time: i });
  }
  assert.equal(memory.bot.serverProfile.claimPolicy.observations.length, 12);
  assert.equal(memory.bot.serverProfile.claimPolicy.observations[0].tick, 8);
}

console.log('server profile tests passed');