// O48: fail-closed API URL constructor. No network or credentials here.
// Checking only client.server.baseUrl is insufficient: new URL(endpoint, base)
// would accept a fully qualified "https://screeps.com/api/user/code" even
// when the client was nominally connected to Newbieland.
export const SCREEPS_API_TARGET_HOLD='O48_API_TARGET_HOLD_UNSAFE_ENDPOINT';

const component = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function resolveSafeScreepsApiTarget(baseUrl,endpoint) {
  if(typeof endpoint!=='string' || endpoint.length>256 ||
      !endpoint.startsWith('/api/')) throw new Error(SCREEPS_API_TARGET_HOLD);
  const parts=endpoint.split('/');
  if(parts.length<3 || parts[0]!=='' || parts[1]!=='api' ||
      parts.slice(2).some(part=>!component.test(part)))
    throw new Error(SCREEPS_API_TARGET_HOLD);

  let base,target;
  try {
    base=new URL(baseUrl);
    if(!['https:','http:'].includes(base.protocol) ||
       base.username || base.password || base.search || base.hash ||
       !base.pathname.endsWith('/')) throw new Error('invalid base');
    // Use the prevalidated relative API segment, preserving explicit
    // reverse-proxy prefixes from a configured server.path.
    target=new URL(endpoint.slice(1),base);
  } catch {
    throw new Error(SCREEPS_API_TARGET_HOLD);
  }
  if(target.origin!==base.origin || target.username || target.password ||
     target.search || target.hash || !target.pathname.startsWith(base.pathname))
    throw new Error(SCREEPS_API_TARGET_HOLD);
  return target;
}
