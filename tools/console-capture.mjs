import { ScreepsHttpClient, ScreepsSocketClient } from './screeps-client.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { parseBotLogLine } from './console-utils.mjs';
import { createContiguousSequenceCursor, decodeMemoryResponse, planJournalCatchUp } from './telemetry-journal-utils.mjs';

const DEFAULT_LOG_DIR = String.raw`C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt\logs`;
const LOG_DIR = process.env.SCREEPS_LOG_DIR || DEFAULT_LOG_DIR;
const SERVER = process.env.SCREEPS_SERVER || 'newbieland';
const CURSOR_PATH = path.join(LOG_DIR, `telemetry-cursor-${SERVER}.json`);
const LOCK_PATH = path.join(LOG_DIR, `collector-${SERVER}.lock`);
const LOCK_STALE_MS = 120000;

fs.mkdirSync(LOG_DIR, { recursive: true });

function dateKey() { return new Date().toISOString().slice(0, 10); }
function stamp() { return new Date().toISOString(); }
function append(name, line) { fs.appendFileSync(path.join(LOG_DIR, `${name}-${dateKey()}.log`), line + '\n', 'utf8'); }
function appendJson(name, obj) { fs.appendFileSync(path.join(LOG_DIR, `${name}-${dateKey()}.ndjson`), JSON.stringify(obj) + '\n', 'utf8'); }

function processAlive(pid) {
  try { process.kill(Number(pid), 0); return true; }
  catch (err) { return err && err.code === 'EPERM'; }
}

let lockHeartbeat = null;
function writeLock() {
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, heartbeatAt: stamp(), server: SERVER }) + '\n', 'utf8');
}

function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(LOCK_PATH, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: stamp(), heartbeatAt: stamp(), server: SERVER }) + '\n', 'utf8');
      fs.closeSync(fd);
      lockHeartbeat = setInterval(() => { try { writeLock(); } catch {} }, 30000);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let stale = true;
      try {
        const existing = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
        const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
        stale = age > LOCK_STALE_MS || !existing.pid || !processAlive(existing.pid);
      } catch {}
      if (stale) {
        try { fs.unlinkSync(LOCK_PATH); } catch {}
        continue;
      }
      throw new Error(`Collector already running for '${SERVER}'. Lock: ${LOCK_PATH}`);
    }
  }
  throw new Error(`Could not acquire collector lock: ${LOCK_PATH}`);
}

function releaseLock() {
  clearInterval(lockHeartbeat);
  lockHeartbeat = null;
  try {
    const existing = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (Number(existing.pid) === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch {}
}

function loadCursor() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CURSOR_PATH, 'utf8'));
    return Math.max(0, Number(parsed.lastSeq) || 0);
  } catch { return 0; }
}

const initialCursor = loadCursor();
const sequenceCursor = createContiguousSequenceCursor(initialCursor);
let persistedCursor = initialCursor;

function saveCursor() {
  const next = sequenceCursor.value;
  if (next === persistedCursor && fs.existsSync(CURSOR_PATH)) return;
  persistedCursor = next;
  const tmp = CURSOR_PATH + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify({ server: SERVER, lastSeq: next, updatedAt: stamp() }, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CURSOR_PATH);
}

function writeLatestStatus(event) {
  const latestPath = path.join(LOG_DIR, 'bot-status-latest.json');
  let existingTick = -1;
  try { existingTick = Number(JSON.parse(fs.readFileSync(latestPath, 'utf8')).tick) || -1; } catch {}
  if ((Number(event.tick) || 0) >= existingTick) {
    fs.writeFileSync(latestPath, JSON.stringify(event, null, 2) + '\n', 'utf8');
  }
}

function persistBotPayload(payload, shard, meta = {}) {
  if (!payload) return false;
  const jseq = Number(payload.jseq) || 0;
  if (jseq && !sequenceCursor.canObserve(jseq)) return false;

  const event = { capturedAt: stamp(), shard: shard || null, ...meta, ...payload };
  appendJson('bot-events', event);
  if (payload.code === 'STATUS_SNAPSHOT') {
    appendJson('telemetry', { ...event, type: 'bot-status' });
    writeLatestStatus(event);
  }
  if (payload.level === 'ERROR' || payload.level === 'FATAL' || payload.level === 'WARN') appendJson('bot-problems', event);

  if (jseq) {
    const observed = sequenceCursor.observe(jseq);
    if (observed.advanced) saveCursor();
  }
  return true;
}

let replayInProgress = false;
let queuedConsole = [];

