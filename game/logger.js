'use strict';

const config = require('config');
const telemetryJournal = require('telemetry.journal');

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40, FATAL: 50 };

function levelEnabled(level) {
  return (LEVELS[level] || 20) >= (LEVELS[config.LOG_LEVEL] || 20);
}

function ensureMemory() {
  if (!Memory.bot) Memory.bot = {};
  if (!Memory.bot.logs) Memory.bot.logs = [];
  if (!Memory.bot.logDedupe) Memory.bot.logDedupe = {};
}

function slim(value, depth) {
  depth = depth || 0;
  if (depth > (config.LOG_SERIALIZE_DEPTH || 6)) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) + '…' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(v => slim(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    let count = 0;
    for (const k in value) {
      if (count++ >= 30) { out.__truncated = true; break; }
      try { out[k] = slim(value[k], depth + 1); } catch (e) { out[k] = '[unserializable]'; }
    }
    return out;
  }
  return String(value);
}

function emit(level, code, message, context, opts) {
  opts = opts || {};
  if (!levelEnabled(level)) return;
  ensureMemory();

  const dedupeKey = opts.dedupeKey || (level + ':' + code + ':' + (context && context.room || ''));
  const lastTick = Memory.bot.logDedupe[dedupeKey];
  const dedupeTicks = opts.dedupeTicks === undefined ? config.LOG_DEDUPE_TICKS : opts.dedupeTicks;
  if (!opts.force && dedupeTicks > 0 && lastTick !== undefined && Game.time - lastTick < dedupeTicks) return;
  Memory.bot.logDedupe[dedupeKey] = Game.time;

  const payload = {
    v: config.VERSION,
    session: Memory.bot.sessionId || null,
    tick: Game.time,
    level,
    code,
    msg: message,
    ctx: slim(context || {})
  };

  const journalSeq = telemetryJournal.append(payload, opts);
  if (journalSeq !== null) payload.jseq = journalSeq;

  const line = '[BOTLOG]' + JSON.stringify(payload);
  console.log(line);

  if (level === 'WARN' || level === 'ERROR' || level === 'FATAL' || opts.persist) {
    Memory.bot.logs.push(payload);
    if (Memory.bot.logs.length > config.LOG_MEMORY_LIMIT) {
      Memory.bot.logs.splice(0, Memory.bot.logs.length - config.LOG_MEMORY_LIMIT);
    }
  }
}

function error(code, message, err, context) {
  const stack = err && err.stack ? String(err.stack) : String(err || 'unknown error');
  emit('ERROR', code, message, Object.assign({}, context || {}, { error: stack }), { force: true, persist: true, dedupeTicks: 0 });
}

function prune() {
  ensureMemory();
  if (Game.time % 100 !== 0) return;
  for (const key in Memory.bot.logDedupe) {
    if (Game.time - Memory.bot.logDedupe[key] > 500) delete Memory.bot.logDedupe[key];
  }
}

module.exports = {
  debug: (code, msg, ctx, opts) => emit('DEBUG', code, msg, ctx, opts),
  info: (code, msg, ctx, opts) => emit('INFO', code, msg, ctx, opts),
  warn: (code, msg, ctx, opts) => emit('WARN', code, msg, ctx, opts),
  fatal: (code, msg, ctx, opts) => emit('FATAL', code, msg, ctx, Object.assign({ force: true, persist: true }, opts || {})),
  error,
  emit,
  prune
};
