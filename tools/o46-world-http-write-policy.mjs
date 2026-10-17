// O46: network-bound World HTTP mutation quarantine.
// User approval strings, GitHub refs and environment variables never bypass it.
// Authentication is permitted only to support GET-only World diagnostics.
// Deliberately no explicit "allow" token exists in this module.
export const WORLD_HTTP_MUTATION_HOLD =
  'O46_WORLD_HTTP_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR';

export function assertWorldHttpReadOnly(serverName, method, endpoint) {
  if (serverName !== 'world') return;
  if (method === 'GET' && typeof endpoint === 'string' &&
      endpoint.startsWith('/api/')) return;
  if (method === 'POST' && endpoint === '/api/auth/signin') return;
  throw new Error(WORLD_HTTP_MUTATION_HOLD);
}
