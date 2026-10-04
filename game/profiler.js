'use strict';

const logger = require('logger');

function ensure() {
  if (!Memory.bot) Memory.bot = {};
  if (!Memory.bot.cpu) Memory.bot.cpu = { sections: {}, history: [] };
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
    const used = Game.cpu.getUsed() - start;
    const s = Memory.bot.cpu.sections[name] || { avg: used, max: 0, last: 0, samples: 0 };
    s.samples += 1;
    s.last = Math.round(used * 1000) / 1000;
    s.lastTick = Game.time;
    s.avg = Math.round((s.avg * 0.9 + used * 0.1) * 1000) / 1000;
    if (used > s.max) s.max = Math.round(used * 1000) / 1000;
    Memory.bot.cpu.sections[name] = s;
  }
}

function finishTick() {
  ensure();
  const used = Math.round(Game.cpu.getUsed() * 1000) / 1000;
  Memory.bot.cpu.last = used;
  Memory.bot.cpu.bucket = Game.cpu.bucket;
  if (Game.time % 25 === 0) {
    const sections = {};
    let attributed = 0;
    for (const name in Memory.bot.cpu.sections) {
      const section = Memory.bot.cpu.sections[name];
      const current = section && section.lastTick === Game.time
        ? Math.max(0, Number(section.last) || 0)
        : 0;
      sections[name] = current;
      attributed += current;
    }
    Memory.bot.cpu.history.push({
      tick: Game.time,
      used,
      bucket: Game.cpu.bucket,
      sections,
      attributed: Math.round(attributed * 1000) / 1000,
      unattributed: Math.round(Math.max(0, used - attributed) * 1000) / 1000
    });
    if (Memory.bot.cpu.history.length > 40) Memory.bot.cpu.history.shift();
  }
}

module.exports = { section, finishTick };
