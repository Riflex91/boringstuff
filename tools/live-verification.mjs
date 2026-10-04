import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_BOT_VERSION, evaluateLive, evaluateSmoke } from './live-verification-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOG_DIR = String.raw`C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt\logs`;
const LOG_DIR = process.env.SCREEPS_LOG_DIR || DEFAULT_LOG_DIR;
const ROOM = process.env.SCREEPS_ROOM || 'E8N1';

function usage(code = 0) {
  console.log(`\nLive Verification Harness v0.2.17\n\n  node live-verification.mjs smoke [--start-tick N] [--room E8N1] [--version 0.2.17-node18]\n  node live-verification.mjs live  [--start-tick N] [--room E8N1] [--version 0.2.17-node18]\n\nThe command is read-only. It evaluates existing collector evidence and never mutates Screeps or historical telemetry.\nIf --start-tick is omitted, the latest VERSION_CHANGE to the requested version is used.\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const mode = argv.shift();
  if (!['smoke', 'live'].includes(mode)) usage(2);
  const out = { mode, startTick: null, room: ROOM, version: EXPECTED_BOT_VERSION, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--start-tick') out.startTick = Number(argv[++i]);
    else if (a === '--room') out.room = String(argv[++i] || '').toUpperCase();
    else if (a === '--version') out.version = String(argv[++i] || '');
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') usage(0);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (out.startTick !== null && (!Number.isInteger(out.startTick) || out.startTick < 0)) throw new Error('--start-tick must be a non-negative integer');
  return out;
}

function matchingFiles(prefix, suffix) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter(name => name.startsWith(prefix) && name.endsWith(suffix))
    .sort()
    .map(name => path.join(LOG_DIR, name));
}

function readNdjson(prefix) {
  const rows = [];
  for (const file of matchingFiles(prefix, '.ndjson')) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch {}
    }
  }
  return rows;
}

function parseTime(line) {
  const m = String(line).match(/^(\d{4}-\d{2}-\d{2}T[^ ]+)/);
  const t = m ? Date.parse(m[1]) : NaN;
  return Number.isFinite(t) ? t : null;
}

function readErrorLines(startAt, endAt) {
  const rows = [];
  for (const prefix of ['screeps-errors-', 'collector-errors-']) {
    for (const file of matchingFiles(prefix, '.log')) {
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const t = parseTime(line);
        if (t !== null && startAt !== null && endAt !== null && (t < startAt || t > endAt)) continue;
        rows.push(line);
      }
    }
  }
  return rows;
}

function dedupeEvents(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const key = e?.jseq ? `j:${e.jseq}` : `e:${e?.tick}:${e?.code}:${JSON.stringify(e?.ctx || {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => (Number(a.tick) || 0) - (Number(b.tick) || 0) || (Number(a.jseq) || 0) - (Number(b.jseq) || 0));
}

function autoStart(events, version, mode, roomName) {
  const changes = events.filter(e => e?.code === 'VERSION_CHANGE' && (e?.ctx?.to === version || e?.v === version)).sort((a, b) => Number(a.tick) - Number(b.tick));
  if (!changes.length) throw new Error(`No VERSION_CHANGE to ${version} found. Deploy first or pass --start-tick explicitly.`);
  const deployTick = Number(changes.at(-1).tick);
  if (mode === 'smoke') return deployTick + 1;

  const candidates = events
    .filter(e => e?.code === 'STATUS_SNAPSHOT' && (!e?.v || e.v === version))
    .map(e => ({ e, last100: e?.ctx?.rooms?.[roomName]?.economy?.last100 }))
    .filter(x => Number(x.last100?.ticks) >= 100 && Number(x.last100?.startTick) > deployTick && Number(x.last100?.endTick) >= Number(x.last100?.startTick) + 99)
    .sort((a, b) => Number(a.last100.startTick) - Number(b.last100.startTick));
  if (!candidates.length) {
    throw new Error(`No complete 100-tick STATUS_SNAPSHOT window exists after deployment tick ${deployTick}. Keep the collector running, then retry.`);
  }
  return Number(candidates[0].last100.startTick);
}

function printHuman(result) {
  console.log(`VERIFY ${result.mode.toUpperCase()} ${result.startTick}-${result.endTick}: ${result.outcome}`);
  for (const c of result.checks) console.log(`${c.status.padEnd(5)} ${c.id.padEnd(24)} ${c.message}`);
  console.log(`Summary: PASS=${result.counts.pass} WATCH=${result.counts.watch} FAIL=${result.counts.fail}`);
}

const args = parseArgs(process.argv.slice(2));
const events = dedupeEvents(readNdjson('bot-events-'));
if (!events.length) throw new Error(`No bot-events-*.ndjson evidence found in ${LOG_DIR}. Run the collector first.`);
const startTick = args.startTick ?? autoStart(events, args.version, args.mode, args.room);
const tickCount = args.mode === 'smoke' ? 25 : 100;
const endTick = startTick + tickCount - 1;
const inWindow = events.filter(e => Number(e?.tick) >= startTick && Number(e?.tick) <= endTick);
const times = inWindow.map(e => Date.parse(e?.capturedAt)).filter(Number.isFinite);
const rawErrors = readErrorLines(times.length ? Math.min(...times) : null, times.length ? Math.max(...times) : null);
const retention = events.filter(e => e?.code === 'TELEMETRY_RETENTION_GAP' && Number(e?.tick || 0) <= endTick).map(e => Number(e?.ctx?.droppedThroughSeq) || 0);
const input = {
  events,
  startTick,
  roomName: args.room,
  nodeVersion: process.versions.node,
  botVersion: args.version,
  rawErrors,
  droppedThroughSeq: Math.max(0, ...retention)
};
const result = args.mode === 'smoke' ? evaluateSmoke(input) : evaluateLive(input);
if (args.json) console.log(JSON.stringify(result, null, 2)); else printHuman(result);
process.exitCode = result.outcome === 'FAIL' ? 2 : 0;
