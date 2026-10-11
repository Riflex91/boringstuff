import assert from 'node:assert/strict';
import { WORLD_PROFILE, buildWorldConfig } from './world-deployment-profile.mjs';

assert.equal(WORLD_PROFILE.url, 'https://screeps.com/');
assert.equal(WORLD_PROFILE.enabledByDefault, false);
assert.equal(WORLD_PROFILE.branch, 'chatgpt');
assert.equal(new URL(WORLD_PROFILE.url).protocol, 'https:');
assert.throws(() => buildWorldConfig(), /SCREEPS_TOKEN_WORLD/);
assert.throws(() => buildWorldConfig({ SCREEPS_TOKEN_WORLD: 'short' }), /SCREEPS_TOKEN_WORLD/);
assert.deepEqual(buildWorldConfig({ SCREEPS_TOKEN_WORLD: ' world-token-example-123 ' }), {
  world: { url: 'https://screeps.com/', branch: 'chatgpt', token: 'world-token-example-123' }
});
console.log('World deployment profile (offline only): PASS');
