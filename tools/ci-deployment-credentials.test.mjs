import assert from 'node:assert/strict';
import { buildScreepsConfig, credentialSource, NEWBIELAND_API_URL } from './ci-deployment-credentials.mjs';

assert.equal(NEWBIELAND_API_URL, 'https://screeps.newbieland.net/');
assert.equal(new URL(NEWBIELAND_API_URL).protocol, 'https:');
assert.equal(credentialSource({}), null);
assert.equal(credentialSource({
  SCREEPS_USERNAME_NEWBIELAND: 'player'
}), null);
assert.equal(credentialSource({
  SCREEPS_PASSWORD_NEWBIELAND: 'secret'
}), null);
assert.throws(() => buildScreepsConfig({}), /Missing credentials/);

const token = buildScreepsConfig({
  SCREEPS_TOKEN_NEWBIELAND: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  SCREEPS_USERNAME_NEWBIELAND: 'irrelevant',
  SCREEPS_PASSWORD_NEWBIELAND: 'irrelevant'
});
assert.deepEqual(token, {
  newbieland: {
    url: 'https://screeps.newbieland.net/',
    branch: 'chatgpt',
    token: 'aaaaaaaaaaaaaaaaaaaaaaaa'
  }
});
assert.equal(credentialSource({ SCREEPS_TOKEN_NEWBIELAND: 'token' }), 'token');
assert.throws(() => buildScreepsConfig({ SCREEPS_TOKEN_NEWBIELAND: 'tiny' }), /too short/);

const password = buildScreepsConfig({
  SCREEPS_USERNAME_NEWBIELAND: ' SteamPlayer ',
  SCREEPS_PASSWORD_NEWBIELAND: 'private-server-password'
});
assert.deepEqual(password, {
  newbieland: {
    url: 'https://screeps.newbieland.net/',
    branch: 'chatgpt',
    username: 'SteamPlayer',
    password: 'private-server-password'
  }
});
assert.equal(credentialSource({
  SCREEPS_USERNAME_NEWBIELAND: 'SteamPlayer',
  SCREEPS_PASSWORD_NEWBIELAND: 'private-server-password'
}), 'steam-linked-password');

assert.throws(() => buildScreepsConfig({
  SCREEPS_USERNAME_NEWBIELAND: 'SteamPlayer',
  SCREEPS_PASSWORD_NEWBIELAND: ''
}), /Missing credentials/);
console.log('Screeps HTTPS and Steam-linked credentials selection tests passed');
