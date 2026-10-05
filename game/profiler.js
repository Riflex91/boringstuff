'use strict';

const logger = require('logger');

function ensure() {
  if (!Memory.bot) Memory.bot = {};
  if (!Memory.bot.cpu) Memory.bot.cpu = {};
  if (!Memory.bot.cpu.sections) Memory.bot.cpu.sections = {};
  if (!Memory.bot.cpu.details) Memory.bot.cpu.details = {};
  if (!Array.isArray(Memory.bot.cpu.history)) Memory.bot.cpu.history = [];
}

function record(store, name, used) {
  const s = store[name] || { avg: used, max: 0, last: 0, samples: 0 };
  s.samples += 1;
  s.last = Math.round(used * 1000) / 1000;
  s.lastTick = Game.time;
  s.avg = Math.round((s.avg * 0.9 + used * 0.1) * 1000) / 1000;
  if (used > s.max) s.max = Math.round(used * 1000) / 1000;
  store[name] = s;
}

function section(name, fn, context) {
  ensure();
  const start = Game.cpu.getUsed();
  try {
    return fn();
  } catch (err) {
    logger.error('UNCAUGHT_SECTION', 'Exception in CPU section ' + name, err, context || { section: name });
    return undefined;
  } finally {
    record(Memory.bot.cpu.sections, name, Game.cpu.getUsed() - start);
  }
}

function detailSection(name, fn) {
  ensure();
  const start = Game.cpu.getUsed();
  try {
    return fn();
  } finally {
    record(Memory.bot.cpu.details, name, Game.cpu.getUsed() - start);
  }
}

function currentSamples(store) {
  const samples = {};
  for (const name in store) {
    const sample = store[name];
    samples[name] = sample && sample.lastTick === Game.time
      ? Math.max(0, Number(sample.last) || 0)
      : 0;
  }
  return samples;
}

function finishTick() {
  ensure();
  const used = Math.round(Game.cpu.getUsed() * 1000) / 1000;
  Memory.bot.cpu.last = used;
  Memory.bot.cpu.bucket = Game.cpu.bucket;
  if (Game.time % 25 === 0) {
    const sections = currentSamples(Memory.bot.cpu.sections);
    const details = currentSamples(Memory.bot.cpu.details);
    let attributed = 0;
    for (const name in sections) attributed += sections[name];
    Memory.bot.cpu.history.push({
      tick: Game.time,
      used,
      bucket: Game.cpu.bucket,
      sections,
      details,
      attributed: Math.round(attributed * 1000) / 1000,
      unattributed: Math.round(Math.max(0, used - attributed) * 1000) / 1000
    });
    if (Memory.bot.cpu.history.length > 40) Memory.bot.cpu.history.shift();
  }
}

function currentHistorySample() {
  ensure();
  const history = Memory.bot.cpu.history;
  if (!history.length) return null;
  const sample = history[history.length - 1];
  return sample && sample.tick === Game.time ? sample : null;
}

module.exports = { section, detailSection, finishTick, currentHistorySample };
