'use strict';

function collect(roomStates) {
  if (!Memory.stats) Memory.stats = {};
  const creeps = Object.keys(Game.creeps).length;
  const rooms = roomStates.length;
  let energy = 0;
  let hostiles = 0;
  roomStates.forEach(s => { energy += s.energyStored + s.energyAvailable; hostiles += s.hostileCreeps.length; });

  Memory.stats.tick = Game.time;
  Memory.stats.cpu = Math.round(Game.cpu.getUsed() * 1000) / 1000;
  Memory.stats.bucket = Game.cpu.bucket;
  Memory.stats.gcl = Game.gcl ? { level: Game.gcl.level, progress: Game.gcl.progress, progressTotal: Game.gcl.progressTotal } : null;
  Memory.stats.creeps = creeps;
  Memory.stats.rooms = rooms;
  Memory.stats.energy = energy;
  Memory.stats.hostiles = hostiles;
  Memory.stats.health = {};
  Memory.stats.efficiency = {};
  roomStates.forEach(s => {
    if (s.health) Memory.stats.health[s.room.name] = { score: s.health.overallScore, status: s.health.status };
    if (s.efficiency) Memory.stats.efficiency[s.room.name] = { score: s.efficiency.overallScore, status: s.efficiency.status, pressure: s.efficiency.pressure && s.efficiency.pressure.state };
  });
}

module.exports = { collect };
