import { gunzipSync } from 'node:zlib';
import { ScreepsHttpClient } from './screeps-client.mjs';

// Read-only, non-secret diagnostics. Never print raw Memory, API responses,
// headers, credentials, code modules, or compressed payloads.
const api = await ScreepsHttpClient.fromConfig('newbieland');
const expectedDeploymentId = '20261010152608480-2377';

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
function describe(reply) {
  const data = reply?.data;
  return {
    responseType: typeOf(reply),
    ok: reply?.ok ?? null,
    hasData: !!reply && Object.prototype.hasOwnProperty.call(reply, 'data'),
    dataType: typeOf(data),
    dataEncoding: typeof data === 'string' ? data.startsWith('gz:') ? 'gz' :
      data.trimStart().startsWith('{') ? 'json' : 'other' : 'not-string',
    dataLength: typeof data === 'string' ? data.length : null
  };
}
function parse(value) {
  for (let i = 0; i < 6; i++) {
    if (typeof value === 'string') {
      try {
        value = value.startsWith('gz:')
          ? JSON.parse(gunzipSync(Buffer.from(value.slice(3), 'base64'), { maxOutputLength: 4_000_000 }).toString('utf8'))
          : JSON.parse(value);
      } catch {
        return null;
      }
    } else if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data')) {
      value = value.data;
    } else {
      break;
    }
  }
  return value && typeof value === 'object' ? value : null;
}
const pathResponse = await api.userMemory('bot');
const pathBot = parse(pathResponse);
console.log('MEMORY_PATH_META ' + JSON.stringify(describe(pathResponse)));

const rootResponse = await api.userMemory();
const root = parse(rootResponse);
console.log('MEMORY_ROOT_META ' + JSON.stringify(describe(rootResponse)));
const bot = pathBot?.deploymentId !== undefined ? pathBot : root?.bot || null;
const journal = bot?.telemetryJournal || {};
const snapshots = Array.isArray(journal.snapshots) ? journal.snapshots : [];
const events = Array.isArray(journal.events) ? journal.events : [];
const sorted = snapshots.filter(s => s?.c === 'STATUS_SNAPSHOT').sort((a,b) => Number(b.t)-Number(a.t));
const last = sorted[0];
const status = last?.x || {};
console.log('BOT_DIAGNOSTIC ' + JSON.stringify({
  foundAtPath: !!pathBot?.deploymentId,
  foundAtRoot: !!root?.bot,
  deploymentMatchesExpected: bot?.deploymentId === expectedDeploymentId,
  deploymentIdPresent: typeof bot?.deploymentId === 'string',
  deploymentTick: Number.isInteger(bot?.deploymentTick) ? bot.deploymentTick : null,
  journalEvents: events.length,
  journalSnapshots: snapshots.length,
  journalRetentionGap: journal.droppedThroughSeq || 0,
  lastEventTick: events.length ? Math.max(...events.map(e => Number(e?.t)||0)) : null,
  lastSnapshotTick: last?.t ?? null,
  cpu: Number.isFinite(Number(status.cpu)) ? Number(status.cpu) : null,
  bucket: Number.isFinite(Number(status.bucket)) ? Number(status.bucket) : null,
  roomE8N1: status.rooms?.E8N1 ? {
    rcl: status.rooms.E8N1.rcl ?? null,
    creepRoles: status.rooms.E8N1.creeps ?? null,
    energyAvailable: status.rooms.E8N1.energyAvailable ?? null,
    energyCapacity: status.rooms.E8N1.energyCapacity ?? null,
    constructionSites: status.rooms.E8N1.constructionSites ?? null,
    criticalConsumers: status.rooms.E8N1.consumerSupply?.criticalConsumers?.length ?? null
  } : null,
  fatalCodesAfterDeploy: events
    .filter(e => (Number(e?.t)||0) >= (Number(bot?.deploymentTick)||Infinity) &&
      (e.l === 'FATAL' || e.c === 'MAIN_FATAL' || e.c === 'CPU_BUCKET_CRITICAL'))
    .slice(-12).map(e => e.c)
}));
try {
 const world=await api.userWorldStatus();
 console.log('WORLD_STATUS ' + JSON.stringify({ok:world?.ok ?? null, status:world?.status ?? null}));
} catch {console.log('WORLD_STATUS unavailable');}
