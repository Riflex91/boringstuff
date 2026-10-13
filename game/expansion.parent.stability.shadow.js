'use strict';

// I4 expansion parent continuity witness, NOT expansion authorization.
// Strictly consecutive real game ticks must pass the existing parent support
// preflight. Snapshot status alone must not be called durable support.
const support = require('expansion.parent.support.shadow');
const SCHEMA_VERSION = 1;
const REQUIRED_TICKS = 100;
const MAX_OBSERVED_ROOMS = 20;

function validTick(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
function safeRoomName(name) {
  return typeof name === 'string' && /^[WE][0-9]+[NS][0-9]+$/.test(name) &&
    name.length <= 16;
}
function publicRow(name, value) {
  return {
    room: name,
    status: value.streak >= REQUIRED_TICKS && value.reason === null
      ? 'CONTINUOUS_SUPPORT_OBSERVED'
      : value.reason === null ? 'OBSERVING' : 'HOLD',
    reason: value.reason,
    firstTick: value.firstTick,
    lastTick: value.lastTick,
    consecutiveSupportTicks: value.streak,
    requiredTicks: REQUIRED_TICKS,
    actionAuthority: 'NONE',
    claimActionEnabled: false
  };
}
function unknown(reason) {
  return {
    schemaVersion: SCHEMA_VERSION, authority: 'SHADOW_EVIDENCE',
    actionAuthority: 'NONE', claimActionEnabled: false,
    status: 'UNVERIFIED', reason, requiredTicks: REQUIRED_TICKS,
    rooms: []
  };
}
function summarize(root, tick) {
  const store = root && root.bot && root.bot.expansionParentStabilityShadow;
  if (!store || store.schemaVersion !== SCHEMA_VERSION ||
      !validTick(store.lastTick) || !store.rooms ||
      typeof store.rooms !== 'object' || Array.isArray(store.rooms))
    return unknown('CONTINUITY_JOURNAL_UNAVAILABLE');
  const rows = Object.entries(store.rooms);
  if (rows.length > MAX_OBSERVED_ROOMS)
    return unknown('CONTINUITY_JOURNAL_TOO_LARGE');
  const evidence = [];
  for (const [name, row] of rows) {
    if (!safeRoomName(name) || !row ||
        !validTick(row.lastTick) || !validTick(row.streak) ||
        row.streak > REQUIRED_TICKS ||
        (row.firstTick !== null && !validTick(row.firstTick)) ||
        (row.reason !== null && typeof row.reason !== 'string'))
      return unknown('CONTINUITY_JOURNAL_INVALID');
    evidence.push(publicRow(name,row));
  }
  evidence.sort((a,b) => a.room.localeCompare(b.room));
  return {
    schemaVersion: SCHEMA_VERSION, authority: 'SHADOW_EVIDENCE',
    actionAuthority: 'NONE', claimActionEnabled: false,
    status: validTick(tick) && store.lastTick === tick
      ? 'OBSERVATIONS_AVAILABLE' : 'STALE',
    reason: null, requiredTicks: REQUIRED_TICKS,
    lastTick: store.lastTick,
    rooms: evidence
  };
}
function observe(roomStates, game, memoryRoot) {
  const tick = game && game.time;
  if (!validTick(tick) || !Array.isArray(roomStates) ||
      roomStates.length > MAX_OBSERVED_ROOMS ||
      !memoryRoot || typeof memoryRoot !== 'object' ||
      !memoryRoot.bot || typeof memoryRoot.bot !== 'object')
    return unknown('ROOM_OR_RUNTIME_EVIDENCE_UNAVAILABLE');

  const names = new Set();
  for (const state of roomStates) {
    const name = state && state.room && state.room.name;
    if (!safeRoomName(name) || names.has(name) ||
        state.room.controller?.my !== true)
      return unknown('OWNED_ROOM_EVIDENCE_INVALID');
    names.add(name);
  }

  const previous = memoryRoot.bot.expansionParentStabilityShadow;
  const prior = previous && previous.schemaVersion === SCHEMA_VERSION &&
    previous.rooms && !Array.isArray(previous.rooms) &&
    typeof previous.rooms === 'object' ? previous.rooms : {};
  const next = {};
  for (const state of roomStates) {
    const name = state.room.name;
    const assessment = support.assess(state);
    const pass = assessment.status === 'ADVISORY_OK' &&
      assessment.reason === null;
    const old = Object.prototype.hasOwnProperty.call(prior,name)
      ? prior[name] : null;
    const validOld = old && validTick(old.streak) && old.streak > 0 &&
      old.streak <= REQUIRED_TICKS && validTick(old.lastTick) &&
      validTick(old.firstTick) && old.firstTick <= old.lastTick &&
      old.lastTick - old.firstTick + 1 >= old.streak &&
      old.reason === null;
    // Same-tick reevaluation cannot manufacture additional observed ticks.
    const continues = pass && validOld &&
      (old.lastTick === tick || old.lastTick === tick - 1);
    const streak = !pass ? 0 : continues
      ? old.lastTick === tick ? old.streak
        : Math.min(REQUIRED_TICKS,old.streak+1) : 1;
    next[name] = {
      streak,
      firstTick: !pass ? null
        : continues ? old.firstTick : tick,
      lastTick: tick,
      reason: pass ? null : (assessment.reason || 'PARENT_SUPPORT_UNVERIFIED')
    };
  }
  // Rebuild from currently observed owned rooms: an unobserved or lost room
  // cannot carry an old apparently continuous support window into the future.
  memoryRoot.bot.expansionParentStabilityShadow = {
    schemaVersion: SCHEMA_VERSION, lastTick: tick, rooms: next
  };
  return summarize(memoryRoot,tick);
}
module.exports = {SCHEMA_VERSION,REQUIRED_TICKS,MAX_OBSERVED_ROOMS,
  observe,snapshot:summarize};
