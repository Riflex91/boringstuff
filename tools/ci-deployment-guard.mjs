import { ScreepsHttpClient } from './screeps-client.mjs';
import { readDeploymentReceipt, DEFAULT_VERIFICATION_LOG_DIR } from './deployment-receipt.mjs';

const server = process.env.SCREEPS_SERVER || 'newbieland';
const branch = process.env.SCREEPS_BRANCH || 'chatgpt';
const room = process.env.SCREEPS_ROOM || 'E8N1';
const mode = process.argv[2];
if (mode !== 'preflight' && mode !== 'verify') {
  throw new Error('Usage: node ci-deployment-guard.mjs preflight|verify');
}

export function parseBotMemory(reply) {
  let value = reply;
  for (let n = 0; n < 4; n++) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { return null; }
      continue;
    }
    if (!value || typeof value !== 'object') return null;
    if (value.deploymentId !== undefined) return value;
    if (value.data !== undefined) { value = value.data; continue; }
    return null;
  }
  return value && typeof value === 'object' && value.deploymentId ? value : null;
}

export function inspectDeployment(bot, deploymentId, minTicks = 25) {
  if (!bot || typeof bot !== 'object') return { status: 'WAIT', reason: 'NO_MEMORY' };
  if (bot.deploymentId !== deploymentId) {
    return { status: 'WAIT', reason: 'DEPLOYMENT_NOT_ACTIVE' };
  }
  const tick = Number(bot.deploymentTick);
  if (!Number.isInteger(tick) || tick <= 0) {
    return { status: 'FAIL', reason: 'INVALID_DEPLOYMENT_TICK' };
  }
  const journal = bot.telemetryJournal || {};
  const events = Array.isArray(journal.events) ? journal.events : [];
  const marker = events.find(e => e && e.c === 'DEPLOYMENT_MARKER' &&
    e.x && e.x.deploymentId === deploymentId && e.t === tick);
  if (!marker) return { status: 'FAIL', reason: 'MISSING_DEPLOYMENT_MARKER', tick };

  const fatal = events.filter(e => e && Number(e.t) >= tick &&
    (e.l === 'FATAL' || e.c === 'MAIN_FATAL' || e.c === 'CPU_BUCKET_CRITICAL'));
  if (fatal.length) {
    return { status: 'FAIL', reason: 'RUNTIME_FATAL_OR_CRITICAL_CPU', tick,
      codes: fatal.slice(0, 10).map(e => e.c) };
  }
  const snapshots = Array.isArray(journal.snapshots) ? journal.snapshots : [];
  const last = snapshots.filter(s => s && s.c === 'STATUS_SNAPSHOT' &&
    Number(s.t) >= tick).sort((a, b) => b.t - a.t)[0] || null;
  const currentTick = Math.max(tick,
    ...snapshots.map(s => Number(s?.t) || 0),
    ...events.map(e => Number(e?.t) || 0));
  if (currentTick - tick < minTicks) {
    return { status: 'WAIT', reason: 'OBSERVATION_WINDOW_INCOMPLETE',
      tick, observedTicks: currentTick - tick };
  }
  if (!last || !last.x || !last.x.rooms || !last.x.rooms[room]) {
    return { status: 'FAIL', reason: 'NO_ROOM_STATUS_AFTER_DEPLOYMENT', tick,
      observedTicks: currentTick - tick };
  }
  const roomStatus = last.x.rooms[room];
  const cpu = Number(last.x.cpu);
  const bucket = Number(last.x.bucket);
  if (!Number.isFinite(cpu) || !Number.isFinite(bucket) || bucket < 1000) {
    return { status: 'FAIL', reason: 'INVALID_CPU_OR_LOW_BUCKET', tick,
      observedTicks: currentTick - tick };
  }
  if (!Number.isFinite(Number(roomStatus.rcl)) ||
      Number(roomStatus.rcl) <= 0 ||
      !roomStatus.creeps || typeof roomStatus.creeps !== 'object') {
    return { status: 'FAIL', reason: 'INVALID_ROOM_STATE', tick };
  }
  return { status: 'PASS', deploymentTick: tick, observedTicks: currentTick - tick,
    snapshotTick: last.t, rcl: roomStatus.rcl, cpu, bucket,
    roles: roomStatus.creeps,
    constructionSites: roomStatus.constructionSites,
    energyAvailable: roomStatus.energyAvailable,
    energyCapacity: roomStatus.energyCapacity,
    criticalConsumers: roomStatus.consumerSupply?.criticalConsumers?.length || 0 };
}

async function preflight(api) {
  const data = await api.userBranches();
  const entries = Array.isArray(data?.list) ? data.list : [];
  const exact = entries.find(e => e && e.branch === branch);
  const active = typeof exact?.activeWorld === 'boolean'
    ? exact.activeWorld : typeof data?.activeWorld === 'string'
      ? data.activeWorld === branch : null;
  if (active !== true) {
    throw new Error('FAIL CLOSED: target branch is not confirmed activeWorld. No upload performed.');
  }
  const me = await api.authMe();
  if (!me || !(me._id || me.id || me.username)) {
    throw new Error('FAIL CLOSED: Screeps authentication is not confirmed.');
  }
  const before = await api._request('GET', '/api/user/code', { branch });
  if (!before || !before.modules || typeof before.modules !== 'object') {
    throw new Error('FAIL CLOSED: previous live modules cannot be backed up.');
  }
  console.log('PASS: authenticated target branch, activeWorld and backup read verified');
}

async function verify(api) {
  const receipt = readDeploymentReceipt({
    logDir: process.env.SCREEPS_LOG_DIR || DEFAULT_VERIFICATION_LOG_DIR,
    server, branch
  });
  const id = receipt?.receipt?.deploymentId;
  if (!id) throw new Error('FAIL CLOSED: exact deployment receipt missing');
  const timeLimit = Date.now() + 15 * 60 * 1000;
  let last = null;
  while (Date.now() < timeLimit) {
    const response = await api.userMemory('bot');
    const bot = parseBotMemory(response);
    last = inspectDeployment(bot, id, 100);
    if (last.status === 'PASS') {
      console.log('LIVE_100T_PASS ' + JSON.stringify(last));
      return;
    }
    if (last.status === 'FAIL') {
      throw new Error('LIVE_100T_FAIL ' + JSON.stringify(last));
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error('LIVE_100T_INCOMPLETE ' + JSON.stringify(last));
}

if (import.meta.url === new URL('file://' + process.argv[1]).href) {
  const api = await ScreepsHttpClient.fromConfig(server);
  if (mode === 'preflight') await preflight(api);
  else await verify(api);
}