function classify(line, shard) {
  const record = { capturedAt: stamp(), shard: shard || null, line };
  append('screeps-console', `${record.capturedAt} ${shard ? '[' + shard + '] ' : ''}${line}`);

  if (line.includes('[BOTLOG]')) {
    try {
      const payload = parseBotLogLine(line);
      persistBotPayload(payload, shard, { source: 'live-console' });
      return;
    } catch (err) {
      append('collector-errors', `${stamp()} Could not parse BOTLOG: ${err.stack || err}`);
    }
  }
  if (/error|exception|stack|fatal/i.test(line)) append('screeps-errors', `${record.capturedAt} ${line}`);
}

function emitRetentionGap(gap) {
  const event = {
    capturedAt: stamp(),
    shard: null,
    source: 'journal-catchup',
    level: 'WARN',
    code: 'TELEMETRY_RETENTION_GAP',
    msg: 'Durable telemetry journal no longer contains every record after the local cursor',
    ctx: gap
  };
  appendJson('bot-events', event);
  appendJson('bot-problems', event);
  append('collector', `${event.capturedAt} retention-gap expected=${gap.expectedSeq} droppedThrough=${gap.droppedThroughSeq} latest=${gap.latestSeq}`);
}

async function fetchJournal(api) {
  const response = await api.userMemory('bot.telemetryJournal');
  const decoded = decodeMemoryResponse(response);
  return decoded && typeof decoded === 'object' ? decoded : null;
}

let catchUpPromise = null;
async function catchUp(api) {
  if (catchUpPromise) return catchUpPromise;
  replayInProgress = true;
  catchUpPromise = (async () => {
    const started = stamp();
    try {
      const journal = await fetchJournal(api);
      if (!journal) {
        append('collector', `${started} catchup=no-journal cursor=${sequenceCursor.value}`);
        return;
      }
      const plan = planJournalCatchUp(journal, sequenceCursor.value);
      if (plan.gap) {
        emitRetentionGap(plan.gap);
        const skipped = sequenceCursor.skipThrough(plan.gap.droppedThroughSeq);
        if (skipped.advanced) saveCursor();
      }
      let replayed = 0;
      for (const payload of plan.records) {
        if (persistBotPayload(payload, null, { source: 'journal-replay', recovered: true })) replayed++;
      }
      append('collector', `${stamp()} catchup=ok replayed=${replayed} cursor=${sequenceCursor.value} latest=${plan.latestSeq}`);
    } catch (err) {
      append('collector-errors', `${stamp()} journal catch-up failed: ${err?.stack || err}`);
      console.error('Journal catch-up failed:', err?.message || err);
    }
  })().finally(() => {
    catchUpPromise = null;
    replayInProgress = false;
    const pending = queuedConsole;
    queuedConsole = [];
    for (const item of pending) classify(item.line, item.shard);
  });
  return catchUpPromise;
}

acquireLock();
process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(130); });
process.on('SIGTERM', () => { releaseLock(); process.exit(143); });

console.log(`Screeps log collector starting. Server config: ${SERVER}`);
console.log(`Writing to: ${LOG_DIR}`);
console.log(`Durable telemetry cursor: ${sequenceCursor.value}`);

const api = await ScreepsHttpClient.fromConfig(SERVER);

api.socket.on(ScreepsSocketClient.CONNECTED, () => {
  console.log('Connected to Screeps websocket.');
  append('collector', `${stamp()} connected`);
});
api.socket.on(ScreepsSocketClient.DISCONNECTED, () => {
  console.log('Disconnected from Screeps websocket.');
  append('collector', `${stamp()} disconnected`);
});
api.socket.on(ScreepsSocketClient.AUTH, event => {
  console.log('Auth:', event.data.status);
  append('collector', `${stamp()} auth=${event.data.status}`);
  if (event.data.status === 'ok') void catchUp(api);
});
api.socket.on(ScreepsSocketClient.ERROR, err => {
  append('collector-errors', `${stamp()} websocket ${err?.stack || err}`);
  console.error('WebSocket error:', err?.message || err);
});

await api.socket.connect();
if (catchUpPromise) await catchUpPromise;

await api.socket.subscribeUserConsole(event => {
  const { messages, error, shard } = event.data;
  const feed = [];
  if (error) feed.push(String(error));
  if (messages) {
    for (const line of (messages.log || [])) feed.push(String(line));
    for (const line of (messages.results || [])) feed.push('< ' + String(line));
  }
  for (const line of feed) {
    if (replayInProgress) queuedConsole.push({ line, shard });
    else classify(line, shard);
  }
});

await api.socket.subscribeUserCpu(event => {
  appendJson('telemetry', { capturedAt: stamp(), type: 'cpu', ...event.data });
});

process.on('uncaughtException', err => {
  append('collector-errors', `${stamp()} uncaughtException ${err.stack || err}`);
  console.error(err);
});
process.on('unhandledRejection', err => {
  append('collector-errors', `${stamp()} unhandledRejection ${err && err.stack || err}`);
  console.error(err);
});
