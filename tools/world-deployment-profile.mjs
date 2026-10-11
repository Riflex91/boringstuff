// Preparation only. This module does not connect to Screeps or deploy code.
export const WORLD_PROFILE = Object.freeze({
  server: 'world',
  url: 'https://screeps.com/',
  branch: 'chatgpt',
  tokenSecret: 'SCREEPS_TOKEN_WORLD',
  enabledByDefault: false
});

export function buildWorldConfig(env = {}) {
  const token = String(env.SCREEPS_TOKEN_WORLD || '').trim();
  if (token.length < 10) throw new Error('SCREEPS_TOKEN_WORLD must be configured before World preflight');
  return { world: { url: WORLD_PROFILE.url, branch: WORLD_PROFILE.branch, token } };
}
