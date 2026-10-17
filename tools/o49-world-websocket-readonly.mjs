import { resolveSafeScreepsApiTarget } from './o48-safe-api-target.mjs';
import { isOfficialWorldTarget } from './o46-world-http-write-policy.mjs';

// O49 read-only WebSocket diagnostics (cooperating ScreepsSocketClient only).
// No arbitrary user console eval, memory updates or game mutation commands.
export const WORLD_WS_MUTATION_HOLD =
  'O49_WORLD_WEBSOCKET_HOLD_READ_ONLY_DIAGNOSTICS';

const reject=()=>{throw new Error(WORLD_WS_MUTATION_HOLD);};

export function resolveSafeScreepsSocketTarget(httpBaseUrl) {
  // Validate the same HTTP baseURL and reverse-proxy containment as O48.
  resolveSafeScreepsApiTarget(httpBaseUrl,'/api/auth/me');
  const base=new URL(httpBaseUrl);
  let target;
  try {
    target=new URL('socket/websocket',base);
    if(target.origin!==base.origin ||
       !target.pathname.startsWith(base.pathname) ||
       target.search || target.hash || target.username || target.password)
      reject();
  } catch { reject(); }
  target.protocol=base.protocol==='https:'?'wss:':'ws:';
  return target;
}

export function assertReadOnlyScreepsWsCommand(serverName,httpBaseUrl,
  command,authToken) {
  const protectedTarget = serverName==='world' ||
    isOfficialWorldTarget(httpBaseUrl);
  if(!protectedTarget) return;
  if(typeof command!=='string' || command.length>512) reject();
  // Never treat a multiline/whitespace token as a valid command payload.
  // A malicious token with a newline must not smuggle a second WS command.
  if(typeof authToken==='string' &&
      /^[^\s\x00-\x1f\x7f]{1,500}$/.test(authToken) &&
      command==='auth '+authToken) return;
  if(/^subscribe user:[A-Za-z0-9_-]{1,80}\/(?:console|cpu)$/.test(command))
    return;
  reject();
}

export function protectScreepsSocketSend(ws,serverName,httpBaseUrl,authToken) {
  if(!ws || typeof ws.send!=='function') reject();
  if(serverName!=='world' && !isOfficialWorldTarget(httpBaseUrl)) return ws;
  // Validate authentication material before the send interceptor is installed.
  assertReadOnlyScreepsWsCommand(serverName,httpBaseUrl,
    'auth '+authToken,authToken);
  // Lock method against accidental direct socket.ws.send(...) bypass.
  // Not a sandbox: independent WS implementations remain outside contract.
  const rawSend=ws.send.bind(ws);
  Object.defineProperty(ws,'send',{
    configurable:false,writable:false,enumerable:false,
    value:(data,...args)=>{
      assertReadOnlyScreepsWsCommand(serverName,httpBaseUrl,data,authToken);
      return rawSend(data,...args);
    }
  });
  return ws;
}
