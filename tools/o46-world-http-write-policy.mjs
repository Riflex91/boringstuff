// O46-O47: deny real World writes by BOTH explicit server identity and
// canonical outbound World host. A caller can label a ScreepsHttpClient
// 'newbieland' or mutate its baseUrl; name-only fencing is insufficient.
// The authoritative production World origin is https://screeps.com/.
export const WORLD_HTTP_MUTATION_HOLD =
  'O46_WORLD_HTTP_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR';

// URL parsing (rather than substring matching) avoids host confusion such
// as screeps.com.attacker.invalid or userinfo containing "screeps.com".
// DNS aliases, unrecognized custom proxies and direct independent clients
// remain out of scope. This is process-level defense, not an egress ACL.
export function isOfficialWorldTarget(baseUrl) {
  if (typeof baseUrl !== 'string') return false;
  let url;
  try { url = new URL(baseUrl); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  return host === 'screeps.com' || host.endsWith('.screeps.com');
}

export function assertWorldHttpReadOnly(serverName, method, endpoint, baseUrl) {
  const namedWorld = serverName === 'world';
  const addressedWorld = isOfficialWorldTarget(baseUrl);
  if (!namedWorld && !addressedWorld) return;
  if (method === 'GET' && typeof endpoint === 'string' &&
      endpoint.startsWith('/api/')) return;
  // Only a correctly identified World client can perform the auth POST
  // needed by GET-only diagnostics. Mislabeled World-target clients cannot
  // use the login exception to send POSTs to the official World server.
  if (namedWorld && method === 'POST' && endpoint === '/api/auth/signin')
    return;
  throw new Error(WORLD_HTTP_MUTATION_HOLD);
}
