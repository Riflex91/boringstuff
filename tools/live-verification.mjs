import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_BOT_VERSION, evaluateLive, evaluateSmoke } from './live-verification-core.mjs';
import { filterTimestampedLogRecords } from './live-verification-log.mjs';
import { waitForAutoStart } from './live-verification-wait.mjs';
import { DEFAULT_VERIFICATION_LOG_DIR, readDeploymentReceipt } from './deployment-receipt.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.SCREEPS_LOG_DIR || DEFAULT_VERIFICATION_LOG_DIR;
const ROOM = process.env.SCREEPS_ROOM || 'E8N1';
const SERVER = process.env.SCREEPS_SERVER || 'newbieland';
const BRANCH = process.env.SCREEPS_BRANCH || 'chatgpt';

function usage(code = 0) {
  console.log(`\nLive Verification Harness v0.3.0-shadow.8\n\n  node live-verification.mjs smoke [--start-tick N] [--room E8N1] [--version 0.3.0-shadow.8-node24]\n  node live-verification.mjs live  [--start-tick N] [--room E8N1] [--version 0.3.0-shadow.8-node24]\n\nThe command is read-only. It evaluates existing collector evidence and never mutates Screeps or historical telemetry.\nIf --start-tick is omitted, the deployment receipt requires the exact matching DEPLOYMENT_MARKER; historical runs without a matching receipt may still fall back to VERSION_CHANGE.\n`);
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

function readErrorRecords(prefix, startAt, endAt) {
  const rows = [];
  for (const file of matchingFiles(prefix, '.log')) {
    rows.push(...filterTimestampedLogRecords(fs.readFileSync(file, 'utf8'), startAt, endAt));
  }
  return rows;
}

function readErrorEvidence(startAt, endAt) {
  return {
    runtimeErrors: readErrorRecords('screeps-errors-', startAt, endAt),
    collectorErrors: readErrorRecords('collector-errors-', startAt, endAt)
  };
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

function printHuman(result) {
  console.log(`VERIFY ${result.mode.toUpperCase()} ${result.startTick}-${result.endTick}: ${result.outcome}`);
  for (const c of result.checks) console.log(`${c.status.padEnd(5)} ${c.id.padEnd(24)} ${c.message}`);
  console.log(`Summary: PASS=${result.counts.pass} WATCH=${result.counts.watch} FAIL=${result.counts.fail}`);
}

const args = parseArgs(process.argv.slice(2));
let events = dedupeEvents(readNdjson('bot-events-'));
if (!events.length) throw new Error(`No bot-events-*.ndjson evidence found in ${LOG_DIR}. Run the collector first.`);

let startTick = args.startTick;
if (startTick === null) {
  const receipt = readDeploymentReceipt({
    logDir: LOG_DIR,
    server: SERVER,
    branch: BRANCH,
    version: args.version
  });
  const expectedDeploymentId = receipt?.receipt?.deploymentId || null;

  const waited = await waitForAutoStart({
    mode: args.mode,
    version: args.version,
    roomName: args.room,
    loadEvents: () => dedupeEvents(readNdjson('bot-events-')),
    onWait: message => console.error(message),
    expectedDeploymentId
  });
  startTick = waited.startTick;
  events = waited.events;
}

const tickCount = args.mode === 'smoke' ? 25 : 100;
const endTick = startTick + tickCount - 1;
const inWindow = events.filter(e => Number(e?.tick) >= startTick && Number(e?.tick) <= endTick);
const times = inWindow.map(e => Date.parse(e?.capturedAt)).filter(Number.isFinite);
const errorEvidence = readErrorEvidence(times.length ? Math.min(...times) : null, times.length ? Math.max(...times) : null);
const retention = events.filter(e => e?.code === 'TELEMETRY_RETENTION_GAP' && Number(e?.tick || 0) <= endTick).map(e => Number(e?.ctx?.droppedThroughSeq) || 0);
const input = {
  events,
  startTick,
  roomName: args.room,
  nodeVersion: process.versions.node,
  botVersion: args.version,
  rawErrors: errorEvidence.runtimeErrors,
  collectorErrors: errorEvidence.collectorErrors,
  droppedThroughSeq: Math.max(0, ...retention)
};
const result = args.mode === 'smoke' ? evaluateSmoke(input) : evaluateLive(input);
if (args.json) console.log(JSON.stringify(result, null, 2)); else printHuman(result);
process.exitCode = result.outcome === 'FAIL' ? 2 : result.complete ? 0 : 3;
