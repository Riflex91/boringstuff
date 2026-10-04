import assert from 'node:assert/strict';
import { filterTimestampedLogRecords, parseTimestampedLogRecords } from './live-verification-log.mjs';

const sample = [
  'orphan stack line before any timestamp',
  '2026-10-04T09:00:00.000Z Could not parse BOTLOG: SyntaxError: old failure',
  '    at JSON.parse (<anonymous>)',
  '    at classify (file:///collector.mjs:31:28)',
  '2026-10-04T10:21:30.000Z websocket current failure',
  '    at WebSocket.emit (node:events:517:28)',
  ''
].join('\n');

const records = parseTimestampedLogRecords(sample);
assert.equal(records.length, 2);
assert.equal(records[0].lines.length, 3);
assert.equal(records[1].lines.length, 2);

const start = Date.parse('2026-10-04T10:21:00.000Z');
const end = Date.parse('2026-10-04T10:22:00.000Z');
const current = filterTimestampedLogRecords(sample, start, end);
assert.equal(current.length, 1);
assert.match(current[0], /websocket current failure/);
assert.doesNotMatch(current[0], /old failure/);
assert.doesNotMatch(current[0], /JSON\.parse/);

console.log('live verification log tests passed');
