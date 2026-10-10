import { gunzipSync } from 'node:zlib';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { pathToFileURL } from 'node:url';
import { readDeploymentReceipt, DEFAULT_VERIFICATION_LOG_DIR } from './deployment-receipt.mjs';

const server = process.env.SCREEPS_SERVER || 'newbieland';
const branch = process.env.SCREEPS_BRANCH || 'chatgpt';
const room = process.env.SCREEPS_ROOM || 'E8N1';
const mode = process.argv[2];

export function parseBotMemory(reply) {
  let value = reply;
  for (let n = 0; n < 6; n++) {
    if (typeof value === 'string') {
      try {
        // Screeps /api/user/memory sends gz: + base64(gzip(JSON)) on
        // official and compatible private servers, not always raw JSON.
        // Bound inflation so malformed/untrusted responses fail closed.
        value = value.startsWith('gz:')
          ? JSON.parse(gunzipSync(Buffer.from(value.slice(3), 'base64'),
              { maxOutputLength: 4_000_000 }).toString('utf8'))
          : JSON.parse(value);
      } catch { return null; }
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (typeof value.deploymentId === 'string') return value;
    if (Object.prototype.hasOwnProperty.call(value, 'data')) {
      value = value.data;
      continue;
    }
    return null;
  }
  return value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.deploymentId === 'string' ? value : null;
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
  // A newer journal event can prove elapsed ticks but cannot prove room state
  // at the end of that window. Require the status snapshot itself to be fresh.
  const minimumSnapshotTick = tick + minTicks;
  const last = snapshots.filter(s => s && s.c === 'STATUS_SNAPSHOT' &&
    Number.isFinite(Number(s.t)) && Number(s.t) >= minimumSnapshotTick)
    .sort((a, b) => Number(b.t) - Number(a.t))[0] || null;
  const currentTick = Math.max(tick,
    ...snapshots.map(s => Number(s?.t) || 0),
    ...events.map(e => Number(e?.t) || 0));
  if (currentTick - tick < minTicks) {
    return { status: 'WAIT', reason: 'OBSERVATION_WINDOW_INCOMPLETE',
      tick, observedTicks: currentTick - tick };
  }
  if (!last) {
    // Snapshots are on a fixed 100-tick cadence; do not turn normal
    // post-window cadence lag into a false pass or a premature failure.
    return { status: 'WAIT', reason: 'POST_WINDOW_STATUS_SNAPSHOT_PENDING',
      tick, observedTicks: currentTick - tick, minimumSnapshotTick };
  }
  if (!last.x || !last.x.rooms || !last.x.rooms[room]) {
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
  // The final healthy bucket cannot erase a critical dip at a prior
  // post-deployment STATUS_SNAPSHOT. This is snapshot evidence only:
  // events already cover logged CPU_BUCKET_CRITICAL between samples.
  const sampled = snapshots.filter(s => s && s.c === 'STATUS_SNAPSHOT' &&
    Number.isInteger(s.t) && s.t >= tick && s.t <= Number(last.t) &&
    s.x && typeof s.x.bucket === 'number' && Number.isFinite(s.x.bucket));
  const critical = sampled.filter(s => s.x.bucket < 1000);
  if (critical.length) {
    return { status: 'FAIL', reason: 'INTERMEDIATE_CPU_BUCKET_CRITICAL', tick,
      observedTicks: currentTick - tick,
      criticalSnapshotTicks: critical.slice(0, 8).map(s => s.t),
      minimumSnapshotBucket: Math.min(...sampled.map(s => s.x.bucket)) };
  }
  const cpuSamples = sampled.filter(s => typeof s.x.cpu === 'number' &&
    Number.isFinite(s.x.cpu));
  const minimumSnapshotBucket = Math.min(...sampled.map(s => s.x.bucket));
  const maximumSnapshotCpu = cpuSamples.length
    ? Math.max(...cpuSamples.map(s => s.x.cpu)) : cpu;
  if (!Number.isFinite(Number(roomStatus.rcl)) ||
      Number(roomStatus.rcl) <= 0 ||
      !roomStatus.creeps || typeof roomStatus.creeps !== 'object') {
    return { status: 'FAIL', reason: 'INVALID_ROOM_STATE', tick };
  }
  return { status: 'PASS', deploymentTick: tick, observedTicks: currentTick - tick,
    snapshotTick: last.t, rcl: roomStatus.rcl, cpu, bucket,
    checkedCpuSnapshots: sampled.length, minimumSnapshotBucket, maximumSnapshotCpu,
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (mode !== 'preflight' && mode !== 'verify') {
    throw new Error('Usage: node ci-deployment-guard.mjs preflight|verify');
  }
  const api = await ScreepsHttpClient.fromConfig(server);
  if (mode === 'preflight') await preflight(api);
  else await verify(api);
}
