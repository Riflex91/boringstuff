import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const NEWBIELAND_API_URL = 'https://screeps.newbieland.net/';

export function credentialSource(env = {}) {
  const token = String(env.SCREEPS_TOKEN_NEWBIELAND || '').trim();
  if (token) return 'token';
  const username = String(env.SCREEPS_USERNAME_NEWBIELAND || '').trim();
  const password = String(env.SCREEPS_PASSWORD_NEWBIELAND || '');
  if (username && password) return 'steam-linked-password';
  return null;
}

export function buildScreepsConfig(env = {}) {
  const source = credentialSource(env);
  if (!source) {
    throw new Error('Missing credentials: configure SCREEPS_TOKEN_NEWBIELAND or both SCREEPS_USERNAME_NEWBIELAND and SCREEPS_PASSWORD_NEWBIELAND in GitHub Actions Secrets');
  }

  const entry = { url: NEWBIELAND_API_URL, branch: 'chatgpt' };
  if (source === 'token') {
    const token = String(env.SCREEPS_TOKEN_NEWBIELAND).trim();
    if (token.length < 10) throw new Error('Screeps token is too short');
    entry.token = token;
  } else {
    entry.username = String(env.SCREEPS_USERNAME_NEWBIELAND).trim();
    entry.password = String(env.SCREEPS_PASSWORD_NEWBIELAND);
  }
  return { newbieland: entry };
}

function createConfigFile(target, env) {
  if (!target || typeof target !== 'string') throw new Error('SCREEPS_CONFIG path is required');
  const config = buildScreepsConfig(env);
  // Credentials never appear in stdout, logs, source control, CLI arguments,
  // or the artifact uploaded with the deployment receipt.
  fs.writeFileSync(path.resolve(target), JSON.stringify(config), { mode: 0o600, flag: 'wx' });
  return credentialSource(env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = createConfigFile(process.env.SCREEPS_CONFIG, process.env);
  console.log('Screeps HTTPS configuration created; credential type: ' + source);
}
