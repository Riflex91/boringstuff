'use strict';

const routes = require('path.routes');

// One optional comparison, after legacy survival/actions, never a move intent.
function run(states, context) {
  const game = context.game;
  const memory = context.memory;
  if (!memory.bot) memory.bot = {};
  let state = memory.bot.pathShadow;
  if (!state || state.schemaVersion !== 1) state = memory.bot.pathShadow = {
    schemaVersion: 1, authority: 'SHADOW', cursor: 0, compared: 0, incomplete: 0,
    deferred: 0, lastTick: null, lastResult: null
  };
  const defer = reason => {
    state.deferred++;
    state.lastResult = { reason, tick: game.time, complete: false };
    return state.lastResult;
  };
  if (context.lowCpu) return defer('LOW_CPU');
  if (!game.cpu || typeof game.cpu.getUsed !== 'function' || !Number.isFinite(context.cpuCeiling) ||
      game.cpu.getUsed() >= context.cpuCeiling) return defer('CPU_BUDGET');
  const candidates = [];
  for (const colony of states || []) {
    const anchor = colony.spawn;
    if (!anchor || !anchor.pos) continue;
    for (const source of colony.sources || []) {
      if (source && source.pos) candidates.push({ roomName: colony.room.name, origin: anchor.pos, target: source.pos });
    }
    if (colony.room.controller && colony.room.controller.pos) {
      candidates.push({ roomName: colony.room.name, origin: anchor.pos, target: colony.room.controller.pos });
    }
  }
  candidates.sort((a, b) => a.roomName.localeCompare(b.roomName) || a.target.x - b.target.x || a.target.y - b.target.y);
  if (!candidates.length) return defer('NO_ENDPOINTS');
  const candidate = candidates[state.cursor % candidates.length];
  state.cursor = (state.cursor + 1) % candidates.length;
  let result;
  try {
    result = routes.search(candidate.origin, { pos: candidate.target, range: 1 }, {
      maxOps: context.maxOps || 200, maxRooms: 1, ttl: 100,
      cpuCeiling: context.cpuCeiling, movement: { id: 'local-logistics' }
    }, context);
  } catch (err) {
    return defer('OPTIONAL_PATH_ERROR');
  }
  state.lastTick = game.time;
  if (result.complete) state.compared++;
  else if (result.reason === 'CPU_BUDGET') state.deferred++;
  else state.incomplete++;
  state.lastResult = {
    tick: game.time, roomName: candidate.roomName, reason: result.reason, complete: result.complete,
    steps: result.path.length, cost: Number.isFinite(result.cost) ? result.cost : null,
    ops: result.ops || 0, confidence: result.confidence, cacheHit: result.cacheHit
  };
  return state.lastResult;
}

function snapshot(memory) {
  const state = memory.bot && memory.bot.pathShadow;
  if (!state) return { authority: 'SHADOW', available: false };
  return { schemaVersion: 1, authority: 'SHADOW', available: true,
    compared: state.compared, incomplete: state.incomplete, deferred: state.deferred,
    lastTick: state.lastTick, lastResult: state.lastResult, cache: routes.summary(memory) };
}

module.exports = { run, snapshot };
