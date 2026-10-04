import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';
import zlib from 'node:zlib';
import { decodeMemoryResponse, planJournalCatchUp } from './telemetry-journal-utils.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

const config = require('../game/config.js');
config.TELEMETRY_JOURNAL_MAX_SNAPSHOTS = 2;
config.TELEMETRY_JOURNAL_MAX_EVENTS = 2;
config.TELEMETRY_JOURNAL_MAX_BYTES = 100000;

global.Memory = { bot: {} };
global.Game = { time: 100 };

const journal = require('../game/telemetry.journal.js');

function payload(code, level = 'INFO', tick = Game.time) {
  return { v: config.VERSION, session: 'E8N1-test', tick, level, code, msg: code, ctx: { room: 'E8N1', value: tick } };
}

assert.equal(journal.shouldRecord('INFO', 'BOT_HEARTBEAT', {}), false);
assert.equal(journal.shouldRecord('INFO', 'STATUS_SNAPSHOT', {}), true);
assert.equal(journal.shouldRecord('WARN', 'TEST_WARN', {}), true);

const q1 = journal.append(payload('STATUS_SNAPSHOT', 'INFO', 100), {});
const q2 = journal.append(payload('SPAWN_OK', 'INFO', 101), { persist: true });
const q3 = journal.append(payload('STATUS_SNAPSHOT', 'INFO', 200), {});
const q4 = journal.append(payload('PLAN_CHANGED', 'INFO', 201), { persist: true });
assert.deepEqual([q1, q2, q3, q4], [1, 2, 3, 4]);
assert.equal(journal.status().snapshots, 2);
assert.equal(journal.status().events, 2);
assert.equal(journal.status().journalSeq, 4);

// Per-bucket retention drops seq 1 and records that the local history is no longer complete.
journal.append(payload('STATUS_SNAPSHOT', 'INFO', 300), {});
assert.equal(journal.status().snapshots, 2);
assert.equal(journal.status().droppedThroughSeq, 1);
assert.deepEqual(journal.recent(2).map(r => r.q), [4, 5]);

const memoryObject = { modelVersion: 1, nextSeq: 6, droppedThroughSeq: 1, snapshots: Memory.bot.telemetryJournal.snapshots, events: Memory.bot.telemetryJournal.events };
const raw = JSON.stringify(memoryObject);
assert.deepEqual(decodeMemoryResponse({ data: raw }), memoryObject);
const gz = 'gz:' + zlib.gzipSync(Buffer.from(raw)).toString('base64');
assert.deepEqual(decodeMemoryResponse({ data: gz }), memoryObject);

const catchUp = planJournalCatchUp(memoryObject, 0);
assert.equal(catchUp.gap.expectedSeq, 1);
assert.equal(catchUp.gap.droppedThroughSeq, 1);
assert.deepEqual(catchUp.records.map(r => r.jseq), [2, 3, 4, 5]);
assert.equal(catchUp.records[0].code, 'SPAWN_OK');

const incremental = planJournalCatchUp(memoryObject, 3);
assert.equal(incremental.gap, null);
assert.deepEqual(incremental.records.map(r => r.jseq), [4, 5]);

// Logger integration: durable console payloads expose jseq so the live collector
// can advance the same cursor used by journal replay.
global.Memory = { bot: { sessionId: 'E8N1-live' } };
global.Game.time = 500;
const logger = require('../game/logger.js');
const originalConsoleLog = console.log;
let emittedLine = null;
console.log = line => { emittedLine = String(line); };
try {
  logger.info('VERSION_CHANGE', 'test', { from: 'a', to: 'b' }, { force: true, persist: true, dedupeTicks: 0 });
} finally {
  console.log = originalConsoleLog;
}
assert.ok(emittedLine && emittedLine.startsWith('[BOTLOG]'));
const emittedPayload = JSON.parse(emittedLine.slice('[BOTLOG]'.length));
assert.equal(emittedPayload.jseq, 1);
assert.equal(Memory.bot.telemetryJournal.events[0].q, 1);

console.log('telemetry journal tests passed');
