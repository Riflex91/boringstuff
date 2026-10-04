'use strict';

const config = require('config');
const telemetryJournal = require('telemetry.journal');

function install() {
  if (global.bot && global.bot.__version === config.VERSION) return;
  global.bot = {
    __version: config.VERSION,
    help: function() {
      return [
        'bot.status()                 -> compact bot status',
        'bot.logs(50)                 -> recent persisted WARN/ERROR/events',
        'bot.clearLogs()              -> clear persisted diagnostic ring buffer',
        'bot.room("W1N1")             -> room memory + live summary',
        'bot.setLogLevel("DEBUG")      -> DEBUG/INFO/WARN/ERROR/FATAL',
        'bot.telemetryStatus()         -> durable journal status / retention',
        'bot.telemetry(20)              -> recent durable telemetry records',
        'bot.dump()                    -> copy-friendly full diagnostic JSON'
      ].join('\\n');
    },
    status: function() {
      return JSON.stringify({ version: config.VERSION, tick: Game.time, cpu: Game.cpu.getUsed(), bucket: Game.cpu.bucket, creeps: Object.keys(Game.creeps).length, rooms: Object.keys(Game.rooms).filter(r => Game.rooms[r].controller && Game.rooms[r].controller.my) });
    },
    logs: function(n) {
      n = n || 50;
      return JSON.stringify((Memory.bot && Memory.bot.logs || []).slice(-n), null, 2);
    },
    clearLogs: function() {
      if (Memory.bot) Memory.bot.logs = [];
      return 'diagnostic log ring buffer cleared';
    },
    room: function(name) {
      const r = Game.rooms[name];
      if (!r) return 'room not visible: ' + name;
      return JSON.stringify({ name, controller: r.controller && { level: r.controller.level, progress: r.controller.progress, progressTotal: r.controller.progressTotal }, energy: [r.energyAvailable, r.energyCapacityAvailable], creeps: r.find(FIND_MY_CREEPS).map(c => ({ name: c.name, role: c.memory.role, ttl: c.ticksToLive })) }, null, 2);
    },
    setLogLevel: function(level) {
      return 'Edit config.js LOG_LEVEL and upload. Runtime config is immutable in this build; requested=' + level;
    },
    telemetryStatus: function() {
      return JSON.stringify(telemetryJournal.status(), null, 2);
    },
    telemetry: function(n) {
      return JSON.stringify(telemetryJournal.recent(n || 20), null, 2);
    },
    dump: function() {
      return JSON.stringify({ version: config.VERSION, tick: Game.time, stats: Memory.stats, cpu: Memory.bot && Memory.bot.cpu, logs: Memory.bot && Memory.bot.logs, intel: Memory.intel }, null, 2);
    }
  };
}

module.exports = { install };
