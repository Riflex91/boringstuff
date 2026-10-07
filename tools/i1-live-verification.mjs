import fs from 'node:fs';
import path from 'node:path';
import { evaluateI1Shadow, DEFAULT_I1_WINDOW_TICKS } from './i1-live-verification-core.mjs';
import { EXPECTED_BOT_VERSION } from './live-verification-core.mjs';

const DEFAULT_LOG_DIR = String.raw`C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt\logs`;

function usage(code = 0) {
  console.log(`
I1 Live Verification

  node i1-live-verification.mjs --start-tick N [--ticks 100] [--room E8N1] [--json]

Read-only. Evaluates existing bot-events-*.ndjson evidence and does not mutate Screeps.
`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    startTick: null,
    tickCount: DEFAULT_I1_WINDOW_TICKS,
    roomName: process.env.SCREEPS_ROOM || 'E8N1',
    logDir: process.env.SCREEPS_LOG_DIR || DEFAULT_LOG_DIR,
    json: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--start-tick') out.startTick = Number(argv[++i]);
    else if (arg === '--ticks') out.tickCount = Number(argv[++i]);
    else if (arg === '--room') out.roomName = String(argv[++i] || '').toUpperCase();
    else if (arg === '--log-dir') out.logDir = String(argv[++i] || '');
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') usage(0);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (out.startTick !== null && (!Number.isInteger(out.startTick) || out.startTick < 0)) {
    throw new Error('--start-tick must be a non-negative integer');
  }
  if (!Number.isInteger(out.tickCount) || out.tickCount < 25) {
    throw new Error('--ticks must be an integer >= 25');
  }
  return out;
}

function readEvents(logDir) {
  if (!fs.existsSync(logDir)) throw new Error(`Log directory not found: ${logDir}`);
  const files = fs.readdirSync(logDir)
    .filter(name => name.startsWith('bot-events-') && name.endsWith('.ndjson'))
    .sort();
  const rows = [];
  for (const name of files) {
    const file = path.join(logDir, name);
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch {}
    }
  }

  const seen = new Set();
  return rows
    .filter(event => !event?.v || event.v === EXPECTED_BOT_VERSION)
    .filter(event => {
      const key = event?.jseq
        ? 'j:' + String(event.jseq)
        : [event?.tick, event?.code, JSON.stringify(event?.ctx || {})].join(':');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      (Number(a?.tick) || 0) - (Number(b?.tick) || 0) ||
      (Number(a?.jseq) || 0) - (Number(b?.jseq) || 0)
    );
}

function inferStartTick(events, roomName) {
  const markers = events
    .filter(event => event?.code === 'DEPLOYMENT_MARKER')
    .map(event => Number(event.tick))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
  if (markers.length) return markers.at(-1);

  const roomTicks = events
    .filter(event =>
      event?.code === 'ROOM_HEARTBEAT' &&
      String(event?.ctx?.room || '').toUpperCase() === String(roomName).toUpperCase()
    )
    .map(event => Number(event.tick))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
  return roomTicks.length ? roomTicks[0] : null;
}

function printHuman(result) {
  console.log(`VERIFY I1 ${result.startTick}-${result.endTick}: ${result.outcome}`);
  for (const item of result.checks) {
    console.log(`${item.status.padEnd(5)} ${item.id.padEnd(24)} ${item.message}`);
  }
  console.log(`Summary: PASS=${result.counts.pass} WATCH=${result.counts.watch} FAIL=${result.counts.fail}`);
  if (result.latestFrontier) {
    console.log('Latest frontier:', JSON.stringify(result.latestFrontier));
  }
}

const args = parseArgs(process.argv.slice(2));
const events = readEvents(args.logDir);
if (!events.length) throw new Error(`No bot-events-*.ndjson evidence found in ${args.logDir}. Run the collector first.`);

const startTick = args.startTick ?? inferStartTick(events, args.roomName);
if (!Number.isInteger(startTick)) {
  throw new Error('Could not infer an I1 start tick. Pass --start-tick explicitly.');
}

const result = evaluateI1Shadow({
  events,
  roomName: args.roomName,
  startTick,
  tickCount: args.tickCount
});

if (args.json) console.log(JSON.stringify(result, null, 2));
else printHuman(result);

process.exitCode = result.outcome === 'FAIL' ? 2 : result.complete ? 0 : 3;
