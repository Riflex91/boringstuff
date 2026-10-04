'use strict';

const config = require('config');

const MODEL_VERSION = 1;

function ensureMemory() {
  if (!Memory.bot) Memory.bot = {};
  let journal = Memory.bot.telemetryJournal;
  if (!journal || journal.modelVersion !== MODEL_VERSION) {
    journal = {
      modelVersion: MODEL_VERSION,
      nextSeq: 1,
      droppedThroughSeq: 0,
      approxBytes: 0,
      snapshots: [],
      events: []
    };
    Memory.bot.telemetryJournal = journal;
  }
  if (!Array.isArray(journal.snapshots)) journal.snapshots = [];
  if (!Array.isArray(journal.events)) journal.events = [];
  if (!Number.isFinite(journal.nextSeq) || journal.nextSeq < 1) journal.nextSeq = 1;
  if (!Number.isFinite(journal.droppedThroughSeq) || journal.droppedThroughSeq < 0) journal.droppedThroughSeq = 0;
  if (!Number.isFinite(journal.approxBytes) || journal.approxBytes < 0) {
    journal.approxBytes = 0;
    journal.snapshots.concat(journal.events).forEach(r => { journal.approxBytes += Number(r && r.b) || estimateRecordBytes(r); });
  }
  return journal;
}

function estimateRecordBytes(record) {
  try { return JSON.stringify(record).length; }
  catch (err) { return 512; }
}

function dropRecord(journal, bucketName) {
  const bucket = journal[bucketName];
  const record = bucket && bucket.shift();
  if (!record) return false;
  journal.approxBytes = Math.max(0, journal.approxBytes - (Number(record.b) || estimateRecordBytes(record)));
  journal.droppedThroughSeq = Math.max(journal.droppedThroughSeq || 0, Number(record.q) || 0);
  return true;
}

function prune(journal) {
  const maxSnapshots = config.TELEMETRY_JOURNAL_MAX_SNAPSHOTS || 512;
  const maxEvents = config.TELEMETRY_JOURNAL_MAX_EVENTS || 1500;
  const maxBytes = config.TELEMETRY_JOURNAL_MAX_BYTES || 700000;

  while (journal.snapshots.length > maxSnapshots) dropRecord(journal, 'snapshots');
  while (journal.events.length > maxEvents) dropRecord(journal, 'events');

  while (journal.approxBytes > maxBytes && (journal.snapshots.length || journal.events.length)) {
    const s = journal.snapshots[0];
    const e = journal.events[0];
    if (!s) dropRecord(journal, 'events');
    else if (!e) dropRecord(journal, 'snapshots');
    else if ((Number(s.q) || 0) <= (Number(e.q) || 0)) dropRecord(journal, 'snapshots');
    else dropRecord(journal, 'events');
  }
}

function shouldRecord(level, code, opts) {
  opts = opts || {};
  if (opts.journal === false) return false;
  if (opts.journal === true || opts.persist) return true;
  if (code === 'STATUS_SNAPSHOT') return true;
  return level === 'WARN' || level === 'ERROR' || level === 'FATAL';
}

function append(payload, opts) {
  if (!payload || !payload.code) return null;
  if (!shouldRecord(payload.level, payload.code, opts)) return null;

  const journal = ensureMemory();
  const seq = journal.nextSeq++;
  const record = {
    q: seq,
    t: payload.tick,
    v: payload.v,
    s: payload.session || null,
    l: payload.level,
    c: payload.code,
    m: payload.msg,
    x: payload.ctx || {}
  };
  record.b = estimateRecordBytes(record) + 16;

  const bucket = payload.code === 'STATUS_SNAPSHOT' ? journal.snapshots : journal.events;
  bucket.push(record);
  journal.approxBytes += record.b;
  prune(journal);
  return seq;
}

function allRecords(journal) {
  journal = journal || ensureMemory();
  return journal.snapshots.concat(journal.events).sort((a, b) => (a.q || 0) - (b.q || 0));
}

function status() {
  const journal = ensureMemory();
  const records = allRecords(journal);
  return {
    modelVersion: journal.modelVersion,
    journalSeq: Math.max(0, journal.nextSeq - 1),
    droppedThroughSeq: journal.droppedThroughSeq || 0,
    oldestSeq: records.length ? records[0].q : null,
    newestSeq: records.length ? records[records.length - 1].q : null,
    snapshots: journal.snapshots.length,
    events: journal.events.length,
    records: records.length,
    approxBytes: journal.approxBytes || 0,
    maxBytes: config.TELEMETRY_JOURNAL_MAX_BYTES || 700000,
    oldestTick: records.length ? records[0].t : null,
    latestTick: records.length ? records[records.length - 1].t : null
  };
}

function recent(n) {
  n = Math.max(1, Math.min(Number(n) || 20, 200));
  return allRecords(ensureMemory()).slice(-n);
}

module.exports = { MODEL_VERSION, ensureMemory, shouldRecord, append, status, recent, allRecords };
